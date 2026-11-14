// The owner's account as the gateway holds it (docs/discord.md, 「The owner's account」): the provider's pace
// every call on it keeps, and whether the gateway has confirmed with Discord, by its own call, that the token
// is the account the settings name. The service reads the confirmation from the gateway's own route.

import { DiscordAnswered, currentUser } from "./api";
import { ownerSettingsMissing } from "./config";
import { Pace } from "./pace";
import { discordPolicy } from "./settings";

import type { DiscordConfig } from "./config";

// Whether the owner's account is confirmed, and where it is not, why.
export interface OwnerConfirmation {
  confirmed: boolean;
  reason: string | null;
}

// The provider's pace on the owner's account, which every call made through it keeps.
export const ownerPace = new Pace();

let confirmation: OwnerConfirmation = {
  confirmed: false,
  reason: "the owner's account has not been confirmed with Discord yet",
};

export function ownerConfirmation(): OwnerConfirmation {
  return confirmation;
}

function refused(status: number): OwnerConfirmation {
  return { confirmed: false, reason: `Discord refused BMO_DISCORD_OWNER_TOKEN with ${status}` };
}

// A call on the owner's account at the provider's pace. Discord refusing it as unauthorized takes the
// confirmation away at once: the token no longer opens the account.
export async function onOwnerAccount<T>(discord: DiscordConfig, work: () => Promise<T>): Promise<T> {
  try {
    return await ownerPace.run(discord.ownerPaceMs, work);
  } catch (error) {
    if (error instanceof DiscordAnswered && error.status === 401) {
      confirmation = refused(error.status);
    }

    throw error;
  }
}

// Asks Discord whose the owner's token is, and confirms the account where it is the one the settings name.
// A token Discord refuses, or one that is another account's, leaves it unconfirmed with the reason; a check
// that does not reach Discord, or meets any other failure, leaves the answer that stood.
export async function confirmOwner(discord: DiscordConfig): Promise<OwnerConfirmation> {
  const missing = ownerSettingsMissing(discord);
  const token = discord.ownerToken;

  if (missing !== null || token === null) {
    confirmation = { confirmed: false, reason: missing };

    return confirmation;
  }

  try {
    const id = await onOwnerAccount(discord, () => currentUser({ token, bot: false }));

    confirmation = id === discord.ownerUserId
      ? { confirmed: true, reason: null }
      : { confirmed: false, reason: "BMO_DISCORD_OWNER_TOKEN is not the account BMO_DISCORD_OWNER_ID names" };
  } catch (error) {
    if (error instanceof DiscordAnswered && (error.status === 401 || error.status === 403)) {
      confirmation = refused(error.status);
    } else {
      console.error("discord: the owner's account could not be confirmed:", error);
    }
  }

  return confirmation;
}

// Confirms the owner's account now and every `owner_confirm_ms` after, until the answer is stopped.
export function keepConfirming(discord: DiscordConfig): () => void {
  let stopped = false;
  let next: ReturnType<typeof setTimeout> | null = null;

  const round = (): void => {
    void confirmOwner(discord).finally(() => {
      if (!stopped) {
        next = setTimeout(round, discordPolicy.owner_confirm_ms);
      }
    });
  };

  round();

  return () => {
    stopped = true;

    if (next !== null) {
      clearTimeout(next);
    }
  };
}
