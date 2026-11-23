**English** | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md)

# discord

The Discord chat provider, `bmo-discord`. It is Discord to the chat receiver, through the chat protocol of the
base library `bmo-chat`: it declares its read modes, what it can do and the dialect its rooms read, reads its
rooms through the bot account, sends the verbs it declares, and hands what its rooms say to the receiver. The
owner's own account sends in the `human-reader` and `human-avatar` voices once the gateway has confirmed it; no
account made for the agent is run, since Discord's terms forbid automating one.

## Tests and the test account

- **Most behaviour tests are deferred.** The suite holds the declaration, room-modes, hearing, health,
  document-send and members tests against a stand-in gateway, and the gateway's bot-token, owner-account,
  typing-and-presence and members tests against a stand-in Discord.
- **The declaration test** holds the modes and the capabilities the service declares, whatever tokens are set
  and whatever the gateway answers about the owner's account.
- **The hearing test** holds `peopleTyping` and `presence` declared as the gateway answers it hears each, and
  the service telling a typing mark or a presence change only of a room the receiving side listens to.
- **The health test** holds the service ready with no Discord application, its reason naming the missing
  setting and every mode down; ready once the gateway answers ready with the token set; and not ready where the
  gateway does not answer or answers that Discord rejected the token.
- **The document-send test** holds a file held on disk sent to the gateway inline, and one larger than the
  dialect's file limit refused by its size without the gateway being asked.
- **The members test** holds a room's members as the gateway lists them, the gateway's `not-found` as members
  not held, and none held by an unconfigured provider without the gateway being asked.
- **The bot-token test** (`gateway/tests/`) holds the gateway's health ready saying the token is not set where it
  is unset, ready once Discord accepts the token, and not ready, naming the rejection, once Discord refuses it.
- **The typing-and-presence test** (`gateway/tests/`) holds a typing start told as a ten-second mark in a
  numbered room, never of the bot account or of the provider's own typing through the owner's account, a typing
  send for another account refused, the identify's intents, a fresh session's guilds told as one whole list with
  Discord's states mapped, and each person told beside the rooms they stand in.
- **The owner-account test** (`gateway/tests/`) holds the gateway's confirmation of the owner's account and the
  prefix a `human-avatar` send carries, which a `human-reader` send does not.
- **The gateway's members test** (`gateway/tests/`) holds a DM's members as its recipient and the bot account,
  and a guild channel's as the bot account and the writers Discord still holds, each named by nickname, display
  name or username.
- **The testbed's `personal-data` check reads every tracked file** for a mail address, a home path, a telephone number, a
  token and a private network address, and names the file, the line and the kind of each finding
  (`PERSONAL-DATA.md`).
- **No Discord test account is connected**, so nothing here has been tried against a live Discord server.

## Layout

| Folder | Holds |
|---|---|
| `src/` | the service's own package: the declaration, the `discord-markdown` dialect, the protocol's routes, the receiver link and the generated client of the gateway (`seam.rs`) |
| `gateway/` | the gateway, a bun package holding the bot account's socket, the owner's account's token, the REST calls, the provider's number store and the generated client of the service (`seam.ts`), with its tests in `gateway/tests/` |
| `policy/` | the provider's fixed values: its capabilities, the terms' words the `own-account` mode is declared unsupported with, the owner's account's pace, the ranges its numbers fall in, and its dialect's limit and writing sentence |
| `lang/` | the words a person reads that this provider draws: the platform's label and the marks a message is handed over with |
| `tools/` | `generate.ts`, which writes both clients from `docs/openapi.json` |
| `deploy/` | the two service units a deployment links: the Rust service and the bun gateway |
| `tests/` | the service's one test harness, `tests/main.rs`, and its modules: the declaration, room-modes, hearing, health, document-send and members tests over a stand-in gateway (`stand_in.rs`) |
| `docs/` | the canonical statements of what the provider does |

At the root stand the Cargo manifest of the service's one package, the version in `VERSION`, `testbed.toml`
(the testbed's declaration of how this repository is tested, checked, built and deployed), the Korean ledger
the testbed's check reads, `settings.example.env` (every setting both processes read, with neutral example
values), `PERSONAL-DATA.md` (what personal data may never stand here), `install.toml` (what installing it on a fresh machine needs, which `bmo install` reads),
`rustfmt.toml` and `CLAUDE.md`.

## Documents

| Document | States |
|---|---|
| `docs/api.md` | The provider's fixed API: the wire format, the resources, the routes and the codes |
| `docs/openapi.json` | The same API in OpenAPI 3.1, from which both clients are generated |
| `docs/boundary-api.md` | The boundary: the routes served, the calls made on the receiving side, the seam between the service and the gateway, the configuration and the clients |
| `docs/discord.md` | The provider: its declaration, the socket, which account answers a room, the verbs, the dialect, the numbering and the refusals |
| `PERSONAL-DATA.md` | What personal data may never stand here, and the check that holds it |

## Version

- **One version for the whole repository.** `VERSION` holds it, the package's version equals it, and the
  gateway's `package.json` carries it.
- **It moves only at a release the owner declares,** as bmo-chat's `docs/conventions.md` 「Versions」 states.
  A commit, a deploy, a fix or a contract change moves none, and a deployment is told apart by its commit.

## Build check

Cargo runs through the testbed's Cargo verb, which builds in the one shared build directory; where the
installed testbed has no Cargo verb of its own, `bmo cargo` carries the same verb:

```sh
bmo cargo check --all-targets
bmo cargo clippy --all-targets -- -D warnings
bmo cargo fmt --check
```

The gateway's types are checked in `gateway/`:

```sh
bun install
./node_modules/.bin/tsc --noEmit
```

The two seam clients are generated from `docs/openapi.json`; after changing that document, write them again:

```sh
bun tools/generate.ts
```
