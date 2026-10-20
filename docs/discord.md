# Discord

The Discord chat provider: one chat provider like the others, and the one with the most verbs. It listens on
gateway sockets it opens itself and speaks over Discord's REST API, with no vendor library in between: what a
library would do here is the gateway's own hundred lines plus everything this provider does not use. The
routes, the seam and the settings are in `docs/boundary-api.md`; this document is what the provider is, how it
is set up and what it can do.

## What has to exist before anything runs

- **An application and its bot account**, made in Discord's developer portal. The bot token is what both
  sides authenticate with.
- **The MESSAGE_CONTENT intent, enabled for that application.** It is privileged: without it the gateway
  refuses the connection outright, and the bot account's socket says which intent to turn on and stands down
  rather than reconnecting for ever. An application in more than a hundred servers is reviewed before it is
  granted.
- **The bot invited into a guild**, with permission to read and send in the channels it is meant to be in.
- **For the modes on a person's account, that account's user token.** The owner's own token carries the
  reader and the avatar modes; the token of an account made for the agent carries the mode where the account
  is the agent's own. A user token needs no application, no intent and no invitation: the account reads
  whatever rooms it is already in.

## The declaration

| Member | Value |
|---|---|
| `key` | `discord` |
| `label` | the platform's name in this repository's language pack, `lang/ko.toml` |
| `configured` | null where at least one of the three tokens is set, else the sentence naming all three |
| `can` | `text`, `replyTo`, `photo`, `document`, `sticker`, `reaction`, `pin`, `typing`, `edit`, as `policy/discord.toml` lists them |
| `dialect` | `discord-markdown` (「The dialect」) |
| `shows` | null |
| `numbering` | `assigned` for rooms, people and messages, with the rooms' and people's ranges declared (「Numbering」) |
| `speakers` | false |

The modes, each standing on its own setting. The service reads the settings as it starts, so a token put in
place stands its mode up with the next start; the gateway reads them each time it opens a socket or sends:

| Voice | Reach | Active when | `canReplyTo` |
|---|---|---|---|
| `bot-account` | `all-messages` | `BMO_DISCORD_TOKEN` is set | true |
| `human-reader` | `all-messages` | `BMO_DISCORD_USER_TOKEN` is set | false |
| `human-avatar` | `all-messages` | `BMO_DISCORD_USER_TOKEN` and `BMO_DISCORD_AVATAR_PREFIX` are set | true |
| `own-account` | `all-messages` | `BMO_DISCORD_SELF_TOKEN` is set | true |

An inactive mode's reason names the setting it is missing. The reader's answers are never pinned to a message
it delivered, which `policy/discord.toml` keeps as the voices whose answers go out unpinned.

## The sockets

- **One gateway connection per token, kept open**: the hello names the beat, the socket heartbeats on it, and a
  dropped socket is opened again with growing delay.
- **A session is resumed where the platform lets it** and started fresh where it does not, so a blip does not
  deliver a room's messages twice or lose them.
- **A refused intent is not a blip.** The close code that says a privileged intent is not enabled stops the bot
  account's socket, with one line naming MESSAGE_CONTENT, instead of reconnecting for ever.
- **A user token's socket speaks differently:**
  - requests carry the token bare, without the `Bot ` scheme a bot token takes;
  - the identify names no intents, since a user account is delivered what its client would be, and so it can
    never meet the intent refusal;
  - the account's own id is read off the token's first segment, as the bot's is;
  - group DMs are rooms of this provider, beside guild channels and one-to-one DMs.
- **The bot account's socket identifies itself** with the client name `BMO_DISCORD_CLIENT_NAME` gives; a user
  token's socket describes itself as a desktop browser client does.

## Which account answers a room

- **It follows which accounts are in it.** A room the bot account is in is answered by the bot; the owner's
  account only reads it beside the bot, and its replies go out unpinned. A room only the owner's account is in
  is answered in the avatar voice. A room the agent's own account is in is answered by that account, with no
  prefix.
- **What the provider has heard in a room is written down per room.** A voice that answers where it reaches,
  the bot account or the agent's own account, is written over whatever stood; the avatar voice is written only
  where nothing stands, so a room another account is in stays that account's.
- **A send speaks with the voice it names**, or with the voice the room is answered by. A voice whose token is
  missing is refused, naming what is missing.

## The avatar voice

The account is a person's, so the agent's words and the owner's come in under the same platform account. Only
the prefix tells them apart, which is why everything the agent puts out in that voice carries it and why a
message carrying it is never read as the owner's.

- **A send may name its prefix.** The protocol's send carries `prefix`, and that is what a send in the avatar
  voice puts before its words; the deployment's `BMO_DISCORD_AVATAR_PREFIX` stands where the send names none.
- **The deployment's prefix is configuration**, written from the agent's registration; the provider holds no
  agent's name. It is also what the provider reads a message back by, so the agent's own words are recognised.
  While it is unset the avatar mode is inactive.
- **Everything the agent puts out in that voice carries the prefix**: a text, each part of a split one since
  each is a message of its own, a caption, which is written as the prefix alone where there was none so the
  echo is still recognised, and an edit of its own message. Words that already carry it go as they are.
