//! The provider's declaration (docs/discord.md, 「The declaration」): the modes on a user account stand
//! unsupported whatever is set, the bot account's mode stands on its token and is the one mode that can be
//! active, and `can` is the nine sends the policy lists, with no `roomList`.

use std::collections::BTreeSet;

use bmo_chat::{ChatCapability, ChatModeStanding, ChatProvider, ChatReadMode, ChatVoice};
use bmo_discord::config::Config;
use bmo_discord::policy::POLICY;
use bmo_discord::provider::DiscordProvider;
use bmo_discord::seam::Gateway;

/// A provider whose service reads the bot token as given, and the rest as a deployment sets it.
fn provider(bot_token: bool) -> DiscordProvider {
  let config = Config {
    bot_token,
    port: 3230,
    gateway_port: 3231,
    route_token: "example-route-token".to_owned(),
    receiver_url: "http://127.0.0.1:3200".to_owned(),
    receiver_token: "example-receiver-token".to_owned(),
  };

  DiscordProvider::new(config, Gateway::new(3231, "example-route-token"))
}

fn mode(provider: &DiscordProvider, voice: ChatVoice) -> ChatReadMode {
  provider
    .modes()
    .into_iter()
    .find(|mode| mode.voice == voice)
    .unwrap_or_else(|| panic!("the provider declares {voice:?}"))
}

#[test]
fn the_modes_on_a_user_account_are_unsupported_with_the_terms_as_reason() {
  for provider in [provider(true), provider(false)] {
    for voice in [ChatVoice::HumanReader, ChatVoice::HumanAvatar, ChatVoice::OwnAccount] {
      let mode = mode(&provider, voice);

      assert_eq!(mode.standing, ChatModeStanding::Unsupported, "{voice:?}");
      assert_eq!(mode.reason.as_deref(), Some(POLICY.user_accounts.as_str()), "{voice:?}");
      assert!(!mode.can_reply_to, "{voice:?}");
    }
  }
}

#[test]
fn the_bot_account_is_the_one_active_mode_when_its_token_is_set() {
  let set = provider(true);
  let active: Vec<ChatVoice> = set
    .modes()
    .into_iter()
    .filter(|mode| mode.standing == ChatModeStanding::Active)
    .map(|mode| mode.voice)
    .collect();
  let bot = mode(&set, ChatVoice::BotAccount);

  assert_eq!(active, [ChatVoice::BotAccount]);
  assert_eq!(bot.reason, None);
  assert!(bot.can_reply_to);
  assert!(set.configured().is_none());
}

#[test]
fn the_bot_account_waits_on_its_token_when_it_is_unset() {
  let unset = provider(false);
  let bot = mode(&unset, ChatVoice::BotAccount);

  assert_eq!(bot.standing, ChatModeStanding::Inactive);
  assert_eq!(bot.reason.as_deref(), Some("BMO_DISCORD_TOKEN not set"));
  assert!(unset.modes().iter().all(|mode| mode.standing != ChatModeStanding::Active));
  assert_eq!(unset.configured().as_deref(), Some("BMO_DISCORD_TOKEN not set"));
}

#[test]
fn the_declaration_carries_four_modes_and_nine_capabilities_without_a_room_list() {
  let provider = provider(true);
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
  assert_eq!(declaration.can.len(), 9);
  assert_eq!(declaration.can, can);
  assert!(provider.undeclared(ChatCapability::RoomList).is_some());
}
