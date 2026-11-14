//! A stand-in gateway on a loopback port, answering the seam routes a test gives it in the seam's own shapes,
//! and a provider whose service calls it.

use axum::Router;
use bmo_discord::config::Config;
use bmo_discord::provider::DiscordProvider;
use bmo_discord::seam::Gateway;

pub const ROUTE_TOKEN: &str = "example-route-token";

/// Serves `routes` on a free loopback port for as long as the test's runtime lives, and answers the port.
pub async fn gateway(routes: Router) -> u16 {
  let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("a loopback port is free");
  let port = listener.local_addr().expect("the listener has an address").port();
  tokio::spawn(async move { axum::serve(listener, routes).await });
  port
}

/// A provider whose service reads the bot token as given and calls the gateway at `port`.
pub fn provider(bot_token: bool, port: u16) -> DiscordProvider {
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
