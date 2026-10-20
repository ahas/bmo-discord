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
import { Refusal, notReady, platformRefusal } from "./chat";

import type { KeptMessage, Store } from "./store";
import type { Service } from "./seam";
import type { DiscordCall } from "./api";
import type { DiscordAccount, DiscordConfig } from "./config";
import type { DiscordMessage } from "./events";
import type { DiscordSocket } from "./gateway";
import type { ChatSendRequest, ChatSent, ChatVoice, HandedMessage, ProviderRoom } from "./chat";

// The name this provider is known by: written onto every message it hands over, and the provider whose
// rooms, people and messages the store numbers.
export const discordKey = "discord";

// The kinds of send the provider performs, as its declaration carries them.
const can = new Set(discordPolicy.can);

// Whose account a token is, read out of the token. A token opens with the account's own user id in
// base64 — a bot token with its application's, which is the bot's user id — so the road knows each
// of its accounts before any connection is open, which is what a room's identity has to answer from.
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
  service: Service;
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

  const account = (voice === "own-account" ? accountFor(discord, "own-account") : null)
    ?? accountFor(discord, "bot-account")
    ?? accountFor(discord, "own-account");
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

// One message kept and handed to the service, marked first so the next socket that reads it finds it
// already handed over. A hand-over that did not go takes the mark off again.
async function hand(archive: Store, service: Service, kept: KeptMessage): Promise<void> {
  if (!archive.messages().markHandedOver(kept)) {
    return;
  }

  try {
    await service.handOver(kept.chatId, kept.messageId, kept.message);
  } catch (error) {
    archive.messages().unmarkHandedOver(kept);
    throw error;
  }
}

// One gateway message, turned into the message the store keeps and handed to the service.
// - The agent's own words come back down every socket in the room, and they are kept rather than
//   answered.
// - The owner's account is read through the avatar contract: what carries the prefix is the agent's, the
//   rest is the owner's. In a room another account of this road is in, the owner's socket only keeps what
//   it reads, since that account is the one that answers there.
// - A message two sockets both deliver is one snowflake and one number, and it is handed on once.
export async function handleDiscordMessage(road: DiscordRoad, message: DiscordMessage): Promise<void> {
  const { archive, discord, service, account } = road;
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
  const identity = await identityIn(archive, discord, chatId);
  const origin = message.kind === "edited" ? "edit" : "live";
  let kept: KeptMessage = {
    chatId,
    messageId: await archive.messages().assignMessageId(discordKey, chatId, message.messageId),
    message: {
      origin,
      senderId,
      senderName: own ? senderName() : message.authorName,
      sentAt: message.sentAt,
      text: wordsOf(message),
      replyToMessageId: message.replyToId === null
        ? null
        : await archive.messages().messageIdOf(discordKey, chatId, message.replyToId),
      via: discordKey,
      album: null,
      mode: account.voice,
      context: {
        senderUsername: message.authorName,
        spokenText: message.text,
        metadata: message,
        carriesFile: message.files.length > 0,
      },
      room: {},
      files: [],
      gathering: false,
    },
  };

  // The agent's own words are kept and never routed: a road that answered its own answer would talk to
  // itself for ever. The send may already have kept this message, so this is the second keeper of it and
  // adds nothing where it is already there. An edit is handed over all the same, so the receiving side
  // replaces the message it holds.
  if (own) {
    if (message.kind === "edited") {
      await service.handOver(kept.chatId, kept.messageId, kept.message);
    } else {
      await archive.messages().insertMessageIfAbsent(kept);
    }

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
          identity,
        },
        kept,
      );

      if (read.own) {
        if (message.kind === "edited") {
          await service.handOver(read.kept.chatId, read.kept.messageId, read.kept.message);
        }

        return;
      }

      kept = read.kept;
    }

    // Read beside the account that answers the room, so it goes in as read through a reader.
    if (!await answersAsAvatar(archive, discordKey, chatId)) {
      const read = {
        ...kept,
        message: { ...kept.message, mode: "human-reader" as const },
      };

      if (message.kind === "edited") {
        await service.handOver(read.chatId, read.messageId, read.message);
      } else {
        await archive.messages().insertMessageIfAbsent(read);
      }

      return;
    }
  }

  // What the provider already knows of the room travels with the hand-over, so the receiver need not ask.
  kept = {
    ...kept,
    message: {
      ...kept.message,
      room: {
        kind: await isOwnerRoomOf(archive, discordKey, chatId, await discordProvider.ownerRoom()) ? "owner" : "group",
        identity,
        privateTo: await privateRoomOfRoad(archive, discordKey, chatId),
      },
    },
  };

  if (message.kind === "edited") {
    await service.handOver(kept.chatId, kept.messageId, kept.message);

    return;
  }

  await hand(archive, service, kept);
}

