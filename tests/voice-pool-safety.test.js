const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const librarySource = fs.readFileSync("voice-clips-v4.js", "utf8");

const inlineScripts = html
  .split("<script")
  .slice(1)
  .map(part => part.slice(part.indexOf(">") + 1, part.indexOf("</script>")))
  .filter(source => source.trim());

inlineScripts.forEach((source, index) => new vm.Script(source, { filename: `index-inline-${index + 1}.js` }));

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(librarySource, sandbox);
assert.equal(sandbox.window.CAST_VOICE_LIBRARY.version, 4);
const profiles = sandbox.window.CAST_VOICE_LIBRARY.profiles;
const celestiaRope = profiles["Celestia Ludenberg"].chapters[2].highlights.find(
  clip => clip.text === "It was some kind of rope, was it not?"
);
assert.equal(celestiaRope?.id, "Dr1_voice_hca_us.awb.04819");
assert.equal(celestiaRope?.path, "9/99/Dr1_voice_hca_us.awb.04819.ogg");
assert.ok(html.includes('<script src="voice-clips-v4.js"></script>'));

const transcriptById = new Map();
let checkedVoiceMappings = 0;
for (const [name, profile] of Object.entries(profiles)) {
  const clips = [
    ...(profile.pretrial || []),
    ...Object.values(profile.chapters || {}).flatMap(chapter => [
      ...(chapter.reveal || []),
      ...(chapter.highlights || [])
    ])
  ];
  for (const clip of clips) {
    const filename = `${clip.id}.ogg`;
    const hash = crypto.createHash("md5").update(filename).digest("hex");
    assert.equal(clip.path, `${hash[0]}/${hash.slice(0, 2)}/${filename}`, `${name}: ${clip.text}`);
    if (transcriptById.has(clip.id)) {
      assert.equal(transcriptById.get(clip.id), clip.text, `${clip.id} must not have two transcripts`);
    } else {
      transcriptById.set(clip.id, clip.text);
    }
    checkedVoiceMappings += 1;
  }
}
assert.ok(checkedVoiceMappings >= 400, "The full built-in voice map should be covered by the integrity audit");

for (const [name, profile] of Object.entries(profiles)) {
  assert.ok(profile.pretrial?.length, `${name} needs a non-trial field-dialogue fallback`);
}

const packHelperMatch = html.match(
  /function voicePackForChapter\(profile,chapter\)\s*({[\s\S]*?\r?\n  })\r?\n\r?\n  function voicePackAtChapter/
);
assert.ok(packHelperMatch, "The latest-safe chapter-pack helper is missing");
const voicePackForChapter = vm.runInNewContext(`(function voicePackForChapter(profile,chapter)${packHelperMatch[1]})`);

for (const [name, profile] of Object.entries(profiles)) {
  const availableChapters = Object.keys(profile.chapters || {}).map(Number).sort((a, b) => a - b);
  assert.ok(availableChapters.length, `${name} needs at least one chapter pack`);
  for (let target = availableChapters[0]; target <= 6; target += 1) {
    const expectedChapter = availableChapters.filter(chapter => chapter <= target).at(-1);
    const resolved = voicePackForChapter(profile, target);
    assert.equal(resolved?.chapter, expectedChapter, `${name} should keep its newest safe pack through Chapter ${target}`);
    assert.ok(resolved?.highlights?.length, `${name} should retain playable highlights through Chapter ${target}`);
  }
  assert.equal(voicePackForChapter(profile, availableChapters[0] - 1), null, `${name} must never fall forward into an unrevealed chapter`);
}

const futureGameProfile = {
  chapters: {
    2: { highlights: [{ id: "future-2" }] },
    5: { highlights: [{ id: "future-5" }] }
  }
};
assert.equal(voicePackForChapter(futureGameProfile, 4).chapter, 2, "Future game libraries need the same latest-safe fallback");
assert.equal(voicePackForChapter(futureGameProfile, 1), null, "Future game libraries must not expose a later chapter");

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
assert.ok(poolSource.includes("voicePackForChapter(profile,target)"), "Normal playback should fall back to the newest earlier safe pack");
assert.ok(poolSource.includes('customVoiceFor(r,target,"trial")'), "Host-uploaded Trial clips should use the same earlier-safe fallback");

const versions = [...html.matchAll(/class="patch-version">(v[0-9.]+)/g)].map(match => match[1]);
assert.deepEqual(versions, ["v0.17", "v0.16", "v0.15", "v0.14", "v0.13", "v0.12", "v0.11", "v0.10", "v0.9", "v0.8.1", "v0.8", "v0.7", "v0.6", "v0.5"]);
assert.equal((html.match(/<details class="patch-release"/g) || []).length, 14);
assert.equal((html.match(/<details class="patch-release" open>/g) || []).length, 0);
assert.ok(html.includes("Point calculation for anime guessing"));
const patchNotes = html.slice(html.indexOf('<dialog id="patchNotesDialog"'), html.indexOf('<dialog id="hostAuthDialog"'));
assert.doesNotMatch(patchNotes, /secret points?|hidden points?|unscored|decoy/i);
assert.ok(patchNotes.includes("See who is online"));
assert.ok(patchNotes.includes("Hope and despair leader emblems"));
assert.ok(patchNotes.includes("Voice samples stay available"));
assert.ok(patchNotes.includes("Fresh predictions for every chapter"));
assert.ok(patchNotes.includes('data-reveal-game="dr3anime"><h4>Cleaner prediction labels'));

console.log("Voice-pool safety and patch-history checks passed.");
