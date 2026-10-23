// What the gateway reads of its own environment beyond the platform's credentials (`config.ts`), the
// provider's fixed values in `policy/discord.toml`, and the words a person reads in `lang/ko.toml`
// (docs/boundary-api.md, 「Configuration」). The agent's names are configuration the deployment writes from the
// agent's registration; nothing here knows whose they are.

import policyFile from "../../policy/discord.toml";
import wordsFile from "../../lang/ko.toml";

export interface NumberRange {
  first: number;
  last: number;
}

export interface DiscordPolicy {
  can: string[];
  person_accounts: string;
  numbering: { rooms: NumberRange; people: NumberRange };
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

// The name the agent's own words are handed over under.
export function senderName(): string {
  return requiredSetting("BMO_DISCORD_SENDER_NAME");
}

// The client name each bot socket identifies itself with to Discord.
export function clientName(): string {
  return requiredSetting("BMO_DISCORD_CLIENT_NAME");
}

// The bearer every route of the service and of the gateway takes.
export function routeToken(): string {
  return requiredSetting("BMO_DISCORD_ROUTE_TOKEN");
}

function port(name: string, otherwise: number): number {
  const written = setting(name);
  const read = written === null ? otherwise : Number(written);

  if (!Number.isInteger(read) || read <= 0 || read > 65_535) {
    throw new Error(`${name} is not a port: ${written}`);
  }

  return read;
}

// The loopback port the gateway listens on.
export function gatewayPort(): number {
  return port("BMO_DISCORD_GATEWAY_PORT", 3231);
}

// The loopback port the service listens on, where the gateway hands over what its rooms say.
export function servicePort(): number {
  return port("BMO_DISCORD_PORT", 3230);
}

// The provider's own data folder, which holds the number store.
export function dataFolder(): string {
  return requiredSetting("BMO_DISCORD_DATA");
}
