// The Discord chat provider's gateway side, and the fullest surface of the providers: words, an answer
// aimed at a message, a picture, a file, a sticker, a reaction, a pin, the typing state and an edit of what
// the agent itself said. The service declares the provider and runs its dialect; what stands here reads the
// rooms, performs the sends and answers the room questions (docs/boundary-api.md).
//
// It reads by one account, the official bot account, on one socket. The bot is delivered a room's every
// message where the application has been given the MESSAGE_CONTENT intent, which is privileged and asked
// for in the developer portal; without it the gateway refuses the connection outright and says so
// (`gateway.ts`). The owner's own account, where its token is set, sends in the `human-reader` and
// `human-avatar` voices at the provider's pace and reads nothing (docs/discord.md, 「The owner's account」).
//
// Ids: a channel, a person and a message are all snowflakes — 64-bit numbers above what a number
// holds exactly — so the store numbers all three itself and the platform's ids stay strings.

import { chatMachine } from "./machine";
import { discordPolicy, discordWords, fillMarks, senderName } from "./settings";
import { channelName, directRecipient, editMessage, pin, react, sendFile, sendImage, sendMessage, sendSticker, typing } from "./api";
import { accountFor, accountIdFromToken, botAccount, botTokenMissing, discordConfig, isOwnerVoice, voiceMissing } from "./config";
import { openGateway } from "./gateway";
import { keepConfirming, onOwnerAccount, ownerConfirmation } from "./owner";
import { Refusal, notReady, platformRefusal } from "./chat";

import type { KeptMessage, Store } from "./store";
import type { Service } from "./seam";
import type { DiscordCall } from "./api";
import type { DiscordAccount, DiscordConfig, OwnerVoice } from "./config";
import type { DiscordMessage } from "./events";
import type { DiscordSocket } from "./gateway";
import type { OwnerConfirmation } from "./owner";
import type { ChatSendRequest, ChatSent, ChatVoice, ProviderRoom } from "./chat";

// The name this provider is known by: written onto every message it hands over, and the provider whose
// rooms, people and messages the store numbers.
export const discordKey = "discord";

// The kinds of send the provider performs, as its declaration carries them.
const can = new Set(discordPolicy.can);

// The kinds the owner's account sends: words and the typing state.
const ownerKinds = new Set(["text", "edit", "typing"]);

// A send through the owner's account whose message has not yet been answered with its id: the nonce it went
// with, and its channel and words, which is how its echo is known should the socket bring it back first.
interface AwaitedEcho {
  channelId: string;
  nonce: string;
  words: string;
  voice: OwnerVoice;
}

const awaitedEchoes = new Set<AwaitedEcho>();

// The words a send puts out in a voice: in `human-avatar` behind the prefix, followed by one space unless it
// ends in one, and left as they are where they already begin with it; in any other voice exactly as given.
export function wordsIn(voice: ChatVoice, words: string, prefix: string | null): string {
  if (voice !== "human-avatar" || prefix === null || words.startsWith(prefix)) {
    return words;
  }

  return /\s$/.test(prefix) ? `${prefix}${words}` : `${prefix} ${words}`;
}

