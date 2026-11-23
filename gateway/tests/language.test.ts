// The language packs as the gateway reads them (docs/discord.md, 「Language」): every pack holds the words the
// gateway draws, and a language tag names its pack by its language, as the service reads the same variable.

import { expect, test } from "bun:test";

import { languagePacks, packLanguage } from "../src/settings";

test("every pack holds the same words", () => {
  const korean = Object.keys(languagePacks.ko ?? {}).sort();

  expect(Object.keys(languagePacks).sort()).toEqual(["en", "ja", "ko", "zh-CN"]);

  for (const pack of Object.values(languagePacks)) {
    expect(Object.keys(pack).sort()).toEqual(korean);
  }
});

test("a language tag names its pack by its language", () => {
  const named: [string | undefined, string][] = [
    [undefined, "ko"],
    ["", "ko"],
    ["ko-KR", "ko"],
    ["en-US", "en"],
    ["ja", "ja"],
    ["ja-JP", "ja"],
    ["zh", "zh-CN"],
    ["zh_TW", "zh-CN"],
    ["fr", "ko"],
  ];

  for (const [tag, pack] of named) {
    expect(packLanguage(tag)).toBe(pack);
  }
});
