const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

assert.match(css, /\*\{box-sizing:border-box\}/);
assert.match(css, /\.topbar,\.topbar \*,\.app-shell,\.app-shell \*\{min-width:0\}/);
assert.match(css, /\.tabs\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(css, /\.host-mode \.tabs\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
assert.match(css, /\.modal-card,\.compact-modal,\.practice-dialog-card,\.game-picker-card\{width:100%;max-width:100%\}/);
assert.match(css, /overflow-wrap:anywhere/);
assert.match(css, /@media\(max-width:350px\)/);
assert.doesNotMatch(css, /100vw/);

console.log("Mobile shrink, wrapping, navigation-grid, and dialog containment checks passed.");
