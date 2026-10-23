//! The Discord chat provider as bmo-chat serves it (docs/discord.md, 「The declaration」): the declaration and
//! the dialect stand here, and every room question and every send is the gateway's to answer.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use bmo_chat::{
  ChatCapability, ChatDialect, ChatFailure, ChatHealth, ChatModeStanding, ChatNumberRange,
  ChatNumberRanges, ChatNumberSpace, ChatNumbering, ChatProvider, ChatReach, ChatReadMode, ChatReceiver,
  ChatRefusal, ChatSend, ChatSendRequest, ChatSendResult, ChatVoice, ErrorCode, ProviderRoom, WireError,
};
use tokio::task::JoinHandle;

use crate::config::Config;
use crate::dialect::DiscordMarkdown;
use crate::policy::{POLICY, WORDS};
use crate::seam::{Gateway, GatewayFailure};

pub const KEY: &str = "discord";

const BOT_TOKEN_MISSING: &str = "BMO_DISCORD_TOKEN not set";

/// How often the gateway is asked whether it is ready.
const HEALTH_EVERY: Duration = Duration::from_secs(5);

pub struct DiscordProvider {
  config: Config,
  dialect: DiscordMarkdown,
  gateway: Gateway,
  /// The gateway's last answer about its health.
  gateway_health: Arc<RwLock<ChatHealth>>,
  watching: Mutex<Option<JoinHandle<()>>>,
}

impl DiscordProvider {
  pub fn new(config: Config, gateway: Gateway) -> Self {
    Self {
      config,
      dialect: DiscordMarkdown::new(),
      gateway,
      gateway_health: Arc::new(RwLock::new(ChatHealth::not_ready(
        env!("CARGO_PKG_VERSION"),
        "the gateway has not answered yet",
      ))),
      watching: Mutex::new(None),
    }
  }

  /// The mode on the bot account, which stands on its token: active where the token is set, and waiting on
  /// it, said by name, where it is not. An answer can be pinned to what it delivered.
  fn bot_mode(missing: Option<&str>) -> ChatReadMode {
    ChatReadMode {
      voice: ChatVoice::BotAccount,
      reach: ChatReach::AllMessages,
      standing: if missing.is_none() { ChatModeStanding::Active } else { ChatModeStanding::Inactive },
      reason: missing.map(str::to_owned),
      can_reply_to: true,
    }
  }

  /// A mode on a user account, the owner's or one made for the agent, which Discord's terms forbid
  /// automating: unsupported whatever is set, with the terms' words as its reason. It delivers nothing, so
  /// nothing of it can be answered pinned.
  fn user_account_mode(voice: ChatVoice) -> ChatReadMode {
    ChatReadMode {
      voice,
      reach: ChatReach::AllMessages,
      standing: ChatModeStanding::Unsupported,
      reason: Some(POLICY.user_accounts.clone()),
      can_reply_to: false,
    }
  }

  /// A send with the words its kind carries read through this provider's dialect. Discord's dialect leaves
  /// markdown as written, so this holds the dialect's place rather than changing a word.
  fn spoken(&self, request: ChatSendRequest) -> ChatSendRequest {
    let ChatSendRequest {
      room_id,
      send,
      mode,
      speaker,
      tag,
      prefix,
      reply_to_message_id,
    } = request;
    let caption = |words: Option<String>| words.map(|words| self.dialect.convert(&words).markup);
    let send = match send {
      ChatSend::Text { text, silent, fold } => ChatSend::Text {
        text: self.dialect.outgoing(&text, fold),
        silent,
        fold,
      },
      ChatSend::Photo {
        image_url,
        caption: words,
      } => ChatSend::Photo {
        image_url,
        caption: caption(words),
      },
      ChatSend::Album {
        items,
        caption: words,
      } => ChatSend::Album {
        items,
        caption: caption(words),
      },
      ChatSend::Voice {
        audio,
        said,
        caption: words,
        transcript,
      } => ChatSend::Voice {
        audio,
        said,
        caption: caption(words),
        transcript,
      },
      ChatSend::Edit { message_id, text } => ChatSend::Edit {
        message_id,
        text: self.dialect.convert(&text).markup,
      },
      other => other,
    };

    ChatSendRequest {
      room_id,
      send,
      mode,
      speaker,
      tag,
      prefix,
      reply_to_message_id,
    }
  }

  /// The refusal the service answers with, from the error shape the gateway answered with. A send this
  /// provider does not perform was refused before the gateway was asked, so a gateway answer here is the
  /// platform's own refusal; any other answer is a failure of the call, not a refusal.
  fn refusal(
    &self,
    status: u16,
    capability: ChatCapability,
    answer: &[u8],
  ) -> Result<ChatRefusal, ChatFailure> {
    let label = self.label().to_owned();
    let WireError { code, error } = serde_json::from_slice(answer)
      .map_err(|_| format!("the gateway answered {status} in a shape this service does not read."))?;

    match code {
      ErrorCode::NotReady => Ok(ChatRefusal::NotReady { label }),
      ErrorCode::Gone => Ok(ChatRefusal::Gone {
        label,
        detail: error,
      }),
      ErrorCode::UnsupportedCapability => Ok(ChatRefusal::UnsupportedCapability { label, capability }),
      ErrorCode::Platform => Ok(ChatRefusal::Platform {
        label,
        detail: error,
      }),
      _ => Err(format!("the gateway answered {status}: {error}").into()),
    }
  }
}

