const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("supabase-sync.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

const trackCalls = [];
let untrackCalls = 0;
const channel = {
  state: {},
  syncHandler: null,
  statusHandler: null,
  on(type, filter, handler) {
    if (type === "presence" && filter.event === "sync") this.syncHandler = handler;
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
  removeChannel() {}
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
  String
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

  channel.state = {
    one: [{ actor_id: "actor-a" }],
    two: [{ actor_id: "actor-b" }, { actor_id: "actor-a" }]
  };
  channel.syncHandler();
  assert.deepEqual([...onlineActorIds].sort(), ["actor-a", "actor-b"]);

  await sync.setPresenceActor("actor-c");
  assert.equal(trackCalls.at(-1).actor_id, "actor-c");
  await sync.setPresenceActor(null);
  assert.equal(untrackCalls, 1);

  assert.ok(html.includes(".actor-card.online"));
  assert.ok(html.includes("actor-online-indicator"));
  assert.ok(html.includes("Currently logged in"));
  assert.ok(html.includes("remoteSync.subscribePresence("));
  console.log("Realtime actor presence checks passed.");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
