//! Typing and presence (docs/discord.md, 「Typing and presence」): `peopleTyping` and `presence` declared as the
//! gateway answers its socket hears each, and the service telling the receiving side a typing mark or a
//! presence change only of a room it listens to.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::Router;
use axum::routing::get;
use bmo_chat::{
  AvatarChange, ChatCapability, ChatFailure, ChatPresence, ChatPresenceState, ChatProvider, ChatReceiver,
  Deletion, GatheredPatch, HandedMessage, HeldMessage, Page, PersonPresence, PresenceChange,
  ReactionChange, ReceiverRoom, RoomQuery, RoomsQuery, TypingMark,
};
use bmo_discord::routes::service;
use serde_json::{Value, json};

use crate::stand_in::{ROUTE_TOKEN, gateway, provider};

const LISTENED: i64 = -8_000_000_000_000;
const NOT_LISTENED: i64 = -8_000_000_000_001;

/// A receiving side that listens to one room and keeps every mark and change it is told.
#[derive(Default)]
struct Receiver {
  marks: Mutex<Vec<TypingMark>>,
  changes: Mutex<Vec<PresenceChange>>,
}

#[async_trait]
impl ChatReceiver for Receiver {
  async fn hand_over(&self, _: i64, _: i64, _: HandedMessage) -> Result<HeldMessage, ChatFailure> {
    Err("not asked here".into())
  }

  async fn gathered(&self, _: i64, _: i64, _: GatheredPatch) -> Result<HandedMessage, ChatFailure> {
    Err("not asked here".into())
  }

  async fn avatars_changed(&self, _: AvatarChange) -> Result<(), ChatFailure> {
    Err("not asked here".into())
  }

  async fn reactions_changed(&self, _: ReactionChange) -> Result<(), ChatFailure> {
    Err("not asked here".into())
  }

  async fn deleted(&self, _: Deletion) -> Result<(), ChatFailure> {
    Err("not asked here".into())
  }

  async fn typing_marked(&self, mark: TypingMark) -> Result<(), ChatFailure> {
    self.marks.lock().expect("the marks are readable").push(mark);
    Ok(())
  }

  async fn presence_changed(&self, change: PresenceChange) -> Result<(), ChatFailure> {
    self.changes.lock().expect("the changes are readable").push(change);
    Ok(())
  }

  async fn room(&self, room_id: i64, _: RoomQuery) -> Result<Option<ReceiverRoom>, ChatFailure> {
    Ok((room_id == LISTENED).then_some(ReceiverRoom {
      id: room_id,
      listened: true,
      read: false,
      oldest_message_id: None,
      oldest_sent_at: None,
    }))
  }

  async fn rooms(&self, _: RoomsQuery) -> Result<Page<ReceiverRoom>, ChatFailure> {
    Err("not asked here".into())
  }
}

/// A stand-in gateway answering what its socket hears as it is given.
async fn hearing(typing: bool, presence: bool) -> u16 {
  let heard = |heard: bool| json!({ "heard": heard, "reason": (!heard).then_some("not heard") });
  let answer = json!({ "peopleTyping": heard(typing), "presence": heard(presence) });

  gateway(Router::new().route("/hearing", get(move || async move { axum::Json(answer) }))).await
}

/// The service's routes on a loopback port, telling `receiver`, and a call of one of them as the gateway
/// makes it, answered with its status.
async fn post(receiver: Arc<Receiver>, route: &str, body: Value) -> u16 {
  let routes = service(Arc::new(provider(true, 9)), receiver, ROUTE_TOKEN);
  let port = gateway(routes).await;

  reqwest::Client::new()
    .post(format!("http://127.0.0.1:{port}{route}"))
    .bearer_auth(ROUTE_TOKEN)
    .json(&body)
    .send()
    .await
    .expect("the service answers")
    .status()
    .as_u16()
}

fn person(person_id: i64, state: ChatPresenceState) -> PersonPresence {
  PersonPresence {
    person_id,
    presence: ChatPresence {
      state,
      last_seen_at: None,
    },
  }
}

#[tokio::test]
async fn people_typing_and_presence_are_declared_as_the_gateway_hears_each() {
  let neither = provider(true, hearing(false, false).await);
  let typing = provider(true, hearing(true, false).await);
  let both = provider(true, hearing(true, true).await);

  for provider in [&neither, &typing, &both] {
    assert!(!provider.can().contains(&ChatCapability::PeopleTyping));
    provider.read_hearing().await;
  }

  let declared = |provider: &bmo_discord::provider::DiscordProvider| {
    let can = provider.can();
    (can.contains(&ChatCapability::PeopleTyping), can.contains(&ChatCapability::Presence))
  };

  assert_eq!(declared(&neither), (false, false));
  assert_eq!(declared(&typing), (true, false));
  assert_eq!(declared(&both), (true, true));
}

#[tokio::test]
async fn a_typing_mark_is_told_only_of_a_room_the_receiving_side_listens_to() {
  let receiver = Arc::new(Receiver::default());

  for room_id in [LISTENED, NOT_LISTENED] {
    let mark = json!({ "via": "discord", "roomId": room_id, "personId": 8_000_000_000_001_i64, "on": true, "lastsMs": 10_000 });

    assert_eq!(post(receiver.clone(), "/typing-marks", mark).await, 204);
  }

  let told: Vec<i64> = receiver
    .marks
    .lock()
    .expect("the marks are readable")
    .iter()
    .map(|mark| mark.room_id)
    .collect();

  assert_eq!(told, [LISTENED]);
}

#[tokio::test]
async fn presence_is_told_of_the_people_who_stand_in_a_listened_room_and_a_whole_list_goes_whole() {
  let receiver = Arc::new(Receiver::default());
  let people = json!([
    { "personId": 8_000_000_000_001_i64, "state": "away", "lastSeenAt": null, "roomIds": [NOT_LISTENED, LISTENED] },
    { "personId": 8_000_000_000_002_i64, "state": "online", "lastSeenAt": null, "roomIds": [NOT_LISTENED] },
  ]);
  let nobody = json!([
    { "personId": 8_000_000_000_002_i64, "state": "offline", "lastSeenAt": null, "roomIds": [NOT_LISTENED] },
  ]);

  for (people, whole) in [(people, false), (nobody.clone(), false), (nobody, true)] {
    let change = json!({ "via": "discord", "people": people, "whole": whole });

    assert_eq!(post(receiver.clone(), "/presence-changes", change).await, 204);
  }

  let told = receiver.changes.lock().expect("the changes are readable").clone();
  let change = |people: Vec<PersonPresence>, whole: bool| PresenceChange {
    via: "discord".to_owned(),
    people,
    whole,
  };

  assert_eq!(
    told,
    [
      change(vec![person(8_000_000_000_001, ChatPresenceState::Away)], false),
      change(Vec::new(), true)
    ]
  );
}
