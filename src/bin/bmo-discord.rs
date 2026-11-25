//! The service's binary (docs/boundary-api.md, 「Commands」): `serve` answers the provider's routes and the
//! gateway's hand-overs until the unit tells it to stop, and `health` ends 0 only where the served service
//! answers ready, which a deployment waits on. Both read the environment the deployment's env file supplies.

use std::process::ExitCode;
use std::sync::Arc;

use clap::{Parser, Subcommand};

use bmo_chat::{ChatHealth, ChatProvider, ChatReceiver, ChatReceiverLink};
use bmo_discord::config::Config;
use bmo_discord::provider::DiscordProvider;
use bmo_discord::routes::service;
use bmo_discord::seam::Gateway;

#[derive(Parser)]
#[command(
  name = "bmo-discord",
  version = bmo_discord::VERSION,
  about = "The Discord chat provider: the declaration, the dialect and the protocol's routes, with the gateway behind them."
)]
struct Cli {
  #[command(subcommand)]
  command: Command,
}

#[derive(Subcommand)]
enum Command {
  /// The provider's routes and the gateway's hand-overs answered, until the unit tells it to stop.
  Serve,
  /// Whether the served service answers ready: exit code 0 where it does, 1 where it does not.
  Health,
}

// The stop the served routes answer to: the signal the unit sends, either of them once.
async fn stopped() {
  let interrupted = tokio::signal::ctrl_c();
  let terminated = async {
    match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
      Ok(mut terminate) => {
        terminate.recv().await;
      }
      Err(_) => std::future::pending::<()>().await,
    }
  };

  tokio::select! {
    _ = interrupted => {}
    () = terminated => {}
  }
}

/// The service stood up from the environment: the provider watching the gateway, and the routes served on
/// the loopback, until a stop ends the process.
async fn serve() -> Result<(), String> {
  let config = Config::from_environment();
  let missing = config.missing();

  if !missing.is_empty() {
    for name in missing {
      eprintln!("discord: {name} is not set");
    }

    return Err("the configuration is incomplete".to_owned());
  }

  let gateway = Gateway::new(config.gateway_port, config.route_token.as_str());
  let port = config.port;
  let token = config.route_token.clone();
  let link = ChatReceiverLink::new(config.receiver_url.as_str(), config.receiver_token.as_str());
  let provider = Arc::new(DiscordProvider::new(config, gateway));
  // The link reads the provider's declaration at each typing mark and presence change, and drops one whose
  // capability the provider does not declare now.
  let receiver: Arc<dyn ChatReceiver> = Arc::new(link.declared_by(&provider));

  if let Some(reason) = provider.configured() {
    eprintln!("discord: {reason}");
  }

  provider.start(receiver.clone()).await.map_err(|why| why.to_string())?;

  let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
    .await
    .map_err(|why| why.to_string())?;
  let app = service(provider.clone(), receiver, &token);

  println!("discord: serving on 127.0.0.1:{port}");

  let served = axum::serve(listener, app)
    .with_graceful_shutdown(stopped())
    .await
    .map_err(|why| why.to_string());

  provider.stop().await;

  served
}

/// The served service asked whether it is ready, for a deployment to wait on.
async fn health() -> Result<(), String> {
  let config = Config::from_environment();

  if config.route_token.is_empty() {
    return Err("BMO_DISCORD_ROUTE_TOKEN is not set".to_owned());
  }

  let answer = reqwest::Client::builder()
    .no_proxy()
    .build()
    .map_err(|why| why.to_string())?
    .get(format!("http://127.0.0.1:{}/health", config.port))
    .bearer_auth(&config.route_token)
    .send()
    .await
    .map_err(|why| format!("the service does not answer: {why}"))?;
  let status = answer.status();
  let health: ChatHealth =
    answer.json().await.map_err(|why| format!("the service answered {status}: {why}"))?;

  if health.ready {
    // A ready answer can still say what is down, such as a provider with no Discord application.
    if let Some(reason) = health.reason {
      println!("bmo-discord: ready; {reason}");
    }

    Ok(())
  } else {
    Err(format!("the service is not ready: {}", health.reason.unwrap_or_default()))
  }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
  let cli = Cli::parse();

  let ended = match cli.command {
    Command::Serve => serve().await,
    Command::Health => health().await,
  };

  match ended {
    Ok(()) => ExitCode::SUCCESS,
    Err(why) => {
      eprintln!("bmo-discord: {why}");

      ExitCode::FAILURE
    }
  }
}
