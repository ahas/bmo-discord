# discord

The Discord chat provider, `bmo-discord`. It is Discord to the chat receiver, through the chat protocol of the
base library `bmo-chat`: it declares its read modes, what it can do and the dialect its rooms read, reads its
rooms through the bot account, the owner's account and an account of the agent's own, sends the verbs it
declares, and hands what its rooms say to the receiver.

## Status

- **Tests are deferred.** This phase moves the code only; the repository holds no tests yet, and the only
  verification is the build check below.
- **No Discord test account is connected**, so nothing here has been tried against a live Discord server.

## Layout

| Folder | Holds |
|---|---|
| `src/` | the service's own package: the declaration, the `discord-markdown` dialect, the protocol's routes, the receiver link and the generated client of the gateway (`seam.rs`) |
| `gateway/` | the gateway, a bun package holding the Discord accounts' sockets, the REST calls, the provider's number store and the generated client of the service (`seam.ts`) |
| `policy/` | the provider's fixed values: its capabilities, the voices whose answers go out unpinned, the ranges its numbers fall in, and its dialect's limit and writing sentence |
| `lang/` | the words a person reads that this provider draws: the platform's label and the marks a message is handed over with |
| `tools/` | `generate.ts`, which writes both clients from `docs/openapi.json` |
| `deploy/` | the two service units a deployment links: the Rust service and the bun gateway |
| `docs/` | the canonical statements of what the provider does |
| `.graph/` | this repository's code graph, written only by `bmo-graph` |

At the root stand the Cargo manifest of the service's one package, the version in `VERSION`, `testbed.toml`
(the testbed's declaration of how this repository is tested, checked, built and deployed), the Korean ledger
the testbed's check reads, `settings.example.env` (every setting both processes read, with neutral example
values), `rustfmt.toml` and `CLAUDE.md`.

## Documents

| Document | States |
|---|---|
| `docs/api.md` | The provider's fixed API: the wire format, the resources, the routes and the codes |
| `docs/openapi.json` | The same API in OpenAPI 3.1, from which both clients are generated |
| `docs/boundary-api.md` | The boundary: the routes served, the calls made on the receiving side, the seam between the service and the gateway, the configuration and the clients |
| `docs/discord.md` | The provider: its declaration, the sockets, which account answers a room, the avatar voice, the verbs, the dialect, the numbering and the refusals |

## Version

- **One version for the whole repository,** in semver. `VERSION` holds it, the package's version equals it,
  and the gateway's `package.json` carries it.
- **A major change is a change to a contract a consumer reads;** an addition no existing consumer reads is a
  minor change, anything else a patch. The version is 0.2.0: the provider routes moved to bmo-chat's fixed
  protocol, which every caller of this provider reads.

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
