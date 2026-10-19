//! The Discord chat provider's service (docs/boundary-api.md): the declaration, the `discord-markdown`
//! dialect, the protocol's routes and the receiver link, with the gateway behind them.

pub mod config;
pub mod dialect;
pub mod gateway;
pub mod policy;
pub mod provider;
pub mod routes;
