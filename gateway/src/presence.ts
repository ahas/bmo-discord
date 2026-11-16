// Presence as the bot account's socket hears it (docs/discord.md, 「Typing and presence」): whether the
// application has been granted the privileged presence intent, and the presence of the guilds' members the
// socket holds, told to the service as changes and, once a fresh session has delivered its guilds, as a
// whole list.

import { currentApplicationFlags } from "./api";
import { discordPolicy } from "./settings";

import type { DiscordCall } from "./api";
import type { ChatPresenceState, Heard } from "./chat";
import type { DiscordGuild, DiscordPresence, DiscordStatus } from "./events";

// The application's flags that say the presence intent is granted: in full, or limited to fewer than a
// hundred servers.
const presenceGranted = 1 << 12;
const presenceGrantedLimited = 1 << 13;

const notGranted =
  "the application has not been granted the presence intent: switch Presence Intent on under Bot in the Discord developer portal";

// Discord's statuses as the protocol's states: do not disturb is still at the platform, idle is away.
const states: Record<DiscordStatus, ChatPresenceState> = {
  online: "online",
  idle: "away",
  dnd: "online",
  offline: "offline",
};

export function presenceState(status: DiscordStatus): ChatPresenceState {
  return states[status];
}

// Whether the presence intent is granted, from the last check of the application or the last refusal.
let grant: Heard = { heard: false, reason: "the presence intent has not been checked with Discord yet" };

export function presenceGrant(): Heard {
  return grant;
}

function setGrant(next: Heard): void {
  if (next.heard !== grant.heard || next.reason !== grant.reason) {
    console.log(next.heard ? "discord: the presence intent is granted" : `discord: presence is off: ${next.reason}`);
  }

  grant = next;
}

// Discord refused an identify that asked for the presence intent: it is not granted until a check says so.
export function refusePresence(): void {
  setGrant({ heard: false, reason: notGranted });
}

// Asks Discord for the application's flags and holds whether the presence intent is granted, answering
// whether it was newly granted. A check that does not reach Discord leaves the answer that stood.
export async function checkPresence(bot: DiscordCall): Promise<boolean> {
  const before = grant.heard;

  try {
    const flags = await currentApplicationFlags(bot);
    const granted = (flags & (presenceGranted | presenceGrantedLimited)) !== 0;

    setGrant(granted ? { heard: true, reason: null } : { heard: false, reason: notGranted });
  } catch (error) {
    console.error("discord: whether the presence intent is granted could not be checked:", error);
  }

  return !before && grant.heard;
}

// Checks the grant now and every `presence_check_ms` after, calling `granted` each time it is newly granted,
// until the answer is stopped.
export function keepCheckingPresence(bot: DiscordCall, granted: () => void): () => void {
  let stopped = false;
  let next: ReturnType<typeof setTimeout> | null = null;

  const round = (): void => {
    void checkPresence(bot)
      .then((newly) => {
        if (newly && !stopped) {
          granted();
        }
      })
      .finally(() => {
        if (!stopped) {
          next = setTimeout(round, discordPolicy.presence_check_ms);
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

// One person's presence as the socket holds it, and the guilds it has heard them in.
export interface HeldPresence {
  userId: string;
  state: ChatPresenceState;
  guildIds: string[];
}

// Tells the service the presence of the people given, `whole` where they are every person held.
export type TellPresence = (people: HeldPresence[], whole: boolean) => Promise<void>;

// The presence the socket holds of the guilds' members, in memory alone: started again at each fresh
// session's ready, told whole once every guild the ready names has come or the gathering's time is up, and
// told as a change of each person a presence update or a later guild names.
export class PresenceBook {
  private readonly people = new Map<string, { state: ChatPresenceState; guildIds: Set<string> }>();
  // The guilds a fresh session still waits on before its whole list goes; null once it has gone.
  private waiting: Set<string> | null = null;
  private gathering: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly tell: TellPresence,
    private readonly gatherMs: number = discordPolicy.presence_gather_ms,
  ) {}

  // A fresh session ready, naming the guilds it delivers after it.
  started(guildIds: string[]): void {
    this.people.clear();
    this.waiting = new Set(guildIds);
    this.stopGathering();
    this.gathering = setTimeout(() => this.tellWhole(), this.gatherMs);

    if (this.waiting.size === 0) {
      this.tellWhole();
    }
  }

  // The session ended; what it held stands until the next one starts.
  ended(): void {
    this.stopGathering();
    this.waiting = null;
  }

  // A guild delivered: its members with a presence as it gives them, and offline where it gives none.
  guild(guild: DiscordGuild): void {
    const given = new Set(guild.presences.map((presence) => presence.userId));
    const named = [
      ...guild.presences.map((presence) => this.hold(presence.userId, guild.guildId, presenceState(presence.status))),
      ...guild.memberIds.filter((userId) => !given.has(userId)).map((userId) => this.hold(userId, guild.guildId, "offline")),
    ];

    if (this.waiting === null) {
      this.say(named, false);

      return;
    }

    this.waiting.delete(guild.guildId);

    if (this.waiting.size === 0) {
      this.tellWhole();
    }
  }

  // One member's presence changed.
  update(presence: DiscordPresence): void {
    const held = this.hold(presence.userId, presence.guildId, presenceState(presence.status));

    if (this.waiting === null) {
      this.say([held], false);
    }
  }

  private hold(userId: string, guildId: string, state: ChatPresenceState): HeldPresence {
    const held = this.people.get(userId) ?? { state, guildIds: new Set<string>() };

    held.state = state;
    held.guildIds.add(guildId);
    this.people.set(userId, held);

    return { userId, state, guildIds: [...held.guildIds] };
  }

  private tellWhole(): void {
    this.stopGathering();
    this.waiting = null;
    this.say(
      [...this.people].map(([userId, held]) => ({ userId, state: held.state, guildIds: [...held.guildIds] })),
      true,
    );
  }

  private say(people: HeldPresence[], whole: boolean): void {
    this.tell(people, whole).catch((error: unknown) => {
      console.error("discord: a presence change could not be told:", error);
    });
  }

  private stopGathering(): void {
    if (this.gathering !== null) {
      clearTimeout(this.gathering);
    }

    this.gathering = null;
  }
}
