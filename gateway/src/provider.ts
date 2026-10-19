// The Discord chat provider's gateway side, and the fullest surface of the providers: words, an answer
// aimed at a message, a picture, a file, a sticker, a reaction, a pin, the typing state and an edit of what
// the agent itself said. The service declares the provider and runs its dialect; what stands here reads the
// rooms, performs the sends and answers the room questions (docs/boundary-api.md).
//
// It reads by as many accounts as it is given tokens for, one socket each. The official bot account
// is delivered a room's every message where the application has been given the MESSAGE_CONTENT
// intent, which is privileged and asked for in the developer portal; without it the gateway refuses
// the connection outright and says so (`gateway.ts`). The owner's own account reads the rooms it is in
// beside the bot, and answers in the avatar voice where no other account of this road is
// (`avatar.ts`); an account made for the agent answers in its own rooms as the agent, with no prefix.
//
// Ids: a channel, a person and a message are all snowflakes — 64-bit numbers above what a number
// holds exactly — so the store numbers all three itself and the platform's ids stay strings.

import {
  answersAsAvatar,
  avatarIdentity,
  avatarPrefix,
  heardInRoom,
  inVoice,
  isOwnerRoomOf,
  privateRoomOfRoad,
  readAvatarMessage,
  sendVoice,
  stripAvatarPrefix,
} from "./avatar";
import { chatMachine } from "./machine";
import { avatarPrefixMissing, discordPolicy, discordWords, fillMarks, senderName } from "./settings";
import { channelName, directRecipient, editMessage, pin, react, sendFile, sendImage, sendMessage, sendSticker, typing } from "./api";
import { accountFor, discordAccounts, discordConfig, discordMissing, voiceMissing } from "./config";
import { openGateway } from "./gateway";
import { notReady, platformRefusal, verbRefusal } from "./chat";

import type { ArchivedMessage, Store } from "./store";
import type { DiscordCall } from "./api";
import type { DiscordAccount, DiscordConfig } from "./config";
import type { DiscordMessage } from "./events";
import type { DiscordSocket } from "./gateway";
import type { ChatReceiver, ChatRefusal, ChatSendRequest, ChatSendResult, ChatVerb, ChatVoice } from "./chat";

// The name this provider is known by: written onto every message it hands over, and the provider whose
// rooms, people and messages the store numbers.
export const discordKey = "discord";

// What the provider is called where a person reads it, which every refusal carries.
const label = discordWords.label;

// The verbs the provider performs, as its declaration carries them.
const can = new Set(discordPolicy.can);

// What a send is refused with when it does not go.
function refused(refusal: ChatRefusal): ChatSendResult {
  return { sent: false, refusal, gone: false };
}

