// Generated from `docs/openapi.json` by `tools/generate.ts`. Do not edit by hand: change the document and run
// `bun tools/generate.ts`.
//
// The service's client of the gateway: the loopback routes the gateway serves in docs/api.md.

use std::fmt;

use bmo_chat::{ChatHealth, ChatMembers, ChatSendRequest, ChatSent, ProviderOwner, ProviderRoom};
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

  /// Whether the gateway is ready, and where it is not, why.
  pub async fn health(&self) -> Result<ChatHealth, GatewayFailure> {
    self.call(Method::GET, "/health", None::<&()>).await
  }

  /// One send, of a kind the provider declares.
  pub async fn send(&self, body: &ChatSendRequest) -> Result<ChatSent, GatewayFailure> {
    self.call(Method::POST, "/sends", Some(body)).await
  }

  /// One room as the gateway knows it; the caller reads a 404 as a room this provider does not own.
  pub async fn room(&self, room_id: i64) -> Result<ProviderRoom, GatewayFailure> {
    self.call(Method::GET, &format!("/rooms/{room_id}"), None::<&()>).await
  }

  /// A room's members as the gateway lists them; the caller reads a 404 as members not held, for its reason.
  pub async fn members(&self, room_id: i64) -> Result<ChatMembers, GatewayFailure> {
    self.call(Method::GET, &format!("/rooms/{room_id}/members"), None::<&()>).await
  }

  /// The room to speak into to reach the owner unprompted, or null.
  pub async fn owner(&self) -> Result<ProviderOwner, GatewayFailure> {
    self.call(Method::GET, "/owner", None::<&()>).await
  }

  /// Whether the gateway has confirmed the owner's account, and where it has not, why.
  pub async fn owner_account(&self) -> Result<ChatHealth, GatewayFailure> {
    self.call(Method::GET, "/owner-account", None::<&()>).await
  }

  /// What the bot account's socket hears beside messages: typing, and presence.
  pub async fn hearing(&self) -> Result<Hearing, GatewayFailure> {
    self.call(Method::GET, "/hearing", None::<&()>).await
  }
}
