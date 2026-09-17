/*
 * Real-browser checks. Drives headless Chrome over its own DevTools protocol
 * and asserts against the LIVE DOM -- reading the source is explicitly not
 * enough for these (goal-tree M1-T2-AC3).
 *
 * Zero dependencies, deliberately: the repo has none and this does not add any.
 * Node 24 ships a global WebSocket, which is the whole CDP client.
 *
 * SEPARATE RUNNER, ALSO DELIBERATELY. This is not in tests/run-all.js's suite
 * loop. M1-T1-AC5 pins that runner at 27/8/24/13/85 and the tree's must_not
 * forbids the count moving, so browser checks are counted on their own line.
 *
 *   node tests/browser.js            run everything
 *   node tests/browser.js --head     watch it in a real window
 *
 * The page is served over http://127.0.0.1 rather than opened as file://
 * because localStorage on a file:// origin is opaque in Chrome -- the storage
 * criteria would test nothing there.
 */
const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const net  = require('net');
const { spawn, execFileSync } = require('child_process');
// toFen is the repo's own round-trip-verified writer; AC2 forbids comparing by eye.
let toFen;

const ROOT = path.join(__dirname, '..');
const HEADED = process.argv.includes('--head');

/*
 * The one hard requirement this runner has, checked up front rather than left
 * to surface as a bare ReferenceError from inside the CDP client. Node ships
 * WebSocket as a global unflagged from v22; before that it is absent or behind
 * --experimental-websocket. Exit 2 means "could not run", which is a different
 * thing from "checks failed" and is what CI should read it as.
 */
if (typeof WebSocket !== 'function') {
  console.error('browser.js: this runner needs a global WebSocket, which Node provides from v22.');
  console.error('  running on ' + process.version + '. Upgrade Node, or run with --experimental-websocket on v21.');
  console.error('  The Node suites (node tests/run-all.js) do not need this and run anywhere.');
  process.exit(2);
}

/* ---------- reporting ---------- */
let pass = 0, fail = 0;
const failures = [];
function chk(name, got, want){
  const ok = String(got) === String(want);
  ok ? pass++ : fail++;
  if(!ok) failures.push(name + '   got ' + got + ', want ' + want);
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + '   got ' + got + '  want ' + want);
}
function head(s){ console.log('\n== ' + s); }

/* ---------- a static server on a free port ---------- */
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
                '.css':'text/css', '.svg':'image/svg+xml' };