// The prefix a send in a voice carries: the send's own, else the configured one, in `human-avatar`; none in
// any other voice. A `human-avatar` send with neither is refused, so the owner's account never says the
// agent's words unmarked.
export function prefixFor(voice: ChatVoice, request: ChatSendRequest, discord: DiscordConfig): string | null {
  if (voice !== "human-avatar") {
    return null;
  }

  const prefix = request.prefix === undefined || request.prefix === null || request.prefix === ""
    ? discord.avatarPrefix
    : request.prefix;

  if (prefix === null) {
    throw platformRefusal("A human-avatar send needs a prefix, and neither the send nor BMO_DISCORD_AVATAR_PREFIX gives one.");
  }

  return prefix;
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

// The account that is the agent's own on this road, the bot: what it says is the agent's when the socket
// brings it back.
function agentAccountId(discord: DiscordConfig): string | null {
  return accountIdFromToken(discord.token);
}

// The number the owner's words are filed under: the person the store numbers for the owner's account, as
// the settings name it.
async function ownerNumber(archive: Store, discord: DiscordConfig): Promise<number | null> {
  const owner = discord.ownerUserId;

  return owner === null ? null : await archive.providerNumbers().providerSenderId(discordKey, owner);
}

// The voice a room is answered by, as the store wrote it down. Only the bot account's voice answers a room;
// any other voice the store holds, `own-account` among them, counts as none.
async function roomVoice(archive: Store, chatId: number): Promise<DiscordAccount["voice"] | null> {
  const voice = await archive.chats().roomVoice(discordKey, chatId);

  return voice === "bot-account" ? voice : null;
}

// Whether this room is the owner's private chat with the agent.
function isOwnerRoom(chatId: number, ownerRoom: number | null): boolean {
  return ownerRoom !== null && chatId === ownerRoom;
}

// Whether the owner's account answers a room: it is held and confirmed, it has been heard in the room, and the
// room is not the owner's one-to-one with the agent.
async function ownerAnswers(archive: Store, discord: DiscordConfig, chatId: number): Promise<boolean> {
  return accountFor(discord, "human-reader") !== null
    && ownerConfirmation().confirmed
    && !isOwnerRoom(chatId, await discordProvider.ownerRoom())
    && await archive.chats().ownerHeard(discordKey, chatId);
}

// The voices whose account answers a room: the bot account's in every room, and the owner's account's besides
// where it answers the room.
async function voicesIn(archive: Store, discord: DiscordConfig, chatId: number): Promise<ChatVoice[]> {
  return await ownerAnswers(archive, discord, chatId)
    ? ["bot-account", "human-reader", "human-avatar"]
    : ["bot-account"];
}

// The voice a message the owner's account wrote went out in, where this provider sent it: known by the nonce
// it went with or its words while its send awaits an answer, and by the store's mark once it has one.
async function ownerSendOf(archive: Store, chatId: number, message: DiscordMessage): Promise<OwnerVoice | null> {
  for (const awaited of awaitedEchoes) {
    if (
      (message.nonce !== null && message.nonce === awaited.nonce)
      || (message.channelId === awaited.channelId && message.text === awaited.words)
    ) {
      return awaited.voice;
    }
  }

  const voice = await archive.messages().ownerSendVoice(discordKey, chatId, message.messageId);

  return voice !== null && isOwnerVoice(voice) ? voice : null;
}

// Who the agent is in a room: the bot account, which answers every room.
async function identityIn(archive: Store, discord: DiscordConfig): Promise<number | null> {
  const id = agentAccountId(discord);

  return id === null ? null : await archive.providerNumbers().providerSenderId(discordKey, id);
}

// The channels this run has asked the platform about, so a group DM is asked once and not at every
// message said in it.
const askedChannels = new Set<string>();

// Whether a channel with no guild is a DM of the bot account, asked of the platform once a run,
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
      const person = recipient === road.discord.ownerUserId
        ? await ownerNumber(road.archive, road.discord)
        : await road.archive.providerNumbers().providerSenderId(discordKey, recipient);

      await road.archive.chats().setPrivateRoom(discordKey, chatId, person);
    }
  } catch (error) {
    askedChannels.delete(channelId);
    console.error(`discord: could not ask what channel ${channelId} is:`, error);
  }
}

