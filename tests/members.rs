//! A room's members as the service answers them (docs/discord.md, 「The members of a room」): the gateway's list
//! as it stands, the gateway's `not-found` as members not held for its reason, and none held by an unconfigured
//! provider without the gateway being asked.

use axum::Router;
use axum::http::StatusCode;
use axum::routing::get;
use bmo_chat::{ChatMember, ChatMembersResult, ChatProvider};
use serde_json::json;

use crate::stand_in::{closed_port, gateway, provider};

/// A stand-in gateway listing room −5's members and holding none of room −6's.
async fn members() -> u16 {
  let listed = json!({ "members": [
    { "person": 8_000_000_000_001_i64, "name": "Agent", "statusMessage": null },
    { "person": null, "name": "tester", "statusMessage": null },
  ] });
  let unheld = json!({ "code": "not-found", "error": "Room -6 is neither a DM nor a guild's channel." });

  gateway(
    Router::new()
      .route("/rooms/-5/members", get(move || async move { axum::Json(listed) }))
      .route(
        "/rooms/-6/members",
        get(move || async move { (StatusCode::NOT_FOUND, axum::Json(unheld)) }),
      ),
  )
  .await
}

#[tokio::test]
async fn a_room_s_members_are_the_gateway_s_list() {
  let port = members().await;

  assert_eq!(
    provider(true, port).members(-5).await.unwrap(),
    ChatMembersResult::Listed(vec![
      ChatMember {
        person: Some(8_000_000_000_001),
        name: "Agent".to_owned(),
        status_message: None,
      },
      ChatMember {
        person: None,
        name: "tester".to_owned(),
        status_message: None,
      },
    ])
  );
}

#[tokio::test]
async fn members_the_gateway_does_not_hold_are_unheld_for_its_reason() {
  let port = members().await;

  assert_eq!(
    provider(true, port).members(-6).await.unwrap(),
    ChatMembersResult::Unheld {
      reason: "Room -6 is neither a DM nor a guild's channel.".to_owned(),
    }
  );
}

#[tokio::test]
async fn an_unconfigured_provider_holds_no_members_without_asking_the_gateway() {
  assert_eq!(
    provider(false, closed_port()).members(-5).await.unwrap(),
    ChatMembersResult::Unheld {
      reason: "BMO_DISCORD_TOKEN not set".to_owned(),
    }
  );
}
