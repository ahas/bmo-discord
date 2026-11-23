# Working in this repository

Three standing principles hold for every bmo repository, this one included:

- **(a) Each service runs on its own,** with no context bleeding in from other repositories: it builds, tests
  and runs from its own repository, data and settings, and never reads another repository's code, files,
  data folders or tables.
- **(b) Services talk to each other only through documented APIs** (HTTP routes, events, a documented
  command), never by importing another service's code.
- **(c) Upstream never intrudes on downstream:** a service calls only what the service below it documents,
  never reaches into its data or decides what is that service's to decide, and a base library never depends
  on a service.

This repository is the Discord chat provider, `bmo-discord`: Discord as the receiver sees every chat service,
through bmo-chat's provider contract. The Rust service at the root declares the provider's modes,
capabilities and dialect, runs the `discord-markdown` dialect, serves the protocol's routes and hands what its
rooms say to the receiver. The gateway, a bun process in `gateway/` that only the service calls over the
loopback, holds the bot account's socket, makes every REST call and keeps the provider's own numbers.

## Rules

- **`docs/` is canonical.** Read the document covering a change before changing code. A change that would
  make it wrong or incomplete repairs it first, stating what is true now, and the code is then written to
  match. `docs/api.md` is the provider's fixed API and `docs/openapi.json` the same API in machine form, from
  which both seam clients are generated; `docs/boundary-api.md` states every route this provider serves, every
  call it makes on another unit, the seam between its two processes and the configuration it reads;
  `docs/discord.md` states what the provider is and does.
- **No `bmo-*` dependency but the base libraries** `bmo-chat`, `bmo-chat-client`, `bmo-ui` and `bmo-text`.
  Another unit is reached over HTTP, as the boundary states. The gateway depends on no `@bmo/` package.
- **The provider declares what it is.** Its modes, capabilities and dialect are its own declaration, in
  `policy/discord.toml` and the service; nothing here names the receiver's internals or another provider, and
  nothing branches on an agent's name.
- **Words a person reads live in this repository's language packs** under `lang/`, one per language (`ko`, `en`,
  `ja`, `zh-CN`), each holding the same words: the platform's label and the marks a message is handed over with.
  A word added to one pack is added to every pack. Everything else is English: code, comments, strings, policy,
  documents and commit messages. A refusal is a bmo-chat refusal code with an English sentence. No code file
  holds Hangul.
- **No agent names, owner names, host names, home paths or private network addresses** in code, documents or
  commits. `PERSONAL-DATA.md` states the prohibition whole and the testbed's `personal-data` check holds it. A deployment
  value that would name one is configuration (`docs/boundary-api.md`, 「Configuration」).
- **Tests live in `tests/`** for the service and `gateway/tests/` for the gateway; no test module sits beside
  runtime code. The service's are one test target, `tests/main.rs`, each file of tests a module of it
  (bmo-chat's `docs/conventions.md`, 「Rust builds」). The behaviour tests are deferred in this phase.
- **No directory named after its parent** (no `x/x`), and **only Cargo manifests at the root**: the root
  `Cargo.toml` is the service's one package. The gateway's `package.json` is in `gateway/`.
- **Documents state what is true now**: no change history, no quoted source and no file-and-line pins.

## Checks

A change moves through three stages in order:

1. Writing: `cargo check --all-targets`, and in `gateway/` `./node_modules/.bin/tsc --noEmit`.
2. Review: read the whole diff against what the change is for and the document governing it, then
   `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` (108 columns, 2-space indentation, as
   `rustfmt.toml` sets).
3. Verification: the suites `testbed.toml` declares, run at the close.

Cargo runs through the testbed's Cargo verb, `bmo-testbed cargo <cargo arguments…>`, which builds in the one
shared build directory; no checkout keeps a `target/` of its own. Where the installed testbed predates that
verb, `bmo cargo <cargo arguments…>` carries the same verb.

The version is the package's, and `VERSION` holds it. It moves only at a release the owner declares, as
bmo-chat's `docs/conventions.md` 「Versions」 states; a commit, a deploy, a fix or a contract change moves none,
and a deployment is told apart by its commit. The gateway's `package.json` carries the same version.
