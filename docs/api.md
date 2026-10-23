# The Discord provider's fixed API

**Fixed 0.5.0.**

This document is `bmo-discord`'s fixed API, in the common wire format, grouped by the resource each route
acts on. `docs/openapi.json` is the same contract in machine form, and the two clients beside the code —
`src/seam.rs` and `gateway/src/seam.ts` — are generated from that one document by `tools/generate.ts`. Where
this document and the OpenAPI document disagree, the OpenAPI document stands.

The wire format, the shape of routes and bodies, the error codes and the rules between units are bmo-chat's
(`docs/conventions.md`). The provider routes another unit calls are bmo-chat's too, and this document does
not restate them: they are `docs/protocol.md` and `docs/openapi/provider.json` in that repository, served
here exactly as they state them.

## What the provider serves

- **The chat protocol's provider routes**, all of them, as bmo-chat's `provider_router` serves them: the
  declaration, health, sends, the rooms of the account, a room, the owner, a message's files, the dialect
  readings and checks, and the avatar routes. This repository adds no public route beside them.
- **Its own loopback API**, the seam between its two processes, stated below. It is not a route another unit
  calls; both processes listen on `127.0.0.1` only and every route takes `BMO_DISCORD_ROUTE_TOKEN` as its
  bearer, answering 401 without it.

The provider declares `text`, `replyTo`, `photo`, `document`, `sticker`, `reaction`, `pin`, `typing` and `edit`.
It declares no `fetchMedia`, no `avatars`, no `history`, no `roomList` and no album, audio, voice or delete
send, so the base refuses those before this provider is asked.

Its one mode that can be active is `bot-account`. Its `human-reader`, `human-avatar` and `own-account` modes,
the modes on a user account, are declared `unsupported`, with Discord's terms as the reason (`docs/discord.md`,
「The declaration」).

## The wire

- **Keys** are camelCase. **Times** are integers of epoch milliseconds. **Rooms, messages, senders and every
  other id** are signed 64-bit integers.
- **A list is a page**, `{"items": [...], "more": boolean}`.
- **A failure is a non-2xx status** whose body is `{"code": ..., "error": ...}`. A refusal is answered by
  status too; no success carries a refusal flag.

### Codes

| Status | `code` | When |
|---|---|---|
| 400 | `bad-request` | the body or the query is not the shape the route takes |
| 401 | `unauthorized` | the token is missing or wrong |
| 404 | `no-route` | no route answers this method and path |
| 404 | `not-found` | the number names no room this provider owns |
| 422 | `platform` | Discord refused, for this provider's English reason |
| 422 | `unsupported-capability` | the send's kind is not one the provider declares |
| 500 | `failed` | the process failed while answering |
| 503 | `not-ready` | the provider is up and cannot answer yet; `Retry-After` says when to ask again |

A send this provider does not perform is a refusal; its code is one of the refusal codes `bmo-chat`'s
`docs/contract.md` lists, answered with that code's status.

## Health

| Route | Answers |
|---|---|
| `GET /health` | `ready` (boolean), `reason` (null when ready) and `version` (the service's own version) |

The service answers ready once its gateway is ready and the bot token is set; the reason names the first
setting missing while it is not.

## Rooms

| Route | Query | Answers |
|---|---|---|
| `GET /rooms/{roomId}` | | one room: `id`, `owns`, `identity`, `kind` (`owner` or `group`), `privateTo`, `title`. 404 `not-found` where the number is not this provider's |

`identity` is the sender number the account's own words carry in the room, and `privateTo` is the one person of
a one-to-one, null for a room of several. The gateway says nothing of a room's modes: the service answers the
protocol's room with `modes`, the voices its declaration has active, which every room takes alike.

## The owner

| Route | Answers |
|---|---|
| `GET /owner` | `roomId`, the room to speak into to reach the owner unprompted, or null |

## Sends

| Route | Body | Answers |
|---|---|---|
| `POST /sends` | a send as bmo-chat's `docs/contract.md` states it: `roomId`, `kind`, the kind's `fields`, and optional `mode`, `speaker`, `tag`, `prefix` and `replyToMessageId` | 201 with `messageId` (null where Discord gives none back) and `missed` (empty, since no album goes) |
| | | A send that does not go is answered with the refusal's code and status |

`prefix` belongs to the `human-avatar` voice, which this provider declares `unsupported`, so it changes no send.
A send whose `mode` names a voice on a user account is refused `platform`.

Bytes — a document's `bytes` — are base64.

## Messages

| Route | Body | Answers |
|---|---|---|
| `PUT /rooms/{roomId}/messages/{messageId}` | a message as bmo-chat's `docs/contract.md` states it, with `origin`, `senderId`, `senderName`, `sentAt`, `text`, `replyToMessageId`, `via`, `album`, `mode`, `context`, `room`, `files` and `gathering` | 201 where the receiving side did not hold the message before, 200 where it did, with the message as held |

A message the receiving side could not take is answered with its own error shape and status, so `not-ready`
reaches the hand-over as it came. A hand-over is offered again only while nothing listens at the receiving
side, within the protocol's patience window; a request that reached a listener is never offered again.

The provider hands over `live` and `edit` messages under their room and number; it declares no `history`, so
no past message is read back. A message that carried a file crosses as a mark in `text` with
`context.carriesFile`; no bytes cross, since the provider declares no `fetchMedia`.
