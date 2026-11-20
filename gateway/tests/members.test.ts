// A room's members against a stand-in Discord and a stand-in service (docs/discord.md, 「The members of a room」):
// a DM is its recipient and the bot account; a guild channel is the bot account and every writer the socket
// delivered in it that Discord confirms, one Discord no longer holds left out and one never heard there never
// asked; each named by nickname, display name or username; and a failure of Discord's is members not held, in
// its words.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { botAccount, discordConfig } from "../src/config";
import { holdChatMachine } from "../src/machine";
import { roomMembers } from "../src/members";
import { discordKey, handleDiscordMessage } from "../src/provider";
import { Service } from "../src/seam";
import { Store } from "../src/store";

import type { DiscordConfig } from "../src/config";
import type { DiscordMessage } from "../src/events";
import type { DiscordRoad } from "../src/provider";

const botId = "2002";
const botToken = `${btoa(botId)}.example.bot`;
const routeToken = "example-route-token";
const guildId = "777";
const guildChannel = "555";
const otherChannel = "556";
const directChannel = "600";
const refusedChannel = "666";
const person = "3003";
const stayed = "4004";
const left = "5005";
const elsewhere = "6006";

const users: Record<string, Record<string, unknown>> = {
  [botId]: { id: botId, username: "agent-bot", global_name: null },
  [person]: { id: person, username: "person", global_name: "Person" },
  [stayed]: { id: stayed, username: "stayer", global_name: "Stayer" },
  [elsewhere]: { id: elsewhere, username: "elsewhere", global_name: null },
};

// The members of the guild the stand-in holds, with their nicknames, and every member it was asked after.
const guild: Record<string, string | null> = { [botId]: "Agent", [stayed]: null, [elsewhere]: null };
const askedAfter: string[] = [];

const discord = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/users/@me") {
      return Response.json(users[botId]);
    }

    if (path === `/channels/${directChannel}`) {
      return Response.json({ id: directChannel, type: 1, recipients: [users[person]] });
    }

    if (path === `/channels/${guildChannel}`) {
      return Response.json({ id: guildChannel, type: 0, guild_id: guildId, name: "general" });
    }

    if (path === `/channels/${refusedChannel}`) {
      return Response.json({ message: "Missing Access", code: 50001 }, { status: 403 });
    }

    const member = /^\/guilds\/777\/members\/(\d+)$/.exec(path)?.[1];

    if (member !== undefined) {
      askedAfter.push(member);

      return member in guild
        ? Response.json({ user: users[member] ?? { id: member }, nick: guild[member] })
        : Response.json({ message: "Unknown Member", code: 10007 }, { status: 404 });
    }

    return new Response("no route", { status: 404 });
  },
});

// The stand-in service takes every hand-over as new.
const service = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    return Response.json(await request.json(), { status: 201 });
  },
});

const folder = mkdtempSync(join(tmpdir(), "discord-members-"));
const store = new Store(folder, async () => {});

function config(): DiscordConfig {
  const read = discordConfig();

  if (read === null) {
    throw new Error("the test's environment sets the bot token");
  }

  return read;
}

function road(): DiscordRoad {
  return {
    discord: config(),
    archive: store,
    service: new Service(`http://127.0.0.1:${service.port}`, routeToken),
    account: botAccount(config()),
  };
}

let sent = 0;

// A message the socket delivers, written by `authorId` in `channelId`.
async function delivered(channelId: string, authorId: string, inGuild: boolean): Promise<void> {
  sent += 1;

  const message: DiscordMessage = {
    kind: "said",
    channelId,
    guildId: inGuild ? guildId : null,
    messageId: String(9000 + sent),
    replyToId: null,
    authorId,
    authorName: authorId,
    authorIsBot: authorId === botId,
    text: "hello",
    nonce: null,
    sentAt: 1_700_000_000_000 + sent,
    files: [],
  };

  await handleDiscordMessage(road(), message);
}

async function numberOf(userId: string): Promise<number | null> {
  return store.providerNumbers().knownSenderId(discordKey, userId);
}

async function roomOf(channelId: string): Promise<number> {
  return store.providerNumbers().providerChatId(discordKey, channelId, "");
}

beforeAll(async () => {
  Object.assign(process.env, {
    BMO_DISCORD_API_URL: `http://127.0.0.1:${discord.port}`,
    BMO_DISCORD_TOKEN: botToken,
    BMO_DISCORD_SENDER_NAME: "tester",
  });
  delete process.env.BMO_DISCORD_OWNER_ID;
  delete process.env.BMO_DISCORD_OWNER_TOKEN;
  delete process.env.BMO_DISCORD_OWNER_CHANNEL;
  holdChatMachine({ archive: store });
});

afterAll(() => {
  void discord.stop(true);
  void service.stop(true);
  store.close();
  rmSync(folder, { recursive: true, force: true });
});

test("a DM's members are its recipient and the bot account", async () => {
  await delivered(directChannel, person, false);

  expect(await roomMembers(await roomOf(directChannel))).toEqual({
    members: [
      { person: await numberOf(person), name: "Person", statusMessage: null },
      { person: await numberOf(botId), name: "agent-bot", statusMessage: null },
    ],
  });
});

test("a guild channel's members are the bot account and the writers Discord still holds", async () => {
  await delivered(guildChannel, stayed, true);
  await delivered(guildChannel, left, true);
  await delivered(guildChannel, botId, true);
  await delivered(guildChannel, stayed, true);
  await delivered(otherChannel, elsewhere, true);
  askedAfter.length = 0;

  expect(await roomMembers(await roomOf(guildChannel))).toEqual({
    members: [
      { person: await numberOf(botId), name: "Agent", statusMessage: null },
      { person: await numberOf(stayed), name: "Stayer", statusMessage: null },
    ],
  });
  expect(askedAfter).toEqual([botId, stayed, left]);
});

test("a room Discord refuses, or one never numbered, holds no members", async () => {
  expect(await roomMembers(await roomOf(refusedChannel))).toEqual({
    unheld: expect.stringContaining("Missing Access") as unknown as string,
  });
  expect(await roomMembers(-1)).toEqual({ unheld: "Nothing is known of room -1." });
});
