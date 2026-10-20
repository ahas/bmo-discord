//! The service's routes: the chat protocol's provider routes as bmo-chat serves them, and beside them the one
//! route the gateway calls, `PUT /rooms/{roomId}/messages/{messageId}`, which hands what a room said on to the
//! receiver (docs/boundary-api.md, 「The seam between the service and the gateway」).

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::HeaderMap;
use axum::http::StatusCode;
use axum::http::header::AUTHORIZATION;
use axum::response::{IntoResponse, Response};
use axum::routing::put;
use bmo_chat::{
  ChatFailure, ChatProvider, ChatReceiver, ErrorCode, HandedMessage, LinkFailure, WireError,
  provider_router,
};

struct Served {
  receiver: Arc<dyn ChatReceiver>,
  token: String,
}

/// Every route the service answers: the provider's, under the route token, and the gateway's hand-over route
/// under the same token.
pub fn service(provider: Arc<dyn ChatProvider>, receiver: Arc<dyn ChatReceiver>, token: &str) -> Router {
  let served = Arc::new(Served {
    receiver,
    token: token.to_owned(),
  });
  let inbound = Router::new()
    .route("/rooms/{room_id}/messages/{message_id}", put(hand_over))
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
  let bearer = headers.get(AUTHORIZATION).and_then(|value| value.to_str().ok());

  if bearer != Some(format!("Bearer {}", served.token).as_str()) {
    return WireError::new(ErrorCode::Unauthorized, "The bearer token is missing or wrong.")
      .into_response();
  }

  let message: HandedMessage = match serde_json::from_slice(&body) {
    Ok(message) => message,
    Err(why) => {
      return WireError::new(ErrorCode::BadRequest, format!("The hand-over is not a message: {why}."))
        .into_response();
    }
  };

  match served.receiver.hand_over(room_id, message_id, message).await {
    Ok(held) => {
      let status = if held.created { StatusCode::CREATED } else { StatusCode::OK };

      (status, axum::Json(held.message)).into_response()
    }
    Err(failure) => failed(failure),
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
