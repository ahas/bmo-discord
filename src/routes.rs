//! The service's routes: the chat protocol's provider routes as bmo-chat serves them, and beside them the
//! routes the gateway calls, which hand what a room said, who is typing in it and who is reachable on to the
//! receiver (docs/boundary-api.md, 「The seam between the service and the gateway」).

use std::collections::BTreeSet;
use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::http::header::AUTHORIZATION;
use axum::response::{IntoResponse, Response};
use axum::routing::{post, put};
use bmo_chat::{
  ChatFailure, ChatProvider, ChatReceiver, ErrorCode, HandedMessage, LinkFailure, PresenceChange,
  RoomQuery, TypingMark, WireError, provider_router,
};
use serde::de::DeserializeOwned;

use crate::hearing::PresenceInRooms;
use crate::provider::KEY;

struct Served {
  receiver: Arc<dyn ChatReceiver>,
  token: String,
}

/// Every route the service answers: the provider's, under the route token, and the gateway's routes under the
/// same token.
pub fn service(provider: Arc<dyn ChatProvider>, receiver: Arc<dyn ChatReceiver>, token: &str) -> Router {
  let served = Arc::new(Served {
    receiver,
    token: token.to_owned(),
  });
  let inbound = Router::new()
    .route("/rooms/{room_id}/messages/{message_id}", put(hand_over))
    .route("/typing-marks", post(typing_marked))
    .route("/presence-changes", post(presence_changed))
    .with_state(served);

  inbound.merge(provider_router(provider, token))
}

/// One message handed over, answered 201 where the receiving side did not hold it before and 200 where it
/// did. A receiving side that answers with an error shape has that answer passed on, so `not-ready` and a
/// refusal reach the gateway as they came.
async fn hand_over(
  State(served): State<Arc<Served>>,
  Path((room_id, message_id)): Path<(i64, i64)>,
  headers: HeaderMap,
  body: Bytes,
) -> Response {
  let message: HandedMessage = match served.read(&headers, &body, "The hand-over is not a message") {
    Ok(message) => message,
    Err(refused) => return refused.into_response(),
  };

  match served.receiver.hand_over(room_id, message_id, message).await {
    Ok(held) => {
      let status = if held.created { StatusCode::CREATED } else { StatusCode::OK };

      (status, axum::Json(held.message)).into_response()
    }
    Err(failure) => failed(failure),
  }
}

/// One typing mark, told where the receiving side listens to its room and passed over where it does not.
async fn typing_marked(State(served): State<Arc<Served>>, headers: HeaderMap, body: Bytes) -> Response {
  let mark: TypingMark = match served.read(&headers, &body, "The body is not a typing mark") {
    Ok(mark) => mark,
    Err(refused) => return refused.into_response(),
  };

  match served.listened(BTreeSet::from([mark.room_id])).await {
    Ok(listened) if listened.contains(&mark.room_id) => match served.receiver.typing_marked(mark).await {
      Ok(()) => StatusCode::NO_CONTENT.into_response(),
      Err(failure) => failed(failure),
    },
    Ok(_) => StatusCode::NO_CONTENT.into_response(),
    Err(failure) => failed(failure),
  }
}

/// People's presence, told of the people who stand in a room the receiving side listens to. A whole change is
/// told even where nobody is left in it, so the people the receiving side held stand unknown.
async fn presence_changed(State(served): State<Arc<Served>>, headers: HeaderMap, body: Bytes) -> Response {
  let change: PresenceInRooms = match served.read(&headers, &body, "The body is not a presence change") {
    Ok(change) => change,
    Err(refused) => return refused.into_response(),
  };
  let rooms = change.people.iter().flat_map(|person| person.room_ids.iter().copied()).collect();
  let listened = match served.listened(rooms).await {
    Ok(listened) => listened,
    Err(failure) => return failed(failure),
  };
  let people: Vec<_> = change
    .people
    .into_iter()
    .filter(|person| person.room_ids.iter().any(|room| listened.contains(room)))
    .map(|person| person.person)
    .collect();

  if people.is_empty() && !change.whole {
    return StatusCode::NO_CONTENT.into_response();
  }

  let told = PresenceChange {
    via: change.via,
    people,
    whole: change.whole,
  };

  match served.receiver.presence_changed(told).await {
    Ok(()) => StatusCode::NO_CONTENT.into_response(),
    Err(failure) => failed(failure),
  }
}

impl Served {
  /// The body of a gateway call, read once its bearer is the route token; the refusal to answer with where it
  /// is not or where the body is not the shape the route takes, `what` saying what it is not.
  fn read<T: DeserializeOwned>(
    &self,
    headers: &HeaderMap,
    body: &[u8],
    what: &str,
  ) -> Result<T, WireError> {
    let bearer = headers.get(AUTHORIZATION).and_then(|value| value.to_str().ok());

    if bearer != Some(format!("Bearer {}", self.token).as_str()) {
      return Err(WireError::new(ErrorCode::Unauthorized, "The bearer token is missing or wrong."));
    }

    serde_json::from_slice(body)
      .map_err(|why| WireError::new(ErrorCode::BadRequest, format!("{what}: {why}.")))
  }

  /// Which of `rooms` the receiving side listens to, each asked of it once.
  async fn listened(&self, rooms: BTreeSet<i64>) -> Result<BTreeSet<i64>, ChatFailure> {
    let mut listened = BTreeSet::new();

    for room in rooms {
      let held = self
        .receiver
        .room(
          room,
          RoomQuery {
            via: KEY.to_owned(),
          },
        )
        .await?;

      if held.is_some_and(|held| held.listened) {
        listened.insert(room);
      }
    }

    Ok(listened)
  }
}

/// The receiving side's own answer where it gave one, and a failure with its sentence otherwise.
fn failed(failure: ChatFailure) -> Response {
  if let Some(LinkFailure::Answered {
    answer: Some(answer),
    ..
  }) = failure.downcast_ref::<LinkFailure>()
  {
    return answer.clone().into_response();
  }

  WireError::from(failure).into_response()
}
