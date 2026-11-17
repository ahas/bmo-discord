// The bot token against a stand-in Discord (docs/discord.md, 「The bot token」): the gateway's health ready
// saying the token is not set where it is unset, not ready until Discord has answered, ready once Discord
// accepts the token, and not ready, naming the rejection, once Discord refuses it.

import { afterAll, beforeAll, expect, test } from "bun:test";

import { confirmBotToken, forgetBotToken } from "../src/bot";
import { botTokenMissing, discordConfig } from "../src/config";
import { discordProvider } from "../src/provider";

import type { DiscordConfig } from "../src/config";

const botToken = `${btoa("2002")}.example.bot`;

// What the stand-in answers the current-user call with.
let status = 200;

const discord = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === "/users/@me") {
      return status === 200
        ? Response.json({ id: "2002" })
        : Response.json({ message: "401: Unauthorized" }, { status });
    }

    return new Response("no route", { status: 404 });
  },
});

const before = { token: process.env.BMO_DISCORD_TOKEN, api: process.env.BMO_DISCORD_API_URL };

function config(): DiscordConfig {
  const read = discordConfig();

  if (read === null) {
    throw new Error("the bot token is set");
  }

  return read;
}

beforeAll(() => {
  process.env.BMO_DISCORD_API_URL = `http://127.0.0.1:${discord.port}`;
});

afterAll(() => {
  void discord.stop(true);
  forgetBotToken();

  for (const [name, value] of [["BMO_DISCORD_TOKEN", before.token], ["BMO_DISCORD_API_URL", before.api]] as const) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test("with no bot token the gateway is ready and says the token is not set", () => {
  delete process.env.BMO_DISCORD_TOKEN;

  expect(discordProvider.health()).toEqual({ ready: true, reason: botTokenMissing });
});

test("with the bot token set the gateway is ready only while Discord accepts it", async () => {
  process.env.BMO_DISCORD_TOKEN = botToken;
  forgetBotToken();

  expect(discordProvider.health()).toEqual({
    ready: false,
    reason: "Discord has not yet answered whether it accepts BMO_DISCORD_TOKEN",
  });

  status = 200;
  await confirmBotToken(config());

  expect(discordProvider.health()).toEqual({ ready: true, reason: null });

  status = 401;
  await confirmBotToken(config());

  expect(discordProvider.health()).toEqual({
    ready: false,
    reason: "Discord rejected BMO_DISCORD_TOKEN: the current-user call answered 401",
  });
});
