# The Discord provider's fixed API

**Fixed at 0.1.0-rev.1.**

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

The provider declares `text`, `replyTo`, `photo`, `document`, `sticker`, `reaction`, `pin`, `typing` and `edit`;
`peopleTyping` while the bot account's socket runs, and `presence` while it runs with the presence intent
granted (`docs/discord.md`, 「Typing and presence」).
It declares no `fetchMedia`, no `avatars`, no `history`, no `roomList` and no album, audio, voice or delete
send, so the base refuses those before this provider is asked.

Its `bot-account` mode is active where the bot token is set and the gateway does not answer that Discord has
not accepted it, and its `human-reader` and `human-avatar` modes, the owner's account sending, while the
bot account's is and the gateway has confirmed the owner's account with its own call; each is inactive
otherwise, saying what it waits on. Its `own-account` mode is declared `unsupported`, with Discord's
terms as the reason (`docs/discord.md`, 「The declaration」).

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
| `GET /health` | `ready` (boolean), `reason` (why not while not ready; while ready, what is down, or null) and `version` (the service's own version) |

Health says whether the provider's processes serve, not whether a Discord application stands behind them:

- **Ready** once the gateway answers that it is ready.
- **Ready with no Discord application.** Where `BMO_DISCORD_TOKEN` is not set the provider is not configured,
  and that is a mode down, not a process failing: the answer is ready, its `reason` names the missing setting
  and every mode that is down. Every mode then stands inactive, and a send, a room or the owner is answered as
  an unconfigured provider answers it (`docs/discord.md`, 「Refusals」).
- **Not ready** while the gateway does not answer, while Discord has not yet answered whether it accepts the
  bot token, and once Discord has rejected it; the `reason` says which.

## The owner's account

| Route | Answers |
|---|---|
| `GET /owner-account` | `ready` (true once the gateway has confirmed the owner's account with Discord), `reason` (why not, null when confirmed) and `version` |

The gateway answers from its last confirmation and makes no call on Discord to answer it; how it confirms the
account is `docs/discord.md`, 「The owner's account」.

## What the socket hears

| Route | Answers |
|---|---|
| `GET /hearing` | `peopleTyping` and `presence`, each `heard` (boolean) and `reason` (why not, null while heard) |

`peopleTyping` is heard while the bot account's socket runs, and `presence` while it runs with the presence
intent granted. The gateway answers from what it holds and makes no call on Discord to answer it.

## Rooms

| Route | Query | Answers |
|---|---|---|
| `GET /rooms/{roomId}` | | one room: `id`, `owns`, `identity`, `kind` (`owner` or `group`), `privateTo`, `title`. 404 `not-found` where the number is not this provider's |

`identity` is the sender number the account's own words carry in the room, and `privateTo` is the one person of
a one-to-one, null for a room of several. `modes` are the voices whose account answers the room: `bot-account`
in every room, and `human-reader` and `human-avatar` besides where the owner's account answers it
(`docs/discord.md`, 「The owner's account」). The service answers the protocol's room with those of them its
declaration has active, and with every active voice where the gateway names none. With no bot token set the
service owns no room and answers 404 `not-found` without asking the gateway.

## The owner

| Route | Answers |
|---|---|
| `GET /owner` | `roomId`, the room to speak into to reach the owner unprompted, or null |

## Sends

| Route | Body | Answers |
|---|---|---|
| `POST /sends` | a send as bmo-chat's `docs/contract.md` states it: `roomId`, `kind`, the kind's `fields`, and optional `mode`, `speaker`, `tag`, `prefix` and `replyToMessageId` | 201 with `messageId` (null where Discord gives none back) and `missed` (empty, since no album goes) |
| | | A send that does not go is answered with the refusal's code and status |

A `typing` send that names an `accountId` is refused `platform`: a person's typing goes only in their own
voice, and this provider types only as the bot account and the owner's account.

A send whose `mode` names `human-reader` or `human-avatar` goes out through the owner's account, at the
provider's pace, in a room that account answers, and only as `text`, `edit` or `typing`. `prefix` belongs to the
`human-avatar` voice: its words go out behind it, or behind `BMO_DISCORD_AVATAR_PREFIX` where the send names
none, and a send in that voice with neither is refused. In every other voice `prefix` changes nothing, so a
`human-reader` send carries the owner's words as given. A send whose `mode` names `own-account`, or a voice
whose account is not held, is refused `platform`.

A document's `bytes` come inline, as base64, or, in a multipart send, as a part (bmo-chat's `docs/protocol.md`,
「Files carried as parts」). A document larger than the dialect's `fileBytes`, 25 MiB, is refused `platform`
before its bytes are read.

## Messages

| Route | Body | Answers |
|---|---|---|
| `PUT /rooms/{roomId}/messages/{messageId}` | a message as bmo-chat's `docs/contract.md` states it, with `origin`, `senderId`, `senderName`, `sentAt`, `text`, `replyToMessageId`, `via`, `album`, `mode`, `context`, `room`, `files` and `gathering` | 201 where the receiving side did not hold the message before, 200 where it did, with the message as held |

A message the receiving side could not take is answered with its own error shape and status, so `not-ready`
reaches the hand-over as it came. A hand-over is offered again only while nothing listens at the receiving
side, every two seconds until something does; a request that reached a listener waits for its answer and is
never offered again.

The provider hands over `live` and `edit` messages under their room and number; it declares no `history`, so
no past message is read back. A message that carried a file crosses as a mark in `text` with
`context.carriesFile`; no bytes cross, since the provider declares no `fetchMedia`.

## Typing and presence

| Route | Body | Answers |
|---|---|---|
| `POST /typing-marks` | a typing mark as bmo-chat's `docs/contract.md` states it: `via`, `roomId`, `personId`, `on` and `lastsMs` | 204, told where the receiving side listens to the room and passed over where it does not |
| `POST /presence-changes` | `via`, `whole`, and `people`, each `personId`, `state`, `lastSeenAt` and `roomIds`, the rooms the person stands in | 204, the people who stand in a room the receiving side listens to told as a presence change |

A failure of the receiving side is answered with its own error shape and status. The gateway offers a presence
change again while nothing listens at the service, every two seconds, and a typing mark once.
