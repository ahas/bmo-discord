//! `discord-markdown`: what the agent's markdown becomes in a Discord channel, and the measures that platform
//! holds a message to (docs/discord.md, 「The dialect」).
//!
//! Discord reads markdown itself — bold, italic, strikethrough, spoilers, inline code, code blocks with a
//! language, quotes and links — so the marks go out as the writer wrote them and nothing is converted or
//! escaped on the way. It declares no fold: Discord has no expandable quote to fold into, so its rooms ask
//! for no fold decision.

use bmo_chat::{ChatDialect, ChatDialectLimits, ChatMarkup};
use bmo_text::markdown::markdown_parts;

use crate::policy::{DialectPolicy, POLICY};

pub struct DiscordMarkdown {
  policy: &'static DialectPolicy,
}

impl DiscordMarkdown {
  pub fn new() -> Self {
    Self {
      policy: &POLICY.dialect,
    }
  }

  /// What one message holds. Nitro raises it, and nothing here counts on that.
  fn text_limit(&self) -> usize {
    usize::try_from(self.policy.text_limit).unwrap_or(usize::MAX)
  }
}

impl Default for DiscordMarkdown {
  fn default() -> Self {
    Self::new()
  }
}

impl ChatDialect for DiscordMarkdown {
  fn name(&self) -> &str {
    &self.policy.name
  }

  fn limits(&self) -> ChatDialectLimits {
    ChatDialectLimits {
      text: Some(self.policy.text_limit),
      // A picture's words ride in the message's own content beside the embed, so they are held to the same
      // limit as any other message.
      caption: Some(self.policy.text_limit),
      album_photos: Some(self.policy.album_photos),
      // The largest file a guild with no boost takes. A boosted one takes more, and a provider that assumed
      // the larger number would be refused in the ordinary case.
      file_bytes: Some(self.policy.file_bytes),
    }
  }

  fn writing(&self) -> &str {
    &self.policy.writing
  }

  fn foldable(&self) -> bool {
    false
  }

  fn convert(&self, markdown: &str) -> ChatMarkup {
    ChatMarkup {
      markup: markdown.to_owned(),
      plain: markdown.to_owned(),
      formatted: false,
    }
  }

  fn parts(&self, markdown: &str) -> Vec<String> {
    markdown_parts(markdown, self.text_limit())
  }

  fn fault(&self, _markup: &str) -> Option<String> {
    None
  }

  fn fold(&self, _markdown: &str) -> Option<String> {
    None
  }

  fn visible(&self, markup: &str) -> String {
    markup.to_owned()
  }
}
