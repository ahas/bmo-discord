//! The language packs (docs/discord.md, 「Language」): every pack the repository ships holds the same words with
//! the same marks, and a language tag names its pack by its language.

use std::collections::BTreeSet;

use bmo_discord::config::pack_language;
use bmo_discord::policy::{PACKS, words_in};

/// A pack's keys, each with the `{marks}` its words carry.
fn words(pack: &str) -> Vec<(String, BTreeSet<String>)> {
  let table: toml::Table = toml::from_str(pack).expect("a pack reads as a table");

  table
    .into_iter()
    .map(|(key, value)| {
      let text = value.as_str().unwrap_or_else(|| panic!("{key} is words")).to_owned();
      let marks = text
        .split('{')
        .skip(1)
        .filter_map(|after| after.split_once('}').map(|(mark, _)| mark.to_owned()))
        .collect();

      (key, marks)
    })
    .collect()
}

#[test]
fn every_pack_holds_the_same_words_with_the_same_marks() {
  let (_, korean) = PACKS[0];
  let expected = words(korean);

  for (language, pack) in PACKS {
    assert_eq!(words(pack), expected, "the {language} pack holds what the ko pack holds");
    assert!(!words_in(language).label.is_empty(), "the {language} pack names the platform");
  }
}

#[test]
fn a_language_tag_names_its_pack_by_its_language() {
  for (tag, pack) in [
    ("", "ko"),
    ("ko-KR", "ko"),
    ("en", "en"),
    ("en-US", "en"),
    ("ja", "ja"),
    ("ja-JP", "ja"),
    ("zh", "zh-CN"),
    ("zh-CN", "zh-CN"),
    ("zh_TW", "zh-CN"),
    ("fr", "ko"),
  ] {
    assert_eq!(pack_language(tag), pack, "{tag:?} names the {pack} pack");
  }
}
