//! A room as the service answers it is the gateway's room with `modes` narrowed to the voices the declaration
//! has active, and every active voice where the gateway names none (docs/api.md, 「Rooms」).

use axum::Router;
use axum::routing::get;
use bmo_chat::{ChatProvider, ChatVoice};
use serde_json::json;

use crate::stand_in::{gateway, provider};

/// A stand-in gateway answering a room that names no modes, a room the owner's account answers too, and the
/// owner's account as confirmed.
async fn rooms() -> u16 {
  let room = |id: i64, modes: Option<Vec<&'static str>>| {
    json!({
      "id": id, "owns": true, "identity": 7, "kind": "group", "privateTo": null, "title": "A Room", "modes": modes,
    })
  };
  let unnamed = room(-5, None);
  let owner_answers = room(-6, Some(vec!["bot-account", "human-reader", "human-avatar"]));
  let confirmed = json!({ "ready": true, "reason": null, "version": "0.0.0" });

  gateway(
    Router::new()
      .route("/rooms/-5", get(move || async move { axum::Json(unnamed) }))
      .route("/rooms/-6", get(move || async move { axum::Json(owner_answers) }))
      .route("/owner-account", get(move || async move { axum::Json(confirmed) })),
  )
  .await
}

#[tokio::test]
async fn a_room_takes_the_bot_voice_where_the_token_is_set_and_none_where_it_is_not() {
  let port = rooms().await;

  let room = provider(true, port).room(-5).await.unwrap().expect("the gateway knows the room");
  assert_eq!(room.identity, Some(7));
  assert_eq!(room.modes, Some(vec![ChatVoice::BotAccount]));

  let room = provider(false, port).room(-5).await.unwrap().expect("the gateway knows the room");
  assert_eq!(room.modes, Some(vec![]));
}

#[tokio::test]
async fn a_room_takes_the_owner_voices_only_while_the_owner_account_is_confirmed() {
  let port = rooms().await;
  let provider = provider(true, port);

  let room = provider.room(-6).await.unwrap().expect("the gateway knows the room");
  assert_eq!(room.modes, Some(vec![ChatVoice::BotAccount]));

  provider.read_owner_account().await;

  let room = provider.room(-6).await.unwrap().expect("the gateway knows the room");
  assert_eq!(
    room.modes,
    Some(vec![ChatVoice::BotAccount, ChatVoice::HumanReader, ChatVoice::HumanAvatar])
  );
}
