//! The Discord chat provider's service (docs/boundary-api.md): the declaration, the `discord-markdown`
//! dialect, the protocol's routes and the receiver link, with the gateway behind them.

pub mod config;
pub mod dialect;
pub mod hearing;
pub mod policy;
pub mod provider;
pub mod routes;
pub mod seam;

/// The version the provider's health and its command name: the set's version the build was made at, which
/// the testbed hands the build as `BMO_VERSION`, else the manifest's placeholder (bmo-chat's
/// `docs/conventions.md`, 「Versions」).
pub const VERSION: &str = match option_env!("BMO_VERSION") {
  Some(version) => version,
  None => env!("CARGO_PKG_VERSION"),
};
