//! The service's routes: the chat protocol's provider routes as bmo-chat serves them, and beside them the one
//! route the gateway calls, `POST /service/inbound`, which hands what a room said on to the receiver
//! (docs/boundary-api.md, 「The service's route, called by the gateway」).

use std::sync::Arc;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::http::header::AUTHORIZATION;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use bmo_chat::{ChatHandover, ChatProvider, ChatReceiver, ErrorCode, WireError, provider_router};
use serde::Deserialize;

/// Which hand-over the gateway asks for.
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum InboundKind {
  Message,
  Edited,
}

/// The body of `POST /service/inbound`: the kind, and the hand-over's body as the protocol states it.
#[derive(Deserialize)]
struct Inbound {
  kind: InboundKind,
  #[serde(flatten)]
  handover: ChatHandover,
}

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
  let inbound = Router::new().route("/service/inbound", post(inbound)).with_state(served);

  inbound.merge(provider_router(provider, token))
}

async fn inbound(State(served): State<Arc<Served>>, headers: HeaderMap, body: Bytes) -> Response {
  let bearer = headers.get(AUTHORIZATION).and_then(|value| value.to_str().ok());

  if bearer != Some(format!("Bearer {}", served.token).as_str()) {
    return WireError::new(ErrorCode::Unauthorized, "The bearer token is missing or wrong.")
      .into_response();
  }

  let inbound: Inbound = match serde_json::from_slice(&body) {
    Ok(inbound) => inbound,
    Err(why) => {
      return WireError::new(ErrorCode::BadRequest, format!("The hand-over is not one: {why}."))
        .into_response();
    }
  };

  let handed = match inbound.kind {
    InboundKind::Message => served.receiver.message(inbound.handover).await,
    InboundKind::Edited => served.receiver.edited(inbound.handover).await,
  };

  match handed {
    Ok(()) => axum::Json(serde_json::json!({})).into_response(),
    Err(why) => WireError::new(ErrorCode::Failed, why.to_string()).into_response(),
  }
}
