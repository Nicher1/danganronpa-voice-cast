const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("design-preview.html", "utf8");

for (const view of ["assignments", "memorial", "statistics", "monopad", "admin"]) {
  assert.ok(html.includes(`data-view="${view}"`), `Missing navigation control for ${view}`);
  assert.ok(html.includes(`id="view-${view}"`), `Missing view for ${view}`);
}

assert.ok(html.includes("DR1 × V3"), "The concept direction should be explicit");
assert.ok(html.includes("Trigger Happy Havoc"), "DR1 must remain the active game");
assert.ok(html.includes("assets/monopad/dr1/monokuma.png"), "The active game screen should use Monokuma artwork");
assert.ok(html.includes("assets/monopad/dr1/celestia-ludenberg.jpeg"), "The assignment screen should use character artwork");
assert.ok(html.includes("id=\"wakeButton\""));
assert.ok(html.includes("id=\"advanceButton\""));
assert.ok(html.includes("id=\"refreshButton\""));
assert.ok(html.includes("id=\"resetButton\""));
assert.ok(html.includes("document.querySelectorAll('.role')"));
assert.ok(html.includes("document.querySelectorAll('.student-list button')"));

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.strictEqual(scripts.length, 1, "Expected one inline prototype script");
new vm.Script(scripts[0]);

console.log("Interactive DR1/V3 design preview checks passed.");
