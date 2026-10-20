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
const USER_TOKEN_MISSING: &str = "BMO_DISCORD_USER_TOKEN not set";
const SELF_TOKEN_MISSING: &str = "BMO_DISCORD_SELF_TOKEN not set";
const AVATAR_PREFIX_MISSING: &str = "BMO_DISCORD_AVATAR_PREFIX not set";
const DISCORD_MISSING: &str =
  "none of BMO_DISCORD_TOKEN, BMO_DISCORD_USER_TOKEN and BMO_DISCORD_SELF_TOKEN is set";

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

  /// A mode that stands on what it needs: active where nothing is missing, and waiting on the first thing
  /// missing, said by name. Whether an answer can be pinned to what it delivered is the policy's.
  fn mode(voice: ChatVoice, missing: Option<&str>) -> ChatReadMode {
    ChatReadMode {
      voice,
      reach: ChatReach::AllMessages,
      standing: if missing.is_none() { ChatModeStanding::Active } else { ChatModeStanding::Inactive },
      reason: missing.map(str::to_owned),
      can_reply_to: !POLICY.unpinned.contains(&voice),
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
    let any = self.config.bot_token || self.config.user_token || self.config.self_token;

    (!any).then(|| DISCORD_MISSING.to_owned())
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

  /// Each mode stands on its own setting, read as the service starts.
  fn modes(&self) -> Vec<ChatReadMode> {
    let config = &self.config;
    let user = (!config.user_token).then_some(USER_TOKEN_MISSING);
    let avatar = user.or((!config.avatar_prefix).then_some(AVATAR_PREFIX_MISSING));

    vec![
      // The official bot account, delivered a room's every message. What it needs besides the token is the
      // MESSAGE_CONTENT intent, which is privileged: an application that has not been given it is refused at
      // the gateway rather than quietly handed empty messages.
      Self::mode(ChatVoice::BotAccount, (!config.bot_token).then_some(BOT_TOKEN_MISSING)),
      // The owner's own account reading beside the bot. What it reads there is answered by the bot, so an
      // answer never points at it.
      Self::mode(ChatVoice::HumanReader, user),
      // The same account answering, behind the prefix, where no other account of this provider is.
      Self::mode(ChatVoice::HumanAvatar, avatar),
      // An account made for the agent, answering as the agent with no prefix.
      Self::mode(ChatVoice::OwnAccount, (!config.self_token).then_some(SELF_TOKEN_MISSING)),
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
