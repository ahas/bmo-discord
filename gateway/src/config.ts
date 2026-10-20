// What the Discord road reads of its own environment: the platform's credentials, the owner's account and
// channel, and the agent's stickers. A machine with no Discord account behind it says one line at startup and
// goes on as before.

import type { ChatVoice } from "./chat";

export interface DiscordConfig {
  // The bot token of the application, which the bot account mode runs on. A token is the whole of
  // what the gateway and the REST side authenticate with, and none is ever written into a log or
  // an answer.
  token: string | null;
  // The owner's own user token, which the reader and the avatar modes run on.
  userToken: string | null;
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
export const userTokenMissing = "BMO_DISCORD_USER_TOKEN not set";
export const selfTokenMissing = "BMO_DISCORD_SELF_TOKEN not set";
export const discordMissing = "none of BMO_DISCORD_TOKEN, BMO_DISCORD_USER_TOKEN and BMO_DISCORD_SELF_TOKEN is set";

function tokenOf(written: string | undefined): string | null {
  return written === undefined || written === "" ? null : written;
}

// Null where no account at all is configured; each mode then stands on its own token.
export function discordConfig(env: NodeJS.ProcessEnv = process.env): DiscordConfig | null {
  const token = tokenOf(env.BMO_DISCORD_TOKEN);
  const userToken = tokenOf(env.BMO_DISCORD_USER_TOKEN);
  const selfToken = tokenOf(env.BMO_DISCORD_SELF_TOKEN);

  if (token === null && userToken === null && selfToken === null) {
    return null;
  }

  return {
    token,
    userToken,
    selfToken,
    ownerUserId: env.BMO_DISCORD_OWNER_ID ?? null,
    ownerChannelId: env.BMO_DISCORD_OWNER_CHANNEL ?? null,
    stickers: parseStickers(env.BMO_DISCORD_STICKERS),
  };
}

// One account this road holds a socket for: its token, whether it is an application's bot or a
// person's account — which is how a request and an identify are written — and the voice it speaks
// with. The owner's own account reads rooms beside the bot and answers, in the avatar voice, where no
// other account of this road is.
export interface DiscordAccount {
  token: string;
  bot: boolean;
  voice: Extract<ChatVoice, "bot-account" | "own-account" | "human-avatar">;
}

export function discordAccounts(discord: DiscordConfig): DiscordAccount[] {
  return [
    ...(discord.token === null ? [] : [{ token: discord.token, bot: true, voice: "bot-account" as const }]),
    ...(discord.selfToken === null ? [] : [{ token: discord.selfToken, bot: false, voice: "own-account" as const }]),
    ...(discord.userToken === null ? [] : [{ token: discord.userToken, bot: false, voice: "human-avatar" as const }]),
  ];
}

// The account a voice speaks with. Reading beside the bot and answering in the avatar voice are one
// account, the owner's own.
export function accountFor(discord: DiscordConfig, voice: ChatVoice): DiscordAccount | null {
  const wanted = voice === "human-reader" ? "human-avatar" : voice;

  return discordAccounts(discord).find((account) => account.voice === wanted) ?? null;
}

// What a voice is missing, in the words a refusal carries.
export function voiceMissing(voice: ChatVoice): string {
  if (voice === "bot-account") return botTokenMissing;
  if (voice === "own-account") return selfTokenMissing;

  return userTokenMissing;
}
