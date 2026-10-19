// The one call the gateway makes on the service (docs/boundary-api.md, 「The seam between the service and the
// gateway」): a hand-over of what a room said, which the service hands on to the receiver.

import { routeToken, servicePort } from "./settings";

import type { ChatMessage, InboundChatContext } from "./chat";

// The protocol's retry rule: a hand-over is offered again only while nothing listens, within this window.
const patienceMs = 120_000;
const offerEveryMs = 2_000;

function refusedConnection(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ConnectionRefused";
}

export async function handToService(
  kind: "message" | "edited",
  message: ChatMessage,
  context: InboundChatContext | null,
): Promise<void> {
  const deadline = Date.now() + patienceMs;

  for (;;) {
    try {
      const answer = await fetch(`http://127.0.0.1:${servicePort()}/service/inbound`, {
        method: "POST",
        headers: { authorization: `Bearer ${routeToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ kind, message, context }),
      });

      if (!answer.ok) {
        throw new Error(`the service answered the ${kind} hand-over ${answer.status}: ${await answer.text()}`);
      }

      return;
    } catch (error) {
      if (!refusedConnection(error) || Date.now() >= deadline) {
        throw error;
      }

      await Bun.sleep(offerEveryMs);
    }
  }
}
