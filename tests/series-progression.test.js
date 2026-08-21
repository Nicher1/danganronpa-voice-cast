const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const sql = fs.readFileSync("supabase-schema.sql", "utf8");
const hostRedirect = fs.readFileSync("11037/index.html", "utf8");
const build = JSON.parse(fs.readFileSync("build.json", "utf8"));

const inlineScripts = html
  .split("<script")
  .slice(1)
  .map(part => part.slice(part.indexOf(">") + 1, part.indexOf("</script>")))
  .filter(source => source.trim());
inlineScripts.forEach((source, index) => new vm.Script(source, { filename: `index-inline-${index + 1}.js` }));

const definitionsMatch = html.match(/const GAME_DEFINITIONS = (\[[\s\S]*?\n  \]);\n  const GAME_IDS/);
assert.ok(definitionsMatch, "Game definitions are missing");
const definitions = vm.runInNewContext(definitionsMatch[1]);
assert.deepEqual(Array.from(definitions, game => game.id), ["dr1", "dr2", "dr3anime", "v3"]);
assert.equal(definitions.find(game => game.id === "dr3anime").kind, "anime");
assert.equal(definitions.find(game => game.id === "dr3anime").maxChapter, 24);
assert.equal(definitions.find(game => game.id === "v3").kind, "killing");

for (const name of [
  "Kaede Akamatsu", "Shuichi Saihara", "Rantaro Amami", "Miu Iruma",
  "Kokichi Oma", "K1-B0", "Gonta Gokuhara", "Tsumugi Shirogane",
  "Korekiyo Shinguji", "Tenko Chabashira", "Kirumi Tojo", "Maki Harukawa",
  "Ryoma Hoshi", "Kaito Momota", "Himiko Yumeno", "Angie Yonaga",
  "Monokid", "Monotaro", "Monosuke", "Monophanie", "Monodam"
]) assert.ok(html.includes(`\"${name}\"`), `V3 roster is missing ${name}`);

for (const name of [
  "Kazuo Tengan", "Kyosuke Munakata", "Koichi Kizakura", "Seiko Kimura",
  "Chisa Yukizome", "Juzo Sakakura", "Miaya Gekkogahara", "Ruruka Ando",
  "Sonosuke Izayoi", "Ryota Mitarai", "Daisaku Bandai", "Great Gozu"
]) assert.ok(html.includes(`\"${name}\"`), `Anime roster is missing ${name}`);

const resultStart = html.indexOf("function recalculateResult");
const resultEnd = html.indexOf("function predictionMarkers", resultStart);
const resultSource = html.slice(resultStart, resultEnd);
assert.ok(resultSource.includes('kind==="blackened"&&gameDefinition(activeGameId).kind==="anime"'));
assert.ok(resultSource.includes("result.blackenedCorrectActorIds=[]"));
assert.ok(resultSource.includes("result.hiddenBlackenedCorrectActorIds=roleId?state.actors"));
assert.ok(resultSource.includes("if(animeComplete)blackened++"));
assert.ok(resultSource.includes("else pendingBlackened++"));
assert.ok(resultSource.includes('if(anime&&kind==="victim"&&roleId)lockChapterPredictions(chapter)'));

const pickerStart = html.indexOf("function renderGamePicker");
const pickerEnd = html.indexOf("function showGamePicker", pickerStart);
const pickerSource = html.slice(pickerStart, pickerEnd);
assert.ok(pickerSource.includes('mode==="host"?GAME_DEFINITIONS:GAME_DEFINITIONS.filter(game=>isGameUnlocked(game.id))'));
assert.match(html, /NEXT KILLING GAME<\/div><h2 id="lockedGameTitle">Next game<\/h2>/);
assert.ok(html.includes('$("#lockedGameTitle").textContent=nextLocked.title'));
assert.ok(html.includes("const ANIME_WATCH_ORDER"));
assert.ok(html.includes("function renderAnimeTracker"));
assert.ok(html.includes('id="animeCandidateGrid"'));
assert.ok(html.includes("function sortedActorsForBoard"));
assert.ok(html.includes("activeGameLeaderIds(\"total\")"));
assert.ok(html.includes("activeGameLeaderIds(\"deaths\")"));
assert.ok(html.includes("Only unlocked boards appear"));
assert.ok(html.includes("function renderPredictionChart"));
assert.ok(html.includes('data-reveal-game="dr3anime"'));
assert.ok(html.includes('sharedStateVersion<10'));
assert.ok(sql.includes("'dr1', 'dr2', 'dr3anime', 'v3'"));
assert.ok(html.includes("version:10"));
assert.ok(html.includes(`const APP_BUILD = "${build.build}"`));
assert.ok(hostRedirect.includes(`build=${build.build}`));
assert.ok(html.includes("async function refreshOutdatedBuild()"));

console.log("Series progression, anime scoring, V3 roster, and statistics checks passed.");
