//! The service's health (docs/api.md, 「Health」): ready with no Discord application, its reason naming the
//! missing setting and every mode down, with a send, a room and the owner answered without asking the gateway;
//! ready once the gateway answers ready with the token set; and not ready where the gateway does not answer or
//! answers that Discord rejected the token, the bot account's mode waiting on the same.

use axum::Router;
use axum::routing::get;
use bmo_chat::{
  ChatHealth, ChatModeStanding, ChatProvider, ChatRefusal, ChatSend, ChatSendRequest, ChatSendResult,
  ChatVoice,
};
use bmo_discord::provider::DiscordProvider;
use serde_json::json;

use crate::stand_in::{closed_port, gateway, provider};

const REJECTED: &str = "Discord rejected BMO_DISCORD_TOKEN: the current-user call answered 401";

/// A stand-in gateway answering its health as it is given.
async fn gateway_health(ready: bool, reason: Option<&'static str>) -> u16 {
  let answer = json!({ "ready": ready, "reason": reason, "version": "0.0.0" });

  gateway(Router::new().route("/health", get(move || async move { axum::Json(answer) }))).await
}

/// The standing and the reason of the mode a voice speaks with.
fn standing(provider: &DiscordProvider, voice: ChatVoice) -> (ChatModeStanding, Option<String>) {
  let mode = provider
    .modes()
    .into_iter()
    .find(|mode| mode.voice == voice)
    .unwrap_or_else(|| panic!("the provider declares {voice:?}"));

  (mode.standing, mode.reason)
}

fn text_send() -> ChatSendRequest {
  ChatSendRequest {
    room_id: -8_000_000_000_000,
    send: ChatSend::Text {
      text: "hello".to_owned(),
      silent: false,
      fold: false,
    },
    mode: None,
    speaker: None,
    tag: None,
    prefix: None,
    reply_to_message_id: None,
    account_id: None,
  }
}

#[tokio::test]
async fn with_no_bot_token_health_is_ready_and_names_every_mode_down() {
  let unconfigured = provider(false, gateway_health(true, Some("BMO_DISCORD_TOKEN not set")).await);
  unconfigured.read_gateway_health().await;

  let health = unconfigured.health();

  assert!(health.ready);
  assert_eq!(
    health.reason.as_deref(),
    Some(
      "not configured: BMO_DISCORD_TOKEN not set; the bot-account, human-reader, human-avatar modes are down"
    )
  );
}

#[tokio::test]
async fn an_unconfigured_provider_answers_a_send_a_room_and_the_owner_without_the_gateway() {
  let unconfigured = provider(false, closed_port());

  assert!(matches!(
    unconfigured.send(text_send()).await,
    Ok(ChatSendResult::Refused(ChatRefusal::NotReady { .. }))
  ));
  assert!(matches!(unconfigured.room(-8_000_000_000_000).await, Ok(None)));
  assert!(matches!(unconfigured.owner_room().await, Ok(None)));
}

#[tokio::test]
async fn with_the_bot_token_set_health_is_ready_once_the_gateway_is() {
  let configured = provider(true, gateway_health(true, None).await);

  assert!(!configured.health().ready);

  configured.read_gateway_health().await;

  assert_eq!(configured.health(), ChatHealth::ready(env!("CARGO_PKG_VERSION")));
}

#[tokio::test]
async fn a_rejected_bot_token_is_not_ready_and_the_bot_account_waits_on_it() {
  let rejected = provider(true, gateway_health(false, Some(REJECTED)).await);
  rejected.read_gateway_health().await;

  assert_eq!(rejected.health(), ChatHealth::not_ready(env!("CARGO_PKG_VERSION"), REJECTED));
  assert_eq!(
    standing(&rejected, ChatVoice::BotAccount),
    (ChatModeStanding::Inactive, Some(REJECTED.to_owned()))
  );
  assert_eq!(
    standing(&rejected, ChatVoice::HumanReader),
    (ChatModeStanding::Inactive, Some(REJECTED.to_owned()))
  );
}

#[tokio::test]
async fn a_gateway_that_does_not_serve_is_not_ready_whatever_is_set() {
  for bot_token in [true, false] {
    let unserved = provider(bot_token, closed_port());
    unserved.read_gateway_health().await;

    let health = unserved.health();

    assert!(!health.ready);
    assert!(
      health
        .reason
        .as_deref()
        .is_some_and(|reason| reason.starts_with("the gateway does not answer")),
      "{health:?}"
    );
  }
}
