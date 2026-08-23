const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");

const inlineScripts = html
  .split("<script")
  .slice(1)
  .map(part => part.slice(part.indexOf(">") + 1, part.indexOf("</script>")))
  .filter(source => source.trim());
inlineScripts.forEach((source, index) => new vm.Script(source, { filename: `index-inline-${index + 1}.js` }));

const helperStart = html.indexOf("function isChapterPredictionLocked");
const helperEnd = html.indexOf("function enterChapter", helperStart);
assert.ok(helperStart > 0 && helperEnd > helperStart, "Prediction lifecycle helpers are missing");
const helpers = vm.runInNewContext(`${html.slice(helperStart, helperEnd)};({isChapterPredictionLocked,predictionKindForDeath,resetPredictionsForChapter})`);
const plain = value => JSON.parse(JSON.stringify(value));

assert.equal(helpers.isChapterPredictionLocked("killing", false), false, "Pre-Trial predictions must be editable");
assert.equal(helpers.isChapterPredictionLocked("killing", true), true, "Trial predictions must lock");
assert.equal(helpers.isChapterPredictionLocked("killing", false, false, true), false, "A resolved Victim must not lock a pre-Trial chapter");
assert.equal(helpers.isChapterPredictionLocked("anime", false, false, false), false, "An unresolved anime episode must remain editable");
assert.equal(helpers.isChapterPredictionLocked("anime", false, false, true), true, "An anime episode locks after its death resolves");

assert.equal(helpers.predictionKindForDeath("killing", false), "victim", "A pre-Trial death must resolve Victim scoring");
assert.equal(helpers.predictionKindForDeath("killing", true), "blackened", "A Trial death must resolve Blackened scoring");
assert.equal(helpers.predictionKindForDeath("anime", false), "victim", "Anime deaths must retain dies-next scoring");

const predictions = {
  actorA: { "dr1:2": { victimRoleId: "role-a", blackenedRoleId: "role-b" } },
  actorB: { "dr1:2": { victimRoleId: "role-c", blackenedRoleId: "role-d" } }
};
helpers.resetPredictionsForChapter(predictions, ["actorA", "actorB"], "dr1", "3");
assert.deepEqual(plain(predictions.actorA["dr1:3"]), { victimRoleId: "", blackenedRoleId: "" });
assert.deepEqual(plain(predictions.actorB["dr1:3"]), { victimRoleId: "", blackenedRoleId: "" });
assert.deepEqual(predictions.actorA["dr1:2"], { victimRoleId: "role-a", blackenedRoleId: "role-b" }, "Chapter 2 history must remain intact");

predictions.actorA["dr1:3"].victimRoleId = "role-e";
predictions.actorA["dr1:3"].blackenedRoleId = "role-f";
predictions.actorA["dr1:3"].victimRoleId = "role-g";
predictions.actorA["dr1:3"].blackenedRoleId = "role-h";
assert.deepEqual(plain(predictions.actorA["dr1:3"]), { victimRoleId: "role-g", blackenedRoleId: "role-h" }, "Changing a prediction must replace its old value");
assert.deepEqual(plain(predictions.actorB["dr1:3"]), { victimRoleId: "", blackenedRoleId: "" }, "Actors must have independent prediction state");

const restored = JSON.parse(JSON.stringify(predictions));
assert.deepEqual(restored, plain(predictions), "Predictions must survive serialized reload restoration");

const canEditStart = html.indexOf("function canEditPrediction");
const canEditEnd = html.indexOf("function setPrediction", canEditStart);
const canEditSource = html.slice(canEditStart, canEditEnd);
assert.ok(canEditSource.includes("isChapterPredictionLocked"));
assert.doesNotMatch(canEditSource, /trialEnteredByChapter|prediction\.locked|result\?\.\[predictionField/);

const setPredictionStart = html.indexOf("function setPrediction");
const setPredictionEnd = html.indexOf("function recalculateResult", setPredictionStart);
const setPredictionSource = html.slice(setPredictionStart, setPredictionEnd);
assert.ok(setPredictionSource.includes("prediction[predictionField(kind)]=roleId||\"\""));
assert.ok(setPredictionSource.includes("recalculateResult(kind,currentSettings().voiceChapter)"), "Changing a resolved pre-Trial Victim prediction must refresh scoring");

const enterStart = html.indexOf("function enterChapter");
const enterEnd = html.indexOf("function livingVoiceSourceSummary", enterStart);
const enterSource = html.slice(enterStart, enterEnd);
assert.ok(enterSource.includes("const firstVisit=!Object.prototype.hasOwnProperty.call(settings.trialByChapter,next)"));
assert.ok(enterSource.includes("resetPredictionsForChapter"));
assert.ok(enterSource.includes("settings.trialByChapter[next]=false"));

const killStart = html.indexOf("async function killRole");
const killEnd = html.indexOf("function reviveRole", killStart);
const killSource = html.slice(killStart, killEnd);
assert.ok(killSource.includes("predictionKindForDeath"));
assert.ok(killSource.includes("setChapterResult(resultKind"));
assert.ok(killSource.includes('r.deathPhase=currentSettings().voiceInTrial?"trial":"pretrial"'));

const normalizedPredictionStart = html.indexOf("if(!s.predictions");
const normalizedPredictionEnd = html.indexOf("if(!s.chapterResults", normalizedPredictionStart);
assert.doesNotMatch(html.slice(normalizedPredictionStart, normalizedPredictionEnd), /locked/);
assert.doesNotMatch(html, /lockChapterPredictions|prediction\.locked/);

console.log("Prediction lifecycle, phase scoring, actor separation, and reload checks passed.");
