const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const a = html.indexOf("function voicedCharacterCount"), b = html.indexOf("const VARIETY_AWARD_FACES", a);
assert.ok(a > 0 && b > a, "Variety helpers are missing");
const ctx = vm.runInNewContext(`
  let activeGameId="dr1";
  const historyKey=n=>String(n||"").trim().toLowerCase();
  const normaliseHistory=v=>[...new Set((v||[]).map(String))];
  const currentRoleVisible=r=>!r.hiddenSpoiler||r.revealed;
  const state={
    roles:[{gameId:"dr1",name:"Toko"},{gameId:"dr1",name:"Genocide Jill"},{gameId:"dr1",name:"Secret",hiddenSpoiler:true,revealed:false},{gameId:"dr2",name:"Other"}],
    actors:[{id:"a",history:["toko","Genocide Jill","Secret","Other"]},{id:"b",history:["Toko"]},{id:"c",history:[]}]};
  ${html.slice(a, b)};
  ({count:id=>voicedCharacterCount(state.actors.find(x=>x.id===id)),leadersJson:()=>JSON.stringify([...activeGameVarietyLeaderIds()].sort()),state})`);
assert.equal(ctx.count("a"), 2, "Counts only visible characters from the current game, ignoring case");
assert.equal(ctx.count("b"), 1);
const leaders = () => JSON.parse(ctx.leadersJson());
assert.deepEqual(leaders(), ["a"]);
ctx.state.actors[1].history = ["Toko", "Genocide Jill"];
assert.deepEqual(leaders(), ["a", "b"], "Ties share the badge");
ctx.state.actors[0].history = ["Toko"];
ctx.state.actors[1].history = ["Toko"];
assert.deepEqual(leaders(), [], "One character is not enough for a badge");
console.log("Variety badge passed.");
