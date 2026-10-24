// Browser-independent implementation so signature/authentication tests run in Node.
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});
const snowflake = value => typeof value === "string" && /^[1-9][0-9]{16,19}$/.test(value);
const bytesFromHex = value => Uint8Array.from(value.match(/../g), part => parseInt(part, 16));
const noMentions = { parse: [] };

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 65536) { await reader.cancel(); throw new Error("too large"); }
    parts.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

function readableError(message) {
  const allowed = [
    "Your Discord account is not linked yet.", "The schedule changed or this date has finished.",
    "These controls expired.", "Open the current pinned schedule message.",
    "Arrival adjustments must stay within 24 hours.", "This schedule is not connected to this Discord channel.",
  ];
  return typeof message === "string" && allowed.some(prefix => message.startsWith(prefix))
    ? message : "Your reply could not be saved. Please try again or use the website.";
}

export function createHandler({ publicKey, applicationId, supabaseUrl, serviceKey,
  waitUntil, fetchImpl = fetch, cryptoImpl = crypto, now = Date.now, log = console.error }) {
  let importedKey;
  const configured = /^[0-9a-f]{64}$/i.test(publicKey || "") && snowflake(applicationId)
    && /^https:\/\/[^/]+$/.test(supabaseUrl || "") && !!serviceKey;

  async function rpc(name, args) {
    const result = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "content-type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      body: JSON.stringify(args),
    });
    const data = await result.json();
    if (!result.ok) throw new Error(readableError(data?.message));
    return data;
  }

  async function complete(interaction) {
    const event = {
      interaction_id: interaction.id, application_id: interaction.application_id,
      guild_id: interaction.guild_id, channel_id: interaction.channel_id,
      discord_id: interaction.member.user.id, message_id: interaction.message.id,
      custom_id: interaction.data.custom_id, values: interaction.data.values || [],
    };
    let data;
    try { data = await rpc("cast_discord_interaction", { p_event: event }); }
    catch (error) { data = { content: readableError(error.message), components: [], allowed_mentions: noMentions }; }
    try {
      const response = await fetchImpl(`https://discord.com/api/v10/webhooks/${applicationId}/${encodeURIComponent(interaction.token)}/messages/@original`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify(data), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) log("Discord private confirmation failed", response.status);
    } catch { log("Discord private confirmation unavailable"); }
    // Public card refresh is independent of confirmation delivery. Cron also retries.
    try { await rpc("cast_discord_refresh", { p_application_id: applicationId, p_guild_id: event.guild_id, p_channel_id: event.channel_id }); }
    catch { log("Discord schedule refresh deferred to cron"); }
  }

  return async function handler(request) {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!configured) return json({ error: "Discord voting is not configured" }, 503);
    const signature = request.headers.get("x-signature-ed25519") || "";
    const timestamp = request.headers.get("x-signature-timestamp") || "";
    if (!/^[0-9a-f]{128}$/i.test(signature) || !/^\d{10,11}$/.test(timestamp)
      || Math.abs(now() / 1000 - Number(timestamp)) > 300) return json({ error: "Invalid signature" }, 401);
    let body;
    try { body = await readBody(request); } catch { return json({ error: "Request too large" }, 413); }
    const prefix = new TextEncoder().encode(timestamp);
    const signed = new Uint8Array(prefix.length + body.length); signed.set(prefix); signed.set(body, prefix.length);
    try {
      importedKey ||= cryptoImpl.subtle.importKey("raw", bytesFromHex(publicKey), { name: "Ed25519" }, false, ["verify"]);
      if (!await cryptoImpl.subtle.verify("Ed25519", await importedKey, bytesFromHex(signature), signed)) return json({ error: "Invalid signature" }, 401);
    } catch { return json({ error: "Invalid signature" }, 401); }
    let interaction;
    try { interaction = JSON.parse(new TextDecoder().decode(body)); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (interaction.application_id !== applicationId) return json({ error: "Wrong application" }, 403);
    if (interaction.type === 1) return json({ type: 1 });
    if (interaction.type !== 3) return json({ type: 4, data: { content: "Use the buttons on the pinned schedule.", flags: 64, allowed_mentions: noMentions } });
    if (!snowflake(interaction.id) || !snowflake(interaction.guild_id) || !snowflake(interaction.channel_id)
      || !snowflake(interaction.member?.user?.id) || !snowflake(interaction.message?.id)
      || typeof interaction.data?.custom_id !== "string" || interaction.data.custom_id.length > 100
      || !/^[A-Za-z0-9._-]{10,2048}$/.test(interaction.token || "")
      || (interaction.data.values !== undefined && (!Array.isArray(interaction.data.values)
        || interaction.data.values.length > 1 || interaction.data.values.some(value => typeof value !== "string" || value.length > 100)))) {
      return json({ error: "Invalid interaction" }, 400);
    }
    // Acknowledge immediately, before any database or Discord network request.
    const task = complete(interaction).catch(() => log("Discord interaction failed"));
    if (waitUntil) waitUntil(task); else await task;
    // Edits inside the private panel keep the same message and selected-day controls.
    return /^cast:[ps]:/.test(interaction.data.custom_id)
      ? json({ type: 6 }) : json({ type: 5, data: { flags: 64 } });
  };
}
