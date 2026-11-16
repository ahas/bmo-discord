// Generates the two clients of this repository's own API from its one OpenAPI document, `docs/openapi.json`:
// the service's Rust client of the gateway (`src/seam.rs`) and the gateway's TypeScript client of the service
// (`gateway/src/seam.ts`). The document is the contract; the clients carry the routes and the error shape it
// states and nothing else.
//
// Run from the repository root: `bun tools/generate.ts`.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = dirname(import.meta.dir);
const header = (file: string) =>
  `// Generated from \`docs/openapi.json\` by \`tools/generate.ts\`. Do not edit by hand: change the document and run\n// \`bun tools/generate.ts\`.\n//\n// ${file}\n`;

interface Operation {
  name: string;
  method: string;
  path: string;
  answer: string;
  request: string | null;
  key: string | null;
  optional: boolean;
  refusal: boolean;
}

interface Call {
  language: "rust" | "typescript";
  name: string;
  answer?: string;
  request?: string;
  key?: string;
  optional?: boolean;
  refusal?: boolean;
}

const document = JSON.parse(readFileSync(join(root, "docs/openapi.json"), "utf8")) as {
  paths: Record<string, Record<string, { "x-call"?: Call }>>;
};

function operations(language: Call["language"]): Operation[] {
  const found: Operation[] = [];

  for (const [path, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const call = operation["x-call"];

      if (call === undefined || call.language !== language) {
        continue;
      }

      found.push({
        name: call.name,
        method: method.toUpperCase(),
        path,
        answer: call.answer ?? "void",
        request: call.request ?? null,
        key: call.key ?? null,
        optional: call.optional === true,
        refusal: call.refusal === true,
      });
    }
  }

  return found;
}

function rustMethod(operation: Operation): string {
  const path = operation.path.replaceAll("{roomId}", "{room_id}");

  if (operation.name === "health") {
    return `  /// Whether the gateway is ready, and where it is not, why.
  pub async fn health(&self) -> Result<${operation.answer}, GatewayFailure> {
    self.call(Method::${operation.method}, "${path}", None::<&()>).await
  }
`;
  }

  if (operation.name === "send") {
    return `  /// One send, of a kind the provider declares.
  pub async fn send(&self, body: &${operation.request}) -> Result<${operation.answer}, GatewayFailure> {
    self.call(Method::${operation.method}, "${path}", Some(body)).await
  }
`;
  }

  if (operation.name === "room") {
    return `  /// One room as the gateway knows it; the caller reads a 404 as a room this provider does not own.
  pub async fn room(&self, room_id: i64) -> Result<${operation.answer}, GatewayFailure> {
    self.call(Method::${operation.method}, &format!("${path}"), None::<&()>).await
  }
`;
  }

  if (operation.name === "owner") {
    return `  /// The room to speak into to reach the owner unprompted, or null.
  pub async fn owner(&self) -> Result<${operation.answer}, GatewayFailure> {
    self.call(Method::${operation.method}, "${path}", None::<&()>).await
  }
`;
  }

  if (operation.name === "ownerAccount") {
    return `  /// Whether the gateway has confirmed the owner's account, and where it has not, why.
  pub async fn owner_account(&self) -> Result<${operation.answer}, GatewayFailure> {
    self.call(Method::${operation.method}, "${path}", None::<&()>).await
  }
`;
  }

  if (operation.name === "hearing") {
    return `  /// What the bot account's socket hears beside messages: typing, and presence.
  pub async fn hearing(&self) -> Result<${operation.answer}, GatewayFailure> {
    self.call(Method::${operation.method}, "${path}", None::<&()>).await
  }
`;
  }

  throw new Error(`No Rust client template for ${operation.name}, from docs/openapi.json.`);
}