#[async_trait]
impl ChatProvider for DiscordProvider {
  fn key(&self) -> &str {
    KEY
  }

  fn label(&self) -> &str {
    &WORDS.label
  }

  fn version(&self) -> &str {
    env!("CARGO_PKG_VERSION")
  }

  fn configured(&self) -> Option<String> {
    (!self.config.bot_token).then(|| BOT_TOKEN_MISSING.to_owned())
  }

  /// The gateway reads the rooms; the service only keeps asking it whether it is ready.
  async fn start(&self, _receiver: Arc<dyn ChatReceiver>) -> Result<(), ChatFailure> {
    let gateway = self.gateway.clone();
    let health = self.gateway_health.clone();
    let version = self.version().to_owned();
    let watching = tokio::spawn(async move {
      loop {
        let answer = gateway.health().await.map_or_else(
          |why| ChatHealth::not_ready(version.clone(), format!("the gateway does not answer: {why}")),
          |answer| ChatHealth {
            version: version.clone(),
            ..answer
          },
        );

        if let Ok(mut held) = health.write() {
          *held = answer;
        }

        tokio::time::sleep(HEALTH_EVERY).await;
      }
    });

    if let Ok(mut held) = self.watching.lock() {
      *held = Some(watching);
    }

    Ok(())
  }

  async fn stop(&self) {
    let watching = self.watching.lock().ok().and_then(|mut held| held.take());

    if let Some(watching) = watching {
      watching.abort();
    }
  }

  /// Ready once the gateway says it is ready.
  fn health(&self) -> ChatHealth {
    if let Some(reason) = self.configured() {
      return ChatHealth::not_ready(self.version(), reason);
    }

    self.gateway_health.read().map_or_else(
      |_| ChatHealth::not_ready(self.version(), "the gateway's health could not be read"),
      |held| ChatHealth {
        version: self.version().to_owned(),
        ..held.clone()
      },
    )
  }

  /// The bot account's mode stands on its token, read as the service starts; the modes on a user account
  /// stand on nothing.
  fn modes(&self) -> Vec<ChatReadMode> {
    vec![
      // The official bot account, delivered a room's every message. What it needs besides the token is the
      // MESSAGE_CONTENT intent, which is privileged: an application that has not been given it is refused at
      // the gateway rather than quietly handed empty messages.
      Self::bot_mode((!self.config.bot_token).then_some(BOT_TOKEN_MISSING)),
      // The owner's own account, read and answered in, and an account made for the agent: the platform's
      // terms forbid automating either.
      Self::user_account_mode(ChatVoice::HumanReader),
      Self::user_account_mode(ChatVoice::HumanAvatar),
      Self::user_account_mode(ChatVoice::OwnAccount),
    ]
  }

  fn can(&self) -> BTreeSet<ChatCapability> {
    POLICY.can.clone()
  }

  fn dialect(&self) -> &dyn ChatDialect {
    &self.dialect
  }

  fn numbering(&self) -> ChatNumbering {
    ChatNumbering {
      rooms: ChatNumberSpace::Assigned,
      people: ChatNumberSpace::Assigned,
      messages: ChatNumberSpace::Assigned,
      ranges: ChatNumberRanges {
        rooms: Some(ChatNumberRange {
          first: POLICY.numbering.rooms.first,
          last: POLICY.numbering.rooms.last,
        }),
        people: Some(ChatNumberRange {
          first: POLICY.numbering.people.first,
          last: POLICY.numbering.people.last,
        }),
      },
    }
  }

  async fn room(&self, room_id: i64) -> Result<Option<ProviderRoom>, ChatFailure> {
    match self.gateway.room(room_id).await {
      Ok(room) => Ok(Some(room)),
      Err(GatewayFailure::Answered { status: 404, .. }) => Ok(None),
      Err(failure) => Err(failure.into()),
    }
  }

  async fn owner_room(&self) -> Result<Option<i64>, ChatFailure> {
    let answer = self.gateway.owner().await?;

    Ok(answer.room_id)
  }

  async fn send(&self, request: ChatSendRequest) -> Result<ChatSendResult, ChatFailure> {
    let capability: ChatCapability = request.send.kind().into();

    if let Some(refusal) = self.undeclared(capability) {
      return Ok(ChatSendResult::Refused(refusal));
    }

    match self.gateway.send(&self.spoken(request)).await {
      Ok(sent) => Ok(ChatSendResult::Sent(sent)),
      Err(GatewayFailure::Answered { status, body }) => {
        Ok(ChatSendResult::Refused(self.refusal(status, capability, &body)?))
      }
      Err(failure) => Err(failure.into()),
    }
  }
}
