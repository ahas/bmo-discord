//! The provider's fixed values in `policy/discord.toml` and the words a person reads in `lang/ko.toml`
//! (docs/discord.md), built into the binary and read once.

use std::collections::BTreeSet;
use std::sync::LazyLock;

use bmo_chat::{ChatCapability, ChatVoice};
use serde::Deserialize;

/// The `discord-markdown` dialect's values.
#[derive(Deserialize)]
pub struct DialectPolicy {
  pub name: String,
  /// The longest one message and one caption hold, in characters.
  pub text_limit: u64,
  /// The most embeds one message carries.
  pub album_photos: u64,
  /// The largest file a guild with no boost takes, in bytes.
  pub file_bytes: u64,
  /// What a writer in such a room is told its marks become.
  pub writing: String,
}

/// What `policy/discord.toml` holds.
#[derive(Deserialize)]
pub struct Policy {
  /// What the provider sends, as its declaration's `can`.
  pub can: BTreeSet<ChatCapability>,
  /// The voices whose answers go out unpinned.
  pub unpinned: Vec<ChatVoice>,
  pub dialect: DialectPolicy,
}

/// What `lang/ko.toml` holds that the service draws: the platform's name as the declaration's label.
#[derive(Deserialize)]
pub struct Words {
  pub label: String,
}

pub static POLICY: LazyLock<Policy> = LazyLock::new(|| {
  toml::from_str(include_str!("../policy/discord.toml"))
    .expect("policy/discord.toml reads as the provider's policy")
});

pub static WORDS: LazyLock<Words> = LazyLock::new(|| {
  toml::from_str(include_str!("../lang/ko.toml")).expect("lang/ko.toml reads as the provider's words")
});
