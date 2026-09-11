const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));

assert.match(css, /\*\{box-sizing:border-box\}/);
assert.match(css, /\.topbar,\.topbar \*,\.app-shell,\.app-shell \*\{min-width:0\}/);
assert.match(css, /\.tabs,\.host-mode \.tabs\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(css, /\.modal-card,\.compact-modal,\.practice-dialog-card,\.game-picker-card,\.dossier-dialog-card\{width:100%;max-width:100%\}/);
assert.match(css, /#dossierDialog\{width:min\(94vw,820px\);max-width:94vw;overflow-x:hidden;overflow-y:auto\}/);
assert.match(css, /#dossierDialogArtWrap\{display:flex;align-items:stretch;min-width:0;max-width:100%;overflow:hidden\}/);
assert.match(css, /\.dossier-dialog-art\{display:block;width:100%;max-width:100%;min-width:0/);
assert.match(css, /\.monopad-section-head\{display:block;width:100%\}/, "Master recap heading must stack in portrait view");
assert.match(css, /\.monopad-section-actions\{display:grid;grid-template-columns:1fr;width:100%;margin-top:10px\}/, "Master recap buttons must not squeeze the summary text");
assert.match(css, /overflow-wrap:anywhere/);
assert.match(css, /@media\(max-width:350px\)/);
assert.doesNotMatch(css, /100vw/);

console.log("Mobile shrink, wrapping, navigation-grid, and dialog containment checks passed.");
