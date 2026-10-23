// What the Discord gateway sends, and the readings of one payload that need no connection behind
// them. Everything that knows the shape of a gateway frame is here: the socket in `gateway.ts`
// does the connecting and hands each frame through these, and the provider only ever sees the
// message below.
//
// Ids are snowflakes — 64-bit numbers written as strings, above what a number holds exactly — so
// every id stays a string the whole way through and the store is what gives out numbers.

import { clientName, discordWords } from "./settings";

// The frames this road acts on. A gateway payload is `{ op, d, s, t }`, and the op is what it is.
export const gatewayOps = {
  dispatch: 0,
  heartbeat: 1,
  identify: 2,
  resume: 6,
  reconnect: 7,
  invalidSession: 9,
  hello: 10,
  heartbeatAck: 11,
} as const;

// What this road asks to be sent: the guilds it is in, their messages, direct messages, and the
// content of a message. The last one is privileged — an application over a hundred servers is
// reviewed for it — and without it a guild message arrives with its content empty, which is why
// the road says so plainly rather than reading empty words as a quiet room.
export const guildsIntent = 1 << 0;
export const guildMessagesIntent = 1 << 9;
export const directMessagesIntent = 1 << 12;
export const messageContentIntent = 1 << 15;
export const gatewayIntents = guildsIntent | guildMessagesIntent | directMessagesIntent | messageContentIntent;

// The close code the gateway sends when an intent this road asks for has not been enabled for the
// application. It is not a connection that failed: nothing about trying again makes it work.
export const disallowedIntentsClose = 4014;

export interface GatewayFrame {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

// One message as this road hands it on. A channel, a person and a message are all snowflakes; the
// words are what the person typed, and an attachment is named rather than fetched.
export interface DiscordMessage {
  kind: "said" | "edited" | "deleted";
  channelId: string;
  // The guild the channel belongs to, or null in a direct message. It is what the room is called
  // by, together with the channel's name, where the payload says so.
  guildId: string | null;
  messageId: string;
  // The message this one answers, where it answers one.
  replyToId: string | null;
  authorId: string;
  authorName: string;
  // Whether the author is an application rather than a person. The agent's own words come back on this
  // socket like everybody else's, and this is how they are told apart.
  authorIsBot: boolean;
  text: string;
  // Sent at, in epoch milliseconds.
  sentAt: number;
  files: { name: string; contentType: string | null; url: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFrame(raw: string): GatewayFrame | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    return isRecord(parsed) && typeof parsed.op === "number" ? (parsed as unknown as GatewayFrame) : null;
  } catch {
    return null;
  }
}

// The dispatch names this road acts on, and what each one means for the record.
const messageKinds: Record<string, DiscordMessage["kind"]> = {
  MESSAGE_CREATE: "said",
  MESSAGE_UPDATE: "edited",
  MESSAGE_DELETE: "deleted",
};

// A dispatch frame as a message, or null where it is a dispatch this road does not act on or a
// payload missing what a message cannot be without. A deletion carries no author and no words —
// the payload is the ids alone — so it is answered with what it has.
export function parseDispatch(frame: GatewayFrame, now = Date.now()): DiscordMessage | null {
  const kind = frame.t === null || frame.t === undefined ? undefined : messageKinds[frame.t];
  const payload = frame.d;

  if (kind === undefined || !isRecord(payload)) {
    return null;
  }

  const channelId = payload.channel_id;
  const messageId = payload.id;

  if (typeof channelId !== "string" || typeof messageId !== "string") {
    return null;
  }

  const author = isRecord(payload.author) ? payload.author : null;
  const referenced = isRecord(payload.message_reference) ? payload.message_reference : null;
  const timestamp = typeof payload.timestamp === "string" ? Date.parse(payload.timestamp) : Number.NaN;
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];

  return {
    kind,
    channelId,
    guildId: typeof payload.guild_id === "string" ? payload.guild_id : null,
    messageId,
    replyToId: typeof referenced?.message_id === "string" ? referenced.message_id : null,
    authorId: typeof author?.id === "string" ? author.id : "",
    authorName: typeof author?.global_name === "string"
      ? author.global_name
      : typeof author?.username === "string" ? author.username : discordWords.unknown_sender,
    authorIsBot: author?.bot === true,
    text: typeof payload.content === "string" ? payload.content : "",
    sentAt: Number.isNaN(timestamp) ? now : Math.round(timestamp),
    files: attachments.flatMap((attachment) => {
      if (!isRecord(attachment) || typeof attachment.url !== "string") {
        return [];
      }

      return [{
        name: typeof attachment.filename === "string" ? attachment.filename : discordWords.unnamed_file,
        contentType: typeof attachment.content_type === "string" ? attachment.content_type : null,
        url: attachment.url,
      }];
    }),
  };
}

// What the road says to open a session: who it is, what it asks to be sent, and enough about
// itself for the platform's own bookkeeping. The token is in the frame because that is where the
// gateway takes it; nothing prints this frame.
export function identifyFrame(token: string): string {
  return JSON.stringify({
    op: gatewayOps.identify,
    d: { token, intents: gatewayIntents, properties: { os: "linux", browser: clientName(), device: clientName() } },
  });
}

// Taking a dropped session up where it left off, which is what keeps a room's messages from
// arriving twice or not at all across a blip.
export function resumeFrame(token: string, sessionId: string, seq: number | null): string {
  return JSON.stringify({ op: gatewayOps.resume, d: { token, session_id: sessionId, seq } });
}

export function heartbeatFrame(seq: number | null): string {
  return JSON.stringify({ op: gatewayOps.heartbeat, d: seq });
}
