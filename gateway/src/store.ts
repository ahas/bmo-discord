// The provider's own numbers (docs/discord.md, 「Numbering」): a Discord id is a snowflake, larger than a
// number holds exactly, so every channel, person and message is given a number here and the snowflake stays a
// string. The store also keeps which messages have been handed over, so a message two sockets read goes once,
// the voice each room is answered by, the one person of each DM channel, the rooms the owner has been heard in,
// the messages sent through the owner's account, the guild of each guild channel, and every person heard writing
// in each room. It is this provider's alone, so the provider key each call names is always this provider's.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { discordPolicy } from "./settings";

import type { HandedMessage } from "./chat";

// A message as the store keeps it: the room and message numbers it is numbered by, and the hand-over it
// makes to the receiver.
export interface KeptMessage {
  chatId: number;
  messageId: number;
  message: HandedMessage;
}

// Hands one kept message to the receiver, through the service.
export type HandOver = (kept: KeptMessage) => Promise<void>;

// Where the ranges start: rooms count down from the range's last number and people up from its first, clear
// of the ranges other providers declare (policy/discord.toml).
const roomStart = discordPolicy.numbering.rooms.last;
const personStart = discordPolicy.numbering.people.first;

const schema = `
  CREATE TABLE IF NOT EXISTS rooms (
    room_id TEXT PRIMARY KEY,
    chat_id INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS people (
    user_id TEXT PRIMARY KEY,
    sender_id INTEGER NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS message_numbers (
    chat_id INTEGER NOT NULL,
    native_id TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    PRIMARY KEY (chat_id, native_id),
    UNIQUE (chat_id, message_id)
  );
  CREATE TABLE IF NOT EXISTS message_marks (
    chat_id INTEGER PRIMARY KEY,
    highest INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS handed_over (
    chat_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    sender_id INTEGER,
    PRIMARY KEY (chat_id, message_id)
  );
  CREATE TABLE IF NOT EXISTS room_voices (
    chat_id INTEGER PRIMARY KEY,
    voice TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS private_rooms (
    chat_id INTEGER PRIMARY KEY,
    sender_id INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS guild_rooms (
    chat_id INTEGER PRIMARY KEY,
    guild_id TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS guild_rooms_by_guild ON guild_rooms (guild_id);
  CREATE TABLE IF NOT EXISTS owner_rooms (
    chat_id INTEGER PRIMARY KEY
  );
  CREATE TABLE IF NOT EXISTS room_writers (
    chat_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    PRIMARY KEY (chat_id, sender_id)
  );
  CREATE TABLE IF NOT EXISTS owner_sends (
    chat_id INTEGER NOT NULL,
    native_id TEXT NOT NULL,
    voice TEXT NOT NULL,
    PRIMARY KEY (chat_id, native_id)
  );
`;

export class Store {
  private readonly db: Database;

