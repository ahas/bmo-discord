//! The provider's declaration (docs/discord.md, 「The declaration」): the bot account's mode stands on its token,
//! the two on the owner's account on the gateway having confirmed that account, `own-account` stands
//! unsupported whatever is set, and `can` is the nine sends and `memberList` the policy lists, with no
//! `roomList`.

use std::collections::BTreeSet;

use axum::Router;
use axum::routing::get;
use bmo_chat::{ChatCapability, ChatModeStanding, ChatProvider, ChatReadMode, ChatVoice};
use bmo_discord::policy::POLICY;
use bmo_discord::provider::DiscordProvider;
use serde_json::json;

use crate::stand_in::{gateway, provider};

/// A port nothing answers on: the declaration's own tests call no gateway.
const NO_GATEWAY: u16 = 9;

fn mode(provider: &DiscordProvider, voice: ChatVoice) -> ChatReadMode {
  provider
    .modes()
    .into_iter()
    .find(|mode| mode.voice == voice)
    .unwrap_or_else(|| panic!("the provider declares {voice:?}"))
}

fn active(provider: &DiscordProvider) -> Vec<ChatVoice> {
  provider
    .modes()
    .into_iter()
    .filter(|mode| mode.standing == ChatModeStanding::Active)
    .map(|mode| mode.voice)
    .collect()
}

/// The standing and the reason of the two modes on the owner's account, which always stand alike.
fn owner_modes(provider: &DiscordProvider) -> (ChatModeStanding, Option<String>) {
  let reader = mode(provider, ChatVoice::HumanReader);
  let avatar = mode(provider, ChatVoice::HumanAvatar);

  assert_eq!((reader.standing, &reader.reason), (avatar.standing, &avatar.reason));
  assert!(!reader.can_reply_to && !avatar.can_reply_to);
  (reader.standing, reader.reason)
}

/// A stand-in gateway answering the owner's account as it is given.
async fn owner_account(ready: bool, reason: Option<&'static str>) -> u16 {
  let answer = json!({ "ready": ready, "reason": reason, "version": "0.0.0" });

  gateway(Router::new().route("/owner-account", get(move || async move { axum::Json(answer) }))).await
}

#[test]
fn the_account_made_for_the_agent_is_unsupported_with_the_terms_as_reason() {
  for provider in [provider(true, NO_GATEWAY), provider(false, NO_GATEWAY)] {
    let mode = mode(&provider, ChatVoice::OwnAccount);

    assert_eq!(mode.standing, ChatModeStanding::Unsupported);
    assert_eq!(mode.reason.as_deref(), Some(POLICY.user_accounts.as_str()));
    assert!(!mode.can_reply_to);
  }
}

#[tokio::test]
async fn the_owner_account_modes_are_active_once_the_gateway_has_confirmed_the_account() {
  let provider = provider(true, owner_account(true, None).await);

  assert_eq!(
    owner_modes(&provider),
    (
      ChatModeStanding::Inactive,
      Some("the gateway has not said whether the owner's account is confirmed".to_owned())
    )
  );

  provider.read_owner_account().await;

  assert_eq!(owner_modes(&provider), (ChatModeStanding::Active, None));
  assert_eq!(
    active(&provider),
    [ChatVoice::BotAccount, ChatVoice::HumanReader, ChatVoice::HumanAvatar]
  );
}

#[tokio::test]
async fn the_owner_account_modes_wait_with_the_reason_while_the_account_is_not_confirmed() {
  let unconfirmed = provider(true, owner_account(false, Some("BMO_DISCORD_OWNER_TOKEN not set")).await);
  unconfirmed.read_owner_account().await;

  assert_eq!(
    owner_modes(&unconfirmed),
    (ChatModeStanding::Inactive, Some("BMO_DISCORD_OWNER_TOKEN not set".to_owned()))
  );
  assert_eq!(active(&unconfirmed), [ChatVoice::BotAccount]);

  let without_bot = provider(false, owner_account(true, None).await);
  without_bot.read_owner_account().await;

  assert_eq!(
    owner_modes(&without_bot),
    (ChatModeStanding::Inactive, Some("BMO_DISCORD_TOKEN not set".to_owned()))
  );
}

#[test]
fn the_bot_account_is_active_when_its_token_is_set() {
  let set = provider(true, NO_GATEWAY);
  let bot = mode(&set, ChatVoice::BotAccount);

  assert_eq!(bot.standing, ChatModeStanding::Active);
  assert_eq!(bot.reason, None);
  assert!(bot.can_reply_to);
  assert!(set.configured().is_none());
}

#[test]
fn the_bot_account_waits_on_its_token_when_it_is_unset() {
  let unset = provider(false, NO_GATEWAY);
  let bot = mode(&unset, ChatVoice::BotAccount);

  assert_eq!(bot.standing, ChatModeStanding::Inactive);
  assert_eq!(bot.reason.as_deref(), Some("BMO_DISCORD_TOKEN not set"));
  assert!(active(&unset).is_empty());
  assert_eq!(unset.configured().as_deref(), Some("BMO_DISCORD_TOKEN not set"));
}

#[test]
fn the_declaration_carries_four_modes_and_ten_capabilities_without_a_room_list() {
  let provider = provider(true, NO_GATEWAY);
  let declaration = provider.declaration();
  let voices: Vec<ChatVoice> = declaration.modes.iter().map(|mode| mode.voice).collect();
  let can = BTreeSet::from([
    ChatCapability::Text,
    ChatCapability::ReplyTo,
    ChatCapability::Photo,
    ChatCapability::Document,
    ChatCapability::Sticker,
    ChatCapability::Reaction,
    ChatCapability::Pin,
    ChatCapability::Typing,
    ChatCapability::Edit,
    ChatCapability::MemberList,
  ]);

  assert_eq!(
    voices,
    [
      ChatVoice::BotAccount,
      ChatVoice::HumanReader,
      ChatVoice::HumanAvatar,
      ChatVoice::OwnAccount
    ]
  );
  assert_eq!(declaration.can, can);
  assert!(provider.undeclared(ChatCapability::RoomList).is_some());
}