let sockets: DiscordSocket[] = [];

// What the gateway's routes ask of the provider (docs/api.md, 「Rooms」, 「Sends」 and 「Health」).
export interface DiscordProvider {
  key: string;
  configured(): string | null;
  start(deps: { archive: Store; service: Service }): void;
  stop(): void;
  room(chatId: number): Promise<ProviderRoom | null>;
  ownerRoom(): Promise<number | null>;
  send(request: ChatSendRequest): Promise<ChatSent>;
}

// What the platform calls a channel, asked of the platform. A gateway message carries the channel's id and
// never its name, and a direct message has no name at all.
async function roomTitle(channelId: string): Promise<string | null> {
  const discord = discordConfig();
  const account = discord === null ? undefined : discordAccounts(discord)[0];

  if (account === undefined) {
    return null;
  }

  try {
    return await channelName(account, channelId);
  } catch (error) {
    console.error(`discord: could not read what channel ${channelId} is called:`, error);

    return null;
  }
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
      const road: DiscordRoad = { discord, archive: deps.archive, service: deps.service, account };

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

  // What the provider knows of a room, or null where the number is not one of its rooms.
  async room(chatId) {
    const machine = chatMachine();
    const channel = await roomOf(chatId);
    const discord = discordConfig();

    if (machine === null || channel === null || discord === null) {
      return null;
    }

    const { archive } = machine;

    return {
      id: chatId,
      owns: true,
      identity: await identityIn(archive, discord, chatId),
      kind: await isOwnerRoomOf(archive, discordKey, chatId, await discordProvider.ownerRoom()) ? "owner" : "group",
      privateTo: await privateRoomOfRoad(archive, discordKey, chatId),
      title: await roomTitle(channel),
    };
  },

  // The owner's one-to-one with the agent, where the settings name the channel. A DM channel says it is a
  // DM and not whose, so the road is told rather than taking the first one it is spoken to in.
  ownerRoom: async () => {
    const machine = chatMachine();
    const channel = discordConfig()?.ownerChannelId ?? null;

    if (machine === null || channel === null) {
      return null;
    }

    return (await machine.archive.providerNumbers().providerRooms(discordKey)).find((one) => one.roomId === channel)?.chatId ?? null;
  },

  async send(request) {
    if (!can.has(request.kind)) {
      throw new Refusal("unsupported-capability", `This provider cannot perform a ${request.kind} send.`, 422);
    }

    const machine = chatMachine();
    const discord = discordConfig();

    if (discord === null || machine === null) {
      throw notReady();
    }

    const { archive } = machine;
    const channelId = await archive.providerNumbers().providerRoom(discordKey, request.roomId);

    if (channelId === null) {
      throw platformRefusal(`There is no room ${request.roomId}.`);
    }

    // The voice this send speaks with — the one it names, else the room's — and the account that
    // voice is. In the avatar voice every word goes out behind the prefix: the one the send names, or the
    // deployment's own; without either, that voice has no account to speak with.
    const recorded = await archive.chats().roomVoice(discordKey, request.roomId) as ChatVoice | null;
    const voice = await sendVoice(archive, discordKey, request, recorded ?? discordAccounts(discord)[0]?.voice ?? "bot-account");
    const prefix = request.prefix ?? avatarPrefix();
    const prefixMissing = voice === "human-avatar" && prefix === null;
    const account = prefixMissing ? null : accountFor(discord, voice);

    if (account === null) {
      const why = prefixMissing ? avatarPrefixMissing : voiceMissing(voice);

      throw platformRefusal(`That account cannot send: ${why}.`);
    }

    const api = { token: account.token, bot: account.bot };
    const spoken = inVoice(request, voice, prefix);
    // Every kind that points at a message points at one of the store's numbers, and what goes out has to
    // name the platform's own.
    const nativeOf = async (messageId: number): Promise<string | null> =>
      archive.messages().nativeMessageId(discordKey, request.roomId, messageId);

    if (spoken.kind === "typing") {
      if (spoken.fields.on) {
        await typing(api, channelId);
      }

      return { messageId: null, missed: [] };
    }

    if (spoken.kind === "reaction" || spoken.kind === "pin" || spoken.kind === "edit") {
      const native = await nativeOf(spoken.fields.messageId);

      if (native === null) {
        throw platformRefusal(`There is no message ${spoken.fields.messageId}.`);
      }

      if (spoken.kind === "reaction") {
        // An empty emoji takes the agent's own reaction off, which is the same path the other way.
        await react(api, channelId, native, spoken.fields.emoji, spoken.fields.emoji !== "");
      } else if (spoken.kind === "pin") {
        await pin(api, channelId, native, spoken.fields.on);
      } else {
        await editMessage(api, channelId, native, spoken.fields.text);
      }

      return { messageId: spoken.fields.messageId, missed: [] };
    }

    const replyTo = request.replyToMessageId === undefined || request.replyToMessageId === null
      ? null
      : await nativeOf(request.replyToMessageId);
    const sent = await outgoing(api, channelId, discord, spoken, replyTo);

    if (sent.id === null) {
      return { messageId: null, missed: [] };
    }

    // The number the store gives the message that went out. The same message comes back down the
    // gateway a moment later and is kept there, under this same number.
    const messageId = await archive.messages().assignMessageId(discordKey, request.roomId, sent.id);

    // In the avatar voice the echo comes back under the owner's account, and a send that carried no
    // words — a sticker, a file — comes back without the prefix that would say it is the agent's. It is
    // kept as it goes, so the echo finds the agent's message standing and is read as the agent's.
    if (voice === "human-avatar") {
      const senderId = await identityIn(archive, discord, request.roomId) ?? await avatarIdentity(archive, discordKey);
      const handed: HandedMessage = {
        origin: "live",
        senderId,
        senderName: senderName(),
        sentAt: Date.now(),
        text: wordsSent(spoken),
        replyToMessageId: request.replyToMessageId ?? null,
        via: discordKey,
        album: null,
        mode: voice,
        context: {},
        room: {},
        files: [],
        gathering: false,
      };

      await archive.messages().insertMessageIfAbsent({ chatId: request.roomId, messageId, message: handed });
    }

    return { messageId, missed: [] };
  },
};