  // `handOver` is how a message the store keeps of its own accord reaches the receiver.
  constructor(folder: string, private readonly handOver: HandOver) {
    mkdirSync(folder, { recursive: true });
    this.db = new Database(join(folder, "discord.sqlite"), { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(schema);
  }

  close(): void {
    this.db.close();
  }

  // The furthest a counter has reached, or null before it gave anything out.
  private counter(name: string): number | null {
    const row = this.db.query("SELECT value FROM counters WHERE name = $name").get({ name }) as { value: number } | null;

    return row?.value ?? null;
  }

  private setCounter(name: string, value: number): void {
    this.db.query("INSERT INTO counters (name, value) VALUES ($name, $value) ON CONFLICT (name) DO UPDATE SET value = excluded.value")
      .run({ name, value });
  }

  providerNumbers() {
    const db = this.db;

    return {
      // The room's number, given on first sight, one below the lowest ever given; a title, where one is
      // named, is written down beside it.
      providerChatId: async (_provider: string, roomId: string, title: string): Promise<number> =>
        db.transaction(() => {
          const known = db.query("SELECT chat_id FROM rooms WHERE room_id = $roomId").get({ roomId }) as { chat_id: number } | null;

          if (known !== null) {
            if (title !== "") {
              db.query("UPDATE rooms SET title = $title WHERE room_id = $roomId").run({ title, roomId });
            }

            return known.chat_id;
          }

          const lowest = this.counter("room");
          const chatId = lowest === null ? roomStart : lowest - 1;

          db.query("INSERT INTO rooms (room_id, chat_id, title) VALUES ($roomId, $chatId, $title)").run({ roomId, chatId, title });
          this.setCounter("room", chatId);

          return chatId;
        })(),

      // The room number of a channel already numbered, or null where none is: nothing is given out.
      knownChatId: async (_provider: string, roomId: string): Promise<number | null> => {
        const row = db.query("SELECT chat_id FROM rooms WHERE room_id = $roomId").get({ roomId }) as { chat_id: number } | null;

        return row?.chat_id ?? null;
      },

      // The channel behind a room number, or null where the number is not one of this provider's rooms.
      providerRoom: async (_provider: string, chatId: number): Promise<string | null> => {
        const row = db.query("SELECT room_id FROM rooms WHERE chat_id = $chatId").get({ chatId }) as { room_id: string } | null;

        return row?.room_id ?? null;
      },

      providerRooms: async (_provider: string): Promise<{ roomId: string; chatId: number; title: string }[]> => {
        const rows = db.query("SELECT room_id, chat_id, title FROM rooms ORDER BY chat_id DESC").all() as {
          room_id: string;
          chat_id: number;
          title: string;
        }[];

        return rows.map((row) => ({ roomId: row.room_id, chatId: row.chat_id, title: row.title }));
      },

      // The number of a person already numbered, or null where none is: nothing is given out.
      knownSenderId: async (_provider: string, userId: string): Promise<number | null> => {
        const row = db.query("SELECT sender_id FROM people WHERE user_id = $userId").get({ userId }) as { sender_id: number } | null;

        return row?.sender_id ?? null;
      },

      // A person's number, given on first sight, one above the highest ever given.
      providerSenderId: async (_provider: string, userId: string): Promise<number> =>
        db.transaction(() => {
          const known = db.query("SELECT sender_id FROM people WHERE user_id = $userId").get({ userId }) as { sender_id: number } | null;

          if (known !== null) {
            return known.sender_id;
          }

          const highest = this.counter("person");
          const senderId = highest === null ? personStart : highest + 1;

          db.query("INSERT INTO people (user_id, sender_id) VALUES ($userId, $senderId)").run({ userId, senderId });
          this.setCounter("person", senderId);

          return senderId;
        })(),
    };
  }

  messages() {
    const db = this.db;

    const messageIdOf = async (_provider: string, chatId: number, nativeId: string): Promise<number | null> => {
      const row = db.query("SELECT message_id FROM message_numbers WHERE chat_id = $chatId AND native_id = $nativeId")
        .get({ chatId, nativeId }) as { message_id: number } | null;

      return row?.message_id ?? null;
    };

    // Marks a message as handed over; false where it already was.
    const markHandedOver = (kept: Pick<KeptMessage, "chatId" | "messageId" | "message">): boolean =>
      db.query("INSERT INTO handed_over (chat_id, message_id, sender_id) VALUES ($chatId, $messageId, $senderId) ON CONFLICT DO NOTHING")
        .run({ chatId: kept.chatId, messageId: kept.messageId, senderId: kept.message.senderId }).changes > 0;

    const unmarkHandedOver = (kept: Pick<KeptMessage, "chatId" | "messageId">): void => {
      db.query("DELETE FROM handed_over WHERE chat_id = $chatId AND message_id = $messageId")
        .run({ chatId: kept.chatId, messageId: kept.messageId });
    };

    return {
      // The message's number, given on first sight: counting up from one within the room, past the highest
      // the room was ever given, so a number is never given twice.
      assignMessageId: async (provider: string, chatId: number, nativeId: string): Promise<number> => {
        const known = await messageIdOf(provider, chatId, nativeId);

        if (known !== null) {
          return known;
        }

        return db.transaction(() => {
          const mark = db.query("SELECT highest FROM message_marks WHERE chat_id = $chatId").get({ chatId }) as { highest: number } | null;
          const messageId = Math.max(mark?.highest ?? 0, 0) + 1;

          db.query("INSERT INTO message_numbers (chat_id, native_id, message_id) VALUES ($chatId, $nativeId, $messageId)")
            .run({ chatId, nativeId, messageId });
          db.query(
            "INSERT INTO message_marks (chat_id, highest) VALUES ($chatId, $messageId) ON CONFLICT (chat_id) DO UPDATE SET highest = MAX(highest, excluded.highest)",
          ).run({ chatId, messageId });

          return messageId;
        })();
      },

      // The number the store holds that message under, or null where it has never seen it. A reply aimed at
      // a message that never reached here points at nothing, and that is what null says.
      messageIdOf,

      // The platform's own id for a message the store numbered, which is what a reply target, an edit, a
      // reaction or a pin has to name.
      nativeMessageId: async (_provider: string, chatId: number, messageId: number): Promise<string | null> => {
        const row = db.query("SELECT native_id FROM message_numbers WHERE chat_id = $chatId AND message_id = $messageId")
          .get({ chatId, messageId }) as { native_id: string } | null;

        return row?.native_id ?? null;
      },

      // A message kept of the store's own accord — the agent's own words read back — handed over once, where
      // it was not already. Returns whether it was handed over now.
      insertMessageIfAbsent: async (kept: KeptMessage): Promise<boolean> => {
        if (!markHandedOver(kept)) {
          return false;
        }

        try {
          await this.handOver(kept);
        } catch (error) {
          unmarkHandedOver(kept);
          throw error;
        }

        return true;
      },

      // Marks a message as handed over as the provider hands it on; false where it already was, and
      // nothing is handed over twice.
      markHandedOver,

      // Takes the mark off again where the hand-over did not go, so the next socket offers it again.
      unmarkHandedOver,

      // Writes down that a message went out through the owner's account, in this voice.
      markOwnerSend: async (_provider: string, chatId: number, nativeId: string, voice: string): Promise<void> => {
        db.query("INSERT INTO owner_sends (chat_id, native_id, voice) VALUES ($chatId, $nativeId, $voice) ON CONFLICT DO NOTHING")
          .run({ chatId, nativeId, voice });
      },

      // The voice a message went out in through the owner's account, or null where it did not go out that way.
      ownerSendVoice: async (_provider: string, chatId: number, nativeId: string): Promise<string | null> => {
        const row = db.query("SELECT voice FROM owner_sends WHERE chat_id = $chatId AND native_id = $nativeId")
          .get({ chatId, nativeId }) as { voice: string } | null;

        return row?.voice ?? null;
      },
    };
  }

  chats() {
    const db = this.db;

    return {
      // The voice the provider answers this room with, or null where it has never said.
      roomVoice: async (_provider: string, chatId: number): Promise<string | null> => {
        const row = db.query("SELECT voice FROM room_voices WHERE chat_id = $chatId").get({ chatId }) as { voice: string } | null;

        return row?.voice ?? null;
      },

      // Writes the voice down over whatever stood.
      setRoomVoice: async (_provider: string, chatId: number, voice: string): Promise<void> => {
        db.query(
          `INSERT INTO room_voices (chat_id, voice) VALUES ($chatId, $voice)
            ON CONFLICT (chat_id) DO UPDATE SET voice = excluded.voice`,
        ).run({ chatId, voice });
      },

      // The person a room is a one-to-one with the agent with, or null where the provider has not written
      // that it is one.
      privateRoomPerson: async (_provider: string, chatId: number): Promise<number | null> => {
        const row = db.query("SELECT sender_id FROM private_rooms WHERE chat_id = $chatId").get({ chatId }) as { sender_id: number } | null;

        return row?.sender_id ?? null;
      },

      // Writes down that a room is a one-to-one with the agent, with this person; a person with no number
      // leaves nothing written.
      setPrivateRoom: async (_provider: string, chatId: number, senderId: number | null): Promise<void> => {
        if (senderId === null) {
          return;
        }

        db.query(
          "INSERT INTO private_rooms (chat_id, sender_id) VALUES ($chatId, $senderId) ON CONFLICT (chat_id) DO UPDATE SET sender_id = excluded.sender_id",
        ).run({ chatId, senderId });
      },

      // The DM rooms that are a one-to-one with the agent with this person.
      privateRoomsOf: async (_provider: string, senderId: number): Promise<number[]> =>
        (db.query("SELECT chat_id FROM private_rooms WHERE sender_id = $senderId").all({ senderId }) as { chat_id: number }[])
          .map((row) => row.chat_id),

      // Writes down the guild a guild channel's room belongs to.
      setRoomGuild: async (_provider: string, chatId: number, guildId: string): Promise<void> => {
        db.query(
          "INSERT INTO guild_rooms (chat_id, guild_id) VALUES ($chatId, $guildId) ON CONFLICT (chat_id) DO UPDATE SET guild_id = excluded.guild_id",
        ).run({ chatId, guildId });
      },

      // The rooms of a guild's channels the provider has numbered.
      guildRooms: async (_provider: string, guildId: string): Promise<number[]> =>
        (db.query("SELECT chat_id FROM guild_rooms WHERE guild_id = $guildId").all({ guildId }) as { chat_id: number }[])
          .map((row) => row.chat_id),

      // Writes down that the owner's account has been heard in a room, which shows it is in the room.
      markOwnerHeard: async (_provider: string, chatId: number): Promise<void> => {
        db.query("INSERT INTO owner_rooms (chat_id) VALUES ($chatId) ON CONFLICT DO NOTHING").run({ chatId });
      },

      // Writes down that a person was heard writing in a room.
      markWriter: async (_provider: string, chatId: number, senderId: number): Promise<void> => {
        db.query("INSERT INTO room_writers (chat_id, sender_id) VALUES ($chatId, $senderId) ON CONFLICT DO NOTHING")
          .run({ chatId, senderId });
      },

      // The Discord accounts of everyone heard writing in a room, in the order they were first heard.
      roomWriters: async (_provider: string, chatId: number): Promise<string[]> =>
        (db.query(
          `SELECT people.user_id FROM room_writers JOIN people ON people.sender_id = room_writers.sender_id
            WHERE room_writers.chat_id = $chatId ORDER BY room_writers.rowid`,
        ).all({ chatId }) as { user_id: string }[]).map((row) => row.user_id),

      // Whether the owner's account has been heard in a room.
      ownerHeard: async (_provider: string, chatId: number): Promise<boolean> =>
        db.query("SELECT 1 FROM owner_rooms WHERE chat_id = $chatId").get({ chatId }) !== null,
    };
  }
}
