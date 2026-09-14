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

/* Written by `node tools/gen-puzzles.js --inline`, which is how the puzzle set
   reaches the Claude Artifact target — that build publishes src/tyranny.html
   itself, so a head injection into index.html never reaches it. */
const MARK_BEGIN = '/* PUZZLE-DATA-BEGIN */';
const MARK_END = '/* PUZZLE-DATA-END */';

/* Key-sorted stringify, so two documents that differ only in key order compare
   equal. Without it a harmless re-serialisation would fail the sync check and
   train people to ignore it. */
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

/* What, if anything, src/tyranny.html already carries between the markers.
     absent  — no markers at all (a source predating --inline)
     empty   — markers present, nothing between them (the state UI committed)
     filled  — an assignment is inlined; src is then the SINGLE writer */
function inlined(src) {
  const a = src.indexOf(MARK_BEGIN);
  const b = src.indexOf(MARK_END);
  if (a < 0 || b < 0 || b < a) return { state: 'absent' };
  const body = src.slice(a + MARK_BEGIN.length, b).trim();
  if (!body) return { state: 'empty' };
  const m = body.match(/window\.TYRANNY_PUZZLES\s*=\s*([\s\S]+?);?\s*$/);
  if (!m) {
    throw new Error('src/tyranny.html: the PUZZLE-DATA markers contain something that is not a\n' +
                    'window.TYRANNY_PUZZLES assignment. Re-run: node tools/gen-puzzles.js --inline');
  }
  return { state: 'filled', json: m[1] };
}

/* THE BLIND SPOT THIS CLOSES. --check compares index.html against a fresh build
   of src. When the puzzle data lives INSIDE src, a stale copy is copied
   faithfully into index.html and --check compares like with like and passes —
   so puzzles.json could say 10 while the shipped page says 64, with CI green.
   Demonstrated 2026-09-14. The only guard is comparing the inlined copy against
   puzzles.json directly. */
function assertInlineFresh(jsonText) {
  if (!fs.existsSync(PUZZLES)) {
    throw new Error('src/tyranny.html has puzzle data inlined but puzzles/puzzles.json is missing.\n' +
                    'They cannot be compared. Restore the file or clear the inlined block.');
  }
  let fromSrc, fromFile;
  try { fromSrc = JSON.parse(jsonText); }
  catch (e) { throw new Error('the block inlined in src/tyranny.html is not valid JSON: ' + e.message); }
  try { fromFile = JSON.parse(fs.readFileSync(PUZZLES, 'utf8')); }
  catch (e) { throw new Error('puzzles/puzzles.json is not valid JSON: ' + e.message); }
  if (canonical(fromSrc) !== canonical(fromFile)) {
    const n = o => (o && o.puzzles ? o.puzzles.length : '?');
    throw new Error(
      'STALE INLINE: the puzzle data inside src/tyranny.html does not match puzzles/puzzles.json.\n' +
      '  src/tyranny.html : ' + n(fromSrc) + ' puzzles\n' +
      '  puzzles.json     : ' + n(fromFile) + ' puzzles\n' +
      'The page would ship the src copy, because it is later in document order.\n' +
      'Fix:  node tools/gen-puzzles.js --inline   then  node build.js');
  }
}

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

  /* EXACTLY ONE WRITER for window.TYRANNY_PUZZLES. When src carries the data
     the head injection is skipped, so index.html assigns the global once; when
     it does not, the head is the writer and the ALWAYS-DEFINED contract above
     still holds. Two writers is not merely wasteful: the body wins on document
     order, which silently overrides the head copy --check was built to police. */
  const inl = inlined(src);
  if (inl.state === 'filled') assertInlineFresh(inl.json);
  const head = (inl.state === 'filled') ? [] : [puzzleScript()];

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>html{color-scheme:light dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>',
    src.slice(0, cut).trim()
  ].concat(head, [
    '</head>',
    '<body>',
    src.slice(cut).trim(),
    '</body>',
    '</html>',
    ''
  ]).join('\n');
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
  const where = inlined(fs.readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n')).state === 'filled'
    ? 'from src (already inlined; head injection skipped)'
    : 'injected into the head';
  console.log('built index.html (' + Buffer.byteLength(out) + ' bytes) from src/tyranny.html, ' +
              n + ' puzzles ' + where);
}