function freePort(){
  return new Promise(res => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}
function serve(port){
  const srv = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const f = path.join(ROOT, rel);
    // never serve outside the repo
    if(!f.startsWith(ROOT)){ res.writeHead(403).end(); return; }
    fs.readFile(f, (e, buf) => {
      if(e){ res.writeHead(404).end('no'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(res => srv.listen(port, '127.0.0.1', () => res(srv)));
}

/* ---------- find Chrome ---------- */
function chromePath(){
  const cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for(const c of cands) if(fs.existsSync(c)) return c;
  return null;
}

/* ---------- a minimal CDP client ---------- */
function cdp(wsUrl){
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const waiting = new Map();
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if(msg.id && waiting.has(msg.id)){
        const { res, rej } = waiting.get(msg.id);
        waiting.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
    ws.onerror = e => reject(new Error('ws error: ' + (e.message || 'unknown')));
    ws.onopen = () => resolve({
      send(method, params, sessionId){
        const mid = ++id;
        return new Promise((res, rej) => {
          waiting.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
        });
      },
      close(){ try { ws.close(); } catch(e){} },
    });
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main(){
  // Always test the BUILT page, never a stale one, and keep the extracted
  // engine fresh so toFen() below agrees with what the page is running.
  execFileSync(process.execPath, [path.join(ROOT, 'build.js')], { stdio: 'pipe' });
  execFileSync(process.execPath, [path.join(__dirname, 'extract.js')], { stdio: 'pipe' });
  ({ toFen } = require('../tools/fen-write.js'));   // requires the freshly written engine.js

  const bin = chromePath();
  if(!bin){
    console.error('browser.js: no Chrome found. Set CHROME_PATH and re-run.');
    console.error('  looked in: ' + [process.env.CHROME_PATH && 'CHROME_PATH', 'Program Files', 'LOCALAPPDATA',
      '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications'].filter(Boolean).join(', '));
    process.exit(2);                 // 2 = could not run, distinct from 1 = failed
  }

  const port = await freePort();
  const srv  = await serve(port);
  const URL  = 'http://127.0.0.1:' + port + '/index.html';
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'tyranny-cdp-'));

  const args = ['--remote-debugging-port=0', '--user-data-dir=' + prof,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-extensions', '--disable-background-networking',
    '--disable-features=Translate,MediaRouter', 'about:blank'];
  /* Only under CI. A container has no usable sandbox and Chrome refuses to
     start without this; a developer machine keeps its sandbox, because turning
     it off everywhere to fix a runner is a real change in posture rather than a
     flag. /dev/shm is tiny in containers and crashes the renderer without the
     second flag. */
  if (process.env.CI) args.unshift('--no-sandbox', '--disable-dev-shm-usage');
  if(!HEADED) args.unshift('--headless=new');
  const proc = spawn(bin, args, { stdio: 'ignore' });

  // Chrome writes the port it actually took into the profile dir.
  const portFile = path.join(prof, 'DevToolsActivePort');
  let devPort = null;
  for(let i = 0; i < 100 && devPort === null; i++){
    await sleep(100);
    try { devPort = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim(); } catch(e){}
  }
  if(!devPort){ console.error('browser.js: Chrome never reported a debug port.'); process.exit(2); }

  const ver = await new Promise((res, rej) => {
    http.get('http://127.0.0.1:' + devPort + '/json/version', r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });

  const c = await cdp(ver.webSocketDebuggerUrl);
  const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await c.send('Target.attachToTarget', { targetId, flatten: true });

  /* Evaluate in the page and hand back a real JS value. */
  async function ev(expr){
    const r = await c.send('Runtime.evaluate',
      { expression: '(function(){' + expr + '})()', returnByValue: true, awaitPromise: true }, sessionId);
    if(r.exceptionDetails){
      throw new Error('page threw: ' + (r.exceptionDetails.exception
        ? r.exceptionDetails.exception.description : r.exceptionDetails.text));
    }
    return r.result.value;
  }
  async function load(){
    await c.send('Page.navigate', { url: URL }, sessionId);
    for(let i = 0; i < 100; i++){
      await sleep(50);
      // The context is torn down mid-navigation, so a throw here means "not yet".
      let st; try { st = await ev('return document.readyState + "|" + (typeof window.render)'); }
      catch(e){ continue; }
      if(st === 'complete|function') return;
    }
    throw new Error('page never finished loading');
  }

  /* Board helpers, written in terms of the page's own globals so a rename
     here fails loudly instead of silently testing nothing. */
  const MARKS = '.hl-move,.hl-take,.hl-self';
  const pick = sq => 'document.querySelector(\'[data-sq="' + sq + '"]\').click();';
  const countMarks = 'return document.querySelectorAll("' + MARKS + '").length;';

  try {
    await load();

    /* ---------------- M1-T1 : the toggle ---------------- */
    head('M1-T1 default state and the three marker classes');

    chk('AC2  fresh profile, no stored value -> markers ON',
      await ev('return window.showMarks'), true);
    chk('AC2  button label agrees with the state',
      await ev('return document.getElementById("markBtn").textContent'), 'Move markers: ON');
    chk('AC4  nothing stored yet',
      await ev('return String(localStorage.getItem("tyranny.markers.v1"))'), 'null');

    // A queen on d4 that can move quietly, take an enemy pawn on e5, and
    // execute its own pawn on d5 -- all three markers from one square.
    const SETUP = 'resetTo(fen("7k/8/8/3Pp3/3Q4/8/8/6K1 w - - 0 1")); render();';
    const D4 = 35, D5 = 27, E5 = 28, D3 = 43;
    await ev(SETUP);
    await ev(pick(D4));
    chk('AC1  quiet dot present on d3',
      await ev('return document.querySelector(\'[data-sq="' + D3 + '"]\').classList.contains("hl-move")'), true);
    chk('AC1  enemy ring present on e5',
      await ev('return document.querySelector(\'[data-sq="' + E5 + '"]\').classList.contains("hl-take")'), true);
    chk('AC1  self brackets present on d5',
      await ev('return document.querySelector(\'[data-sq="' + D5 + '"]\').classList.contains("hl-self")'), true);

    head('M1-T1-AC1 the toggle turns all three off together');
    await ev('document.getElementById("markBtn").click();');
    await ev(pick(D4));                       // re-select, the toggle clears nothing
    chk('AC1  zero marker elements anywhere on the board', await ev(countMarks), 0);
    chk('AC1  targets are still computed (only the hint is hidden)',
      await ev('return window.targets.length > 0'), true);
    chk('     button label follows', await ev('return document.getElementById("markBtn").textContent'),
      'Move markers: OFF');

    head('M1-T1-AC3 a move is still playable with markers OFF');
    const before = await ev('return window.hist.length');
    await ev(pick(D4));
    await ev(pick(E5));                       // d4 takes the enemy pawn on e5
    chk('AC3  the move landed', await ev('return window.hist.length'), before + 1);
    chk('AC3  the queen is on e5 now', await ev('return window.hist[window.hist.length-1].b[' + E5 + ']'), 'wq');

    head('M1-T1-AC4 the choice survives a reload');
    chk('AC4  stored as off', await ev('return localStorage.getItem("tyranny.markers.v1")'), 'off');
    await load();
    chk('AC4  still OFF after reload', await ev('return window.showMarks'), false);
    chk('AC4  label rebuilt from storage, not from the markup',
      await ev('return document.getElementById("markBtn").textContent'), 'Move markers: OFF');
    await ev(SETUP + pick(D4));
    chk('AC4  and it actually suppresses after reload', await ev(countMarks), 0);

    head('M1-T1-AC4 no stored value renders ON and does not throw');
    await ev('localStorage.removeItem("tyranny.markers.v1"); return 1;');
    await load();
    chk('AC4  back to ON', await ev('return window.showMarks'), true);
    chk('AC4  page loaded with no uncaught error',
      await ev('return typeof window.render + "/" + typeof window.marksVisible'), 'function/function');
    await ev(SETUP + pick(D4));
    chk('AC4  markers render again', await ev('return document.querySelectorAll("' + MARKS + '").length > 0'), true);

    /* ---------------- M1-T2 : puzzle mode overrides ---------------- */
    head('M1-T2-AC1 puzzle mode suppresses the markers even with the toggle ON');
    chk('     precondition: toggle is ON', await ev('return window.showMarks'), true);
    chk('     precondition: a puzzle set is present',
      await ev('return !!(window.TYRANNY_PUZZLES && window.TYRANNY_PUZZLES.puzzles.length)'), true);
    await ev('document.getElementById("puzToggle").click();');
    chk('     entered puzzle mode', await ev('return !!window.puz'), true);
    chk('AC1  toggle is still ON underneath', await ev('return window.showMarks'), true);
    // Select every piece of the side to move; not one of them may show a marker.
    // `moves` is the control that keeps this honest: a zero marker count means
    // nothing unless real, non-empty target sets were produced alongside it.
    const sweep = await ev(
      'var S = window.hist[window.hist.length-1], n = 0, moves = 0, picked = 0;' +
      'for(var i=0;i<64;i++){ if(S.b[i] && S.b[i][0] === S.turn){' +
      '  document.querySelector(\'[data-sq="\'+i+\'"]\').click(); picked++;' +
      '  moves += window.targets.length;' +
      '  n += document.querySelectorAll("' + MARKS + '").length; } }' +
      'return {marks:n, moves:moves, picked:picked};');
    chk('AC1  no dot, no ring, no brackets on ANY square, over every movable piece', sweep.marks, 0);
    chk('AC1  control: the sweep really did select pieces', sweep.picked > 0, true);
    chk('AC1  control: those pieces really did have legal moves to mark', sweep.moves > 0, true);
    // Mutation: with the puzzle-mode override removed, the SAME sweep must light up.
    // If it does not, the zero above was measuring nothing.
    const mutated = await ev(
      'var real = window.marksVisible; window.marksVisible = function(){ return window.showMarks; };' +
      'var S = window.hist[window.hist.length-1], n = 0;' +
      'for(var i=0;i<64;i++){ if(S.b[i] && S.b[i][0] === S.turn){' +
      '  document.querySelector(\'[data-sq="\'+i+\'"]\').click();' +
      '  n += document.querySelectorAll("' + MARKS + '").length; } }' +
      'window.marksVisible = real; render(); return n;');
    chk('AC1  mutation: drop the puzzle override and the same sweep marks squares', mutated > 0, true);

    head('M1-T2-AC2 leaving restores the real prior state, not a default');
    await ev('document.getElementById("puzToggle").click();');
    chk('AC2  ON in, ON out', await ev('return window.showMarks'), true);
    await ev('document.getElementById("markBtn").click();');          // now OFF
    await ev('document.getElementById("puzToggle").click();');
    chk('AC2  OFF is preserved while inside', await ev('return window.showMarks'), false);
    chk('AC2  and suppressed inside regardless', await ev('return window.marksVisible()'), false);
    await ev('document.getElementById("puzToggle").click();');
    chk('AC2  OFF in, OFF out -- not reset to the ON default',
      await ev('return window.showMarks'), false);
    chk('AC2  the toggle is usable again after leaving',
      await ev('return document.getElementById("markBtn").disabled'), false);

    /* ---------------- M2-T1 : the entry point ---------------- */
    await load();
    head('M2-T1-AC1 one control, not two competing buttons');
    chk('AC1  the old pair is gone',
      await ev('return !document.getElementById("puzStart") && !document.getElementById("puzQuit")'), true);
    const slotOff = await ev('var r = document.getElementById("puzToggle").getBoundingClientRect();' +
      'return {t:Math.round(r.top), l:Math.round(r.left), label:document.getElementById("puzToggle").textContent};');
    await ev('document.getElementById("puzToggle").click();');
    const slotOn = await ev('var r = document.getElementById("puzToggle").getBoundingClientRect();' +
      'return {t:Math.round(r.top), l:Math.round(r.left), label:document.getElementById("puzToggle").textContent};');
    chk('AC1  it is the SAME element in both states, not a second button',
      slotOff.label + ' -> ' + slotOn.label, 'Start puzzles -> Leave puzzles');
    chk('AC1  and it does not jump: same left edge in both states', slotOn.l, slotOff.l);
    chk('AC1  entering worked', await ev('return !!window.puz'), true);

    head('M2-T1-AC2 opponent and strength are genuinely unavailable in a puzzle');
    const locked = await ev(
      'var out = {dis:0, tot:0, dim:1};' +
      'nodes = [].concat([].slice.call(document.querySelectorAll("#modeSeg button, #levelSeg button")));' +
      'nodes.forEach(function(b){ out.tot++; if(b.disabled) out.dis++;' +
      '  out.dim = Math.min(out.dim, parseFloat(getComputedStyle(b).opacity)); });' +
      'out.pe = getComputedStyle(document.getElementById("modeSeg")).pointerEvents;' +
      'return out;');
    chk('AC2  every opponent/strength button is disabled', locked.dis + '/' + locked.tot, '6/6');
    chk('AC2  and visibly so (computed opacity below 1)', locked.dim < 1, true);
    chk('AC2  the segment does not take pointer events either', locked.pe, 'none');
    chk('AC2  self-capture is locked too, since a puzzle is unsolvable without it',
      await ev('return document.getElementById("ruleBtn").disabled'), true);

    head('M2-T1-AC4 progress, family and difficulty are legible beside the board');
    await c.send('Emulation.setDeviceMetricsOverride',
      { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await sleep(120);
    // "Without leaving the board area" is read as: with the page at scroll 0 on a
    // normal desktop viewport, the three readouts are FULLY on screen at the same
    // time as the board, and they sit beside it rather than below the fold.
    const vis = await ev(
      'window.scrollTo(0,0);' +
      'function box(id){ var r = document.getElementById(id).getBoundingClientRect();' +
      '  return {t:Math.round(r.top), b:Math.round(r.bottom), l:Math.round(r.left),' +
      '          r:Math.round(r.right), w:Math.round(r.width), h:Math.round(r.height),' +
      '          whole: r.width>0 && r.height>0 && r.top>=0 && r.left>=0 &&' +
      '                 r.bottom<=innerHeight && r.right<=innerWidth}; }' +
      'return {board:box("board"), fam:box("puzFam"), prog:box("puzProg"),' +
      '        diff:box("puzDiff"), vh:innerHeight, vw:innerWidth};');
    console.log('       viewport ' + vis.vw + 'x' + vis.vh +
      ' | board ' + vis.board.w + 'x' + vis.board.h + ' at top ' + vis.board.t + ' bottom ' + vis.board.b +
      ' | readouts at top ' + vis.fam.t + '-' + vis.diff.b + ', left ' + vis.fam.l);
    chk('AC4  family, progress and difficulty are all fully on screen',
      [vis.fam.whole, vis.prog.whole, vis.diff.whole].join(','), 'true,true,true');
    chk('AC4  the board is on screen at the same time (top edge visible, not below the fold)',
      vis.board.t >= 0 && vis.board.t < vis.vh, true);
    chk('AC4  the readouts are BESIDE the board, not stacked under it',
      vis.fam.l >= vis.board.r, true);
    chk('AC4  and they sit within the board\'s own vertical band',
      vis.fam.t >= vis.board.t && vis.diff.b <= Math.max(vis.board.b, vis.vh), true);
    await c.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);

    head('M2-T1-AC3 the subtitle no longer claims every answer is an execution');
    await ev('document.getElementById("puzToggle").click();');        // back out
    const note = await ev('return document.getElementById("puzNote").textContent');
    console.log('       subtitle: ' + note);
    chk('AC3  the old claim is gone', /executing your own piece is the answer/.test(note), false);
    chk('AC3  and it is family-neutral, so a restraint family cannot falsify it',
      /self-capture rule decides the answer/.test(note), true);
    // Derived from the data, so it cannot go stale when a family is added.
    const famLine = await ev(
      'var c = {}, o = [];' +
      'window.TYRANNY_PUZZLES.puzzles.forEach(function(p){ var f = p.family || "puzzle";' +
      '  if(!(f in c)){ c[f] = 0; o.push(f); } c[f]++; });' +
      'return o.map(function(f){ return c[f] + " " + f; }).join(", ");');
    chk('AC3  the counts in the subtitle are the real counts from the set',
      note.indexOf(famLine) >= 0, true);

    /* ---------------- M2-T2 : Try again ---------------- */
    head('M2-T2-AC1/AC3 a wrong move lands, offers Try again, and reveals nothing');
    // A synthetic puzzle carrying BOTH castling rights and an en-passant square,
    // because the real set may contain neither and AC2 names them explicitly.
    const SYN = 'rnbqkbnr/pp1ppppp/8/2pP4/8/8/PPP1PPPP/RNBQKBNR w KQkq c6 0 3';
    await ev('window.TYRANNY_PUZZLES = {schema:2, puzzles:[{id:"syn-1", family:"synthetic",' +
      ' fen:"' + SYN + '", sideToMove:"w", solutions:[{from:27,to:18,promo:null}],' +
      ' solutionsSan:["dxc6"], rationale:"en passant", difficulty:1}]}; return 1;');
    await ev('document.getElementById("puzToggle").click();');
    chk('     loaded the synthetic puzzle', await ev('return window.puz.list[0].id'), 'syn-1');
    chk('     its FEN really does carry rights and an ep square',
      await ev('return window.puz.list[0].fen'), SYN);
    await ev(pick(52));                                  // e2
    await ev(pick(36));                                  // e4 - legal, and not the idea
    chk('AC1  the wrong move LANDED on the board',
      await ev('return window.hist.length'), 2);
    chk('AC1  the panel is in the wrong-answer state', await ev('return window.puz.state'), 'wrong');
    chk('AC1  Try again is offered and enabled',
      await ev('return document.getElementById("puzRetry").disabled'), false);
    chk('AC3  Next is disabled, so nothing advances past a failure',
      await ev('return document.getElementById("puzNext").disabled'), true);
    const said = await ev('return document.getElementById("puzSay").textContent');
    console.log('       wrong-answer text: ' + said);
    chk('AC3  the answer square is not named', /c6|d5|dxc6/.test(said), false);
    chk('AC3  the number of answers is not leaked either', /correct answer/.test(said), false);

    head('M2-T2-AC2 Try again restores the FEN exactly, compared string for string');
    const dirty = await ev('return window.hist[window.hist.length-1];');
    chk('     control: the position really did differ before the retry',
      toFen(dirty) === SYN, false);
    console.log('       after the wrong move: ' + toFen(dirty));
    await ev('document.getElementById("puzRetry").click();');
    const back = await ev('return window.hist[window.hist.length-1];');
    chk('AC2  restored FEN is byte-identical to the puzzle fen field', toFen(back), SYN);
    chk('AC2  side to move', back.turn, 'w');
    chk('AC2  castling rights, all four',
      [back.cast.K, back.cast.Q, back.cast.k, back.cast.q].join(','), 'true,true,true,true');
    chk('AC2  the en-passant square survived (c6 = 18)', back.ep, 18);
    chk('AC2  halfmove and fullmove clocks', back.half + '/' + back.full, '0/3');
    chk('AC2  back to open, and Try again is no longer offered',
      await ev('return window.puz.state + "/" + document.getElementById("puzRetry").disabled'), 'open/true');

    head('M2-T2-AC4 retries do not corrupt the tally');
    for(let i = 0; i < 3; i++){ await ev(pick(52)); await ev(pick(36));
                                await ev('document.getElementById("puzRetry").click();'); }
    chk('AC4  four failures recorded', await ev('return window.puz.tries'), 4);
    chk('AC4  nothing counted as solved yet',
      await ev('return Object.keys(window.puz.solved).length'), 0);
    await ev(pick(27)); await ev(pick(18));              // d5 takes c6 en passant - the answer
    chk('AC4  the solve registers after four failures', await ev('return window.puz.state'), 'solved');
    chk('AC4  counted exactly once', await ev('return window.puz.solved["syn-1"] ? 1 : 0'), 1);
    chk('AC4  progress reads 1 / 1, one solved', await ev('return document.getElementById("puzProg").textContent'),
      '1 / 1  · 1 solved');

    /* ---------------- M2-T1-AC5 : the whole round trip, real set ---------------- */
    head('M2-T1-AC5 enter, solve, advance, leave, and play on');
    await load();                                        // real puzzle set back
    await ev('document.getElementById("puzToggle").click();');
    const solve = await ev(
      'for(var i=0;i<window.puz.list.length;i++){ var p = window.puz.list[i];' +
      '  if(!p.solutions[0].promo){ return {i:i, from:p.solutions[0].from, to:p.solutions[0].to, id:p.id}; } }' +
      'return null;');
    await ev('puzLoad(' + solve.i + '); return 1;');
    await ev(pick(solve.from)); await ev(pick(solve.to));
    chk('AC5  solved a real puzzle from the shipped set (' + solve.id + ')',
      await ev('return window.puz.state'), 'solved');
    chk('AC5  Next is enabled once it is solved',
      await ev('return document.getElementById("puzNext").disabled'), false);
    await ev('document.getElementById("puzNext").click();');
    chk('AC5  advanced to the next puzzle', await ev('return window.puz.i'), solve.i + 1);
    chk('AC5  and the new one is open again', await ev('return window.puz.state'), 'open');
    await ev('document.getElementById("puzToggle").click();');
    chk('AC5  left puzzle mode', await ev('return window.puz'), null);
    chk('AC5  the board is back to the opening position',
      await ev('return window.hist.length + "/" + (window.hist[0].b[0] === "br")'), '1/true');
    chk('AC5  opponent and strength are usable again',
      await ev('return document.querySelectorAll("#modeSeg button[disabled], #levelSeg button[disabled]").length'), 0);
    chk('AC5  self-capture is unlocked again',
      await ev('return document.getElementById("ruleBtn").disabled'), false);
    const e2e4 = await ev(pick(52) + pick(36) + 'return window.hist.length;');
    chk('AC5  and a normal move plays after leaving', e2e4, 2);

    /* ---------------- M3 : the two new families, in the page ---------------- */
    await load();
    head('M3-T2-AC3 the tempting self-capture produces the wrong-answer state, not silence');
    chk('     the shipped set carries all four families',
      await ev('var f = {};' +
               'window.TYRANNY_PUZZLES.puzzles.forEach(function(p){ f[p.family] = 1; });' +
               'return ["escape","tactical","restraint","multistep"].every(function(k){ return !!f[k]; });'), true);
    await ev('document.getElementById("puzToggle").click();');
    const restraint = await ev(
      'for(var i=0;i<window.puz.list.length;i++){ var p = window.puz.list[i];' +
      '  if(p.family === "restraint" && p.decoys.length){' +
      '    return {i:i, id:p.id, decoy:p.decoys[0].uci, selfs:p.selfCaptureCount, sols:p.solutions.length}; } }' +
      'return null;');
    chk('     found a restraint puzzle with a temptation on the board', !!restraint, true);
    await ev('puzLoad(' + restraint.i + '); return 1;');
    // The decoys of a restraint ARE its legal self-captures, so decoy 0 is the trap.
    const trap = await ev(
      'var d = "' + restraint.decoy + '";' +
      'var S = window.hist[window.hist.length-1];' +
      'var ms = legal(S, true).filter(function(m){' +
      '  function nm(i){ return "abcdefgh"[i%8] + (8 - ((i/8)|0)); }' +
      '  return nm(m.from)+nm(m.to) === d; });' +
      'return ms.length ? {from:ms[0].from, to:ms[0].to, kind:ms[0].kind} : null;');
    chk('     the decoy really is a legal self-capture', trap && trap.kind, 'self');
    await ev(pick(trap.from)); await ev(pick(trap.to));
    chk('AC3  playing the execution lands it and sets the wrong-answer state',
      await ev('return window.puz.state'), 'wrong');
    chk('AC3  and offers Try again rather than saying nothing',
      await ev('return document.getElementById("puzRetry").disabled'), false);
    const trapSay = await ev('return document.getElementById("puzSay").textContent');
    chk('AC3  the wrong-answer text is not silence', trapSay.length > 20, true);
    await ev('document.getElementById("puzRetry").click();');
    chk('AC3  Try again restores the restraint position exactly',
      toFen(await ev('return window.hist[window.hist.length-1];')),
      await ev('return window.puz.list[' + restraint.i + '].fen'));
    // ...and the ordinary mate IS accepted
    const win = await ev('var p = window.puz.list[' + restraint.i + '];' +
      'return {from:p.solutions[0].from, to:p.solutions[0].to};');
    await ev(pick(win.from)); await ev(pick(win.to));
    chk('AC3  the ordinary move is the one that solves it', await ev('return window.puz.state'), 'solved');
    const solvedSay = await ev('return document.getElementById("puzSay").textContent');
    chk('AC3  and the page does not congratulate an execution that never happened',
      /every one of them is an execution/.test(solvedSay), false);

    head('M3-T2-AC4 the reader knows its own schema and refuses one it does not');
    await load();
    chk('     the shipped file is schema 3', await ev('return window.TYRANNY_PUZZLES.schema'), 3);
    await ev('window.TYRANNY_PUZZLES = {schema:99, puzzles:[{id:"x", fen:"7k/8/8/8/8/8/8/7K w - - 0 1",' +
             ' solutions:[{from:63,to:62,promo:null}]}]}; return 1;');
    const refused = await ev('return JSON.stringify(puzRead());');
    chk('AC4  a schema this page has never seen is refused, not read as an old one',
      JSON.parse(refused).why, 'unknown-schema');
    chk('AC4  and it refuses without throwing', JSON.parse(refused).ok, false);

    /* ---------------- a wrong answer that ENDS the game ---------------- */
    /*
     * Letting a wrong move land has a consequence nobody asked for: across the
     * 121 shipped puzzles there are 3,725 non-solution legal moves, and seven of
     * them finish the game — six stalemate the opponent and one strips the board
     * to insufficient material. None checkmates, which was the hazard worth
     * ruling out. res-0019 Be2 is one of the six, and this is it happening.
     */
    head('A wrong answer that ends the game still reads as a wrong answer');
    await load();
    await ev('document.getElementById("puzToggle").click();');
    const ri = await ev('for(var i=0;i<window.puz.list.length;i++) ' +
      'if(window.puz.list[i].id === "res-0019") return i; return -1;');
    chk('     res-0019 is in the shipped set', ri >= 0, true);
    await ev('puzLoad(' + ri + '); return 1;');
    const be2 = await ev(
      'var S = window.hist[window.hist.length-1];' +
      'var m = legal(S, true).filter(function(x){ return san(S, x, true) === "Be2"; })[0];' +
      'return m ? {from:m.from, to:m.to} : null;');
    chk('     Be2 is legal here and is not a solution', !!be2, true);
    await ev(pick(be2.from)); await ev(pick(be2.to));
    chk('     it really does end the game', await ev('return window.overTxt'), 'Draw — stalemate');
    chk('     and it really is judged wrong', await ev('return window.puz.state'), 'wrong');
    const line = await ev('return document.getElementById("stateTxt").textContent;');
    console.log('       status line: ' + line);
    chk('the status line leads with the puzzle verdict, not the draw',
      /^Not the answer/.test(line), true);
    chk('and still names what actually happened on the board', /stalemate/i.test(line), true);
    chk('it is styled as a warning, not as a finished game',
      await ev('return document.getElementById("stateTxt").className'), 'state warn');
    chk('Try again is offered', await ev('return document.getElementById("puzRetry").disabled'), false);
    await ev('document.getElementById("puzRetry").click();');
    chk('Try again clears the game-over state',
      await ev('return String(window.overTxt);'), 'null');
    chk('and restores the puzzle position exactly',
      toFen(await ev('return window.hist[window.hist.length-1];')),
      await ev('return window.puz.list[' + ri + '].fen;'));
    chk('the board is playable again',
      await ev(pick(be2.from) + 'return window.targets.length > 0;'), true);

    /* ---------------- the in-page suite, actually run ---------------- */
    /*
     * M1-T1-AC5 pins the in-page suite at "48 passed, 0 failed". Reading the
     * source and concluding runTests() was untouched is NOT that check -- it is
     * an inference. This clicks the button and reads what the page reports.
     */
    head('In-page suite: click Run tests and read the number off the page');
    await load();
    await ev('document.getElementById("testBtn").click();');
    const inPage = await ev('return document.getElementById("testOut").textContent;');
    const tail = (inPage.match(/(\d+)\s+passed[,\s]+(\d+)\s+failed/i) || []).slice(1, 3);
    console.log('       page reports: ' + tail.join(' passed, ') + ' failed');
    chk('AC5  the in-page suite still reports 48 passed', tail[0], '48');
    chk('AC5  and 0 failed', tail[1], '0');
  } finally {
    try { c.close(); } catch(e){}
    try { proc.kill(); } catch(e){}
    srv.close();
    await sleep(200);
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch(e){}
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if(fail) failures.forEach(f => console.log('  FAILED: ' + f));
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('browser.js: ' + e.message); process.exit(2); });
