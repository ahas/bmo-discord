// The gateway process (docs/boundary-api.md): it holds the Discord accounts' sockets, answers the service's
// routes on the loopback, and hands what its rooms say to the service. Only the service calls it.

import packageFile from "../package.json";

import { holdChatMachine } from "./machine";
import { roomMembers } from "./members";
import { discordProvider } from "./provider";
import { Refusal } from "./chat";
import { Service } from "./seam";
import { dataFolder, gatewayPort, routeToken } from "./settings";
import { Store } from "./store";

// The version the gateway's health answers: the set's version the testbed hands the process as
// `BMO_VERSION`, else the package's placeholder (bmo-chat's docs/conventions.md, 「Versions」).
const version = process.env.BMO_VERSION || packageFile.version;

import type { ChatSendRequest } from "./chat";
import type { KeptMessage } from "./store";

const token = routeToken();
const service = new Service();
const store = new Store(dataFolder(), async (kept: KeptMessage) => {
  await service.handOver(kept.chatId, kept.messageId, kept.message);
});

holdChatMachine({ archive: store });

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

// The room number a room path names, `tail` after it, or null where the path names none.
function roomIdOf(path: string, tail = ""): number | null {
  const match = new RegExp(`^/rooms/(-?\\d+)${tail}$`).exec(path);
  const roomId = match?.[1] === undefined ? Number.NaN : Number(match[1]);

  return Number.isSafeInteger(roomId) ? roomId : null;
}

async function answer(request: Request): Promise<Response> {
  if (request.headers.get("authorization") !== `Bearer ${token}`) {
    return failure(401, "unauthorized", "The bearer token is missing or wrong.");
  }

  const path = new URL(request.url).pathname;

  if (request.method === "GET" && path === "/health") {
    return Response.json({ ...discordProvider.health(), version });
  }

  if (request.method === "GET" && path === "/owner-account") {
    const owner = discordProvider.ownerAccount();

    return Response.json({ ready: owner.confirmed, reason: owner.reason, version });
  }

  if (request.method === "GET" && path === "/hearing") {
    return Response.json(discordProvider.hearing());
  }

  if (request.method === "GET" && path === "/owner") {
    return Response.json({ roomId: await discordProvider.ownerRoom() });
  }

  const membersOf = request.method === "GET" ? roomIdOf(path, "/members") : null;

  if (membersOf !== null) {
    const members = await roomMembers(membersOf);

    return "unheld" in members ? failure(404, "not-found", members.unheld) : Response.json(members);
  }

  if (request.method === "GET") {
    const roomId = roomIdOf(path);

    if (roomId !== null) {
      const room = await discordProvider.room(roomId);

      return room === null
        ? failure(404, "not-found", `Nothing is known of room ${roomId}.`)
        : Response.json(room);
    }
  }

  if (request.method === "POST" && path === "/sends") {
    const body = await bodyOf(request);

    if (body === null || typeof body.roomId !== "number" || !Number.isSafeInteger(body.roomId) || typeof body.kind !== "string") {
      return failure(400, "bad-request", "A send names its roomId and its kind.");
    }

    try {
      return Response.json(await discordProvider.send(body as unknown as ChatSendRequest), { status: 201 });
    } catch (error) {
      if (error instanceof Refusal) {
        return failure(error.status, error.code, error.detail);
      }

      throw error;
    }
  }

  return failure(404, "no-route", `No route at ${request.method} ${path}.`);
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: gatewayPort(),
  // A call the service makes is held until it is answered, however long the platform takes over it.
  idleTimeout: 0,
  async fetch(request) {
    try {
      return await answer(request);
    } catch (error) {
      return failure(500, "failed", error instanceof Error ? error.message : String(error));
    }
  },
});

discordProvider.start({ archive: store, service });

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
