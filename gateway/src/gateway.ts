// The socket this road listens on. Discord pushes everything a bot sees down one WebSocket, and
// keeping it open is three things: answering the hello with an identify, sending a heartbeat on
// the beat the hello named, and opening a new socket when the old one drops — resuming where the
// platform lets it and starting fresh where it does not.
//
// No SDK. What a library would do here is these hundred lines plus everything this road does not
// use, and a dependency that speaks for a platform is a dependency that decides for it.

import {
  disallowedIntentsClose,
  gatewayOps,
  heartbeatFrame,
  identifyFrame,
  parseDispatch,
  parseFrame,
  resumeFrame,
} from "./events";

import type { DiscordMessage } from "./events";

export const gatewayUrl = "wss://gateway.discord.gg/?v=10&encoding=json";

const reconnectMinMs = 5_000;
const reconnectMaxMs = 60_000;

export interface DiscordSocket {
  stop(): void;
}

interface Session {
  id: string;
  resumeUrl: string;
}

// One socket, kept open, for one account. `hand` is given every message the gateway dispatches;
// what it does with one is the provider's business and a failure in it never takes the socket
// down. `bot` says whether the token is an application's, which is how the identify is written and
// whether an intent refusal can arrive at all.
export function openGateway(
  account: { token: string; bot: boolean },
  hand: (message: DiscordMessage) => void,
): DiscordSocket {
  const { token, bot } = account;
  let socket: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let session: Session | null = null;
  let seq: number | null = null;
  let delay = reconnectMinMs;
  let stopped = false;
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
        opening.send(session === null ? identifyFrame(token, bot) : resumeFrame(token, session.id, seq));

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
        console.log(`discord: gateway session open (${bot ? "bot account" : "person's account"})`);

        return;
      }

      const message = parseDispatch(frame);

      if (message === null) return;

      try {
        hand(message);
      } catch (error) {
        console.error(`discord: message ${message.messageId} in channel ${message.channelId} failed:`, error);
      }
    });

    opening.addEventListener("close", (event) => {
      if (heartbeat !== null) clearInterval(heartbeat);

      heartbeat = null;

      // An intent the application has not been given is not a blip: trying again does the same
      // thing for ever, so the road says which one and stands down. A person's account asks for no
      // intent and is never sent this.
      if (bot && event.code === disallowedIntentsClose) {
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
    stop() {
      stopped = true;

      if (heartbeat !== null) clearInterval(heartbeat);
      if (reopening !== null) clearTimeout(reopening);

      socket?.close();
      socket = null;
    },
  };
}
