// The chat protocol's pieces as the gateway speaks them to the service: bmo-chat's wire shapes (its
// `docs/contract.md` and `docs/protocol.md`), written out for what the seam carries. Numbers are the provider's
// own; Discord's snowflakes never cross. Times are epoch milliseconds.

export type ChatVoice = "bot-account" | "human-reader" | "human-avatar" | "own-account" | "direct";

export type MessageOrigin = "live" | "edit" | "history";

export type RoomKind = "owner" | "group";

export type ChatFileKind =
  | "photo"
  | "video"
  | "round-video"
  | "animation"
  | "audio"
  | "voice-note"
  | "sticker"
  | "document";

// What every send carries beside its kind.
export interface SendCommon {
  roomId: number;
  mode?: ChatVoice | null;
  speaker?: string | null;
  tag?: string | null;
  prefix?: string | null;
  replyToMessageId?: number | null;
  // The account the send goes out in, by the number the caller knows it by; none for the provider's own.
  accountId?: number | null;
}

export type AlbumItem = { address: string } | { name: string; mime: string; bytes: string };

// One send into one room, as `POST /sends` takes it. Bytes are base64, as the wire carries them.
export type ChatSendRequest = SendCommon & (
  | { kind: "text"; fields: { text: string; silent?: boolean; fold?: boolean } }
  | { kind: "photo"; fields: { imageUrl: string; caption?: string | null } }
  | { kind: "album"; fields: { items: AlbumItem[]; caption?: string | null } }
  | { kind: "document"; fields: { bytes: string; fileName: string } }
  | { kind: "audio"; fields: { audio: string; fileName: string } }
  | { kind: "voice"; fields: { audio: string; said: string; caption?: string | null; transcript?: string | null } }
  | { kind: "sticker"; fields: { emoji: string } }
  | { kind: "reaction"; fields: { messageId: number; emoji: string } }
  | { kind: "pin"; fields: { messageId: number; on: boolean; silent?: boolean } }
  | { kind: "typing"; fields: { on: boolean } }
  | { kind: "edit"; fields: { messageId: number; text: string } }
  | { kind: "delete"; fields: { messageId: number } }
);

// A picture of an album that did not go, with why.
export interface MissedPicture {
  address: string;
  reason: { code: string; message: string; detail?: string };
}

// A send the provider performed: the answer of `POST /sends`.
export interface ChatSent {
  messageId: number | null;
  missed: MissedPicture[];
}

// What the platform said about a message beyond the message itself.
export interface InboundChatContext {
  roomTitle?: string | null;
  senderUsername?: string | null;
  replyToSenderId?: number | null;
  spokenText?: string | null;
  metadata?: unknown;
  carriesFile?: boolean;
  tag?: string | null;
}

// What the provider already knows of the room a hand-over came from.
export interface RoomFacts {
  kind?: RoomKind | null;
  identity?: number | null;
  privateTo?: number | null;
}

// A file a message carried, where it is already gathered.
export interface MessageFile {
  id: string;
  name: string;
  mime: string;
  bytes: string;
  kind?: ChatFileKind | null;
}

// A message as a provider hands it over, under the room and message number the route's path names.
export interface HandedMessage {
  origin: MessageOrigin;
  senderId: number | null;
  senderName: string;
  sentAt: number;
  text: string;
  replyToMessageId: number | null;
  via: string;
  album: number | null;
  mode: ChatVoice;
  context: InboundChatContext;
  room: RoomFacts;
  files: MessageFile[];
  gathering: boolean;
  gatherFailure?: string | null;
}

// A person writing in a room now, or no longer, as `POST /typing-marks` takes it.
export interface TypingMark {
  via: string;
  roomId: number;
  personId: number;
  on: boolean;
  // How long the mark stands unless told again, in milliseconds.
  lastsMs: number | null;
}

export type ChatPresenceState = "online" | "away" | "offline";

// One person's presence beside the rooms they stand in, which the service narrows to the rooms the receiving
// side listens to.
export interface PersonInRooms {
  personId: number;
  state: ChatPresenceState;
  lastSeenAt: number | null;
  roomIds: number[];
}

// People's presence, as the service's `POST /presence-changes` takes it; `whole` where the list is every person
// the provider tells presence of.
export interface PresenceInRooms {
  via: string;
  people: PersonInRooms[];
  whole: boolean;
}

// Whether the bot account's socket hears one thing now, and where it does not, why.
export interface Heard {
  heard: boolean;
  reason: string | null;
}

// A room as a provider knows it, and the room to reach the owner in.
export interface ProviderRoom {
  id: number;
  owns: boolean;
  identity: number | null;
  kind: RoomKind;
  privateTo: number | null;
  title: string | null;
  // The voices whose account answers the room; the service keeps those its declaration has active.
  modes?: ChatVoice[] | null;
}

// One person in a room, as a provider lists a room's members: the person's number, null where the provider has
// given them none, what the room calls them, and their status line.
export interface ChatMember {
  person: number | null;
  name: string;
  statusMessage: string | null;
}

export interface ProviderOwner {
  roomId: number | null;
}

export interface ChatHealth {
  ready: boolean;
  reason: string | null;
  version: string;
}

// The error shape: a code to match on and an English sentence.
export interface WireError {
  code: string;
  error: string;
}

// A send the gateway does not perform, answered as the error shape with this code and sentence. The service
// puts the provider's label before the sentence where the code is `platform`.
export class Refusal extends Error {
  constructor(
    readonly code: "platform" | "not-ready" | "unsupported-capability" | "gone",
    readonly detail: string,
    readonly status: number,
  ) {
    super(detail);
  }
}

export function platformRefusal(detail: string): Refusal {
  return new Refusal("platform", detail, 422);
}

export function notReady(): Refusal {
  return new Refusal("not-ready", "The gateway is not ready yet.", 503);
}
