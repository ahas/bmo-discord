//! A room as the service answers it is the gateway's room with `modes`, the voices the declaration has
//! active, since the gateway says nothing of them and every room takes them alike (docs/api.md, 「Rooms」).

use axum::Router;
use axum::routing::get;
use bmo_chat::{ChatProvider, ChatVoice};
use bmo_discord::config::Config;
use bmo_discord::provider::DiscordProvider;
use bmo_discord::seam::Gateway;
use serde_json::json;

const ROUTE_TOKEN: &str = "example-route-token";

/// A stand-in gateway answering one room in the seam's shape, which carries no modes.
async fn gateway() -> u16 {
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("a loopback port is free");
  let port = listener.local_addr().expect("the listener has an address").port();
  let room = json!({
    "id": -5, "owns": true, "identity": 7, "kind": "group", "privateTo": null, "title": "A Room",
  });
  let router = Router::new().route("/rooms/-5", get(move || async move { axum::Json(room) }));
  tokio::spawn(async move { axum::serve(listener, router).await });
  port
}

fn provider(bot_token: bool, port: u16) -> DiscordProvider {
  let config = Config {
    bot_token,
    port: 3230,
    gateway_port: port,
    route_token: ROUTE_TOKEN.to_owned(),
    receiver_url: "http://127.0.0.1:3200".to_owned(),
    receiver_token: "example-receiver-token".to_owned(),
  };
  DiscordProvider::new(config, Gateway::new(port, ROUTE_TOKEN))
}

#[tokio::test]
async fn a_room_takes_the_bot_voice_where_the_token_is_set_and_none_where_it_is_not() {
  let port = gateway().await;

  let room = provider(true, port).room(-5).await.unwrap().expect("the gateway knows the room");
  assert_eq!(room.identity, Some(7));
  assert_eq!(room.modes, Some(vec![ChatVoice::BotAccount]));

  let room = provider(false, port).room(-5).await.unwrap().expect("the gateway knows the room");
  assert_eq!(room.modes, Some(vec![]));
}
