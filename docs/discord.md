# Discord

The Discord chat provider: one chat provider like the others, and the one with the most verbs. It listens on
a gateway socket it opens itself and speaks over Discord's REST API, with no vendor library in between: what a
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

No mode runs on a user account, the owner's or one made for the agent, so no user token is part of the setup
(「The declaration」).

## The declaration

| Member | Value |
|---|---|
| `key` | `discord` |
| `label` | the platform's name in this repository's language pack, `lang/ko.toml` |
| `configured` | null where `BMO_DISCORD_TOKEN` is set, else the sentence naming it |
| `can` | `text`, `replyTo`, `photo`, `document`, `sticker`, `reaction`, `pin`, `typing`, `edit`, as `policy/discord.toml` lists them |
| `dialect` | `discord-markdown` (「The dialect」) |
| `shows` | null |
| `numbering` | `assigned` for rooms, people and messages, with the rooms' and people's ranges declared (「Numbering」) |
| `speakers` | false |

The modes. The bot account's stands on its token: the service reads the setting as it starts, so a token put
in place stands the mode up with the next start, and the gateway reads it each time it opens its socket or
sends. The three on a user account stand on nothing:

| Voice | Reach | Standing | `canReplyTo` |
|---|---|---|---|
| `bot-account` | `all-messages` | active when `BMO_DISCORD_TOKEN` is set | true |
| `human-reader` | `all-messages` | `unsupported` | false |
| `human-avatar` | `all-messages` | `unsupported` | false |
| `own-account` | `all-messages` | `unsupported` | false |

The `bot-account` mode is the one that can be active; while it is inactive its reason names the setting it is
missing.

- **The modes on a user account are `unsupported`.** Discord's terms forbid automating a user account, whoever
  it belongs to: `human-reader` and `human-avatar` would run on the owner's account, and `own-account` on an
  account made for the agent. The reason all three carry is the terms' own words, as `policy/discord.toml`
  holds them. No setting makes any of them active: the provider holds no user account's token, never reads a
  room through one and never answers in one. None of them delivers a message, so none has one an answer could
  be pinned to.
- **The rooms of the account are not listed.** The provider declares no `roomList`: the bot account cannot ask
  the platform for the one-to-one channels it is in, and the channels a guild answers with include those the
  bot cannot read, so no list the platform gives is the rooms the account is in.

## The socket

- **One gateway connection, the bot account's, kept open**: the hello names the beat, the socket heartbeats on
  it, and a dropped socket is opened again with growing delay.
- **A session is resumed where the platform lets it** and started fresh where it does not, so a blip does not
  deliver a room's messages twice or lose them.
- **A refused intent is not a blip.** The close code that says a privileged intent is not enabled stops the bot
  account's socket, with one line naming MESSAGE_CONTENT, instead of reconnecting for ever.
- **Every request carries the token under the `Bot ` scheme**, and the identify names the intents the provider
  reads with, MESSAGE_CONTENT among them.
- **The bot account's own id is read off the token's first segment**, so the provider knows who it is in a
  room before the socket is open.
- **The socket identifies itself** with the client name `BMO_DISCORD_CLIENT_NAME` gives.
- **Guild channels and one-to-one DMs are this provider's rooms.** A bot account is never in a group DM.

## Which account answers a room

- **The bot account answers every room.** It is the one account the provider holds a socket for.
- **What the provider has heard in a room is written down per room.** The voice of the socket that heard the
  room last is written over whatever stood. A voice the store holds that is not `bot-account`, such as
  `own-account`, counts as none, and the room is answered by the bot account.
- **A send speaks with the voice it names**, or with the voice the room is answered by. A voice on a user
  account is refused with the terms' words.

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
  socket reading it again, after a reconnect, finds it there; a hand-over that fails takes the mark off again.
- **A DM channel is a one-to-one with the agent.** A message with no guild sends the gateway to ask the
  platform for the channel, once a run for each such channel, and a channel whose type is a DM writes down
  its recipient as the person it is with. A guild channel is nobody's.
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
| a voice on a user account, or a voice Discord has no account for | `platform` | "That account cannot send: {why}." |
| an edit, a reaction or a pin of a message this provider has not numbered | `platform` | "There is no message {message}." |
| a sticker the pairing does not hold | `platform` | "No sticker is paired with {emoji}." |
| a send the declaration does not carry | `unsupported-capability` | |

## Tests

The declaration test holds the modes and the capabilities the service declares: `bot-account` the one mode
active when its token is set, the three on a user account unsupported with the terms' words whatever is set,
and the nine capabilities. The behaviour tests are deferred: no Discord test account is connected, so nothing
here has been tried against a live Discord server.
