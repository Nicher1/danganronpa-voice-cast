const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("supabase-sync.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const sql = fs.readFileSync("supabase-schema.sql", "utf8");

const trackCalls = [];
const rpcCalls = [];
let untrackCalls = 0;
const channel = {
  state: {},
  presenceHandlers: {},
  statusHandler: null,
  on(type, filter, handler) {
    if (type === "presence") this.presenceHandlers[filter.event] = handler;
    return this;
  },
  subscribe(handler) {
    this.statusHandler = handler;
    return this;
  },
  presenceState() {
    return this.state;
  },
  async track(payload) {
    trackCalls.push(payload);
  },
  async untrack() {
    untrackCalls += 1;
  }
};

const fakeClient = {
  channelName: "",
  channelOptions: null,
  channel(name, options) {
    this.channelName = name;
    this.channelOptions = options;
    return channel;
  },
  removeChannel() {},
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === "cast_presence_activity") return { data: [{ actor_id: "actor-a" }], error: null };
    if (name === "cast_keep_alive") return { data: "2026-09-09T12:00:00Z", error: null };
    return { data: "2026-09-09T12:00:00Z", error: null };
  }
};

const context = {
  window: {
    crypto: { randomUUID: () => "presence-session" },
    supabase: { createClient: () => fakeClient }
  },
  Date,
  Math,
  Object,
  Set,
  String,
  console,
  setInterval,
  clearInterval
};
vm.runInNewContext(source, context, { filename: "supabase-sync.js" });

(async () => {
  const sync = new context.window.CastSupabaseSync({
    url: "https://example.supabase.co",
    publishableKey: "publishable",
    boardSlug: "test-board"
  });

  let onlineActorIds = [];
  sync.subscribePresence("actor-a", actorIds => { onlineActorIds = actorIds; });
  assert.equal(fakeClient.channelName, "cast-presence-test-board");
  assert.equal(fakeClient.channelOptions.config.presence.key, "presence-session");

  await channel.statusHandler("SUBSCRIBED");
  assert.equal(trackCalls.at(-1).actor_id, "actor-a");
  assert.equal(rpcCalls.at(-1).name, "cast_presence_start");

  channel.state = {
    one: [{ actor_id: "actor-a" }],
    two: [{ actor_id: "actor-b" }, { actor_id: "actor-a" }]
  };
  channel.presenceHandlers.sync();
  assert.deepEqual([...onlineActorIds].sort(), ["actor-a", "actor-b"]);

  channel.state.three = [{ actor_id: "actor-c" }];
  channel.presenceHandlers.join();
  assert.deepEqual([...onlineActorIds].sort(), ["actor-a", "actor-b", "actor-c"]);

  channel.state = { one: [{ actor_id: "actor-a" }] };
  channel.presenceHandlers.leave();
  assert.deepEqual([...onlineActorIds], ["actor-a"]);

  await sync.setPresenceActor("actor-c");
  assert.equal(trackCalls.at(-1).actor_id, "actor-c");
  assert.ok(rpcCalls.some(call => call.name === "cast_presence_touch" && call.args.p_ended === true));
  await sync.setPresenceActor(null);
  assert.equal(untrackCalls, 1);

  assert.equal(await sync.keepAlive(), "2026-09-09T12:00:00Z");
  assert.deepEqual(Array.from(await sync.getPresenceActivity(7), row => row.actor_id), ["actor-a"]);

  assert.ok(html.includes(".actor-card.online"));
  assert.ok(html.includes("actor-online-indicator"));
  assert.ok(html.includes("Currently logged in"));
  assert.ok(html.includes("remoteSync.subscribePresence("));
  assert.ok(html.includes('id="activityOverview"'));
  assert.ok(html.includes('id="wakeDatabaseBtn"'));
  assert.ok(html.includes("function renderActivityOverview"));
  assert.ok(sql.includes("create table if not exists public.cast_presence_sessions"));
  assert.ok(sql.includes("public.cast_presence_activity"));
  assert.ok(sql.includes("public.cast_keep_alive"));
  console.log("Realtime and historical actor presence checks passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
