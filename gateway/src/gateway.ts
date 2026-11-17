// The socket this road listens on. Discord pushes everything a bot sees down one WebSocket, and
// keeping it open is three things: answering the hello with an identify, sending a heartbeat on
// the beat the hello named, and opening a new socket when the old one drops — resuming where the
// platform lets it and starting fresh where it does not. What it hears it hands on read: a message,
// a typing start, a presence update, and a guild as a session's start delivers it.
//
// No SDK. What a library would do here is these hundred lines plus everything this road does not
// use, and a dependency that speaks for a platform is a dependency that decides for it.

import {
  authenticationFailedClose,
  disallowedIntentsClose,
  gatewayOps,
  heartbeatFrame,
  identifyFrame,
  parseDispatch,
  parseFrame,
  parseGuild,
  parsePresence,
  parseTyping,
  readyGuilds,
  resumeFrame,
} from "./events";

import type { DiscordGuild, DiscordMessage, DiscordPresence, DiscordTyping, GatewayFrame } from "./events";

export const gatewayUrl = "wss://gateway.discord.gg/?v=10&encoding=json";

const reconnectMinMs = 5_000;
const reconnectMaxMs = 60_000;

export interface DiscordSocket {
  stop(): void;
  // Opens the socket again with a fresh identify, so the intents it asks for are read again.
  renew(): void;
}

// What the socket hands on, and what it asks of its owner. A failure in any of them is said and never takes
// the socket down.
export interface GatewayListener {
  // Whether the next identify asks for the presence intent.
  asksPresence(): boolean;
  // Discord refused an identify that asked for the presence intent, which it has not granted.
  presenceRefused(): void;
  // Discord refused the token the identify carried; the socket has stood down.
  tokenRejected(): void;
  // A session ready, with the guilds it names, or one resumed, with none.
  opened(guildIds: string[] | null): void;
  // The socket closed; it runs again once a session is ready or resumed.
  closed(): void;
  message(message: DiscordMessage): void;
  typing(typing: DiscordTyping): void;
  presence(presence: DiscordPresence): void;
  guild(guild: DiscordGuild): void;
}

interface Session {
  id: string;
  resumeUrl: string;
}

// Each dispatch this road acts on, read and handed to its listener; none where it acts on none.
function handOn(frame: GatewayFrame, listener: GatewayListener): void {
  const message = parseDispatch(frame);

  if (message !== null) {
    return listener.message(message);
  }

  const typing = parseTyping(frame);

  if (typing !== null) {
    return listener.typing(typing);
  }

  const presence = parsePresence(frame);

  if (presence !== null) {
    return listener.presence(presence);
  }

  const guild = parseGuild(frame);

  if (guild !== null) {
    listener.guild(guild);
  }
}

// Says a listener's failure and goes on.
function guarded(what: string, work: () => void): void {
  try {
    work();
  } catch (error) {
    console.error(`discord: ${what} failed:`, error);
  }
}

// One socket, kept open, for one account, handing what it hears to `listener`; what it does with it is
// the provider's business. The token is the application's bot token, the one account the road listens as.
export function openGateway(account: { token: string }, listener: GatewayListener): DiscordSocket {
  const { token } = account;
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let session: Session | null = null;
  let seq: number | null = null;
  let delay = reconnectMinMs;
  let stopped = false;
  // Whether the identify of the socket now open asked for the presence intent.
  let askedPresence = false;
  let reopening: ReturnType<typeof setTimeout> | null = null;

  const beat = (every: number): void => {
    if (heartbeat !== null) clearInterval(heartbeat);

    heartbeat = setInterval(() => socket?.send(heartbeatFrame(seq)), every);
  };

  const later = (): void => {
    if (stopped) return;

    reopening = setTimeout(connect, delay);
    delay = Math.min(delay * 2, reconnectMaxMs);
  };

  function connect(): void {
    if (stopped) return;

    const url = session?.resumeUrl ?? gatewayUrl;
    const opening = new WebSocket(url);

    socket = opening;

    opening.addEventListener("message", (event) => {
      const frame = parseFrame(typeof event.data === "string" ? event.data : String(event.data));

      if (frame === null) return;

      if (typeof frame.s === "number") seq = frame.s;

      if (frame.op === gatewayOps.hello) {
        const every = (frame.d as { heartbeat_interval?: number } | undefined)?.heartbeat_interval ?? 41_250;

        beat(every);

        // A session this road still holds is taken up where it left off; without one it says who
        // it is and starts a new one.
        if (session === null) {
          askedPresence = listener.asksPresence();
          opening.send(identifyFrame(token, askedPresence));
        } else {
          opening.send(resumeFrame(token, session.id, seq));
        }

        return;
      }

      // The platform asking for a new socket, and a session it will not resume: both are answered
      // by opening again, the second with nothing held.
      if (frame.op === gatewayOps.reconnect || frame.op === gatewayOps.invalidSession) {
        if (frame.op === gatewayOps.invalidSession) session = null;

        opening.close();

        return;
      }

      if (frame.op !== gatewayOps.dispatch) return;

      if (frame.t === "READY") {
        const ready = frame.d as { session_id?: string; resume_gateway_url?: string } | undefined;

        delay = reconnectMinMs;
        session = ready?.session_id === undefined
          ? null
          : { id: ready.session_id, resumeUrl: `${ready.resume_gateway_url ?? gatewayUrl}/?v=10&encoding=json` };
        console.log("discord: gateway session open (bot account)");
        guarded("a session's start", () => listener.opened(readyGuilds(frame)));

        return;
      }

      if (frame.t === "RESUMED") {
        guarded("a session's resume", () => listener.opened(null));

        return;
      }

      guarded(`the ${frame.t ?? "unnamed"} dispatch`, () => handOn(frame, listener));
    });

    opening.addEventListener("close", (event) => {
      if (heartbeat !== null) clearInterval(heartbeat);

      heartbeat = null;
      guarded("the socket's close", () => listener.closed());

      // An intent the application has not been given is not a blip. Where the identify asked for
      // presence, that is the one taken away and the socket opens again at once without it; otherwise
      // trying again does the same thing for ever, so the road says which one and stands down.
      if (event.code === disallowedIntentsClose && askedPresence) {
        session = null;
        askedPresence = false;
        guarded("the presence intent's refusal", () => listener.presenceRefused());
        reopening = setTimeout(connect, 0);

        return;
      }

      if (event.code === authenticationFailedClose) {
        stopped = true;
        console.error("discord: the gateway rejected BMO_DISCORD_TOKEN — the bot account's socket stands down");
        guarded("the token's rejection", () => listener.tokenRejected());

        return;
      }

      if (event.code === disallowedIntentsClose) {
        stopped = true;
        console.error(
          "discord: the gateway refused the connection because a privileged intent is not enabled — turn MESSAGE_CONTENT on for this application in the developer portal",
        );

        return;
      }

      // A session can only be resumed over a session's own close codes; anything in the 4000s
      // that is not one of those starts again from nothing.
      if (event.code >= 4000 && event.code !== 4000 && event.code !== 4008) session = null;

      later();
    });

    opening.addEventListener("error", () => {
      // The close handler does the reopening; an error on its own says only that the socket is
      // going, and saying it twice would open two.
      console.error("discord: gateway socket error");
    });
  }

  connect();

  return {
    renew() {
      session = null;
      delay = reconnectMinMs;
      socket?.close();
    },

    stop() {
      stopped = true;

      if (heartbeat !== null) clearInterval(heartbeat);
      if (reopening !== null) clearTimeout(reopening);

      socket?.close();
      socket = null;
    },
  };
}
