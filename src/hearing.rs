//! What the bot account's socket hears beside messages (docs/discord.md, 「Typing and presence」), as the seam
//! carries it: whether typing and presence are heard now, and people's presence beside the rooms they stand
//! in, which the service narrows to the rooms the receiving side listens to.

use bmo_chat::PersonPresence;
use serde::{Deserialize, Serialize};

/// Whether the socket hears one thing now, and where it does not, why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Heard {
  pub heard: bool,
  pub reason: Option<String>,
}

impl Heard {
  pub fn not(reason: impl Into<String>) -> Self {
    Self {
      heard: false,
      reason: Some(reason.into()),
    }
  }
}

/// The answer of the gateway's `GET /hearing`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hearing {
  pub people_typing: Heard,
  pub presence: Heard,
}

impl Hearing {
  /// Neither heard, for the one reason both wait on.
  pub fn neither(reason: &str) -> Self {
    Self {
      people_typing: Heard::not(reason),
      presence: Heard::not(reason),
    }
  }
}

/// One person's presence beside the rooms they stand in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonInRooms {
  #[serde(flatten)]
  pub person: PersonPresence,
  pub room_ids: Vec<i64>,
}

/// The body of the service's `POST /presence-changes`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceInRooms {
  pub via: String,
  pub people: Vec<PersonInRooms>,
  #[serde(default)]
  pub whole: bool,
}
