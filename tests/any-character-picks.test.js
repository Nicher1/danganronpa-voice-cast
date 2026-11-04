const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const slice = (from, to) => {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  assert.ok(a > 0 && b > a, `Missing ${from}`);
  return html.slice(a, b);
};

// Any visible character can be picked, living or fallen; hidden spoilers and the Narrator cannot.
const pickRules = slice("function predictionField", "function canEditPrediction");
const rules = vm.runInNewContext(`
  let activeGameId="dr1";
  const gameDefinition=id=>id==="dr3anime"?{kind:"anime",maxChapter:10}:{kind:"killing",maxChapter:6};
  const currentSettings=()=>({voiceChapter:6});
  const chapterKey=c=>String(c);
  const currentRoleVisible=r=>!r.hiddenSpoiler||r.revealed;
  ${pickRules};
  ({eligiblePredictionRole,mastermindEnabled,predictionField,correctField,setGame:id=>activeGameId=id})`);
assert.equal(rules.eligiblePredictionRole({name:"Hifumi Yamada", dead:true}), true);
assert.equal(rules.eligiblePredictionRole({name:"Yasuhiro Hagakure", dead:false}), true);
assert.equal(rules.eligiblePredictionRole({name:"Junko Enoshima", dead:true, specialRole:"junko-disguise"}), true);
assert.equal(rules.eligiblePredictionRole({name:"Hidden", hiddenSpoiler:true, revealed:false}), false);
assert.equal(rules.eligiblePredictionRole({name:"Revealed", hiddenSpoiler:true, revealed:true, dead:true}), true);
assert.equal(rules.eligiblePredictionRole({name:"Narrator"}), false);
assert.equal(rules.mastermindEnabled(6), true);
assert.equal(rules.mastermindEnabled(5), false);
assert.equal(rules.predictionField("mastermind"), "mastermindRoleId");
assert.equal(rules.correctField("mastermind"), "mastermindCorrectActorIds");
rules.setGame("dr3anime");
assert.equal(rules.eligiblePredictionRole({name:"Fallen", dead:true}), false, "Anime episodes keep living-only picks");
assert.equal(rules.mastermindEnabled(6), false, "The extra guess is limited to the first game");

// Mastermind points count as Blackened points.
const counting = slice("function predictionCountsForActorGame", "function adjustPredictionScore");
const counts = vm.runInNewContext(`
  const state={chapterResults:{
    "dr1:6":{blackenedCorrectActorIds:["a"],mastermindCorrectActorIds:["a","b"],victimCorrectActorIds:["b"]},
    "dr1:5":{blackenedCorrectActorIds:["b"]}},settings:{completedGames:{}}};
  const gameDefinition=()=>({kind:"killing"});
  const predictionScoreAdjustment=()=>0;
  const countRecordedDeathsForActor=()=>0;
  ${counting};
  ({a:predictionCountsForActorGame("a","dr1"),b:predictionCountsForActorGame("b","dr1")})`);
assert.equal(counts.a.blackened, 2);
assert.equal(counts.b.blackened, 2);
assert.equal(counts.b.victim, 1);

// Guesses on the original Junko card move to the real Junko; Mukuro entries and other chapters stay.
const carry = slice("function carryJunkoGuesses", "function revealRole");
const moved = vm.runInNewContext(`
  let activeGameId="dr1";
  const gameDefinition=()=>({maxChapter:6});
  const currentSecretSettings=()=>({junkoMukuroRevealed:false});
  const gameRoles=()=>[{id:"old",specialRole:"junko-disguise"},{id:"real",specialRole:"real-junko"},{id:"mk",specialRole:"unconfirmed-student"}];
  const state={predictions:{a:{"dr1:6":{victimRoleId:"mk",blackenedRoleId:"old",mastermindRoleId:"old"},"dr1:4":{blackenedRoleId:"old"}}}};
  ${carry};
  const n=carryJunkoGuesses();
  ({n,p:state.predictions})`);
assert.equal(moved.n, 2);
assert.deepEqual(JSON.parse(JSON.stringify(moved.p.a["dr1:6"])), {victimRoleId:"mk", blackenedRoleId:"real", mastermindRoleId:"real"});
assert.equal(moved.p.a["dr1:4"].blackenedRoleId, "old");

// The posters and the server accept the new guess.
assert.match(html, /data-pick-fallen/);
assert.match(html, /prediction-pickable/);
assert.match(fs.readFileSync("supabase-schema.sql", "utf8"), /'mastermindRoleId'/);
console.log("Any-character picks passed: living and fallen picks, hidden roles excluded, mastermind scoring, Junko carry-over.");
