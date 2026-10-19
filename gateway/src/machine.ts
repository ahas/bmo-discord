// What this process holds for every answer the gateway gives: the provider's own number store, set once as the
// process starts.

import type { Store } from "./store";

export interface ChatMachine {
  archive: Store;
}

let held: ChatMachine | null = null;

export function holdChatMachine(machine: ChatMachine): void {
  held = machine;
}

export function chatMachine(): ChatMachine | null {
  return held;
}