// Whose account a token is, read out of the token. A token opens with the account's own user id in
// base64 — a bot token with its application's, which is the bot's user id — so the road knows each
// of its accounts before any connection is open, which is what `identityOf` has to answer from.
export function accountIdFromToken(token: string): string | null {
  const head = token.split(".")[0];

  if (head === undefined || head === "") {
    return null;
  }

  try {
    const decoded = atob(head.replaceAll("-", "+").replaceAll("_", "/"));

    return /^\d+$/.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

async function roomOf(chatId: number): Promise<string | null> {
  return await chatMachine()?.archive.providerNumbers().providerRoom(discordKey, chatId) ?? null;
}

// What a message that carried a file says in the record. This provider declares no `fetchMedia`, so
// what a file leaves in the record is a mark and never a path.
function wordsOf(message: DiscordMessage): string {
  if (message.text !== "") {
    return message.text;
  }

  const file = message.files[0];

  if (file === undefined) {
    return "";
  }

  return file.contentType?.startsWith("image/") === true ? discordWords.picture_mark : fillMarks(discordWords.document_kept, { name: file.name });
}

export interface DiscordRoad {
  discord: DiscordConfig;
  archive: Store;
  receiver: ChatReceiver;
  // The account whose socket delivered the message.
  account: DiscordAccount;
}

// The accounts that are the agent's own on this road: the bot, and the account made for the agent. What
// either of them says is the agent's, whichever socket brings it back.
function agentAccountIds(discord: DiscordConfig): string[] {
  return [discord.token, discord.selfToken].flatMap((token) => {
    const id = token === null ? null : accountIdFromToken(token);

    return id === null ? [] : [id];
  });
}

// The owner's own account here: the one the settings name, or the one the owner's token is.
function ownerAccountId(discord: DiscordConfig): string | null {
  return discord.ownerUserId ?? (discord.userToken === null ? null : accountIdFromToken(discord.userToken));
}

// The number the owner's words are filed under: the person the store numbers for the owner's account.
async function ownerNumber(archive: Store, discord: DiscordConfig): Promise<number | null> {
  const owner = ownerAccountId(discord);

  return owner === null ? null : await archive.providerNumbers().providerSenderId(discordKey, owner);
}

// Who the agent is in this room: the avatar voice's number where the room is answered in it, the account
// made for the agent where that account answers it, and the bot everywhere else.
async function identityIn(archive: Store, discord: DiscordConfig, chatId: number): Promise<number | null> {
  const voice = await archive.chats().roomVoice(discordKey, chatId);

  if (voice === "human-avatar") {
    return avatarIdentity(archive, discordKey);
  }

  const account = (voice === "human-as-agent" ? accountFor(discord, "human-as-agent") : null)
    ?? accountFor(discord, "bot-account")
    ?? accountFor(discord, "human-as-agent");
  const id = account === null ? null : accountIdFromToken(account.token);

  return id === null ? null : await archive.providerNumbers().providerSenderId(discordKey, id);
}

// The channels this run has asked the platform about, so a group DM is asked once and not at every
// message said in it.
const askedChannels = new Set<string>();

// Whether a channel with no guild is a DM of the agent's own account, asked of the platform once a run,
// and its recipient written down as the person it is a one-to-one with. A call that fails is asked again
// at the next message.
async function learnDirect(road: DiscordRoad, chatId: number, channelId: string): Promise<void> {
  if (askedChannels.has(channelId)) {
    return;
  }

  askedChannels.add(channelId);

  try {
    const recipient = await directRecipient(road.account, channelId);

    if (recipient !== null) {
      const person = recipient === ownerAccountId(road.discord)
        ? await ownerNumber(road.archive, road.discord)
        : await road.archive.providerNumbers().providerSenderId(discordKey, recipient);

      await road.archive.chats().setPrivateRoom(discordKey, chatId, person);
    }
  } catch (error) {
    askedChannels.delete(channelId);
    console.error(`discord: could not ask what channel ${channelId} is:`, error);
  }
}

// One gateway message, turned into the message the store keeps and handed to the receiver.
// - The agent's own words come back down every socket in the room, and they are kept rather than
//   answered.
// - The owner's account is read through the avatar contract: what carries the prefix is the agent's, the
//   rest is the owner's. In a room another account of this road is in, the owner's socket only keeps what
//   it reads, since that account is the one that answers there.
// - A message two sockets both deliver is one snowflake and one number, and it is handed on once.
export async function handleDiscordMessage(road: DiscordRoad, message: DiscordMessage): Promise<void> {
  const { archive, discord, receiver, account } = road;
  const chatId = await archive.providerNumbers().providerChatId(discordKey, message.channelId, "");

  // A message taken back leaves the record as it was: the record is what was said.
  if (message.kind === "deleted") {
    return;
  }

  const person = account.voice === "human-avatar";

  await heardInRoom(archive, discordKey, chatId, account.voice);

  const own = message.authorId !== "" && agentAccountIds(discord).includes(message.authorId);
  const fromOwner = message.authorId !== "" && message.authorId === ownerAccountId(discord);
  const senderId = fromOwner
    ? await ownerNumber(archive, discord)
    : await archive.providerNumbers().providerSenderId(discordKey, message.authorId);
  let archived: ArchivedMessage = {
    chatId,
    messageId: await archive.messages().assignMessageId(discordKey, chatId, message.messageId),
    senderId,
    senderName: own ? senderName() : message.authorName,
    sentAt: message.sentAt,
    text: wordsOf(message),
    replyToMessageId: message.replyToId === null
      ? null
      : await archive.messages().messageIdOf(discordKey, chatId, message.replyToId),
    via: discordKey,
    mode: account.voice,
  };

  // The agent's own words are kept and never routed: a road that answered its own answer would talk to
  // itself for ever. The send may already have kept this message, so this is the second keeper of it and
  // adds nothing where it is already there.
  if (own) {
    await archive.messages().insertMessageIfAbsent(archived);

    return;
  }

  if (!person && message.guildId === null) {
    await learnDirect(road, chatId, message.channelId);
  }

  if (person) {
    if (fromOwner) {
      const read = await readAvatarMessage(
        {
          archive,
          provider: discordKey,
          ownerId: senderId,
          identity: await identityIn(archive, discord, chatId),
        },
        archived,
      );

      if (read.own) {
        return;
      }

      archived = read.message;
    }

    // Read beside the account that answers the room, so it goes in as read through a reader.
    if (!await answersAsAvatar(archive, discordKey, chatId)) {
      await archive.messages().insertMessageIfAbsent({ ...archived, mode: "human-reader" });

      return;
    }
  }

  // Another socket in the room has already handed this one on.
  if (message.kind === "said" && await archive.messages().getMessage(chatId, archived.messageId) !== null) {
    return;
  }

  const inbound = { ...archived, album: null };
  const context = {
    senderUsername: message.authorName,
    spokenText: message.text,
    metadata: message,
    carriesFile: message.files.length > 0,
  };

  if (message.kind === "edited") {
    await receiver.edited(inbound, context);

    return;
  }

  await receiver.message(inbound, context);
}

let sockets: DiscordSocket[] = [];

// What the gateway's routes ask of the provider (docs/boundary-api.md, 「The seam between the service and
// the gateway」).
export interface DiscordProvider {
  key: string;
  configured(): string | null;
  start(deps: { archive: Store; receiver: ChatReceiver }): void;
  stop(): void;
  ownsRoom(chatId: number): Promise<boolean>;
  identityOf(chatId: number): Promise<number | null>;
  isOwnerRoom(chatId: number): Promise<boolean>;
  privateRoomOf(chatId: number): Promise<number | null>;
  ownerRoom(): Promise<number | null>;
  roomTitle(chatId: number): Promise<string | null>;
  send(request: ChatSendRequest): Promise<ChatSendResult>;
}

export const discordProvider: DiscordProvider = {
  key: discordKey,
  configured: () => (discordConfig() === null ? discordMissing : null),

  start(deps) {
    const discord = discordConfig();

    if (discord === null) {
      return;
    }

    sockets = discordAccounts(discord).map((account) => {
      const road: DiscordRoad = { discord, archive: deps.archive, receiver: deps.receiver, account };

      // A message whose handling failed is said and left; a hand-over that did not go is offered again by
      // the next socket that reads the message, so a failure never takes the process down.
      return openGateway(account, (message) => {
        handleDiscordMessage(road, message).catch((error: unknown) => {
          console.error(`discord: message ${message.messageId} in channel ${message.channelId} failed:`, error);
        });
      });
    });
  },

  stop() {
    for (const socket of sockets) {
      socket.stop();
    }

    sockets = [];
  },

  ownsRoom: async (chatId) => await roomOf(chatId) !== null,

  // The agent's words are filed under the number the store gave the account that answers the room.
  identityOf: async (chatId) => {
    const machine = chatMachine();
    const discord = discordConfig();

    return machine === null || discord === null ? null : identityIn(machine.archive, discord, chatId);
  },

  // The owner's one-to-one with the agent, where the settings name the channel. A DM channel says it is a
  // DM and not whose, so the road is told rather than taking the first one it is spoken to in; a room
  // answered in the avatar voice is never it.
  isOwnerRoom: async (chatId) => {
    const machine = chatMachine();

    return machine !== null && isOwnerRoomOf(machine.archive, discordKey, chatId, await discordProvider.ownerRoom());
  },

  // The person a one-to-one of the agent's own account is with, written down as the platform first said
  // the room was one.
  privateRoomOf: async (chatId) => {
    const machine = chatMachine();

    return machine === null ? null : privateRoomOfRoad(machine.archive, discordKey, chatId);
  },

  ownerRoom: async () => {
    const machine = chatMachine();
    const channel = discordConfig()?.ownerChannelId ?? null;

    if (machine === null || channel === null) {
      return null;
    }

    return (await machine.archive.providerNumbers().providerRooms(discordKey)).find((one) => one.roomId === channel)?.chatId ?? null;
  },

  // What the platform calls the channel, asked of the platform. A gateway message carries the
  // channel's id and never its name, and a direct message has no name at all.
  async roomTitle(chatId) {
    const discord = discordConfig();
    const account = discord === null ? undefined : discordAccounts(discord)[0];
    const channel = await roomOf(chatId);

    if (account === undefined || channel === null) {
      return null;
    }

    try {
      return await channelName(account, channel);
    } catch (error) {
      console.error(`discord: could not read what channel ${channel} is called:`, error);

      return null;
    }
  },

  async send(request: ChatSendRequest): Promise<ChatSendResult> {
    if (!can.has(request.verb)) {
      return refused(verbRefusal(label, request.verb as ChatVerb));
    }

    const machine = chatMachine();
    const discord = discordConfig();

    if (discord === null || machine === null) {
      return refused(notReady(label));
    }

    const { archive } = machine;
    const channelId = await archive.providerNumbers().providerRoom(discordKey, request.chatId);

    if (channelId === null) {
      return refused(platformRefusal(label, `There is no Discord room ${request.chatId}.`));
    }

    // The voice this send speaks with — the one it names, else the room's — and the account that
    // voice is. In the avatar voice every word goes out behind the prefix, so without one that voice
    // has no account to speak with.
    const recorded = await archive.chats().roomVoice(discordKey, request.chatId) as ChatVoice | null;
    const voice = await sendVoice(archive, discordKey, request, recorded ?? discordAccounts(discord)[0]?.voice ?? "bot-account");
    const prefixMissing = voice === "human-avatar" && avatarPrefix() === null;
    const account = prefixMissing ? null : accountFor(discord, voice);

    if (account === null) {
      const why = prefixMissing ? avatarPrefixMissing : voiceMissing(voice);

      return refused(platformRefusal(label, `That account cannot send on Discord: ${why}.`));
    }

    const api = { token: account.token, bot: account.bot };
    const spoken = inVoice(request, voice);
    // Every verb that points at a message points at one of the store's numbers, and what goes
    // out has to name the platform's own.
    const nativeOf = async (messageId: number): Promise<string | null> =>
      archive.messages().nativeMessageId(discordKey, request.chatId, messageId);

    if (request.verb === "typing") {
      if (request.on) {
        await typing(api, channelId);
      }

      return { sent: true, messageId: null };
    }

    if (request.verb === "reaction" || request.verb === "pin" || request.verb === "edit") {
      const native = await nativeOf(request.messageId);

      if (native === null) {
        return refused(platformRefusal(label, `Discord has no message ${request.messageId}.`));
      }

      if (request.verb === "reaction") {
        // An empty emoji takes the agent's own reaction off, which is the same path the other way.
        await react(api, channelId, native, request.emoji === "" ? "" : request.emoji, request.emoji !== "");
      } else if (request.verb === "pin") {
        await pin(api, channelId, native, request.on);
      } else if (spoken.verb === "edit") {
        await editMessage(api, channelId, native, spoken.text);
      }

      return { sent: true, messageId: request.messageId };
    }

    const replyTo = "replyTo" in request && request.replyTo !== undefined && request.replyTo !== null
      ? await nativeOf(request.replyTo)
      : null;
    const sent = await outgoing(api, channelId, discord, spoken, replyTo);

    if ("refusal" in sent) {
      return refused(sent.refusal);
    }

    if (sent.id === null) {
      return { sent: true, messageId: null };
    }

    // The number the store gives the message that went out. The same message comes back down the
    // gateway a moment later and is kept there, under this same number.
    const messageId = await archive.messages().assignMessageId(discordKey, request.chatId, sent.id);

    // In the avatar voice the echo comes back under the owner's account, and a send that carried no
    // words — a sticker, a file — comes back without the prefix that would say it is the agent's. It is
    // kept as it goes, so the echo finds the agent's message standing and is read as the agent's.
    if (voice === "human-avatar") {
      await archive.messages().insertMessageIfAbsent({
        chatId: request.chatId,
        messageId,
        senderId: await identityIn(archive, discord, request.chatId) ?? await avatarIdentity(archive, discordKey),
        senderName: senderName(),
        sentAt: Math.floor(Date.now() / 1000),
        text: wordsSent(spoken),
        replyToMessageId: "replyTo" in request ? (request.replyTo ?? null) : null,
        via: discordKey,
        mode: voice,
      });
    }

    return { sent: true, messageId };
  },
};

// What a send leaves in the record, in the words its echo would.
function wordsSent(request: ChatSendRequest): string {
  if (request.verb === "text") return stripAvatarPrefix(request.text);
  if (request.verb === "photo") return stripAvatarPrefix(request.caption ?? "") || discordWords.picture_mark;
  if (request.verb === "document") return fillMarks(discordWords.document_kept, { name: request.fileName });

  return "";
}

// The one call a send of words, a picture, a file or a sticker turns into. A sticker this
// application has not been given an id for is refused by name rather than sent as nothing.
async function outgoing(
  api: DiscordCall,
  channelId: string,
  discord: DiscordConfig,
  request: ChatSendRequest,
  replyTo: string | null,
): Promise<{ id: string | null } | { refusal: ChatRefusal }> {
  if (request.verb === "photo") {
    return { id: await sendImage(api, channelId, request.imageUrl, request.caption ?? undefined, replyTo) };
  }

  if (request.verb === "document") {
    return { id: await sendFile(api, channelId, Buffer.from(request.bytes, "base64"), request.fileName, replyTo) };
  }

  if (request.verb === "sticker") {
    const stickerId = discord.stickers[request.emoji];

    if (stickerId === undefined) {
      return { refusal: platformRefusal(label, `No Discord sticker is paired with ${request.emoji}.`) };
    }

    return { id: await sendSticker(api, channelId, stickerId) };
  }

  return { id: await sendMessage(api, channelId, request.verb === "text" ? request.text : "", replyTo) };
}
