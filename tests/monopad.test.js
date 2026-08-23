const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const dataSource = fs.readFileSync("monopad-data.js", "utf8");
const context = { window: {} };
vm.runInNewContext(dataSource, context, { filename: "monopad-data.js" });
const data = context.window.CAST_MONOPAD_DATA;

assert.equal(data.version, 2);
assert.deepEqual(Object.keys(data.recaps).sort(), ["dr1", "dr2", "v3"]);
for (const gameId of ["dr1", "dr2", "v3"]) {
  assert.equal(data.recaps[gameId].length, 6, `${gameId} needs six chapter recap pairs`);
  data.recaps[gameId].forEach((entry, index) => {
    assert.ok(entry.pretrial.length > 120, `${gameId} chapter ${index + 1} needs a pre-Trial recap`);
    assert.ok(entry.full.length > 120, `${gameId} chapter ${index + 1} needs a complete recap`);
  });
}
assert.equal(data.animeRecaps.length, 24, "Anime data must follow all 24 watch-order steps");
data.animeRecaps.forEach((entry, index) => assert.ok(entry.length > 100, `Anime watch step ${index + 1} needs a recap`));

const requiredBioCounts = { dr1: 18, dr2: 18, dr3anime: 21, v3: 22 };
for (const [gameId, minimum] of Object.entries(requiredBioCounts)) {
  assert.ok(Object.keys(data.bios[gameId]).length >= minimum, `${gameId} dossiers are incomplete`);
}
for (const identity of ["Mukuro Ikusaba", "Junko Enoshima", "Genocide Jill", "Byakuya Togami", "K1-B0"]) {
  assert.ok(data.profileImages[identity], `Missing profile artwork for ${identity}`);
}
assert.equal(Object.keys(data.profileOverrides.dr1).length, 17);
for (const [name, asset] of Object.entries(data.profileOverrides.dr1)) {
  assert.ok(fs.existsSync(asset), `Missing supplied DR1 artwork for ${name}: ${asset}`);
}

assert.ok(html.includes('<script src="monopad-data.js?v=2"></script>'));
assert.ok(html.includes('data-tab="monopad"'));
assert.ok(html.includes('id="monopadTab"'));
assert.ok(html.includes('id="dossierDialog"'));
assert.ok(html.includes("function renderMonopad()"));
assert.ok(html.includes("const canExpand=!assigned;"), "Unassigned character details must be public");
assert.ok(html.includes("for(let chapter=1;chapter<current;chapter++)"), "Only earlier game chapters should receive full recaps");
assert.ok(html.includes("if(currentSettings().voiceInTrial)"), "The current pre-Trial recap must be gated by Trial state");
assert.ok(html.includes("monopadData.animeRecaps?.[current-2]"), "Anime must show only the previous watch-order episode");
assert.ok(html.includes('role.specialRole==="junko-disguise"'), "The reversible Junko/Mukuro identity needs a safe dossier override");
assert.ok(html.includes('mkRole("Genocide Jill"'));
assert.ok(html.includes('r.name="Genocide Jill"'), "Existing shared state must migrate to Genocide Jill");
assert.ok(html.includes('r.voiceProfile="Genocide Jack"'), "The renamed card must retain its working voice library profile");
assert.ok(data.bios.dr1["Genocide Jill"]);
assert.doesNotMatch(html, /<h[1-6][^>]*>\s*Chapter [1-6]\s*<\/h[1-6]>/i, "Recap entries should not expose chapter-number headings");

console.log("Monopad dossiers, artwork, and spoiler-gated recap data checks passed.");
