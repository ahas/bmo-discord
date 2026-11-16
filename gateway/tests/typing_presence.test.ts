// Typing and presence against a stand-in Discord and a stand-in service (docs/discord.md, 「Typing and
// presence」): a typing start told as a ten-second mark in a numbered room and never of the bot account or of
// this provider's own typing through the owner's account, a typing send for another account refused, the
// identify asking for presence only where it is granted, a fresh session's guilds told as a whole list with
// Discord's states mapped, and each person told beside the rooms they stand in.

import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Refusal } from "../src/chat";
import { botAccount, discordConfig } from "../src/config";
import { identifyFrame } from "../src/events";
import { holdChatMachine } from "../src/machine";
import { confirmOwner } from "../src/owner";
import { PresenceBook } from "../src/presence";
import { discordKey, discordProvider, handleTyping, presenceInRooms } from "../src/provider";
import { Service } from "../src/seam";
import { Store } from "../src/store";

import type { DiscordRoad } from "../src/provider";
import type { HeldPresence } from "../src/presence";
import type { DiscordConfig } from "../src/config";
import type { TypingMark } from "../src/chat";

const ownerId = "1001";
const botId = "2002";
const ownerToken = `${btoa(ownerId)}.example.owner`;
const botToken = `${btoa(botId)}.example.bot`;
const channelId = "555";
const guildId = "777";
const routeToken = "example-route-token";

// The typing calls the stand-in Discord was asked for, by the authorization each carried.
const typed: (string | null)[] = [];

const discord = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/users/@me") {
      return Response.json({ id: ownerId });
    }

    if (request.method === "POST" && path === `/channels/${channelId}/typing`) {
      typed.push(request.headers.get("authorization"));

      return new Response(null, { status: 204 });
    }

    return new Response("no route", { status: 404 });
  },
});

// The marks the stand-in service was told.
const marks: TypingMark[] = [];

const service = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.method === "POST" && new URL(request.url).pathname === "/typing-marks") {
      marks.push(await request.json() as TypingMark);

      return new Response(null, { status: 204 });
    }

    return new Response("no route", { status: 404 });
  },
});

const folder = mkdtempSync(join(tmpdir(), "discord-typing-"));
const store = new Store(folder, async () => {});
let chatId = 0;

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

beforeAll(async () => {
  Object.assign(process.env, {
    BMO_DISCORD_API_URL: `http://127.0.0.1:${discord.port}`,
    BMO_DISCORD_TOKEN: botToken,
    BMO_DISCORD_OWNER_ID: ownerId,
    BMO_DISCORD_OWNER_TOKEN: ownerToken,
    BMO_DISCORD_OWNER_PACE_MS: "0",
    BMO_DISCORD_SENDER_NAME: "tester",
    BMO_DISCORD_CLIENT_NAME: "tester-client",
  });
  delete process.env.BMO_DISCORD_OWNER_CHANNEL;
  holdChatMachine({ archive: store });
  chatId = await store.providerNumbers().providerChatId(discordKey, channelId, "");
  await store.chats().markOwnerHeard(discordKey, chatId);
  await store.chats().setRoomGuild(discordKey, chatId, guildId);
  await confirmOwner(config());
});

beforeEach(() => {
  marks.length = 0;
  typed.length = 0;
});

afterAll(() => {
  void discord.stop(true);
  void service.stop(true);
  store.close();
  rmSync(folder, { recursive: true, force: true });
});

test("a typing start is told as a ten-second mark in a numbered room, never of the bot account", async () => {
  await handleTyping(road(), { channelId: "999", guildId: null, userId: "3003" });
  await handleTyping(road(), { channelId, guildId, userId: botId });
  await handleTyping(road(), { channelId, guildId, userId: "3003" });

  const personId = await store.providerNumbers().knownSenderId(discordKey, "3003");

  expect(marks).toEqual([{ via: discordKey, roomId: chatId, personId: personId ?? -1, on: true, lastsMs: 10_000 }]);
});

test("the owner's typing start is passed over within a mark's life of this provider typing through his account", async () => {
  await discordProvider.send({ roomId: chatId, kind: "typing", fields: { on: true }, mode: "human-reader" });

  expect(typed).toEqual([ownerToken]);

  const now = Date.now();

  await handleTyping(road(), { channelId, guildId, userId: ownerId }, now);
  expect(marks).toHaveLength(0);

  await handleTyping(road(), { channelId, guildId, userId: ownerId }, now + 10_001);
  expect(marks.map((mark) => mark.personId)).toEqual([await store.providerNumbers().knownSenderId(discordKey, ownerId) ?? -1]);
});

test("a typing send for another account is refused and types nowhere", async () => {
  const send = discordProvider.send({ roomId: chatId, kind: "typing", fields: { on: true }, accountId: 42 });

  await expect(send).rejects.toBeInstanceOf(Refusal);
  await expect(send).rejects.toMatchObject({ code: "platform" });
  expect(typed).toHaveLength(0);
});

test("the identify asks for the typing intents always and for presence only where it is granted", () => {
  const intents = (presence: boolean): number => (JSON.parse(identifyFrame(botToken, presence)) as { d: { intents: number } }).d.intents;
  const typing = (1 << 11) | (1 << 14);
  const presence = 1 << 8;

  expect(intents(false) & typing).toBe(typing);
  expect(intents(false) & presence).toBe(0);
  expect(intents(true) & presence).toBe(presence);
});

test("a fresh session's guilds go as one whole list, idle as away and do not disturb as online", () => {
  const told: { people: HeldPresence[]; whole: boolean }[] = [];
  const book = new PresenceBook(async (people, whole) => {
    told.push({ people, whole });
  }, 60_000);

  book.started(["g1", "g2"]);
  book.guild({
    guildId: "g1",
    memberIds: ["u1", "u2", "u3"],
    presences: [{ guildId: "g1", userId: "u1", status: "idle" }, { guildId: "g1", userId: "u2", status: "dnd" }],
  });
  expect(told).toHaveLength(0);

  book.guild({ guildId: "g2", memberIds: [], presences: [{ guildId: "g2", userId: "u1", status: "online" }] });
  book.update({ guildId: "g1", userId: "u3", status: "online" });
  book.ended();

  expect(told).toEqual([
    {
      whole: true,
      people: [
        { userId: "u1", state: "online", guildIds: ["g1", "g2"] },
        { userId: "u2", state: "online", guildIds: ["g1"] },
        { userId: "u3", state: "offline", guildIds: ["g1"] },
      ],
    },
    { whole: false, people: [{ userId: "u3", state: "online", guildIds: ["g1"] }] },
  ]);
});

test("each person is told beside the rooms they stand in, and the bot account and a stranger never", async () => {
  const told = await presenceInRooms(road(), [
    { userId: "4004", state: "away", guildIds: [guildId] },
    { userId: botId, state: "online", guildIds: [guildId] },
    { userId: "5005", state: "online", guildIds: ["888"] },
  ]);

  expect(told).toEqual([
    { personId: await store.providerNumbers().knownSenderId(discordKey, "4004") ?? -1, state: "away", lastSeenAt: null, roomIds: [chatId] },
  ]);
  expect(await store.providerNumbers().knownSenderId(discordKey, "5005")).toBeNull();
});
