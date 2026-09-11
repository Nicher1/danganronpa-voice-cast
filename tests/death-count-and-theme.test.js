const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");

const helperStart = html.indexOf("function countRecordedDeathsForActor");
const helperEnd = html.indexOf("document.body.classList", helperStart);
assert.ok(helperStart > 0 && helperEnd > helperStart, "Death-count helpers are missing");
const helpers = vm.runInNewContext(
  `${html.slice(helperStart, helperEnd)};({countRecordedDeathsForActor,synchroniseActorDeathCounts})`
);

const board = {
  actors: [
    { id: "md", name: "MD", deathCount: 99 },
    { id: "nicher", name: "Nicher", deathCount: 99 }
  ],
  roles: [
    { id: "hifumi", gameId: "dr1", dead: true, deathRecorded: true, deathActorId: "md" },
    { id: "taka", gameId: "dr1", dead: true, deathRecorded: true, deathActorId: "nicher" },
    { id: "old", gameId: "dr2", dead: true, deathRecorded: true, deathActorId: "md" }
  ]
};

assert.equal(helpers.countRecordedDeathsForActor(board, "md"), 2);
assert.equal(helpers.countRecordedDeathsForActor(board, "md", "dr1"), 1);
helpers.synchroniseActorDeathCounts(board);
assert.equal(board.actors[0].deathCount, 2, "Stored totals must be repaired from current Memorial records");

board.roles[0].dead = false;
helpers.synchroniseActorDeathCounts(board);
assert.equal(board.actors[0].deathCount, 1, "Reviving Hifumi must subtract one immediately");

board.roles[0].dead = true;
board.roles[0].deathActorId = "md";
helpers.synchroniseActorDeathCounts(board);
assert.equal(board.actors[0].deathCount, 2, "Recording Hifumi's death again must add one back");

assert.ok(html.includes('id="uiThemeSelect"'), "Every visitor needs a personal theme selector");
assert.ok(html.includes('id="defaultThemeSelect"'), "Admin Tools needs a shared default-theme selector");
assert.ok(html.includes('danganronpa-cast-ui-theme-v1'), "Personal theme preference needs isolated device storage");
assert.ok(html.includes('data-ui-theme="reworked"'), "The reworked live-board theme is missing");
assert.ok(html.includes('state.settings.defaultUiTheme'), "Shared default theme must live with board settings");
assert.ok(html.includes('role.dead&&role.deathRecorded&&role.deathActorId===actorId'), "Only characters currently in Memorial may count as deaths");
assert.ok(html.includes('class="original-brand-shell"'), "The Original interface needs its own preserved header");
assert.ok(html.includes('class="reworked-brand-shell"'), "The Reworked interface needs a separate header composition");
assert.ok(html.includes('class="reworked-monokuma-mark"'), "The Reworked header needs the correct Monokuma emblem");
assert.ok(!html.includes('<img src="assets/monopad/dr1/monokuma.png" alt="">'), "The cropped Monokuma portrait must not be used as the brand mark");
assert.ok(html.includes('html[data-ui-theme="reworked"] .actors-grid{grid-template-columns:repeat(2,minmax(0,1fr))'), "Reworked must use the prototype's readable two-column actor layout");
assert.ok(html.includes('Two presentation layers share the same live board'), "Theme implementations must explicitly share the live board");

const design = fs.readFileSync("design-preview.html", "utf8");
assert.ok(design.includes("function syncDeathCounts()"), "The isolated redesign must also derive live death totals");
assert.ok(!design.includes("actor.deathCount++"), "The redesign must not keep a stale increment-only counter");

console.log("Memorial-derived death totals and switchable theme checks passed.");
