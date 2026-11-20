//! The Discord chat provider as bmo-chat serves it (docs/discord.md, 「The declaration」): the declaration and
//! the dialect stand here, and every room question, a room's members and every send are the gateway's to
//! answer.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use bmo_chat::{
  ChatCapability, ChatDialect, ChatFailure, ChatHealth, ChatMembersResult, ChatModeStanding,
  ChatNumberRange, ChatNumberRanges, ChatNumberSpace, ChatNumbering, ChatProvider, ChatReach, ChatReadMode,
  ChatReceiver, ChatRefusal, ChatSend, ChatSendRequest, ChatSendResult, ChatVoice, ErrorCode, FileBody,
  ProviderRoom, WireError,
};
use tokio::task::JoinHandle;

use crate::config::Config;
use crate::dialect::DiscordMarkdown;
use crate::hearing::{Heard, Hearing};
use crate::policy::{POLICY, WORDS};
use crate::seam::{Gateway, GatewayFailure};

pub const KEY: &str = "discord";

const BOT_TOKEN_MISSING: &str = "BMO_DISCORD_TOKEN not set";
const OWNER_UNANSWERED: &str = "the gateway has not said whether the owner's account is confirmed";
const HEARING_UNANSWERED: &str = "the gateway has not said what its socket hears";
const GATEWAY_UNANSWERED: &str = "the gateway has not answered yet";
const GATEWAY_NOT_READY: &str = "the gateway is not ready";

/// How often the gateway is asked whether it is ready.
const HEALTH_EVERY: Duration = Duration::from_secs(5);

/// What the service last heard of the gateway's health.
#[derive(Clone)]
enum GatewayHeard {
  /// Not asked yet.
  Unasked,
  /// Asked, with no answer: why.
  Unreached(String),
  /// The gateway's answer.
  Answered(ChatHealth),
}

pub struct DiscordProvider {
  config: Config,
  dialect: DiscordMarkdown,
  gateway: Gateway,
  /// The gateway's last answer about its health.
  gateway_health: Arc<RwLock<GatewayHeard>>,
  /// Why the owner's account is not confirmed, from the gateway's last answer; none once it is.
  owner_unconfirmed: Arc<RwLock<Option<String>>>,
  /// What the bot account's socket hears beside messages, from the gateway's last answer.
  hearing: Arc<RwLock<Hearing>>,
  watching: Mutex<Option<JoinHandle<()>>>,
}

impl DiscordProvider {
  pub fn new(config: Config, gateway: Gateway) -> Self {
    Self {
      config,
      dialect: DiscordMarkdown::new(),
      gateway,
      gateway_health: Arc::new(RwLock::new(GatewayHeard::Unasked)),
      owner_unconfirmed: Arc::new(RwLock::new(Some(OWNER_UNANSWERED.to_owned()))),
      hearing: Arc::new(RwLock::new(Hearing::neither(HEARING_UNANSWERED))),
      watching: Mutex::new(None),
    }
  }

  /// The voices the declaration has active.
  fn active_voices(&self) -> Vec<ChatVoice> {
    self
      .modes()
      .into_iter()
      .filter(|mode| mode.standing == ChatModeStanding::Active)
      .map(|mode| mode.voice)
      .collect()
  }

  /// What the bot account waits on: its token where it is not set, then what the gateway answered where it
  /// answered that it is not ready, which is Discord not having accepted the token; none otherwise.
  fn bot_missing(&self) -> Option<String> {
    if !self.config.bot_token {
      return Some(BOT_TOKEN_MISSING.to_owned());
    }

    match self.gateway_heard() {
      GatewayHeard::Answered(ChatHealth {
        ready: false,
        reason,
        ..
      }) => Some(reason.unwrap_or_else(|| GATEWAY_NOT_READY.to_owned())),
      _ => None,
    }
  }

  /// What the service last heard of the gateway's health.
  fn gateway_heard(&self) -> GatewayHeard {
    self.gateway_health.read().map_or_else(
      |_| GatewayHeard::Unreached("the gateway's health could not be read".to_owned()),
      |held| held.clone(),
    )
  }

