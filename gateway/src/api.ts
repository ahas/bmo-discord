// What this road says to Discord. One base address, one header, and a call per verb; the gateway
// only listens, and everything the agent does in a room goes out through here.
//
// Written plainly rather than through a library: each call is the endpoint the platform documents
// and the body it takes, so what this machine sends can be read off the page.

// Discord's REST address, or the one `BMO_DISCORD_API_URL` names in its place, as a stand-in's in the tests.
function apiBase(): string {
  const named = process.env.BMO_DISCORD_API_URL;

  return named === undefined || named === "" ? "https://discord.com/api/v10" : named;
}

// Every call waits for Discord's answer, however long: no idle timer of Bun's cuts it, and the socket's TCP
// keep-alive tells a Discord that has gone from one still answering.

// The token a call carries, and whether it is the application's bot token, which goes under the `Bot`
// scheme; a user token goes bare.
export interface DiscordCall {
  token: string;
  bot: boolean;
}

export function authorization(api: DiscordCall): string {
  return api.bot ? `Bot ${api.token}` : api.token;
}

// A call Discord answered with a failure: the status it answered with, and the code of Discord's own its body
// carried, or null where it carried none.
export class DiscordAnswered extends Error {
  readonly code: number | null;

  constructor(readonly status: number, what: string, body: string) {
    super(`Discord ${what} answered ${status}: ${body}`);
    this.code = codeOf(body);
  }
}

// The code Discord's error body names, or null where the body is not Discord's error object.
function codeOf(body: string): number | null {
  try {
    const parsed: unknown = JSON.parse(body);

    return typeof parsed === "object" && parsed !== null && "code" in parsed && typeof parsed.code === "number"
      ? parsed.code
      : null;
  } catch {
    return null;
  }
}

// Discord's codes for a person a guild does not hold: no member of it, and no account at all.
const unknownMember = 10007;
const unknownUser = 10013;

// A Discord user as a call answers one: the id, and the names Discord shows, each null where it gives none.
export interface DiscordUser {
  id: string;
  username: string | null;
  globalName: string | null;
}

function userOf(value: unknown): DiscordUser | null {
  if (typeof value !== "object" || value === null || !("id" in value) || typeof value.id !== "string") {
    return null;
  }

  const named = (key: string): string | null => {
    const name: unknown = (value as Record<string, unknown>)[key];

    return typeof name === "string" && name !== "" ? name : null;
  };

  return { id: value.id, username: named("username"), globalName: named("global_name") };
}

async function call(
  api: DiscordCall,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      authorization: authorization(api),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    timeout: false,
  });

  if (!response.ok) {
    throw new DiscordAnswered(response.status, `${method} ${path}`, await response.text());
  }

  const answer: unknown = await response.json().catch(async () => null);

  return typeof answer === "object" && answer !== null && !Array.isArray(answer)
    ? (answer as Record<string, unknown>)
    : null;
}

// The id of the message that went out, or null where the platform answered without one.
function idOf(answer: Record<string, unknown> | null): string | null {
  return typeof answer?.id === "string" ? answer.id : null;
}

export async function sendMessage(
  api: DiscordCall,
  channelId: string,
  content: string,
  replyToId: string | null = null,
  nonce: string | null = null,
): Promise<string | null> {
  return idOf(await call(api, "POST", `/channels/${channelId}/messages`, {
    content,
    // The platform passes the nonce on with the message it makes, which is how the message is known as this
    // provider's own when it comes back down the socket.
    ...(nonce === null ? {} : { nonce }),
    // `fail_if_not_exists: false` is what keeps an answer from being refused whole because the
    // message it points at has been taken down: it goes out loose instead.
    ...(replyToId === null ? {} : { message_reference: { message_id: replyToId, fail_if_not_exists: false } }),
  }));
}

export async function editMessage(
  api: DiscordCall,
  channelId: string,
  messageId: string,
  content: string,
): Promise<void> {
  await call(api, "PATCH", `/channels/${channelId}/messages/${messageId}`, { content });
}

// A picture posted by its address. Discord fetches it itself and shows it under the words, which
// is what an embed is for.
export async function sendImage(
  api: DiscordCall,
  channelId: string,
  imageUrl: string,
  caption: string | undefined,
  replyToId: string | null = null,
): Promise<string | null> {
  return idOf(await call(api, "POST", `/channels/${channelId}/messages`, {
    ...(caption === undefined ? {} : { content: caption }),
    embeds: [{ image: { url: imageUrl } }],
    ...(replyToId === null ? {} : { message_reference: { message_id: replyToId, fail_if_not_exists: false } }),
  }));
}

