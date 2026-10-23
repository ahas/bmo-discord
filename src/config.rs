//! The service's configuration, read from the environment the deployment's env file supplies
//! (docs/boundary-api.md, 「Configuration」). The gateway in `gateway/` reads the same names; the values that
//! name no person and no address have defaults, the credentials do not.

/// The loopback port the service listens on, and the one the gateway listens on, where the environment names
/// neither.
const SERVICE_PORT: u16 = 3230;
const GATEWAY_PORT: u16 = 3231;

/// The value a variable gives, trimmed; null where it is unset or empty.
fn given(name: &str) -> Option<String> {
  let value = std::env::var(name).ok();

  match value.as_ref().map(|value| value.trim()) {
    Some(trimmed) if !trimmed.is_empty() => Some(trimmed.to_owned()),
    _ => None,
  }
}

/// A loopback port a variable names, or the one the provider uses where it names none or an unusable one.
fn port(name: &str, otherwise: u16) -> u16 {
  given(name).map_or(otherwise, |value| value.parse().unwrap_or(otherwise))
}

/// What the service stands on.
pub struct Config {
  /// Whether the application's bot token is set, which the `bot-account` mode stands on.
  pub bot_token: bool,
  /// Whether the user token of the agent's own account is set, which the `own-account` mode stands on.
  pub self_token: bool,
  /// The loopback port the service listens on.
  pub port: u16,
  /// The loopback port the gateway listens on.
  pub gateway_port: u16,
  /// The bearer every route of the service and of the gateway takes.
  pub route_token: String,
  /// The receiver's base address.
  pub receiver_url: String,
  /// The token the receiver's routes take.
  pub receiver_token: String,
}

impl Config {
  /// The whole configuration as the environment gives it.
  pub fn from_environment() -> Self {
    Self {
      bot_token: given("BMO_DISCORD_TOKEN").is_some(),
      self_token: given("BMO_DISCORD_SELF_TOKEN").is_some(),
      port: port("BMO_DISCORD_PORT", SERVICE_PORT),
      gateway_port: port("BMO_DISCORD_GATEWAY_PORT", GATEWAY_PORT),
      route_token: given("BMO_DISCORD_ROUTE_TOKEN").unwrap_or_default(),
      receiver_url: given("BMO_DISCORD_RECEIVER_URL").unwrap_or_default(),
      receiver_token: given("BMO_DISCORD_RECEIVER_TOKEN").unwrap_or_default(),
    }
  }

  /// The required values the environment does not give, each named by its variable.
  pub fn missing(&self) -> Vec<&'static str> {
    let required = [
      ("BMO_DISCORD_ROUTE_TOKEN", !self.route_token.is_empty()),
      ("BMO_DISCORD_RECEIVER_URL", !self.receiver_url.is_empty()),
      ("BMO_DISCORD_RECEIVER_TOKEN", !self.receiver_token.is_empty()),
    ];

    required.into_iter().filter(|(_, given)| !given).map(|(name, _)| name).collect()
  }
}
