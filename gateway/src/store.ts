// The provider's own numbers (docs/discord.md, 「Numbering」): a Discord id is a snowflake, larger than a
// number holds exactly, so every channel, person and message is given a number here and the snowflake stays a
// string. The store also keeps which messages have been handed over, so a message two sockets read goes once,
// the voice each room is answered by, and the one person of each DM channel. It is this provider's alone, so
// the provider key each call names is always this provider's.

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { ChatMessage, ChatVoice } from "./chat";

// A message as the store keeps it and as it is handed over, less what only a hand-over carries.
export interface ArchivedMessage {
  chatId: number;
  messageId: number;
  senderId: number | null;
  senderName: string;
  sentAt: number;
  text: string;
  replyToMessageId: number | null;
  via: string;
  // The mode that delivered it.
  mode: ChatVoice;
}

// Hands one kept message to the receiver, through the service.
export type HandOver = (message: ChatMessage) => Promise<void>;

// Where the ranges start: rooms count down from the first and people up from the second, clear of the ranges
// other providers hold.
const firstRoom = -8_000_000_000_000;
const firstPerson = 8_000_000_000_000;

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
          const chatId = lowest === null ? firstRoom : lowest - 1;

          db.query("INSERT INTO rooms (room_id, chat_id, title) VALUES ($roomId, $chatId, $title)").run({ roomId, chatId, title });
          this.setCounter("room", chatId);

          return chatId;
        })(),

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

      // A person's number, given on first sight, one above the highest ever given.
      providerSenderId: async (_provider: string, userId: string): Promise<number> =>
        db.transaction(() => {
          const known = db.query("SELECT sender_id FROM people WHERE user_id = $userId").get({ userId }) as { sender_id: number } | null;

          if (known !== null) {
            return known.sender_id;
          }

          const highest = this.counter("person");
          const senderId = highest === null ? firstPerson : highest + 1;

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
    const markHandedOver = (message: Pick<ArchivedMessage, "chatId" | "messageId" | "senderId">): boolean =>
      db.query("INSERT INTO handed_over (chat_id, message_id, sender_id) VALUES ($chatId, $messageId, $senderId) ON CONFLICT DO NOTHING")
        .run({ chatId: message.chatId, messageId: message.messageId, senderId: message.senderId }).changes > 0;

    const unmarkHandedOver = (message: Pick<ArchivedMessage, "chatId" | "messageId">): void => {
      db.query("DELETE FROM handed_over WHERE chat_id = $chatId AND message_id = $messageId")
        .run({ chatId: message.chatId, messageId: message.messageId });
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

      // A message already handed over, with the sender it was handed over under, or null.
      getMessage: async (chatId: number, messageId: number): Promise<{ senderId: number | null } | null> => {
        const row = db.query("SELECT sender_id FROM handed_over WHERE chat_id = $chatId AND message_id = $messageId")
          .get({ chatId, messageId }) as { sender_id: number | null } | null;

        return row === null ? null : { senderId: row.sender_id };
      },

      // A message kept of the store's own accord — the agent's own words read back, a send in the avatar
      // voice, words read beside the account that answers the room — handed over once, where it was not
      // already. Returns whether it was handed over now.
      insertMessageIfAbsent: async (message: ArchivedMessage): Promise<boolean> => {
        if (!markHandedOver(message)) {
          return false;
        }

        try {
          await this.handOver({ ...message, album: null });
        } catch (error) {
          unmarkHandedOver(message);
          throw error;
        }

        return true;
      },

      // Marks a message as handed over as the provider hands it on; false where it already was, and
      // nothing is handed over twice.
      markHandedOver,

      // Takes the mark off again where the hand-over did not go, so the next socket offers it again.
      unmarkHandedOver,
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

      // Writes the voice down. `settle` false leaves a voice already written in place, which is how a voice
      // that only answers where no other reaches is kept from displacing one that does.
      setRoomVoice: async (_provider: string, chatId: number, voice: string, settle = true): Promise<void> => {
        db.query(
          `INSERT INTO room_voices (chat_id, voice) VALUES ($chatId, $voice)
            ON CONFLICT (chat_id) DO ${settle ? "UPDATE SET voice = excluded.voice" : "NOTHING"}`,
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
    };
  }
}
