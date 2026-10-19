// The avatar mode, written once. A road that reads by a person's account — the owner's own — and lets
// the agent answer in it plugs its own connection into what stands here, and nothing of the mode is
// written again in the road: the prefix the agent's words carry, the number the agent's words are
// filed under, which rooms are answered in that voice, what a message from that account is, and how a
// send settles on its voice. `docs/discord.md`, 「The avatar voice」, is the contract.
//
// The account is a person's, so the agent's words and the owner's come in under the same platform
// account. Only the prefix tells them apart, which is why everything the agent puts out in that voice
// carries it and why a message carrying it is never read as the owner's.

import { avatarPrefixSetting, senderName } from "./settings";

import type { ChatSendRequest, ChatVoice } from "./chat";
import type { ArchivedMessage, Store } from "./store";

// What the agent's words begin with in a person's account, as they go out: the prefix the deployment
// wrote from the agent's registration, or null where none is set and the avatar voice does not stand.
export function avatarPrefix(): string | null {
  return avatarPrefixSetting();
}

// What recognises them as they come back. A platform may trim the space after the colon — a
// caption that is the prefix alone comes back without it — so the colon is where the mark ends.
function avatarMark(): string | null {
  return avatarPrefix()?.trimEnd() ?? null;
}

export function isAvatarText(text: string): boolean {
  const mark = avatarMark();

  return mark !== null && text.trimStart().startsWith(mark);
}

// The words without the prefix, which is what the record keeps of the agent's own: the prefix is how
// the room tells the agent from the owner, and the agent's own message is already handed over as the
// agent's.
export function stripAvatarPrefix(text: string): string {
  const mark = avatarMark();

  if (mark === null || !isAvatarText(text)) {
    return text;
  }

  const rest = text.trimStart().slice(mark.length);

  return rest.startsWith(" ") ? rest.slice(1) : rest;
}

// The words as they go out in the avatar voice. Words that already carry the prefix go as they are.
export function withAvatarPrefix(text: string): string {
  const prefix = avatarPrefix();

  return prefix === null || isAvatarText(text) ? text : `${prefix}${text}`;
}

// The platform user id the agent's avatar voice is numbered by. No platform hands out an id of this
// shape, so it can never be somebody's.
const avatarUser = "agent:avatar";

// The number the agent's words in the avatar voice are filed under on this road. It is a person of the
// provider's own numbering, and never the owner's number, although the platform account is the owner's:
// the receiver tells the agent's words from the owner's by it.
export async function avatarIdentity(archive: Store, provider: string): Promise<number> {
  return await archive.providerNumbers().providerSenderId(provider, avatarUser);
}

// A road's voice has been heard in this room. A voice that answers where it reaches — the bot
// account, an account of the agent's own — is written down over whatever stood; the avatar voice is
// written only where nothing stands, so a room another account is in stays that account's.
export async function heardInRoom(archive: Store, provider: string, chatId: number, voice: ChatVoice): Promise<void> {
  await archive.chats().setRoomVoice(provider, chatId, voice, voice !== "human-avatar");
}

export async function answersAsAvatar(archive: Store, provider: string, chatId: number): Promise<boolean> {
  return await archive.chats().roomVoice(provider, chatId) === "human-avatar";
}

// Who the agent is in this room: the avatar voice's own number where the room is answered in it, and the
// road's other identity everywhere else.
export async function roomIdentity(archive: Store, provider: string, chatId: number, otherwise: number | null): Promise<number | null> {
  return await answersAsAvatar(archive, provider, chatId) ? avatarIdentity(archive, provider) : otherwise;
}

// Whether this room is the owner's private chat with the agent. A room answered in the avatar voice
// never is: a one-to-one of the owner's there is with somebody else.
export async function isOwnerRoomOf(archive: Store, provider: string, chatId: number, ownerRoom: number | null): Promise<boolean> {
  return ownerRoom !== null && chatId === ownerRoom && !await answersAsAvatar(archive, provider, chatId);
}

// Whose one-to-one with the agent a room this road numbered is, as the road wrote it down when its
// platform said so. A room answered in the avatar voice is nobody's: a one-to-one of the owner's there
// is with somebody else.
export async function privateRoomOfRoad(archive: Store, provider: string, chatId: number): Promise<number | null> {
  return await answersAsAvatar(archive, provider, chatId) ? null : await archive.chats().privateRoomPerson(provider, chatId);
}

// What a message from the avatar account is. The agent's own — it carries the prefix, or it stands in
// the store already under the agent's number, which is a send that carried no words — is kept once,
// without the prefix, under the agent's name and number, and goes no further. Everything else is the
// owner's own words, under the owner's number, and is handed on as any message is.
export type AvatarInbound =
  | { own: true; message: ArchivedMessage; kept: boolean }
  | { own: false; message: ArchivedMessage };

export async function readAvatarMessage(
  deps: { archive: Store; provider: string; ownerId: number | null; identity: number | null },
  message: ArchivedMessage,
): Promise<AvatarInbound> {
  const agent = deps.identity ?? await avatarIdentity(deps.archive, deps.provider);
  const standing = await deps.archive.messages().getMessage(message.chatId, message.messageId);

  if (isAvatarText(message.text) || (standing !== null && standing.senderId === agent)) {
    const own = { ...message, text: stripAvatarPrefix(message.text), senderId: agent, senderName: senderName() };

    return { own: true, message: own, kept: await deps.archive.messages().insertMessageIfAbsent(own) };
  }

  return { own: false, message: { ...message, senderId: deps.ownerId } };
}

// The voice a send speaks with: the one it names, or the one the room is answered by.
export async function sendVoice(archive: Store, provider: string, request: ChatSendRequest, otherwise: ChatVoice): Promise<ChatVoice> {
  if (request.as !== undefined && request.as !== null) {
    return request.as;
  }

  return await answersAsAvatar(archive, provider, request.chatId) ? "human-avatar" : otherwise;
}

// The send as it goes out in that voice. In the avatar voice every word the agent puts out carries the
// prefix — a text, each part of a split one since each is a message of its own, a caption, which
// is written as the prefix alone where there was none so the echo is still recognised, and an
// edit of its own message. Every other voice sends as it was asked.
export function inVoice(request: ChatSendRequest, voice: ChatVoice): ChatSendRequest {
  if (voice !== "human-avatar") {
    return request;
  }

  switch (request.verb) {
    case "text":
    case "edit":
      return { ...request, text: withAvatarPrefix(request.text) };
    case "photo":
    case "album":
    case "voice":
      return { ...request, caption: withAvatarPrefix(request.caption ?? "") };
    default:
      return request;
  }
}
