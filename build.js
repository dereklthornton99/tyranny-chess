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
const SPLIT = '<div class="wrap">';

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
    console.error('index.html is STALE - it does not match a fresh build of src/tyranny.html.');
    console.error('Fix:  node build.js   then commit the result.');
    process.exit(1);
  }
  console.log('index.html matches src/tyranny.html');
} else {
  fs.writeFileSync(OUT, out, 'utf8');
  console.log('built index.html (' + Buffer.byteLength(out) + ' bytes) from src/tyranny.html');
}
