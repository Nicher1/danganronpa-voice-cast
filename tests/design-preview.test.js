const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("design-preview.html", "utf8");

for (const view of ["assignments", "memorial", "statistics", "monopad", "admin"]) {
  assert.ok(html.includes(`data-tab="${view}"`), `Missing navigation control for ${view}`);
  assert.ok(html.includes(`id="${view}Tab"`), `Missing panel for ${view}`);
}

assert.ok(html.includes("Trigger Happy Havoc"), "DR1 must remain the active game");
assert.ok(html.includes('aria-label="Danganronpa — Monokuma"'), "The header should use the Danganronpa Monokuma mark");
assert.ok(!html.includes("<b>V/C</b>"), "The old V/C placeholder mark must not return");
assert.ok(html.includes("assets/monopad/dr1/celestia-ludenberg.jpeg"), "The assignment screen should use character artwork");
assert.ok(html.includes("id=\"wakeButton\""));
assert.ok(html.includes("id=\"resetButton\""));
assert.ok(html.includes('id="chapterSelect"'), "Direct chapter selection must remain available");
assert.ok(html.includes('id="trialToggle"'), "Chapter Trial state must remain controllable");
assert.ok(html.includes('id="modeSelect"'), "Master, player, and viewer previews must remain available");
assert.ok(html.includes('id="predictionDock"'), "Player predictions must remain represented");
assert.ok(html.includes('id="spoilerVault"'), "The host spoiler vault must remain represented");
assert.ok(html.includes('id="importInput"') && html.includes('id="exportButton"'), "Sample import/export controls are required");

for (const stateFunction of [
  "rolesForActor", "openRoles", "assignRole", "unassignRole", "toggleLock",
  "killRole", "reviveRole", "toggleResult", "setChapter"
]) {
  assert.ok(html.includes(`function ${stateFunction}(`), `Missing normalized state function ${stateFunction}`);
}

assert.ok(html.includes("ownerId"), "Role ownership must have a single normalized source of truth");
assert.ok(html.includes('data-assigned-role="'), "Actor cards must render their individual assigned roles");
assert.ok(html.includes('data-unassign="'), "Every assigned role must expose its own unassign control");
assert.ok(html.includes('data-revive="'), "Memorial entries must expose revive controls");
assert.ok(html.includes("trialByChapter"), "Each chapter must preserve its own Trial state");
assert.ok(html.includes("dvc-design-preview:v4"), "The isolated preview must use its own storage namespace");
assert.ok(html.includes("function moveRoleToActor("), "Replacement transfers need one normalized move function");
assert.ok(html.includes("data-take-role=\""), "Eligible unavailable roles need a replacement-star control");
assert.ok(html.includes("target.replacementToken=false"), "A replacement takeover must consume the star");
assert.ok(html.includes("source.lockedRoleId===r.id"), "Locked roles must stay protected from replacement takeovers");
assert.ok(html.includes("data-drag-role=\""), "Character portraits must expose the phone drag interaction");
assert.ok(html.includes('data-open-profile="'), "Character portraits must open their Monopad entry");
assert.ok(html.includes('addEventListener("pointermove"'), "Phone drag needs pointer-based movement support");
assert.ok(html.includes('id="mobileActorDock"'), "Phone drag needs visible sticky actor drop targets");
assert.ok(html.includes('addEventListener("dragstart"') && html.includes('addEventListener("drop"'), "Native drag fallback is required");
assert.ok(html.includes("function actorScore("), "Actor-level Hope/Despair scoring is required");
assert.ok(html.includes("function renderHopeTimeline("), "Chapter-by-chapter Hope graph is required");
assert.ok(html.includes("function renderPopulation("), "Editable population statistics are required");
assert.ok(html.includes("data-pop-step=\""), "Master population values need direct controls");
assert.ok(html.includes("completedChapters"), "Story recaps must distinguish active and completed chapters");
assert.ok(html.includes("CAST_MONOPAD_DATA.recaps"), "Monopad must use the full story summaries");
assert.ok(html.includes("@keyframes float-in"), "Section changes need restrained motion");

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.strictEqual(scripts.length, 1, "Expected one inline prototype script");
new vm.Script(scripts[0]);

const production = fs.readFileSync("index.html", "utf8");
assert.ok(!production.includes("dvc-design-preview:v4"), "Prototype state must never leak into the live interface");

console.log("Interactive Danganronpa design preview checks passed.");