// A file this machine holds, uploaded with the message it belongs to. It is the one call that is
// not JSON: the platform takes the message as a part named `payload_json` beside the file itself.
export async function sendFile(
  api: DiscordCall,
  channelId: string,
  bytes: Uint8Array,
  fileName: string,
  replyToId: string | null = null,
): Promise<string | null> {
  const form = new FormData();

  form.append("payload_json", JSON.stringify({
    attachments: [{ id: 0, filename: fileName }],
    ...(replyToId === null ? {} : { message_reference: { message_id: replyToId, fail_if_not_exists: false } }),
  }));
  form.append("files[0]", new Blob([bytes as unknown as BlobPart]), fileName);

  const response = await fetch(`${apiBase()}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { authorization: authorization(api) },
    body: form,
    timeout: false,
  });

  if (!response.ok) {
    throw new DiscordAnswered(response.status, "file upload", await response.text());
  }

  return idOf(await response.json().catch(async () => null) as Record<string, unknown> | null);
}

// A sticker of the application's own set, which goes out as a message carrying no words.
export async function sendSticker(api: DiscordCall, channelId: string, stickerId: string): Promise<string | null> {
  return idOf(await call(api, "POST", `/channels/${channelId}/messages`, { sticker_ids: [stickerId] }));
}

// A reaction is put on and taken off by the same path; `@me` is the one this road may touch, since
// a bot may only add and remove its own.
export async function react(
  api: DiscordCall,
  channelId: string,
  messageId: string,
  emoji: string,
  on: boolean,
): Promise<void> {
  const path = `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`;

  await call(api, on ? "PUT" : "DELETE", path);
}

export async function pin(api: DiscordCall, channelId: string, messageId: string, on: boolean): Promise<void> {
  await call(api, on ? "PUT" : "DELETE", `/channels/${channelId}/pins/${messageId}`);
}

// What the platform calls the channel, for a room that has one. A direct message has none, and
// what comes back then is null rather than an invented name.
export async function channelName(api: DiscordCall, channelId: string): Promise<string | null> {
  const channel = await call(api, "GET", `/channels/${channelId}`);

  return typeof channel?.name === "string" ? channel.name : null;
}

// A channel as Discord answers it: whether it is a DM (type 1), the people a DM is with, and the guild a guild's
// channel belongs to, null for a channel of none.
export interface DiscordChannel {
  direct: boolean;
  recipients: DiscordUser[];
  guildId: string | null;
}

export async function channelOf(api: DiscordCall, channelId: string): Promise<DiscordChannel> {
  const channel = await call(api, "GET", `/channels/${channelId}`);
  const recipients: unknown[] = Array.isArray(channel?.recipients) ? channel.recipients : [];

  return {
    direct: channel?.type === 1,
    recipients: recipients.map(userOf).filter((user) => user !== null),
    guildId: typeof channel?.guild_id === "string" ? channel.guild_id : null,
  };
}

// The person a channel is a one-to-one with: its one recipient, where the platform types the channel
// a DM (type 1). Null for any other channel, a group DM (type 3) among them, which is a room of
// several.
export async function directRecipient(api: DiscordCall, channelId: string): Promise<string | null> {
  const channel = await channelOf(api, channelId);

  return channel.direct && channel.recipients.length === 1 ? channel.recipients[0]?.id ?? null : null;
}

// A person as a member of a guild: the user and their nickname there, null where they have none; null where
// Discord says the guild holds no such member or no such account. Asking one member needs no privileged intent.
export async function guildMember(
  api: DiscordCall,
  guildId: string,
  userId: string,
): Promise<{ user: DiscordUser; nick: string | null } | null> {
  let member: Record<string, unknown> | null;

  try {
    member = await call(api, "GET", `/guilds/${guildId}/members/${userId}`);
  } catch (error) {
    if (error instanceof DiscordAnswered && (error.code === unknownMember || error.code === unknownUser)) {
      return null;
    }

    throw error;
  }

  const user = userOf(member?.user);

  if (user === null) {
    return null;
  }

  return { user, nick: typeof member?.nick === "string" && member.nick !== "" ? member.nick : null };
}

// The user a token is, as Discord itself answers, or null where the answer names none.
export async function currentUserNamed(api: DiscordCall): Promise<DiscordUser | null> {
  return userOf(await call(api, "GET", "/users/@me"));
}

// The account a token is, as Discord itself answers: the current user's id, or null where the answer names
// none.
export async function currentUser(api: DiscordCall): Promise<string | null> {
  return (await currentUserNamed(api))?.id ?? null;
}

// The flags of the application a bot token is, as Discord itself answers; none where it names none.
export async function currentApplicationFlags(api: DiscordCall): Promise<number> {
  const application = await call(api, "GET", "/applications/@me");

  return typeof application?.flags === "number" ? application.flags : 0;
}

// The typing state, which lapses by itself after about ten seconds. There is nothing to take back,
// so a road is never asked to stop typing.
export async function typing(api: DiscordCall, channelId: string): Promise<void> {
  await call(api, "POST", `/channels/${channelId}/typing`);
}
