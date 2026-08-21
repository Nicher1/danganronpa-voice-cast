const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const librarySource = fs.readFileSync("voice-clips.js", "utf8");

const inlineScripts = html
  .split("<script")
  .slice(1)
  .map(part => part.slice(part.indexOf(">") + 1, part.indexOf("</script>")))
  .filter(source => source.trim());

inlineScripts.forEach((source, index) => new vm.Script(source, { filename: `index-inline-${index + 1}.js` }));

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(librarySource, sandbox);
const profiles = sandbox.window.CAST_VOICE_LIBRARY.profiles;

for (const [name, profile] of Object.entries(profiles)) {
  assert.ok(profile.pretrial?.length, `${name} needs a non-trial field-dialogue fallback`);
}

const curatedMatch = html.match(
  /const CURATED_CURRENT_PRETRIAL_CLIPS=({[\s\S]*?\r?\n  });\r?\n\r?\n  function voiceLibraryProfile/
);
assert.ok(curatedMatch, "The curated current-chapter pre-trial pools are missing");
const curated = vm.runInNewContext(`(${curatedMatch[1]})`);

for (const name of ["Makoto Naegi", "Byakuya Togami"]) {
  assert.equal(curated[name][3].length, 5, `${name} should have five Chapter 3 pre-trial clips`);
  const chapterThreeTrialIds = new Set([
    ...profiles[name].chapters[3].reveal,
    ...profiles[name].chapters[3].highlights
  ].map(clip => clip.id));
  assert.ok(
    curated[name][3].every(clip => !chapterThreeTrialIds.has(clip.id)),
    `${name}'s pre-trial pool contains Chapter 3 Trial testimony`
  );
}

const poolStart = html.indexOf("function voicePoolForRole");
const poolEnd = html.indexOf("function personalRecordingsFor", poolStart);
const poolSource = html.slice(poolStart, poolEnd);
const trialStart = poolSource.indexOf("currentSettings().voiceInTrial");
const trialEnd = poolSource.indexOf("}else if(selected===1)", trialStart);
const currentTrialBranch = poolSource.slice(trialStart, trialEnd);

assert.ok(currentTrialBranch.includes("currentPretrialVoiceItems"));
assert.ok(!currentTrialBranch.includes(".reveal"), "Current Trial playback must not read the Trial reveal pool directly");
assert.ok(poolSource.includes("const target=selected-1"), "Normal playback should target the previous chapter");
assert.ok(poolSource.includes("pack?.highlights"), "Normal playback should use the previous chapter's highlights");

const versions = [...html.matchAll(/class="patch-version">(v[0-9.]+)/g)].map(match => match[1]);
assert.deepEqual(versions, ["v0.8", "v0.7", "v0.6", "v0.5"]);
assert.equal((html.match(/<details class="patch-release">/g) || []).length, 4);
assert.equal((html.match(/<details class="patch-release" open>/g) || []).length, 0);

console.log("Voice-pool safety and patch-history checks passed.");
