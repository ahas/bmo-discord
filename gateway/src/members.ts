// A room's members as the bot account can tell them without a privileged intent (docs/discord.md, 「The members of
// a room」). Listing a guild's whole membership needs the server members intent, which this provider does not ask
// for, so a guild channel's members are the bot account and everyone heard writing in the channel, each asked of
// Discord one at a time and kept where Discord says they are still in the guild. A DM is its recipient and the
// bot account. Every person stands under the number the store gave them, the sender number their messages carry.

import { DiscordAnswered, channelOf, currentUserNamed, guildMember } from "./api";
import { accountIdFromToken, botAccount, botTokenMissing, discordConfig } from "./config";
import { chatMachine } from "./machine";
import { discordKey } from "./provider";
import { discordWords } from "./settings";

import type { DiscordCall, DiscordUser } from "./api";
import type { ChatMember } from "./chat";
import type { Store } from "./store";

// What asking for a room's members came to: the members, whole, or why none are held.
export type RoomMembers = { members: ChatMember[] } | { unheld: string };

// What a room calls a person: their nickname there, else their display name, else their username.
function nameOf(user: DiscordUser, nick: string | null): string {
  return nick ?? user.globalName ?? user.username ?? discordWords.unknown_sender;
}

// A person as a member, under the number the store holds them by; none is given only to list them.
async function memberOf(archive: Store, user: DiscordUser, nick: string | null): Promise<ChatMember> {
  return {
    person: await archive.providerNumbers().knownSenderId(discordKey, user.id),
    name: nameOf(user, nick),
    statusMessage: null,
  };
}

// A guild channel's members: the bot account first, then each writer of the room in the order first heard, each
// kept where Discord says the guild still holds them.
async function guildMembers(
  archive: Store,
  api: DiscordCall,
  chatId: number,
  guildId: string,
  botId: string | null,
): Promise<ChatMember[]> {
  const writers = await archive.chats().roomWriters(discordKey, chatId);
  const asked = [...new Set([...(botId === null ? [] : [botId]), ...writers])];
  const members: ChatMember[] = [];

  // One at a time, so a long list of writers never comes to Discord as a burst.
  for (const userId of asked) {
    const found = await guildMember(api, guildId, userId);

    if (found !== null) {
      members.push(await memberOf(archive, found.user, found.nick));
    }
  }

  return members;
}

// The members of a room, or why none are held: a number that is no room of this provider's, a channel that is
// neither a DM nor a guild's, or a call Discord answered with a failure, in its own words.
export async function roomMembers(chatId: number): Promise<RoomMembers> {
  const machine = chatMachine();
  const discord = discordConfig();

  if (machine === null || discord === null) {
    return { unheld: botTokenMissing };
  }

  const { archive } = machine;
  const channelId = await archive.providerNumbers().providerRoom(discordKey, chatId);

  if (channelId === null) {
    return { unheld: `Nothing is known of room ${chatId}.` };
  }

  const api = botAccount(discord);

  try {
    const channel = await channelOf(api, channelId);

    if (channel.direct) {
      const bot = await currentUserNamed(api);
      const people = bot === null ? channel.recipients : [...channel.recipients, bot];

      return { members: await Promise.all(people.map((user) => memberOf(archive, user, null))) };
    }

    if (channel.guildId === null) {
      return { unheld: `Room ${chatId} is neither a DM nor a guild's channel.` };
    }

    return { members: await guildMembers(archive, api, chatId, channel.guildId, accountIdFromToken(discord.token)) };
  } catch (error) {
    if (error instanceof DiscordAnswered) {
      return { unheld: `The members of room ${chatId} could not be read: ${error.message}` };
    }

    throw error;
  }
}
