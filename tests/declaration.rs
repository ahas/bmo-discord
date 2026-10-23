//! The provider's declaration (docs/discord.md, 「The declaration」): the modes on a person's account stand
//! unsupported whatever tokens are set, the modes on the provider's own accounts stand on their tokens, and
//! `can` is the nine sends the policy lists, with no `roomList`.

use std::collections::BTreeSet;

use bmo_chat::{ChatCapability, ChatModeStanding, ChatProvider, ChatReadMode, ChatVoice};
use bmo_discord::config::Config;
use bmo_discord::policy::POLICY;
use bmo_discord::provider::DiscordProvider;
use bmo_discord::seam::Gateway;

/// A provider whose service reads the two tokens as given, and the rest as a deployment sets it.
fn provider(bot_token: bool, self_token: bool) -> DiscordProvider {
  let config = Config {
    bot_token,
    self_token,
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
fn the_modes_on_a_persons_account_are_unsupported_with_the_terms_as_reason() {
  for provider in [provider(true, true), provider(false, false)] {
    for voice in [ChatVoice::HumanReader, ChatVoice::HumanAvatar] {
      let mode = mode(&provider, voice);

      assert_eq!(mode.standing, ChatModeStanding::Unsupported, "{voice:?}");
      assert_eq!(mode.reason.as_deref(), Some(POLICY.person_accounts.as_str()), "{voice:?}");
      assert!(!mode.can_reply_to, "{voice:?}");
    }
  }
}

#[test]
fn the_modes_on_the_providers_own_accounts_stand_on_their_tokens() {
  let set = provider(true, true);

  for voice in [ChatVoice::BotAccount, ChatVoice::OwnAccount] {
    let mode = mode(&set, voice);

    assert_eq!(mode.standing, ChatModeStanding::Active, "{voice:?}");
    assert_eq!(mode.reason, None, "{voice:?}");
    assert!(mode.can_reply_to, "{voice:?}");
  }

  assert!(set.configured().is_none());

  let unset = provider(false, false);

  for (voice, missing) in [
    (ChatVoice::BotAccount, "BMO_DISCORD_TOKEN not set"),
    (ChatVoice::OwnAccount, "BMO_DISCORD_SELF_TOKEN not set"),
  ] {
    let mode = mode(&unset, voice);

    assert_eq!(mode.standing, ChatModeStanding::Inactive, "{voice:?}");
    assert_eq!(mode.reason.as_deref(), Some(missing), "{voice:?}");
  }

  assert!(unset.configured().is_some());
}

#[test]
fn the_declaration_carries_four_modes_and_nine_capabilities_without_a_room_list() {
  let provider = provider(true, false);
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
  assert_eq!(declaration.can, can);
  assert!(provider.undeclared(ChatCapability::RoomList).is_some());
}