// One message kept and handed to the service, marked first so a socket that reads it again after a
// reconnect finds it already handed over. A hand-over that did not go takes the mark off again.
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
// - The agent's own words come back down the socket, and they are kept rather than answered.
// - A message delivered again after a reconnect is one snowflake and one number, and it is handed on once.
export async function handleDiscordMessage(road: DiscordRoad, message: DiscordMessage): Promise<void> {
  const { archive, discord, service, account } = road;
  const chatId = await archive.providerNumbers().providerChatId(discordKey, message.channelId, "");

  // A message taken back leaves the record as it was: the record is what was said.
  if (message.kind === "deleted") {
    return;
  }

  await archive.chats().setRoomVoice(discordKey, chatId, account.voice);

  const fromOwner = message.authorId !== "" && message.authorId === discord.ownerUserId;
  // A message the owner's account wrote is this provider's own where it sent it, and otherwise shows the
  // owner's account is in the room.
  const ownerSent = fromOwner ? await ownerSendOf(archive, chatId, message) : null;
  const own = (message.authorId !== "" && message.authorId === agentAccountId(discord)) || ownerSent !== null;

  if (fromOwner && ownerSent === null) {
    await archive.chats().markOwnerHeard(discordKey, chatId);
  }

  const senderId = fromOwner
    ? await ownerNumber(archive, discord)
    : await archive.providerNumbers().providerSenderId(discordKey, message.authorId);
  const identity = await identityIn(archive, discord);
  const origin = message.kind === "edited" ? "edit" : "live";
  let kept: KeptMessage = {
    chatId,
    messageId: await archive.messages().assignMessageId(discordKey, chatId, message.messageId),
    message: {
      origin,
      senderId,
      senderName: own && ownerSent !== "human-reader" ? senderName() : message.authorName,
      sentAt: message.sentAt,
      text: wordsOf(message),
      replyToMessageId: message.replyToId === null
        ? null
        : await archive.messages().messageIdOf(discordKey, chatId, message.replyToId),
      via: discordKey,
      album: null,
      mode: ownerSent ?? account.voice,
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

  if (message.guildId === null) {
    await learnDirect(road, chatId, message.channelId);
  }

  // What the provider already knows of the room travels with the hand-over, so the receiver need not ask.
  kept = {
    ...kept,
    message: {
      ...kept.message,
      room: {
        kind: isOwnerRoom(chatId, await discordProvider.ownerRoom()) ? "owner" : "group",
        identity,
        privateTo: await archive.chats().privateRoomPerson(discordKey, chatId),
      },
    },
  };

  if (message.kind === "edited") {
    await service.handOver(kept.chatId, kept.messageId, kept.message);

    return;
  }

  await hand(archive, service, kept);
}

let socket: DiscordSocket | null = null;
let stopConfirming: (() => void) | null = null;

// What the gateway's routes ask of the provider (docs/api.md, 「Rooms」, 「Sends」 and 「Health」).
export interface DiscordProvider {
  key: string;
  configured(): string | null;
  start(deps: { archive: Store; service: Service }): void;
  stop(): void;
  room(chatId: number): Promise<ProviderRoom | null>;
  ownerRoom(): Promise<number | null>;
  ownerAccount(): OwnerConfirmation;
  send(request: ChatSendRequest): Promise<ChatSent>;
}

// What the platform calls a channel, asked of the platform. A gateway message carries the channel's id and
// never its name, and a direct message has no name at all.
async function roomTitle(channelId: string): Promise<string | null> {
  const discord = discordConfig();

  if (discord === null) {
    return null;
  }

  try {
    return await channelName(botAccount(discord), channelId);
  } catch (error) {
    console.error(`discord: could not read what channel ${channelId} is called:`, error);

    return null;
  }
}

export const discordProvider: DiscordProvider = {
  key: discordKey,
  configured: () => (discordConfig() === null ? botTokenMissing : null),

  start(deps) {
    const discord = discordConfig();

    if (discord === null) {
      return;
    }

    stopConfirming = keepConfirming(discord);

    const account = botAccount(discord);
    const road: DiscordRoad = { discord, archive: deps.archive, service: deps.service, account };

    // A message whose handling failed is said and left; a hand-over that did not go is offered again when
    // the socket reads the message again, so a failure never takes the process down.
    socket = openGateway(account, (message) => {
      handleDiscordMessage(road, message).catch((error: unknown) => {
        console.error(`discord: message ${message.messageId} in channel ${message.channelId} failed:`, error);
      });
    });
  },

  stop() {
    socket?.stop();
    socket = null;
    stopConfirming?.();
    stopConfirming = null;
  },

  // Whether the gateway has confirmed the owner's account, from its last check; no call is made to answer.
  ownerAccount: () => (discordConfig() === null ? { confirmed: false, reason: botTokenMissing } : ownerConfirmation()),

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
      identity: await identityIn(archive, discord),
      kind: isOwnerRoom(chatId, await discordProvider.ownerRoom()) ? "owner" : "group",
      privateTo: await archive.chats().privateRoomPerson(discordKey, chatId),
      title: await roomTitle(channel),
      modes: await voicesIn(archive, discord, chatId),
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

    // The voice this send speaks with — the one it names, else the room's, else the bot's — and the account
    // that voice is. An account made for the agent is never held.
    const voice = request.mode ?? await roomVoice(archive, request.roomId) ?? "bot-account";
    const account = accountFor(discord, voice);

    if (account === null) {
      throw platformRefusal(`That account cannot send: ${voiceMissing(discord, voice)}.`);
    }

    if (!account.bot) {
      const owner = ownerConfirmation();

      if (!owner.confirmed) {
        throw platformRefusal(`That account cannot send: ${owner.reason ?? "the owner's account is not confirmed"}.`);
      }

      if (!ownerKinds.has(request.kind)) {
        throw platformRefusal(`The owner's account does not send a ${request.kind}.`);
      }

      if (!await ownerAnswers(archive, discord, request.roomId)) {
        throw platformRefusal(`The owner's account does not answer room ${request.roomId}.`);
      }
    }

    // Every call on the owner's account keeps the provider's pace; the bot account's go as they come.
    const paced = <T>(work: () => Promise<T>): Promise<T> =>
      account.bot ? work() : onOwnerAccount(discord, work);
    // Every kind that points at a message points at one of the store's numbers, and what goes out has to
    // name the platform's own.
    const nativeOf = async (messageId: number): Promise<string | null> =>
      archive.messages().nativeMessageId(discordKey, request.roomId, messageId);

    if (request.kind === "typing") {
      if (request.fields.on) {
        await paced(() => typing(account, channelId));
      }

      return { messageId: null, missed: [] };
    }

    // The prefix the words of this send go out behind, which only words need.
    const prefix = prefixFor(voice, request, discord);

    if (request.kind === "reaction" || request.kind === "pin" || request.kind === "edit") {
      const native = await nativeOf(request.fields.messageId);

      if (native === null) {
        throw platformRefusal(`There is no message ${request.fields.messageId}.`);
      }

      if (request.kind === "reaction") {
        // An empty emoji takes the agent's own reaction off, which is the same path the other way.
        await react(account, channelId, native, request.fields.emoji, request.fields.emoji !== "");
      } else if (request.kind === "pin") {
        await pin(account, channelId, native, request.fields.on);
      } else {
        // The owner's account edits only what it sent here itself.
        if (!account.bot && await archive.messages().ownerSendVoice(discordKey, request.roomId, native) === null) {
          throw platformRefusal(`The owner's account did not send message ${request.fields.messageId}.`);
        }

        const words = wordsIn(voice, request.fields.text, prefix);

        await paced(() => editMessage(account, channelId, native, words));
      }

      return { messageId: request.fields.messageId, missed: [] };
    }

    const replyTo = request.replyToMessageId === undefined || request.replyToMessageId === null
      ? null
      : await nativeOf(request.replyToMessageId);
    const ownerVoice = account.voice;
    const sent = isOwnerVoice(ownerVoice)
      ? await paced(() => ownerWords(archive, request.roomId, ownerVoice, account, channelId, request, replyTo, prefix))
      : await outgoing(account, channelId, discord, request, replyTo);

    if (sent.id === null) {
      return { messageId: null, missed: [] };
    }

    // The number the store gives the message that went out. The same message comes back down the
    // gateway a moment later and is kept there, under this same number.
    const messageId = await archive.messages().assignMessageId(discordKey, request.roomId, sent.id);

    return { messageId, missed: [] };
  },
};

// The one call a send of words through the owner's account turns into: the words in its voice, sent with a
// nonce and awaited back until the store holds the message's id as sent through the owner's account.
async function ownerWords(
  archive: Store,
  chatId: number,
  voice: OwnerVoice,
  api: DiscordCall,
  channelId: string,
  request: ChatSendRequest,
  replyTo: string | null,
  prefix: string | null,
): Promise<{ id: string | null }> {
  if (request.kind !== "text") {
    throw platformRefusal(`The owner's account does not send a ${request.kind}.`);
  }

  const words = wordsIn(voice, request.fields.text, prefix);
  const awaited: AwaitedEcho = { channelId, nonce: crypto.randomUUID().replaceAll("-", "").slice(0, 25), words, voice };

  awaitedEchoes.add(awaited);

  try {
    const id = await sendMessage(api, channelId, words, replyTo, awaited.nonce);

    if (id !== null) {
      await archive.messages().markOwnerSend(discordKey, chatId, id, voice);
    }

    return { id };
  } finally {
    awaitedEchoes.delete(awaited);
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
