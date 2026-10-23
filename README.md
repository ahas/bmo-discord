# discord

The Discord chat provider, `bmo-discord`. It is Discord to the chat receiver, through the chat protocol of the
base library `bmo-chat`: it declares its read modes, what it can do and the dialect its rooms read, reads its
rooms through the bot account, sends the verbs it declares, and hands what its rooms say to the receiver. No
mode runs on a user account: Discord's terms forbid automating one.

## Tests and the test account

- **The behaviour tests are deferred.** This phase moves the code only; the suite holds the repository-wide
  personal-data check and the declaration test.
- **The declaration test** holds the modes and the capabilities the service declares, whatever tokens are set.
- **The personal-data check reads every tracked file** for a mail address, a home path, a telephone number, a
  token and a private network address, and names the file, the line and the kind of each finding
  (`PERSONAL-DATA.md`).
- **No Discord test account is connected**, so nothing here has been tried against a live Discord server.

## Layout

| Folder | Holds |
|---|---|
| `src/` | the service's own package: the declaration, the `discord-markdown` dialect, the protocol's routes, the receiver link and the generated client of the gateway (`seam.rs`) |
| `gateway/` | the gateway, a bun package holding the bot account's socket, the REST calls, the provider's number store and the generated client of the service (`seam.ts`) |
| `policy/` | the provider's fixed values: its capabilities, the terms' words the modes on a user account are declared unsupported with, the ranges its numbers fall in, and its dialect's limit and writing sentence |
| `lang/` | the words a person reads that this provider draws: the platform's label and the marks a message is handed over with |
| `tools/` | `generate.ts`, which writes both clients from `docs/openapi.json` |
| `deploy/` | the two service units a deployment links: the Rust service and the bun gateway |
| `tests/` | the repository's checks: the personal-data check over every tracked file, and the declaration test |
| `docs/` | the canonical statements of what the provider does |
| `.graph/` | this repository's code graph, written only by `bmo-graph`. Its area files are generated in the checkout and untracked, so a fresh checkout builds them again, while `settings.toml` is the repository's configuration and stays tracked |

At the root stand the Cargo manifest of the service's one package, the version in `VERSION`, `testbed.toml`
(the testbed's declaration of how this repository is tested, checked, built and deployed), the Korean ledger
the testbed's check reads, `settings.example.env` (every setting both processes read, with neutral example
values), `PERSONAL-DATA.md` (what personal data may never stand here), `rustfmt.toml` and `CLAUDE.md`.

## Documents

| Document | States |
|---|---|
| `docs/api.md` | The provider's fixed API: the wire format, the resources, the routes and the codes |
| `docs/openapi.json` | The same API in OpenAPI 3.1, from which both clients are generated |
| `docs/boundary-api.md` | The boundary: the routes served, the calls made on the receiving side, the seam between the service and the gateway, the configuration and the clients |
| `docs/discord.md` | The provider: its declaration, the socket, which account answers a room, the verbs, the dialect, the numbering and the refusals |
| `PERSONAL-DATA.md` | What personal data may never stand here, and the check that holds it |

## Version

- **One version for the whole repository,** in semver. `VERSION` holds it, the package's version equals it,
  and the gateway's `package.json` carries it.
- **A major change is a change to a contract a consumer reads;** an addition no existing consumer reads is a
  minor change, anything else a patch. The version is 0.4.0.

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
