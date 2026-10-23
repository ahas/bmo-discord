// What the Discord road reads of its own environment: the platform's credentials, the owner's account and
// channel, and the agent's stickers. A machine with no Discord account behind it says one line at startup and
// goes on as before.

import { discordPolicy } from "./settings";

import type { ChatVoice } from "./chat";

export interface DiscordConfig {
  // The bot token of the application, which the bot account mode runs on. A token is the whole of
  // what the gateway and the REST side authenticate with, and none is ever written into a log or
  // an answer.
  token: string | null;
  // The user token of an account made for the agent, which the mode where the account is the agent's own
  // runs on.
  selfToken: string | null;
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
export const selfTokenMissing = "BMO_DISCORD_SELF_TOKEN not set";
export const discordMissing = "neither BMO_DISCORD_TOKEN nor BMO_DISCORD_SELF_TOKEN is set";

function tokenOf(written: string | undefined): string | null {
  return written === undefined || written === "" ? null : written;
}

// Null where no account at all is configured; each mode then stands on its own token.
export function discordConfig(env: NodeJS.ProcessEnv = process.env): DiscordConfig | null {
  const token = tokenOf(env.BMO_DISCORD_TOKEN);
  const selfToken = tokenOf(env.BMO_DISCORD_SELF_TOKEN);

  if (token === null && selfToken === null) {
    return null;
  }

  return {
    token,
    selfToken,
    ownerUserId: env.BMO_DISCORD_OWNER_ID ?? null,
    ownerChannelId: env.BMO_DISCORD_OWNER_CHANNEL ?? null,
    stickers: parseStickers(env.BMO_DISCORD_STICKERS),
  };
}

// One account this road holds a socket for: its token, whether it is an application's bot or a user
// account — which is how a request and an identify are written — and the voice it speaks with. Both are the
// road's own; Discord's terms forbid automating a person's account, so the owner's is never one of them.
export interface DiscordAccount {
  token: string;
  bot: boolean;
  voice: Extract<ChatVoice, "bot-account" | "own-account">;
}

export function discordAccounts(discord: DiscordConfig): DiscordAccount[] {
  return [
    ...(discord.token === null ? [] : [{ token: discord.token, bot: true, voice: "bot-account" as const }]),
    ...(discord.selfToken === null ? [] : [{ token: discord.selfToken, bot: false, voice: "own-account" as const }]),
  ];
}

// The account a voice speaks with, or null where the road holds none for it.
export function accountFor(discord: DiscordConfig, voice: ChatVoice): DiscordAccount | null {
  return discordAccounts(discord).find((account) => account.voice === voice) ?? null;
}

// Why a voice has no account, in the words a refusal carries, which closes them with its own full stop: the
// token it is missing, the platform's terms for a voice on a person's account, and no platform for the rest.
export function voiceMissing(voice: ChatVoice): string {
  if (voice === "bot-account") return botTokenMissing;
  if (voice === "own-account") return selfTokenMissing;
  if (voice === "human-reader" || voice === "human-avatar") return discordPolicy.person_accounts.replace(/\.$/, "");

  return `Discord has no ${voice} account`;
}
