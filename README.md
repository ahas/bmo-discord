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
| `src/` | the service's own package: the declaration, the `discord-markdown` dialect, the protocol's routes, the receiver link and the client of the gateway |
| `gateway/` | the gateway, a bun package holding the Discord accounts' sockets, the REST calls and the provider's number store |
| `policy/` | the provider's fixed values: its capabilities, the voices whose answers go out unpinned, and its dialect's limit and writing sentence |
| `lang/` | the words a person reads that this provider draws: the platform's label and the marks a message is handed over with |
| `deploy/` | the two service units a deployment links: the Rust service and the bun gateway |
| `docs/` | the canonical statements of what the provider does |

At the root stand the Cargo manifest of the service's one package, the version in `VERSION`, `testbed.toml`
(the testbed's declaration of how this repository is tested, checked, built and deployed), the Korean ledger
the testbed's check reads, `rustfmt.toml` and `CLAUDE.md`.

## Documents

| Document | States |
|---|---|
| `docs/boundary-api.md` | The boundary: the routes served, the calls made on the receiver, the seam between the service and the gateway, the configuration |
| `docs/discord.md` | The provider: its declaration, the sockets, which account answers a room, the avatar voice, the verbs, the dialect, the numbering and the refusals |

## Version

- **One version for the whole repository,** in semver. `VERSION` holds it, the package's version equals it,
  and the gateway's `package.json` carries it.
- **A major change is a change to a contract a consumer reads;** an addition no existing consumer reads is a
  minor change, anything else a patch.

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
