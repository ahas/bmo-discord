// Generated from `docs/openapi.json` by `tools/generate.ts`. Do not edit by hand: change the document and run
// `bun tools/generate.ts`.
//
// The gateway's client of the service: the routes the service serves the gateway in docs/api.md.

import { routeToken, servicePort } from "./settings";

import type { HandedMessage, PresenceInRooms, TypingMark } from "./chat";

// A hand-over or a presence change is offered again only while nothing listens, this often, until the service
// is reached.
const offerEveryMs = 2_000;

// Why the service did not take a call: the error shape it answered with.
export class SeamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SeamError";
  }
}

function refusedConnection(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ConnectionRefused";
}

function readError(body: string, status: number): SeamError {
  try {
    const answer: unknown = JSON.parse(body);

    if (typeof answer === "object" && answer !== null && "code" in answer && "error" in answer) {
      const { code, error } = answer as { code: unknown; error: unknown };

      if (typeof code === "string" && typeof error === "string") {
        return new SeamError(status, code, error);
      }
    }
  } catch {
    // Not every answer carries JSON; the sentence below says what was answered.
  }

  return new SeamError(status, "failed", `The service answered ${status}.`);
}

export class Service {
  constructor(
    private readonly base: string = `http://127.0.0.1:${servicePort()}`,
    private readonly token: string = routeToken(),
  ) {}

  // One call, answered with the body the service answered with, however long that takes; a failure answer is
  // the error shape it carried.
  private async call(method: string, path: string, body: unknown): Promise<string> {
    const answer = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      timeout: false,
    });
    const read = await answer.text();

    if (!answer.ok) {
      throw readError(read, answer.status);
    }

    return read;
  }

  // One call offered again while nothing listens at the service, until it is reached.
  private async offered(method: string, path: string, body: unknown): Promise<string> {
    for (;;) {
      try {
        return await this.call(method, path, body);
      } catch (error) {
        if (!refusedConnection(error)) {
          throw error;
        }

        await Bun.sleep(offerEveryMs);
      }
    }
  }

  // One message handed over, answered as the receiving side holds it after it.
  async handOver(roomId: number, messageId: number, message: HandedMessage): Promise<HandedMessage> {
    return JSON.parse(await this.offered("PUT", `/rooms/${roomId}/messages/${messageId}`, message)) as HandedMessage;
  }

  // One typing mark, offered once: a mark offered late tells one that has already ended.
  async typingMarked(mark: TypingMark): Promise<void> {
    await this.call("POST", "/typing-marks", mark);
  }

  // People's presence, each beside the rooms they stand in.
  async presenceChanged(change: PresenceInRooms): Promise<void> {
    await this.offered("POST", "/presence-changes", change);
  }
}
