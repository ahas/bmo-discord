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

// A call Discord answered with a failure, and the status it answered with.
export class DiscordAnswered extends Error {
  constructor(readonly status: number, what: string, body: string) {
    super(`Discord ${what} answered ${status}: ${body}`);
  }
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

// The person a channel is a one-to-one with: its one recipient, where the platform types the channel
// a DM (type 1). Null for any other channel, a group DM (type 3) among them, which is a room of
// several.
export async function directRecipient(api: DiscordCall, channelId: string): Promise<string | null> {
  const channel = await call(api, "GET", `/channels/${channelId}`);
  const recipients: unknown[] = Array.isArray(channel?.recipients) ? channel.recipients : [];
  const only = recipients.length === 1 ? recipients[0] : null;

  return channel?.type === 1 && typeof only === "object" && only !== null && "id" in only && typeof only.id === "string" ? only.id : null;
}

// The account a token is, as Discord itself answers: the current user's id, or null where the answer names
// none.
export async function currentUser(api: DiscordCall): Promise<string | null> {
  return idOf(await call(api, "GET", "/users/@me"));
}

// The typing state, which lapses by itself after about ten seconds. There is nothing to take back,
// so a road is never asked to stop typing.
export async function typing(api: DiscordCall, channelId: string): Promise<void> {
  await call(api, "POST", `/channels/${channelId}/typing`);
}
