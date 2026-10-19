// What the gateway reads of its own environment beyond the platform's credentials (`config.ts`), the
// provider's fixed values in `policy/discord.toml`, and the words a person reads in `lang/ko.toml`
// (docs/boundary-api.md, 「Configuration」). The agent's names are configuration the deployment writes from the
// agent's registration; nothing here knows whose they are.

import policyFile from "../../policy/discord.toml";
import wordsFile from "../../lang/ko.toml";

export interface DiscordPolicy {
  can: string[];
  unpinned: string[];
}

export interface DiscordWords {
  label: string;
  picture_mark: string;
  document_kept: string;
  unknown_sender: string;
  unnamed_file: string;
}

export const discordPolicy = policyFile as DiscordPolicy;
export const discordWords = wordsFile as DiscordWords;

// A template of the pack with its {marks} filled; a mark it is not given stays as it is written.
export function fillMarks(template: string, marks: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => marks[key] ?? whole);
}

export class SettingMissing extends Error {
  constructor(name: string) {
    super(`${name} is not set: the deployment writes it from the agent's registration before the gateway starts`);
  }
}

function setting(name: string): string | null {
  const written = process.env[name];

  return written === undefined || written === "" ? null : written;
}

function requiredSetting(name: string): string {
  const written = setting(name);

  if (written === null) {
    throw new SettingMissing(name);
  }

  return written;
}

export const avatarPrefixMissing = "BMO_DISCORD_AVATAR_PREFIX not set";

// What the agent's words begin with in a person's account, or null where none is set and the avatar voice
// does not stand.
export function avatarPrefixSetting(): string | null {
  return setting("BMO_DISCORD_AVATAR_PREFIX");
}

// The name the agent's own words are handed over under.
export function senderName(): string {
  return requiredSetting("BMO_DISCORD_SENDER_NAME");
}

// The client name each bot socket identifies itself with to Discord.
export function clientName(): string {
  return requiredSetting("BMO_DISCORD_CLIENT_NAME");
}
