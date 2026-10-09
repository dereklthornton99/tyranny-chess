'use strict';
/*
 * engine-server.js - serves the page's OWN engine to the audit harness, one JSON object per line on stdin, one reply
 * per line on stdout.
 *
 * The engine is tests/engine.js, which tests/extract.js cuts out of src/tyranny.html, so what is measured is the code
 * the page runs. The tier settings (LEVELS) are read from src/tyranny.html at start-up, not copied, so a change to a
 * tier in the page changes the audit with it.
 *
 * Requests (all carry an "id"):
 *   {op:"move",  start?:FEN, moves?:[uci...], level:"easy|medium|hard" | {ms,depth,temp?,mop?,seed?}, seed?:N, selfCap?:bool}
 *        -> {uci, score, depth, nodes, ms}        the move the page would play after that game history
 *   {op:"legal", start?:FEN, moves?:[uci...], selfCap?:bool}  -> {moves:[uci...]}
 *   {op:"status", start?:FEN, moves?:[uci...]}  -> {inCheck, insufficient, legal}   the page's own check / dead-material / move-count verdicts
 *   {op:"root",  start?:FEN, moves?:[uci...], depth:N, selfCap?:bool}
 *        -> {moves:[{uci, score, staticAfter}...]}  exact fixed-depth score of every root move, best first
 *   {op:"levels"} -> {levels:{easy:{ms,depth},...}}
 * selfCap defaults to FALSE: standard chess rules, which is what Stockfish can judge.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const E = require(process.env.AUDIT_ENGINE || '../../tests/engine.js');   // AUDIT_ENGINE: a modified copy, for counterfactual runs

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'tyranny.html'), 'utf8');
const m = SRC.match(/var LEVELS\s*=\s*(\{[^;]*\});/);
if (!m) { process.stderr.write('could not read LEVELS from src/tyranny.html\n'); process.exit(2); }
const LEVELS = (new Function('return (' + m[1] + ')'))();     // the page's own object literal: ms, depth and, for the weaker tiers, temp and mop
if (!LEVELS.easy || !LEVELS.medium || !LEVELS.hard) { process.stderr.write('LEVELS in src/tyranny.html lacks a tier\n'); process.exit(2); }

const CP_STD = E.ai.cp;   // the standard piece values; ai.cp holds them until the first think() call changes it
const uci = (mv) => E.sqName(mv.from) + E.sqName(mv.to) + (mv.promo || '');

function build(req) {
  const selfCap = req.selfCap === true;
  const S0 = req.start ? E.fen(req.start) : E.startState();
  const hist = [S0];
  let S = S0;
  for (const u of req.moves || []) {
    const mv = E.legal(S, selfCap).find((x) => uci(x) === u);
    if (!mv) throw new Error('illegal move in the history: ' + u);
    S = E.apply(S, mv);
    hist.push(S);
  }
  return { S, hist, selfCap };
}

function handle(req) {
  if (req.op === 'levels') return { levels: LEVELS };
  const { S, hist, selfCap } = build(req);
  if (req.op === 'legal') return { moves: E.legal(S, selfCap).map(uci) };
  if (req.op === 'status') return { inCheck: E.inCheck(S, S.turn), insufficient: E.insufficient(S.b), legal: E.legal(S, selfCap).length };
  if (req.op === 'move') {
    const L = typeof req.level === 'string' ? LEVELS[req.level] : req.level;
    if (!L) throw new Error('unknown level ' + JSON.stringify(req.level));
    const r = E.think(S, { ms: L.ms, maxDepth: L.depth, selfCap, history: hist, temp: L.temp, mop: L.mop, seed: L.seed !== undefined ? L.seed : req.seed });
    if (!r) return { uci: null };
    return { uci: uci(r.move), score: r.score, depth: r.depth, nodes: r.nodes, ms: r.ms };
  }
  if (req.op === 'root') {
    const ai = E.ai;
    ai.nodes = 0; ai.aborted = false; ai.selfCap = selfCap; ai.cp = (S.v === 'c') ? E.CPC : CP_STD;
    const ms = E.legal(S, selfCap);
    const out = [];
    for (const mv of ms) {
      ai.killers = []; ai.hist = {}; ai.path = []; ai.depthDone = 1; ai.deadline = Infinity; ai.aborted = false;
      ai.gameKeys = new Set(hist.map(E.zkey));
      const T = E.apply(S, mv);
      const v = -E.search(T, req.depth - 1, -Infinity, Infinity, 1);
      out.push({ uci: uci(mv), score: v, staticAfter: -E.evaluate(T) });
    }
    out.sort((a, b) => b.score - a.score);
    return { moves: out };
  }
  throw new Error('unknown op ' + req.op);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch (e) { process.stdout.write(JSON.stringify({ error: 'bad json' }) + '\n'); return; }
  let res;
  try { res = handle(req); } catch (e) { res = { error: String(e && e.message || e) }; }
  res.id = req.id;
  process.stdout.write(JSON.stringify(res) + '\n');
});
rl.on('close', () => process.exit(0));