- **A message read back with the prefix is the agent's own.** A platform may trim the space after the colon,
  so the colon is where the mark ends. The words are handed over without the prefix, under the avatar voice's
  own number and the agent's sender name, and wake nobody. So is a message already numbered under the avatar
  voice's number, which is a send that carried no words.
- **Everything else from that account is the owner's own words**, handed over under the owner's number like
  any message.
- **The avatar voice's number** is a person of this provider's own numbering, never the owner's, although the
  platform account is the owner's: the receiver tells the agent's words from the owner's by it.
- **A room answered in the avatar voice is nobody's one-to-one** and never the owner's room: a one-to-one of
  the owner's there is with somebody else.

## What a Discord room can do

- **The verbs:** text, an answer aimed at a message, a picture, a file, a sticker, a reaction, a pin, the
  typing state, and an edit of what the agent itself said. It is the fullest surface of the providers.
- **A reaction is the agent's own.** A bot may add and remove only its own, which is what the provider does.
- **A sticker is named by an emoji.** Discord names a sticker by an id of its own, so `BMO_DISCORD_STICKERS`
  pairs each emoji with the application's sticker id, and a sticker asked for by an emoji the pairing does not
  hold is refused, naming the emoji.

## The dialect

`discord-markdown`, run by the service:

- **Limits:** 2,000 characters a message and a caption, ten embeds on one message, and 25 MB a file on a guild
  with no boost. Nitro and boosts raise them, and nothing here counts on that.
- **Discord reads markdown itself**, so the marks go out as they were written and nothing is converted or
  escaped: the markup is the text, the plain text is the text, and it never says it is formatted beyond that.
- **Nothing is folded here**, so a room of this dialect asks for no fold decision, and a long answer goes out
  as consecutive messages, cut at its own markdown's seams.
- **It never faults**, and a reader sees the markup as it stands.
- **What a writer is told** is the `writing` sentence in `policy/discord.toml`.

## Numbering

- **Rooms, people and messages are all numbered by this provider.** A Discord id is a snowflake, a 64-bit
  number written as a string and larger than a JSON number holds exactly, so the platform's ids stay strings
  and the provider's own numbers are what every hand-over and every send carries.
- **The gateway keeps the numbers** in its store, `discord.sqlite` under `BMO_DISCORD_DATA`: a number for each
  channel, each person and each message it has seen or sent, the messages it has handed over, the voice each
  room is answered by, and the one person of each DM channel.
- **The ranges:** room numbers count down from −8,000,000,000,000 and person numbers count up from
  8,000,000,000,000, each taking one past the furthest the counter has ever reached, so a number once given is
  never given again. A message number counts up from one within its room, past the highest the room was ever
  given.
- **The declaration carries the ranges** (`policy/discord.toml`): rooms from −8,999,999,999,999 to
  −8,000,000,000,000 and people from 8,000,000,000,000 to 8,999,999,999,999, both ends included. They stand
  clear of KakaoTalk's (rooms below −9,000,000,000,000, people above 9,000,000,000,000) and of Telegram's
  native numbers, and the receiving side refuses a numbering whose ranges overlap another provider's.
- **A message is handed over once.** The store marks a message as handed over as it goes to the service, so a
  second socket reading it finds it there; a hand-over that fails takes the mark off again.
- **A DM channel is a one-to-one with the agent.** A message with no guild sends the gateway to ask the
  platform for the channel, once a run for each such channel, and a channel whose type is a DM writes down
  its recipient as the person it is with. A group DM, a guild channel and a room answered in the avatar voice
  are nobody's.
- **The owner's words** are filed under the person numbered for `BMO_DISCORD_OWNER_ID`.

## What a message carries

- **A file is a mark in the record.** A picture is handed over as the picture mark, and any other file as the
  file mark naming it, both from `lang/ko.toml`. The provider declares no `fetchMedia`: a file somebody posted
  cannot be asked for back.
- **An author Discord gives no name for** is handed over under the unknown-sender name in `lang/ko.toml`,
  and an attachment Discord gives no file name for is named by the unnamed-file word there.
- **A message's origin says what happened.** A message a room said is handed over `live`, and one already
  handed over whose words or sender changed is handed over `edit`, so the receiving side replaces it with the
  sender the edit carries. A message taken back leaves the record as it was: a deletion is handed over to
  nobody.
- **Times are epoch milliseconds**, as the protocol states them, and rooms, people and messages cross as the
  provider's signed 64-bit numbers.

## Refusals

Every refusal is a bmo-chat refusal code with its English sentence, answered with that code's status:

| Where | Code | Detail |
|---|---|---|
| no token is set | `not-ready` | |
| a room this provider has not numbered | `platform` | "There is no room {room}." |
| a voice whose token or prefix is missing | `platform` | "That account cannot send: {why}." |
| an edit, a reaction or a pin of a message this provider has not numbered | `platform` | "There is no message {message}." |
| a sticker the pairing does not hold | `platform` | "No sticker is paired with {emoji}." |
| a send the declaration does not carry | `unsupported-capability` | |

## Tests

Tests are deferred: this repository holds none yet, and no Discord test account is connected, so nothing here
has been tried against a live Discord server.
