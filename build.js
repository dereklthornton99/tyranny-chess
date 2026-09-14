#!/usr/bin/env node
/*
 * The ONE authored file is src/tyranny.html.
 *
 * It is deliberately a FRAGMENT — no <!doctype>, <html>, <head> or <body> —
 * because the Claude Artifact host supplies that skeleton itself, and a file
 * carrying its own would be double-wrapped. GitHub Pages needs the opposite:
 * a complete document. So this script wraps the fragment into index.html.
 *
 *   node build.js            regenerate index.html from src/tyranny.html
 *   node build.js --check    exit 1 if index.html is stale (used by CI)
 *
 * The --check mode is the whole anti-drift guarantee: a commit that edits the
 * source without rebuilding fails CI instead of silently shipping a stale page.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src', 'tyranny.html');
const OUT = path.join(__dirname, 'index.html');
const PUZZLES = path.join(__dirname, 'puzzles', 'puzzles.json');
const SPLIT = '<div class="wrap">';

/*
 * The puzzle set is inlined into the head as `window.TYRANNY_PUZZLES`.
 *
 * CONTRACT, so the page never has to feature-detect: the global is ALWAYS
 * defined. It is the parsed puzzles document when puzzles/puzzles.json exists,
 * and `null` when it does not. A reader branches on null, never on undefined.
 *
 * Minified on purpose — the pretty-printed file is roughly twice the size and
 * nothing reads index.html by hand.
 *
 * Note this widens what --check guards: index.html is now downstream of BOTH
 * src/tyranny.html and puzzles/puzzles.json, so regenerating puzzles without
 * rebuilding is caught the same way a source edit is.
 */
function puzzleScript() {
  if (!fs.existsSync(PUZZLES)) {
    return '<script>window.TYRANNY_PUZZLES = null;</script>';
  }
  const raw = fs.readFileSync(PUZZLES, 'utf8');
  let doc;
  try { doc = JSON.parse(raw); }
  catch (e) { throw new Error('puzzles/puzzles.json is not valid JSON: ' + e.message); }
  /* "</script>" inside the payload would close the tag early; no current field
     can contain it, but the escape costs nothing and removes the class. */
  const json = JSON.stringify(doc).replace(/<\//g, '<\\/');
  return '<script>window.TYRANNY_PUZZLES = ' + json + ';</script>';
}

function build() {
  const src = fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');
  const cut = src.indexOf(SPLIT);
  if (cut < 0) throw new Error('src/tyranny.html: missing "' + SPLIT + '", the head/body split point');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>html{color-scheme:light dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>',
    src.slice(0, cut).trim(),
    puzzleScript(),
    '</head>',
    '<body>',
    src.slice(cut).trim(),
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

const out = build();

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== out) {
    console.error('index.html is STALE - it does not match a fresh build of');
    console.error('src/tyranny.html + puzzles/puzzles.json.');
    console.error('Fix:  node build.js   then commit the result.');
    process.exit(1);
  }
  console.log('index.html matches src/tyranny.html + puzzles/puzzles.json');
} else {
  fs.writeFileSync(OUT, out, 'utf8');
  const n = fs.existsSync(PUZZLES) ? (JSON.parse(fs.readFileSync(PUZZLES, 'utf8')).puzzles || []).length : 0;
  console.log('built index.html (' + Buffer.byteLength(out) + ' bytes) from src/tyranny.html, ' +
              n + ' puzzles inlined as window.TYRANNY_PUZZLES');
}