  /// Asks the gateway whether it is ready, and holds the answer health and the bot account's mode stand on.
  pub async fn read_gateway_health(&self) {
    Self::hold_gateway_health(&self.gateway, &self.gateway_health).await;
  }

  async fn hold_gateway_health(gateway: &Gateway, held: &RwLock<GatewayHeard>) {
    let answer = gateway
      .health()
      .await
      .map_or_else(|why| GatewayHeard::Unreached(why.to_string()), GatewayHeard::Answered);

    if let Ok(mut held) = held.write() {
      *held = answer;
    }
  }

  /// Where the provider is not configured, the missing setting and every mode down for it, as health says
  /// them beside a ready answer; none where it is configured.
  fn unconfigured(&self) -> Option<String> {
    let missing = self.configured()?;
    let down: Vec<String> = self
      .modes()
      .into_iter()
      .filter(|mode| mode.standing == ChatModeStanding::Inactive)
      .map(|mode| voice_name(mode.voice))
      .collect();

    Some(format!("not configured: {missing}; the {} modes are down", down.join(", ")))
  }

  /// What the owner's account waits on: the bot account's setting first, since what the owner's account says
  /// is read back on the bot's socket, then the gateway's confirmation of the account.
  fn owner_missing(&self) -> Option<String> {
    self.bot_missing().or_else(|| {
      self
        .owner_unconfirmed
        .read()
        .map_or_else(|_| Some(OWNER_UNANSWERED.to_owned()), |held| held.clone())
    })
  }

  /// Asks the gateway whether it has confirmed the owner's account, and holds the answer the owner's account
  /// modes stand on. A gateway that does not answer leaves them waiting on it.
  pub async fn read_owner_account(&self) {
    Self::hold_owner_account(&self.gateway, &self.owner_unconfirmed).await;
  }

  async fn hold_owner_account(gateway: &Gateway, held: &RwLock<Option<String>>) {
    let answer = gateway.owner_account().await.map_or_else(
      |why| Some(format!("the gateway does not answer about the owner's account: {why}")),
      |answer| {
        (!answer.ready)
          .then(|| answer.reason.unwrap_or_else(|| "the owner's account is not confirmed".to_owned()))
      },
    );

    if let Ok(mut held) = held.write() {
      *held = answer;
    }
  }

  /// Asks the gateway what its socket hears, and holds the answer `peopleTyping` and `presence` stand on.
  pub async fn read_hearing(&self) {
    Self::hold_hearing(&self.gateway, &self.hearing).await;
  }

  /// Holds what the gateway answers its socket hears. A gateway that does not answer leaves neither heard,
  /// saying why; a change in whether presence is heard is said in one line, so a presence intent not yet
  /// granted is named where the operator looks.
  async fn hold_hearing(gateway: &Gateway, held: &RwLock<Hearing>) {
    let answer = gateway.hearing().await.unwrap_or_else(|why| {
      Hearing::neither(&format!("the gateway does not answer about what its socket hears: {why}"))
    });

    if let Ok(mut held) = held.write() {
      if held.presence.heard != answer.presence.heard {
        match &answer.presence {
          Heard { heard: true, .. } => println!("discord: presence is heard"),
          Heard { reason, .. } => {
            println!("discord: presence is off: {}", reason.as_deref().unwrap_or("not heard"));
          }
        }
      }

      *held = answer;
    }
  }

  /// A mode standing on its account: active where it waits on nothing, and waiting on what it does, said by
  /// name, where it waits on something.
  fn account_mode(voice: ChatVoice, missing: Option<&str>, can_reply_to: bool) -> ChatReadMode {
    ChatReadMode {
      voice,
      reach: ChatReach::AllMessages,
      standing: if missing.is_none() { ChatModeStanding::Active } else { ChatModeStanding::Inactive },
      reason: missing.map(str::to_owned),
      can_reply_to,
    }
  }

