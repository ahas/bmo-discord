// The chat protocol's pieces as the gateway speaks them to the service: bmo-chat's wire shapes (its
// `docs/contract.md`), written out for the calls the gateway makes and answers, and the gateway's own provider
// shape the seam's routes ask. Numbers are the provider's own; Discord's snowflakes never cross.

export type ChatVoice = "bot-account" | "human-reader" | "human-avatar" | "human-as-agent" | "direct";

export type ChatVerb =
  | "text"
  | "photo"
  | "album"
  | "document"
  | "audio"
  | "voice"
  | "sticker"
  | "reaction"
  | "pin"
  | "typing"
  | "edit"
  | "delete";

export type ChatCapability = ChatVerb | "replyTo" | "fetchMedia" | "avatars" | "history";

export type RoomKind = "owner" | "group";

// What every send carries beside its verb.
interface SendCommon {
  chatId: number;
  as?: ChatVoice | null;
  speaker?: { agent: string } | null;
  tag?: string | null;
}

export type AlbumItem = { address: string } | { name: string; mime: string; bytes: string };

// One send into one room. Bytes are base64, as the wire carries them.
export type ChatSendRequest = SendCommon & (
  | { verb: "text"; text: string; replyTo?: number | null; silent?: boolean; fold?: boolean }
  | { verb: "photo"; imageUrl: string; caption?: string | null; replyTo?: number | null }
  | { verb: "album"; items: AlbumItem[]; caption?: string | null; replyTo?: number | null }
  | { verb: "document"; bytes: string; fileName: string; replyTo?: number | null }
  | { verb: "audio"; audio: string; fileName: string; replyTo?: number | null }
  | { verb: "voice"; audio: string; said: string; transcript?: string | null; caption?: string | null; replyTo?: number | null }
  | { verb: "sticker"; emoji: string }
  | { verb: "reaction"; messageId: number; emoji: string }
  | { verb: "pin"; messageId: number; on: boolean; silent?: boolean }
  | { verb: "typing"; on: boolean }
  | { verb: "edit"; messageId: number; text: string }
  | { verb: "delete"; messageId: number }
);

// Why a send was not performed, as its code, the provider's label and the code's fields. The English sentence
// is written by the service, from these.
export type ChatRefusal =
  | { code: "unsupported-capability"; label: string; capability: ChatCapability }
  | { code: "not-ready"; label: string }
  | { code: "platform"; label: string; detail: string };

export type ChatSendResult =
  | { sent: true; messageId: number | null }
  | { sent: false; refusal: ChatRefusal; gone: boolean };

// A message a room said, as it crosses to the receiver.
export interface ChatMessage {
  chatId: number;
  messageId: number;
  senderId: number | null;
  senderName: string;
  sentAt: number;
  text: string;
  replyToMessageId: number | null;
  via: string;
  album: number | null;
  mode: ChatVoice;
}

// What the platform said about a message beyond the message itself.
export interface InboundChatContext {
  roomTitle?: string | null;
  senderUsername?: string | null;
  replyToSenderId?: number | null;
  spokenText?: string | null;
  metadata?: unknown;
  carriesFile?: boolean;
  gathering?: boolean;
  tag?: string | null;
}

// The receiver as the gateway hands it what its rooms say: through the service's inbound route.
export interface ChatReceiver {
  message(message: ChatMessage, context: InboundChatContext): Promise<void>;
  edited(message: ChatMessage, context: InboundChatContext): Promise<void>;
}

// A send of a verb this provider does not carry.
export function verbRefusal(label: string, verb: ChatVerb): ChatRefusal {
  return { code: "unsupported-capability", label, capability: verb };
}

export function notReady(label: string): ChatRefusal {
  return { code: "not-ready", label };
}

export function platformRefusal(label: string, detail: string): ChatRefusal {
  return { code: "platform", label, detail };
}
