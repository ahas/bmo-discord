// The owner's account against a stand-in Discord (docs/discord.md, 「The owner's account」): the gateway confirms
// the account with its own call, a room is offered the owner's voices only while it is confirmed, a
// `human-avatar` send goes out behind the prefix and a `human-reader` send exactly as given, both on the bare
// user token, while the bot account's send keeps its `Bot ` scheme.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Refusal } from "../src/chat";
import { discordConfig } from "../src/config";
import { holdChatMachine } from "../src/machine";
import { confirmOwner } from "../src/owner";
import { discordKey, discordProvider } from "../src/provider";
import { Store } from "../src/store";

import type { DiscordConfig } from "../src/config";

const ownerId = "1001";
const botId = "2002";
const ownerToken = `${btoa(ownerId)}.example.owner`;
const botToken = `${btoa(botId)}.example.bot`;
const channelId = "555";

// What the stand-in answers the current-user call with, and every message posted to it.
let whoAmI: { status: number; id: string } = { status: 200, id: ownerId };
const posted: { authorization: string | null; body: Record<string, unknown> }[] = [];

const discord = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;

    if (path === "/users/@me") {
      return whoAmI.status === 200
        ? Response.json({ id: whoAmI.id })
        : Response.json({ message: "401: Unauthorized" }, { status: whoAmI.status });
    }

    if (request.method === "GET" && path === `/channels/${channelId}`) {
      return Response.json({ id: channelId, name: "general" });
    }

    if (request.method === "POST" && path === `/channels/${channelId}/messages`) {
      posted.push({ authorization: request.headers.get("authorization"), body: await request.json() as Record<string, unknown> });

      return Response.json({ id: String(9000 + posted.length) });
    }

    return new Response("no route", { status: 404 });
  },
});

const folder = mkdtempSync(join(tmpdir(), "discord-owner-"));
const store = new Store(folder, async () => {});
let chatId = 0;

function config(): DiscordConfig {
  const read = discordConfig();

  if (read === null) {
    throw new Error("the test's environment sets the bot token");
  }

  return read;
}

beforeAll(async () => {
  Object.assign(process.env, {
    BMO_DISCORD_API_URL: `http://127.0.0.1:${discord.port}`,
    BMO_DISCORD_TOKEN: botToken,
    BMO_DISCORD_OWNER_ID: ownerId,
    BMO_DISCORD_OWNER_TOKEN: ownerToken,
    BMO_DISCORD_OWNER_PACE_MS: "0",
    BMO_DISCORD_SENDER_NAME: "tester",
  });
  delete process.env.BMO_DISCORD_AVATAR_PREFIX;
  delete process.env.BMO_DISCORD_OWNER_CHANNEL;
  holdChatMachine({ archive: store });
  chatId = await store.providerNumbers().providerChatId(discordKey, channelId, "");
  await store.chats().markOwnerHeard(discordKey, chatId);
});

afterAll(() => {
  void discord.stop(true);
  store.close();
  rmSync(folder, { recursive: true, force: true });
});

test("the owner's account stands confirmed only as the account its settings name", async () => {
  whoAmI = { status: 200, id: ownerId };
  expect(await confirmOwner(config())).toEqual({ confirmed: true, reason: null });
  expect(discordProvider.ownerAccount()).toEqual({ confirmed: true, reason: null });
  expect((await discordProvider.room(chatId))?.modes).toEqual(["bot-account", "human-reader", "human-avatar"]);

  whoAmI = { status: 200, id: "3003" };
  expect(await confirmOwner(config())).toEqual({
    confirmed: false,
    reason: "BMO_DISCORD_OWNER_TOKEN is not the account BMO_DISCORD_OWNER_ID names",
  });
  expect((await discordProvider.room(chatId))?.modes).toEqual(["bot-account"]);

  whoAmI = { status: 401, id: "" };
  expect(await confirmOwner(config())).toEqual({ confirmed: false, reason: "Discord refused BMO_DISCORD_OWNER_TOKEN with 401" });

  delete process.env.BMO_DISCORD_OWNER_TOKEN;
  expect(await confirmOwner(config())).toEqual({ confirmed: false, reason: "BMO_DISCORD_OWNER_TOKEN not set" });
  process.env.BMO_DISCORD_OWNER_TOKEN = ownerToken;
});

test("a human-avatar send carries the prefix and a human-reader send carries none", async () => {
  whoAmI = { status: 200, id: ownerId };
  await confirmOwner(config());
  posted.length = 0;

  const text = { roomId: chatId, kind: "text", fields: { text: "hello" }, prefix: "[agent]" } as const;

  await discordProvider.send({ ...text, mode: "human-avatar" });
  await discordProvider.send({ ...text, mode: "human-reader" });
  await discordProvider.send({ ...text, mode: "bot-account" });

  expect(posted.map((one) => [one.authorization, one.body.content])).toEqual([
    [ownerToken, "[agent] hello"],
    [ownerToken, "hello"],
    [`Bot ${botToken}`, "hello"],
  ]);
  expect(typeof posted[0]?.body.nonce).toBe("string");

  const unmarked = discordProvider.send({ roomId: chatId, kind: "text", fields: { text: "hello" }, mode: "human-avatar" });

  await expect(unmarked).rejects.toBeInstanceOf(Refusal);
  expect(posted).toHaveLength(3);
});