  /// The mode on an account made for the agent, which Discord's terms forbid automating: unsupported whatever
  /// is set, with the terms' words as its reason. It delivers nothing, so nothing of it can be answered
  /// pinned.
  fn own_account_mode() -> ChatReadMode {
    ChatReadMode {
      voice: ChatVoice::OwnAccount,
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
      account_id,
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
      account_id,
    }
  }

  /// The refusal of a document larger than the dialect's file limit, which Discord would refuse whole, told by
  /// its size alone so a file that arrived as a part is not read; none for any other send.
  async fn oversized(&self, send: &ChatSend) -> Result<Option<ChatRefusal>, ChatFailure> {
    let ChatSend::Document { bytes, .. } = send else {
      return Ok(None);
    };
    let size = bytes.size().await?;
    let limit = POLICY.dialect.file_bytes;

    Ok((size > limit).then(|| ChatRefusal::Platform {
      label: self.label().to_owned(),
      detail: format!("The file is {size} bytes, and Discord takes at most {limit}."),
    }))
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

  /// The gateway reads the rooms; the service only keeps asking it whether it is ready, whether it has
  /// confirmed the owner's account, and what its socket hears.
  async fn start(&self, _receiver: Arc<dyn ChatReceiver>) -> Result<(), ChatFailure> {
    let gateway = self.gateway.clone();
    let health = self.gateway_health.clone();
    let owner = self.owner_unconfirmed.clone();
    let hearing = self.hearing.clone();
    let watching = tokio::spawn(async move {
      loop {
        Self::hold_gateway_health(&gateway, &health).await;
        Self::hold_owner_account(&gateway, &owner).await;
        Self::hold_hearing(&gateway, &hearing).await;

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

  /// Ready once the gateway answers that it is ready (docs/api.md, 「Health」). A provider with no bot token is
  /// ready all the same, its reason naming the setting and the modes down: no Discord application is a mode
  /// down, not a process failing.
  fn health(&self) -> ChatHealth {
    let version = self.version();

    match self.gateway_heard() {
      GatewayHeard::Unasked => ChatHealth::not_ready(version, GATEWAY_UNANSWERED),
      GatewayHeard::Unreached(why) => ChatHealth::not_ready(version, why),
      GatewayHeard::Answered(ChatHealth {
        ready: false,
        reason,
        ..
      }) => ChatHealth::not_ready(version, reason.unwrap_or_else(|| GATEWAY_NOT_READY.to_owned())),
      GatewayHeard::Answered(_) => ChatHealth {
        ready: true,
        reason: self.unconfigured(),
        version: version.to_owned(),
      },
    }
  }

  /// The bot account's mode stands on its token, read as the service starts, and on the gateway not answering
  /// that Discord has not accepted it; the owner's account's on the bot account's and on the gateway's
  /// confirmation of it, both read as the service runs.
  fn modes(&self) -> Vec<ChatReadMode> {
    let owner = self.owner_missing();

    vec![
      // The official bot account, delivered a room's every message. What it needs besides the token is the
      // MESSAGE_CONTENT intent, which is privileged: an application that has not been given it is refused at
      // the gateway rather than quietly handed empty messages. An answer can be pinned to what it delivered.
      Self::account_mode(ChatVoice::BotAccount, self.bot_missing().as_deref(), true),
      // The owner's own account, sending in his own words and in the agent's behind its prefix. It reads
      // nothing itself, so nothing it delivered can be answered pinned.
      Self::account_mode(ChatVoice::HumanReader, owner.as_deref(), false),
      Self::account_mode(ChatVoice::HumanAvatar, owner.as_deref(), false),
      Self::own_account_mode(),
    ]
  }

  /// The sends the policy lists, with `peopleTyping` and `presence` while the bot account's socket hears
  /// each, as the gateway last answered.
  fn can(&self) -> BTreeSet<ChatCapability> {
    let mut can = POLICY.can.clone();

    if let Ok(hearing) = self.hearing.read() {
      if hearing.people_typing.heard {
        can.insert(ChatCapability::PeopleTyping);
      }

      if hearing.presence.heard {
        can.insert(ChatCapability::Presence);
      }
    }

    can
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

  /// The gateway's room, its `modes` narrowed to the voices the declaration has active. An unconfigured
  /// provider owns no room, and the gateway is not asked.
  async fn room(&self, room_id: i64) -> Result<Option<ProviderRoom>, ChatFailure> {
    if self.configured().is_some() {
      return Ok(None);
    }

    match self.gateway.room(room_id).await {
      Ok(room) => {
        let active = self.active_voices();
        let modes = match room.modes {
          Some(answering) => answering.into_iter().filter(|voice| active.contains(voice)).collect(),
          None => active,
        };

        Ok(Some(ProviderRoom {
          modes: Some(modes),
          ..room
        }))
      }
      Err(GatewayFailure::Answered { status: 404, .. }) => Ok(None),
      Err(failure) => Err(failure.into()),
    }
  }

  /// A room's members as the gateway lists them (docs/discord.md, 「The members of a room」), and none held, for
  /// the gateway's reason, where it answers that it holds none. An unconfigured provider holds none, and the
  /// gateway is not asked.
  async fn members(&self, room_id: i64) -> Result<ChatMembersResult, ChatFailure> {
    if let Some(missing) = self.configured() {
      return Ok(ChatMembersResult::Unheld { reason: missing });
    }

    match self.gateway.members(room_id).await {
      Ok(listed) => Ok(ChatMembersResult::Listed(listed.members)),
      Err(GatewayFailure::Answered { status: 404, body }) => Ok(ChatMembersResult::Unheld {
        reason: serde_json::from_slice::<WireError>(&body)
          .map_or_else(|_| format!("nothing is known of room {room_id}"), |answer| answer.error),
      }),
      Err(failure) => Err(failure.into()),
    }
  }

  /// The owner's room as the gateway answers it; none for an unconfigured provider, without asking.
  async fn owner_room(&self) -> Result<Option<i64>, ChatFailure> {
    if self.configured().is_some() {
      return Ok(None);
    }

    let answer = self.gateway.owner().await?;

    Ok(answer.room_id)
  }

  async fn send(&self, request: ChatSendRequest) -> Result<ChatSendResult, ChatFailure> {
    let capability: ChatCapability = request.send.kind().into();

    if let Some(refusal) = self.undeclared(capability) {
      return Ok(ChatSendResult::Refused(refusal));
    }

    // An unconfigured provider sends nothing; the base does not turn the send away, since its health is ready.
    if self.configured().is_some() {
      return Ok(ChatSendResult::Refused(ChatRefusal::NotReady {
        label: self.label().to_owned(),
      }));
    }

    if let Some(refusal) = self.oversized(&request.send).await? {
      return Ok(ChatSendResult::Refused(refusal));
    }

    let request = ChatSendRequest {
      send: inline(request.send).await?,
      ..request
    };

    match self.gateway.send(&self.spoken(request)).await {
      Ok(sent) => Ok(ChatSendResult::Sent(sent)),
      Err(GatewayFailure::Answered { status, body }) => {
        Ok(ChatSendResult::Refused(self.refusal(status, capability, &body)?))
      }
      Err(failure) => Err(failure.into()),
    }
  }
}

/// The send as the seam takes it, every file inline (docs/boundary-api.md, 「The seam between the service and
/// the gateway」): a document that arrived as a part is read from the spool, which the gateway would read whole
/// anyway to hand Discord. The other kinds that carry files are not declared, so the send refuses them first.
async fn inline(send: ChatSend) -> Result<ChatSend, ChatFailure> {
  match send {
    ChatSend::Document {
      bytes: stored @ FileBody::Stored(_),
      file_name,
    } => Ok(ChatSend::Document {
      bytes: stored.read().await?.into(),
      file_name,
    }),
    other => Ok(other),
  }
}

/// A voice by its name on the wire, as a person reading the health answer finds it in the declaration.
fn voice_name(voice: ChatVoice) -> String {
  serde_json::to_value(voice)
    .ok()
    .and_then(|name| name.as_str().map(str::to_owned))
    .unwrap_or_else(|| format!("{voice:?}"))
}
