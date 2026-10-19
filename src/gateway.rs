//! The calls the service makes on the gateway process over the loopback (docs/boundary-api.md, 「The seam
//! between the service and the gateway」): its health, a send, the room questions and the owner's room.

use bmo_chat::{
  ChatFailure, ChatHealth, ChatSendRequest, ChatSendResult, OwnerRoom, RoomIdentity, RoomKind,
  RoomKindAnswer, RoomOwns, RoomPerson, RoomQuery, RoomTitle,
};
use reqwest::{Client, RequestBuilder};
use serde::de::DeserializeOwned;

/// The gateway at its loopback port, behind the route token.
#[derive(Clone)]
pub struct Gateway {
  base: String,
  token: String,
  client: Client,
}

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

  /// The answer of one call, read as the shape it carries; a call the gateway did not answer with success is
  /// the failure, with what it said.
  async fn answer<T: DeserializeOwned>(&self, route: &str, call: RequestBuilder) -> Result<T, ChatFailure> {
    let answer = call.bearer_auth(&self.token).send().await?;
    let status = answer.status();

    if !status.is_success() {
      let said = answer.text().await.unwrap_or_default();

      return Err(format!("the gateway answered {route} {status}: {said}").into());
    }

    Ok(answer.json().await?)
  }

  async fn get<T: DeserializeOwned>(&self, route: &str) -> Result<T, ChatFailure> {
    self.answer(route, self.client.get(format!("{}{route}", self.base))).await
  }

  async fn post<T: DeserializeOwned>(
    &self,
    route: &str,
    body: &impl serde::Serialize,
  ) -> Result<T, ChatFailure> {
    self.answer(route, self.client.post(format!("{}{route}", self.base)).json(body)).await
  }

  /// Whether the gateway is ready, and where it is not, why.
  pub async fn health(&self) -> Result<ChatHealth, ChatFailure> {
    self.get("/health").await
  }

  pub async fn send(&self, request: &ChatSendRequest) -> Result<ChatSendResult, ChatFailure> {
    self.post("/gateway/send", request).await
  }

  pub async fn owns(&self, chat_id: i64) -> Result<bool, ChatFailure> {
    let answer: RoomOwns = self.post("/gateway/room/owns", &RoomQuery { chat_id }).await?;

    Ok(answer.owns)
  }

  pub async fn identity(&self, chat_id: i64) -> Result<Option<i64>, ChatFailure> {
    let answer: RoomIdentity = self.post("/gateway/room/identity", &RoomQuery { chat_id }).await?;

    Ok(answer.identity)
  }

  pub async fn is_owner(&self, chat_id: i64) -> Result<RoomKind, ChatFailure> {
    let answer: RoomKindAnswer = self.post("/gateway/room/is-owner", &RoomQuery { chat_id }).await?;

    Ok(answer.kind)
  }

  pub async fn private_of(&self, chat_id: i64) -> Result<Option<i64>, ChatFailure> {
    let answer: RoomPerson = self.post("/gateway/room/private-of", &RoomQuery { chat_id }).await?;

    Ok(answer.person)
  }

  pub async fn title(&self, chat_id: i64) -> Result<Option<String>, ChatFailure> {
    let answer: RoomTitle = self.post("/gateway/room/title", &RoomQuery { chat_id }).await?;

    Ok(answer.title)
  }

  pub async fn owner_room(&self) -> Result<Option<i64>, ChatFailure> {
    let answer: OwnerRoom = self.get("/gateway/owner-room").await?;

    Ok(answer.chat_id)
  }
}
