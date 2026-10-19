// The gateway process (docs/boundary-api.md): it holds the Discord accounts' sockets, answers the service's
// routes on the loopback, and hands what its rooms say to the service. Only the service calls it.

import { notReady } from "./chat";
import { holdChatMachine } from "./machine";
import { discordProvider } from "./provider";
import { handToService } from "./service";
import { dataFolder, discordWords, gatewayPort, routeToken } from "./settings";
import { Store } from "./store";

import type { ChatMessage, ChatReceiver, ChatSendRequest, InboundChatContext } from "./chat";

const token = routeToken();
const store = new Store(dataFolder(), async (message) => await handToService("message", message, null));

holdChatMachine({ archive: store });

// What the provider hands over goes to the service once: a message another socket has already handed over is
// dropped here, and one whose hand-over fails is offered again by the next socket that reads it.
const receiver: ChatReceiver = {
  async message(message: ChatMessage, context: InboundChatContext) {
    if (!store.messages().markHandedOver(message)) {
      return;
    }

    try {
      await handToService("message", message, context);
    } catch (error) {
      store.messages().unmarkHandedOver(message);
      console.error(`discord: message ${message.messageId} in room ${message.chatId} was not handed over:`, error);
    }
  },

  async edited(message: ChatMessage, context: InboundChatContext) {
    try {
      await handToService("edited", message, context);
    } catch (error) {
      console.error(`discord: the edit of message ${message.messageId} in room ${message.chatId} was not handed over:`, error);
    }
  },
};

// An answer in the protocol's error shape.
function failure(status: number, code: string, error: string): Response {
  return Response.json({ code, error }, { status });
}

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();

    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The room number a room question names, or null where the body names none.
function chatIdOf(body: Record<string, unknown> | null): number | null {
  const chatId = body?.chatId;

  return typeof chatId === "number" && Number.isSafeInteger(chatId) ? chatId : null;
}

const roomQuestions: Record<string, (chatId: number) => Promise<Record<string, unknown>>> = {
  "/gateway/room/owns": async (chatId) => ({ owns: await discordProvider.ownsRoom(chatId) }),
  "/gateway/room/identity": async (chatId) => ({ identity: await discordProvider.identityOf(chatId) }),
  "/gateway/room/is-owner": async (chatId) => ({ kind: await discordProvider.isOwnerRoom(chatId) ? "owner" : "group" }),
  "/gateway/room/private-of": async (chatId) => ({ person: await discordProvider.privateRoomOf(chatId) }),
  "/gateway/room/title": async (chatId) => ({ title: await discordProvider.roomTitle(chatId) }),
};

async function answer(request: Request): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    return failure(401, "unauthorized", "The bearer token is missing or wrong.");
  }

  const path = new URL(request.url).pathname;

  if (request.method === "GET" && path === "/health") {
    const missing = discordProvider.configured();

    return Response.json({ ready: missing === null, reason: missing });
  }

  if (request.method === "GET" && path === "/gateway/owner-room") {
    return Response.json({ chatId: await discordProvider.ownerRoom() });
  }

  if (request.method === "POST" && path === "/gateway/send") {
    const body = await bodyOf(request);

    if (body === null || chatIdOf(body) === null || typeof body.verb !== "string") {
      return failure(400, "bad-request", "A send names its chatId and its verb.");
    }

    if (discordProvider.configured() !== null) {
      return Response.json({ sent: false, refusal: notReady(discordWords.label), gone: false });
    }

    return Response.json(await discordProvider.send(body as unknown as ChatSendRequest));
  }

  const question = request.method === "POST" ? roomQuestions[path] : undefined;

  if (question !== undefined) {
    const chatId = chatIdOf(await bodyOf(request));

    if (chatId === null) {
      return failure(400, "bad-request", "A room question names its chatId.");
    }

    return Response.json(await question(chatId));
  }

  return failure(404, "no-route", `No route at ${request.method} ${path}.`);
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: gatewayPort(),
  async fetch(request) {
    try {
      return await answer(request);
    } catch (error) {
      return failure(500, "failed", error instanceof Error ? error.message : String(error));
    }
  },
});

discordProvider.start({ archive: store, receiver });

const configured = discordProvider.configured();

console.log(`discord: gateway listening on ${server.hostname}:${server.port}${configured === null ? "" : ` — ${configured}`}`);

function stop(): void {
  discordProvider.stop();
  void server.stop();
  store.close();
  process.exit(0);
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
