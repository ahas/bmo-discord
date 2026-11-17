// The bot token as Discord answers it (docs/discord.md, 「The bot token」): whether Discord has accepted it,
// rejected it, or not yet answered. The gateway's health stands on it, and the service reads that health.

import { DiscordAnswered, currentUser } from "./api";
import { botAccount } from "./config";

import type { DiscordConfig } from "./config";

// Whether Discord accepts the bot token, and where it has not, why.
export interface BotTokenAnswer {
  accepted: boolean;
  reason: string | null;
}

const unanswered: BotTokenAnswer = {
  accepted: false,
  reason: "Discord has not yet answered whether it accepts BMO_DISCORD_TOKEN",
};

let answer: BotTokenAnswer = unanswered;

export function botTokenAnswer(): BotTokenAnswer {
  return answer;
}

// Discord took the token: a session ready on the socket, or the current-user call answered.
export function acceptBotToken(): void {
  answer = { accepted: true, reason: null };
}

// Discord refused the token, in the words of how it refused.
export function rejectBotToken(how: string): void {
  answer = { accepted: false, reason: `Discord rejected BMO_DISCORD_TOKEN: ${how}` };
}

// Asks Discord whose the bot token is. Discord answering accepts the token, and refusing it as unauthorized
// or forbidden rejects it; a check that does not reach Discord, or meets any other failure, leaves the answer
// that stood, which the socket's next session settles.
export async function confirmBotToken(discord: DiscordConfig): Promise<BotTokenAnswer> {
  try {
    await currentUser(botAccount(discord));
    acceptBotToken();
  } catch (error) {
    if (error instanceof DiscordAnswered && (error.status === 401 || error.status === 403)) {
      rejectBotToken(`the current-user call answered ${error.status}`);
    } else {
      console.error("discord: whether Discord accepts the bot token could not be asked:", error);
    }
  }

  return answer;
}

// Forgets every answer, as a gateway starting again with a new token does.
export function forgetBotToken(): void {
  answer = unanswered;
}