function rust(): string {
  const methods = operations("rust").map(rustMethod).join("\n");

  return `${header("The service's client of the gateway: the loopback routes the gateway serves in docs/api.md.")}
use std::fmt;

use bmo_chat::{ChatHealth, ChatSendRequest, ChatSent, ProviderOwner, ProviderRoom};
use reqwest::{Client, Method};
use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::hearing::Hearing;

/// The gateway at its loopback port, behind the route token.
#[derive(Clone)]
pub struct Gateway {
  base: String,
  token: String,
  client: Client,
}

/// Why a call on the gateway was not answered with success.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GatewayFailure {
  /// The gateway answered, and not with success; the body is the error shape where it carried one.
  Answered { status: u16, body: Vec<u8> },
  /// The call did not reach a listener, or its answer could not be read.
  Transport(String),
}

impl fmt::Display for GatewayFailure {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      Self::Answered { status, body } => {
        write!(f, "the gateway answered {status}: {}", String::from_utf8_lossy(body))
      }
      Self::Transport(why) => f.write_str(why),
    }
  }
}

impl std::error::Error for GatewayFailure {}

impl Gateway {
  pub fn new(port: u16, token: impl Into<String>) -> Self {
    let client = Client::builder()
      .no_proxy()
      .build()
      .expect("a client with no TLS and no proxy always builds");

    Self {
      base: format!("http://127.0.0.1:{port}"),
      token: token.into(),
      client,
    }
  }

  /// The answer of one call, read as the shape it carries. A call the gateway did not answer with success is
  /// the failure, with the status and the body it answered with.
  async fn call<T: DeserializeOwned>(
    &self,
    method: Method,
    route: &str,
    body: Option<&impl Serialize>,
  ) -> Result<T, GatewayFailure> {
    let mut request = self.client.request(method, format!("{}{route}", self.base)).bearer_auth(&self.token);

    if let Some(body) = body {
      request = request.json(body);
    }

    let answer = request
      .send()
      .await
      .map_err(|why| GatewayFailure::Transport(format!("the gateway does not answer: {why}")))?;
    let status = answer.status();
    let bytes = answer
      .bytes()
      .await
      .map_err(|why| GatewayFailure::Transport(format!("the gateway's answer could not be read: {why}")))?;

    if !status.is_success() {
      return Err(GatewayFailure::Answered {
        status: status.as_u16(),
        body: bytes.to_vec(),
      });
    }

    serde_json::from_slice(&bytes).map_err(|why| {
      GatewayFailure::Transport(format!(
        "the gateway answered {status} in a shape this route does not take: {why}"
      ))
    })
  }

${methods}}
`;
}

// The one gateway route of the given name, which the TypeScript client must carry.
function typescriptRoute(name: string): Operation {
  const found = operations("typescript").find((operation) => operation.name === name);

  if (found === undefined) {
    throw new Error(`docs/openapi.json names no ${name} route.`);
  }

  return found;
}

function typescript(): string {
  const handOver = typescriptRoute("handOver");
  const typingMarked = typescriptRoute("typingMarked");
  const presenceChanged = typescriptRoute("presenceChanged");

  return `${header("The gateway's client of the service: the routes the service serves the gateway in docs/api.md.")}
import { routeToken, servicePort } from "./settings";

import type { ${handOver.request}, ${presenceChanged.request}, ${typingMarked.request} } from "./chat";

// A hand-over or a presence change is offered again only while nothing listens, this often, until the service
// is reached.
const offerEveryMs = 2_000;

// Why the service did not take a call: the error shape it answered with.
export class SeamError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SeamError";
  }
}

function refusedConnection(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ConnectionRefused";
}

function readError(body: string, status: number): SeamError {
  try {
    const answer: unknown = JSON.parse(body);

    if (typeof answer === "object" && answer !== null && "code" in answer && "error" in answer) {
      const { code, error } = answer as { code: unknown; error: unknown };

      if (typeof code === "string" && typeof error === "string") {
        return new SeamError(status, code, error);
      }
    }
  } catch {
    // Not every answer carries JSON; the sentence below says what was answered.
  }

  return new SeamError(status, "failed", \`The service answered \${status}.\`);
}

export class Service {
  constructor(
    private readonly base: string = \`http://127.0.0.1:\${servicePort()}\`,
    private readonly token: string = routeToken(),
  ) {}

  // One call, answered with the body the service answered with, however long that takes; a failure answer is
  // the error shape it carried.
  private async call(method: string, path: string, body: unknown): Promise<string> {
    const answer = await fetch(\`\${this.base}\${path}\`, {
      method,
      headers: { authorization: \`Bearer \${this.token}\`, "content-type": "application/json" },
      body: JSON.stringify(body),
      timeout: false,
    });
    const read = await answer.text();

    if (!answer.ok) {
      throw readError(read, answer.status);
    }

    return read;
  }

  // One call offered again while nothing listens at the service, until it is reached.
  private async offered(method: string, path: string, body: unknown): Promise<string> {
    for (;;) {
      try {
        return await this.call(method, path, body);
      } catch (error) {
        if (!refusedConnection(error)) {
          throw error;
        }

        await Bun.sleep(offerEveryMs);
      }
    }
  }

  // One message handed over, answered as the receiving side holds it after it.
  async handOver(roomId: number, messageId: number, message: ${handOver.request}): Promise<${handOver.answer}> {
    return JSON.parse(await this.offered("${handOver.method}", \`/rooms/\${roomId}/messages/\${messageId}\`, message)) as ${handOver.answer};
  }

  // One typing mark, offered once: a mark offered late tells one that has already ended.
  async typingMarked(mark: ${typingMarked.request}): Promise<void> {
    await this.call("${typingMarked.method}", "${typingMarked.path}", mark);
  }

  // People's presence, each beside the rooms they stand in.
  async presenceChanged(change: ${presenceChanged.request}): Promise<void> {
    await this.offered("${presenceChanged.method}", "${presenceChanged.path}", change);
  }
}
`;
}

writeFileSync(join(root, "src/seam.rs"), rust());
writeFileSync(join(root, "gateway/src/seam.ts"), typescript());
console.log("generated src/seam.rs and gateway/src/seam.ts from docs/openapi.json");
