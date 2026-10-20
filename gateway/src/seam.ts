// Generated from `docs/openapi.json` by `tools/generate.ts`. Do not edit by hand: change the document and run
// `bun tools/generate.ts`.
//
// The gateway's client of the service: the hand-over route the service serves in docs/api.md.

import { routeToken, servicePort } from "./settings";

import type { HandedMessage } from "./chat";

// The protocol's retry rule: a hand-over is offered again only while nothing listens, within this window.
const patienceMs = 120_000;
const offerEveryMs = 2_000;

// Why the service did not take a hand-over: the error shape it answered with.
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

  // One message handed over, answered as the receiving side holds it after it.
  async handOver(roomId: number, messageId: number, message: HandedMessage): Promise<HandedMessage> {
    const deadline = Date.now() + patienceMs;

    for (;;) {
      try {
        const answer = await fetch(`${this.base}/rooms/${roomId}/messages/${messageId}`, {
          method: "PUT",
          headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
          body: JSON.stringify(message),
        });
        const body = await answer.text();

        if (!answer.ok) {
          throw readError(body, answer.status);
        }

        return JSON.parse(body) as HandedMessage;
      } catch (error) {
        if (!refusedConnection(error) || Date.now() >= deadline) {
          throw error;
        }

        await Bun.sleep(offerEveryMs);
      }
    }
  }
}
