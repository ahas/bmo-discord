// What the Discord road reads of its own environment: the platform's credentials, the owner's account and
// channel, the agent's stickers and prefix, and the pace of the owner's account. A machine with no Discord
// account behind it says one line at startup and goes on as before.

import { discordPolicy } from "./settings";

import type { DiscordCall } from "./api";
import type { ChatVoice } from "./chat";

export interface DiscordConfig {
  // The bot token of the application, which the bot account mode runs on. A token is the whole of
  // what the gateway and the REST side authenticate with, and none is ever written into a log or
  // an answer.
  token: string;
  // The owner's own Discord account, so the owner's words here are filed under the owner's number.
  ownerUserId: string | null;
  // The channel that is the owner's one-to-one with the agent — a DM channel — where there is one. A
  // Discord channel says whether it is a DM, but the road is told which one is the owner's rather than
  // taking the first DM it is spoken to in.
  ownerChannelId: string | null;
  // The agent's own stickers on this platform, by the emoji a session asks for them with. Discord names
  // a sticker by an id of its own rather than by an emoji, so the pairing is this application's
  // own and is read from `BMO_DISCORD_STICKERS` as `emoji:id` pairs separated by commas.
  stickers: Record<string, string>;
  // The owner's own user token, which the owner's account modes send through, where it is set.
  ownerToken: string | null;
  // The agent's prefix a `human-avatar` send carries where the send names none.
  avatarPrefix: string | null;
  // The least time, in milliseconds, between one call on the owner's account ending and the next starting.
  ownerPaceMs: number;
}

// The sticker pairing as it is written down, ignoring anything that is not a pair.
export function parseStickers(written: string | undefined): Record<string, string> {
  const stickers: Record<string, string> = {};

  for (const pair of (written ?? "").split(",")) {
    const [emoji, id] = pair.split(":").map((part) => part.trim());

    if (emoji !== undefined && emoji !== "" && id !== undefined && id !== "") {
      stickers[emoji] = id;
    }
  }

  return stickers;
}

export const botTokenMissing = "BMO_DISCORD_TOKEN not set";
const ownerTokenMissing = "BMO_DISCORD_OWNER_TOKEN not set";

function tokenOf(written: string | undefined): string | null {
  return written === undefined || written === "" ? null : written;
}

// The pace the environment names, or the policy's where it names none or no whole number of milliseconds.
function paceOf(written: string | undefined): number {
  const pace = written === undefined || written.trim() === "" ? Number.NaN : Number(written);

  return Number.isSafeInteger(pace) && pace >= 0 ? pace : discordPolicy.owner_pace_ms;
}

// Null where the bot token is not set, which is the account every room is read on.
export function discordConfig(env: NodeJS.ProcessEnv = process.env): DiscordConfig | null {
  const token = tokenOf(env.BMO_DISCORD_TOKEN);

  if (token === null) {
    return null;
  }

  return {
    token,
    ownerUserId: env.BMO_DISCORD_OWNER_ID ?? null,
    ownerChannelId: env.BMO_DISCORD_OWNER_CHANNEL ?? null,
    stickers: parseStickers(env.BMO_DISCORD_STICKERS),
    ownerToken: tokenOf(env.BMO_DISCORD_OWNER_TOKEN),
    avatarPrefix: tokenOf(env.BMO_DISCORD_AVATAR_PREFIX),
    ownerPaceMs: paceOf(env.BMO_DISCORD_OWNER_PACE_MS),
  };
}

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

// The voices this road holds an account for: the application's bot, and the owner's own account, which
// sends in his own words and in the agent's behind its prefix. An account made for the agent is never held:
// Discord's terms forbid automating one.
export type OwnerVoice = Extract<ChatVoice, "human-reader" | "human-avatar">;
export type AccountVoice = Extract<ChatVoice, "bot-account"> | OwnerVoice;

// One account the road calls Discord through, and the voice it speaks with.
export interface DiscordAccount extends DiscordCall {
  voice: AccountVoice;
}

export function isOwnerVoice(voice: string): voice is OwnerVoice {
  return voice === "human-reader" || voice === "human-avatar";
}

export function botAccount(discord: DiscordConfig): DiscordAccount {
  return { token: discord.token, bot: true, voice: "bot-account" };
}

// The first setting the owner's account is missing, or null where its token and id are both set. Whether the
// token is that account is the gateway's confirmation (`owner.ts`).
export function ownerSettingsMissing(discord: DiscordConfig): string | null {
  if (discord.ownerToken === null) {
    return ownerTokenMissing;
  }

  return discord.ownerUserId === null || discord.ownerUserId === "" ? "BMO_DISCORD_OWNER_ID not set" : null;
}

// The account a voice speaks with, or null where the road holds none for it. The owner's account is held
// where its settings are; a send through it also waits on its confirmation.
export function accountFor(discord: DiscordConfig, voice: ChatVoice): DiscordAccount | null {
  if (voice === "bot-account") {
    return botAccount(discord);
  }

  if (isOwnerVoice(voice) && discord.ownerToken !== null && ownerSettingsMissing(discord) === null) {
    return { token: discord.ownerToken, bot: false, voice };
  }

  return null;
}

// Why a voice has no account, in the words a refusal carries, which closes them with its own full stop: what
// the owner's account is missing for its voices, the platform's terms for an account made for the agent, and
// no platform for the rest. The bot account always has one, since the road runs only where its token is set.
export function voiceMissing(discord: DiscordConfig, voice: ChatVoice): string {
  if (isOwnerVoice(voice)) {
    return ownerSettingsMissing(discord) ?? ownerTokenMissing;
  }

  if (voice === "own-account") {
    return discordPolicy.user_accounts.replace(/\.$/, "");
  }

  return `Discord has no ${voice} account`;
}