// What a send leaves in the record, in the words its echo would.
function wordsSent(request: ChatSendRequest): string {
  switch (request.kind) {
    case "text":
    case "edit":
      return stripAvatarPrefix(request.fields.text);
    case "photo":
      return stripAvatarPrefix(request.fields.caption ?? "") || discordWords.picture_mark;
    case "document":
      return fillMarks(discordWords.document_kept, { name: request.fields.fileName });
    default:
      return "";
  }
}

// The one call a send of words, a picture, a file or a sticker turns into. A sticker this application has
// not been given an id for is refused by name rather than sent as nothing.
async function outgoing(
  api: DiscordCall,
  channelId: string,
  discord: DiscordConfig,
  request: ChatSendRequest,
  replyTo: string | null,
): Promise<{ id: string | null }> {
  switch (request.kind) {
    case "text":
      return { id: await sendMessage(api, channelId, request.fields.text, replyTo) };
    case "photo":
      return { id: await sendImage(api, channelId, request.fields.imageUrl, request.fields.caption ?? undefined, replyTo) };
    case "document":
      return { id: await sendFile(api, channelId, Buffer.from(request.fields.bytes, "base64"), request.fields.fileName, replyTo) };
    case "sticker": {
      const stickerId = discord.stickers[request.fields.emoji];

      if (stickerId === undefined) {
        throw platformRefusal(`No sticker is paired with ${request.fields.emoji}.`);
      }

      return { id: await sendSticker(api, channelId, stickerId) };
    }
    default:
      throw new Refusal("unsupported-capability", `This provider cannot perform a ${request.kind} send.`, 422);
  }
}
