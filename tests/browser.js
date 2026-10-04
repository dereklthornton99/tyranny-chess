/*
 * Real-browser checks. Drives headless Chrome over its own DevTools protocol
 * and asserts against the LIVE DOM -- reading the source is explicitly not
 * enough for these (goal-tree M1-T2-AC3).
 *
 * Zero dependencies, deliberately: the repo has none and this does not add any.
 * Node 24 ships a global WebSocket, which is the whole CDP client.
 *
 * SEPARATE RUNNER, ALSO DELIBERATELY. This is not in tests/run-all.js's suite
 * loop, so the Node count stays a number about Node. It IS run by CI as its own
 * step: no suite under tests/ other than this one touches the page's UI, so
 * without it the marker toggle, puzzle mode and the Try again reset could all
 * be deleted with the build staying green.
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

  /* Wait for the PAGE's own timers instead of guessing how long they take. The
     opponent's scripted reply is a 520ms setTimeout inside the page. A fixed
     900ms sleep passed on an idle machine and failed with every core busy ("the
     reply landed on the board: got 2, want 3") -- which is how a shared CI
     runner behaves. Poll the condition, give up only after ten seconds, and
     return whether it held so the caller asserts on it. */
  async function until(cond, limitMs){
    const t0 = Date.now(), limit = limitMs || 10000;
    for(;;){
      if(await ev('return !!(' + cond + ');')) return true;
      if(Date.now() - t0 > limit) return false;
      await sleep(25);
    }
  }

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
    //
    // The selection is CLEARED before every click, and that is the fix for a
    // flaky test that predates the multi-move work. Clicking piece A selects it;
    // clicking the next piece B then EXECUTES A-takes-B whenever B is one of A's
    // targets, and under this rule friendly pieces are targets. So the "just
    // select everything" sweep was quietly PLAYING a move in 195 of the 280
    // puzzles, and in five survival puzzles (sur-0015, 0046, 0076, 0079, 0116)
    // that move was the solution: the puzzle came out marked solved and the
    // later check "nothing counted as solved yet" failed, about one run in fifty,
    // on whichever puzzle the shuffle dealt first. Reproduced deterministically by
    // dealing sur-0015: the sweep played K(x)h8 and the page marked it solved.
    const sweep = await ev(
      'var S = window.hist[window.hist.length-1], n = 0, moves = 0, picked = 0, h0 = window.hist.length;' +
      'for(var i=0;i<64;i++){ if(S.b[i] && S.b[i][0] === S.turn){' +
      '  window.sel = -1; window.targets = [];' +
      '  document.querySelector(\'[data-sq="\'+i+\'"]\').click(); picked++;' +
      '  moves += window.targets.length;' +
      '  n += document.querySelectorAll("' + MARKS + '").length; } }' +
      'return {marks:n, moves:moves, picked:picked, played:window.hist.length - h0};');
    chk('AC1  no dot, no ring, no brackets on ANY square, over every movable piece', sweep.marks, 0);
    chk('AC1  control: the sweep really did select pieces', sweep.picked > 0, true);
    chk('AC1  control: those pieces really did have legal moves to mark', sweep.moves > 0, true);
    chk('AC1  control: the sweep only SELECTED pieces, it never played a move', sweep.played, 0);
    // Mutation: with the puzzle-mode override removed, the SAME sweep must light up.
    // If it does not, the zero above was measuring nothing.
    const mutated = await ev(
      'var real = window.marksVisible; window.marksVisible = function(){ return window.showMarks; };' +
      'var S = window.hist[window.hist.length-1], n = 0;' +
      'for(var i=0;i<64;i++){ if(S.b[i] && S.b[i][0] === S.turn){' +
      '  window.sel = -1; window.targets = [];' +
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
    /* The stored solved-set is cleared first: this section asserts "nothing counted
       as solved yet", which is a claim about THIS section and must not depend on
       whatever an earlier one happened to leave in localStorage. */
    await ev('localStorage.removeItem("tyranny.puzzles.solved.v1");' +
      'window.TYRANNY_PUZZLES = {schema:2, puzzles:[{id:"syn-1", family:"synthetic",' +
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
      /* Not the LAST entry: the set is shuffled on entry now, so "first puzzle
         with a non-promotion solution" is no longer guaranteed to be index 0,
         and landing on the last one would make the Next assertion below fail
         for a reason that has nothing to do with what is being tested.

         And not a LINE-CARRYING one either (schema 5): this check is the
         one-move round trip, and a multi-move puzzle correctly answers its
         first move with "mid" rather than "solved". Excluding it here is not
         a coverage gap -- the multi-move path is R3-M1-AC5 below, which asserts
         the opposite of this on purpose. */
      'for(var i=0;i<window.puz.list.length-1;i++){ var p = window.puz.list[i];' +
      '  if(!p.solutions[0].promo && !p.line){ return {i:i, from:p.solutions[0].from, to:p.solutions[0].to, id:p.id}; } }' +
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
               'return ["tactical","restraint","multistep","survival"].every(function(k){ return !!f[k]; }) && !f.escape;'), true);
    await ev('document.getElementById("puzToggle").click();');
    /* Chosen from the DATA, not from the random deal. This used to take "the first
       restraint puzzle the shuffle dealt", and two of the 40 (res-0029, res-0033)
       are solved by a PROMOTION: clicking from-square then to-square opens a
       piece-choice dialog instead of finishing the move, so the section failed
       with "got open, want solved" whenever one of them came up first -- 2 runs in
       40, and it was already so before the multi-move work. Sorted by id, and
       restricted to puzzles whose answer and trap are plain two-click moves. */
    const restraint = await ev(
      'var L = window.puz.list.map(function(p, i){ return {p:p, i:i}; })' +
      '  .sort(function(a, b){ return a.p.id < b.p.id ? -1 : 1; });' +
      'for(var k=0;k<L.length;k++){ var p = L[k].p;' +
      '  if(p.family === "restraint" && p.decoys.length && !p.solutions[0].promo && p.decoys[0].uci.length === 4){' +
      '    return {i:L[k].i, id:p.id, decoy:p.decoys[0].uci, selfs:p.selfCaptureCount, sols:p.solutions.length}; } }' +
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
    chk('     the shipped file is schema 5', await ev('return window.TYRANNY_PUZZLES.schema'), 5);
    await ev('window.TYRANNY_PUZZLES = {schema:99, puzzles:[{id:"x", fen:"7k/8/8/8/8/8/8/7K w - - 0 1",' +
             ' solutions:[{from:63,to:62,promo:null}]}]}; return 1;');
    const refused = await ev('return JSON.stringify(puzRead());');
    chk('AC4  a schema this page has never seen is refused, not read as an old one',
      JSON.parse(refused).why, 'unknown-schema');
    chk('AC4  and it refuses without throwing', JSON.parse(refused).ok, false);

    /* ---------------- survival: a wrong answer that teaches ---------------- */
    /*
     * The family this replaced could not be answered incorrectly — it listed
     * every legal move as a solution. These checks are the opposite claim:
     * there are wrong answers, and picking one tells you what refuted it.
     */
    head('Survival has wrong answers, and says what beat you');
    await load();
    await ev('document.getElementById("puzToggle").click();');
    /* From the data (id order), not the deal, for the same reason as the restraint
       section above: a dealt-order pick makes the outcome depend on a shuffle. */
    const sv = await ev(
      'var L = window.puz.list.map(function(p, i){ return {p:p, i:i}; })' +
      '  .sort(function(a, b){ return a.p.id < b.p.id ? -1 : 1; });' +
      'for(var k=0;k<L.length;k++){ var p = L[k].p;' +
      '  if(p.family === "survival" && p.decoys.length && p.decoys[0].refutedBy' +
      '     && p.solutionsUci[0].length === 4 && p.decoys[0].uci.length === 4){' +
      '    return {i:L[k].i, id:p.id, sol:p.solutionsUci[0], decoy:p.decoys[0].uci,' +
      '            beats:p.decoys[0].refutedBy, legal:p.legalMoveCount,' +
      '            sols:p.solutions.length, url:p.source.url}; } }' +
      'return null;');
    chk('     found a survival puzzle', !!sv, true);
    chk('AC   it has real wrong answers: fewer solutions than legal moves',
      sv.sols + ' of ' + sv.legal, '1 of 3');
    chk('     and it is traceable to a real game', /^https:\/\/lichess\.org\//.test(sv.url), true);
    await ev('puzLoad(' + sv.i + '); return 1;');
    const dm = await ev(
      'var S = window.hist[window.hist.length-1];' +
      'function nm(i){ return "abcdefgh"[i%8] + (8 - ((i/8)|0)); }' +
      'var m = legal(S, true).filter(function(x){ return nm(x.from)+nm(x.to) === "' + sv.decoy + '"; })[0];' +
      'return m ? {from:m.from, to:m.to, kind:m.kind} : null;');
    chk('     the decoy is a legal self-capture', dm && dm.kind, 'self');
    await ev(pick(dm.from)); await ev(pick(dm.to));
    chk('AC   a losing escape is judged WRONG', await ev('return window.puz.state'), 'wrong');
    const told = await ev('return document.getElementById("puzSay").textContent;');
    console.log('       told: ' + told);
    chk('AC   and the page names what refuted it', told.indexOf(sv.beats) >= 0, true);
    /* Naming what refuted YOUR move is not naming the puzzle's answer. The
       square the winning move goes to must not appear in the message. */
    chk('AC   without naming the square the answer moves to',
      told.indexOf(sv.sol.slice(2, 4)) < 0, true);
    await ev('document.getElementById("puzRetry").click();');
    const winning = await ev('var p = window.puz.list[' + sv.i + '];' +
      'return {from:p.solutions[0].from, to:p.solutions[0].to};');
    await ev(pick(winning.from)); await ev(pick(winning.to));
    chk('AC   the one surviving move solves it', await ev('return window.puz.state'), 'solved');
    await ev('document.getElementById("puzToggle").click();');

    /* ---------------- the set is dealt in a new order every time ---------------- */
    head('Puzzles are shuffled on entry, not served in generation order');
    await load();
    const ids = 'return window.puz.list.map(function(p){ return p.id; });';
    const dealA = await ev('document.getElementById("puzToggle").click();' + ids);
    await ev('document.getElementById("puzToggle").click();');            // leave
    const dealB = await ev('document.getElementById("puzToggle").click();' + ids);
    /* The size is read off the data the page shipped with, not a literal: a
       magic number here broke every time the set grew, and a test that has to be
       edited whenever the data changes teaches people to edit the test. */
    const setSize = await ev('return window.TYRANNY_PUZZLES.puzzles.length;');
    chk('     both deals contain the whole set',
      dealA.length + '/' + dealB.length, setSize + '/' + setSize);
    chk('     and the set is not empty, so that comparison means something', setSize > 0, true);
    chk('two entries deal a DIFFERENT order',
      JSON.stringify(dealA) === JSON.stringify(dealB), false);
    /* The half that matters more than the shuffle itself: a bad shuffle that
       drops or duplicates entries would still pass the check above. */
    chk('but exactly the same puzzles — none dropped, none duplicated',
      JSON.stringify(dealA.slice().sort()) === JSON.stringify(dealB.slice().sort()), true);
    chk('     and no duplicates inside one deal', new Set(dealA).size, dealA.length);
    /* puzRead() filters, so r.list is its own array; shuffling it must not
       reorder the data the page shipped with. */
    chk('the shipped data itself is untouched, still in generation order',
      await ev('var p = window.TYRANNY_PUZZLES.puzzles;' +
               'return p[0].id + "," + p[p.length-1].id;'), 'tac-0001,sur-0153');
    chk('     the families are genuinely interleaved now, not still grouped',
      await ev('var seen = {}, runs = 0, last = null;' +
               'window.puz.list.forEach(function(p){ if(p.family !== last){ runs++; last = p.family; } });' +
               'return runs > 4;'), true);
    await ev('document.getElementById("puzToggle").click();');            // leave clean

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

    /* ---------------- R3-M1-AC5 : a multi-move puzzle takes more than one move ----
     *
     * THE CRITERION TC-R2 DID NOT HAVE, and the reason this section exists.
     * Round 2's M3-T1 shipped `done` with six criteria, every one of them
     * honestly met -- and all six were about the GENERATOR and the DATA. Its
     * AC4 even walked the full forcing line. Not one of them said the PLAYER
     * is asked for the second move, so the family was built, validated and
     * shipped as a one-move puzzle. Derek, 2026-10-02: "Some of the ones that
     * are in the app already say that they are multistep but are only one
     * step."
     *
     * So these checks are deliberately about the INTERACTION. A green data
     * test is not evidence here: the first assertion below is that a correct
     * move does NOT solve the puzzle, which is the exact thing no data check
     * can see.
     */
    head('R3-M1-AC5 a correct first move does not solve a multi-move puzzle');
    await load();
    /* Every multistep puzzle carries a line, and there are at least the 27 the
       random playout produced. Compared to the family count rather than a
       literal, so a seeded set growing the family does not weaken the check. */
    chk('     every multistep puzzle the page ships carries a continuation', await ev(
      'var m = window.TYRANNY_PUZZLES.puzzles.filter(function(p){ return p.family === "multistep"; });' +
      'return m.length + "/" + m.filter(function(p){ return !!p.line; }).length;'),
      await ev('var n = window.TYRANNY_PUZZLES.puzzles.filter(function(p){ return p.family === "multistep"; }).length;' +
               'return n + "/" + n;'));
    chk('     and there are at least the 27 the random playout produced', await ev(
      'return window.TYRANNY_PUZZLES.puzzles.filter(function(p){ return p.family === "multistep"; }).length >= 27;'), true);
    await ev('document.getElementById("puzToggle").click();');
    /* The one with the MOST opponent replies, so the test runs on a position
       where the reply is a real choice rather than the only legal move. Chosen
       in-page by max `of`, not hardcoded, so regenerating the set cannot leave
       this check silently pointing at a puzzle that no longer exists. */
    const ms = await ev(
      'var best = null;' +
      'for(var i=0;i<window.puz.list.length;i++){ var p = window.puz.list[i];' +
      '  if(!p.line) continue;' +
      /* Not a promotion anywhere on the line: a click on a promoting move opens
         a piece-choice dialog this section does not drive, and it would fail for
         a reason unrelated to what is being tested. */
      '  if(p.solutions[0].promo) continue;' +
      '  if(p.line.steps[2].accept.some(function(u){ return u.length > 4; })) continue;' +
      '  var n = p.line.steps[1].of || 0;' +
      '  if(!best || n > best.of) best = {i:i, id:p.id, of:n, plies:p.line.plies,' +
      '    from:p.solutions[0].from, to:p.solutions[0].to,' +
      '    reply:p.line.steps[1].reply, mates:p.line.steps[2].accept}; }' +
      'return best;');
    chk('     found a multi-move puzzle with real opponent choice', !!ms && ms.of > 1, true);
    console.log('       using ' + ms.id + ': ' + ms.of + ' legal replies, ' +
                ms.plies + ' plies, ' + ms.mates.length + ' mating answer(s)');
    await ev('puzLoad(' + ms.i + '); return 1;');
    chk('     starts at step 0', await ev('return window.puz.step'), 0);

    await ev(pick(ms.from)); await ev(ms.to !== null ? pick(ms.to) : 'return 1;');
    chk('AC5  the correct first move does NOT solve it',
      await ev('return window.puz.state'), 'mid');
    chk('AC5  and nothing is recorded as solved yet',
      await ev('return window.puz.solved["' + ms.id + '"] ? 1 : 0'), 0);
    chk('AC5  Next stays disabled, so the second move cannot be skipped',
      await ev('return document.getElementById("puzNext").disabled'), true);

    head('R3-M1-AC5 the opponent actually replies, with the stored move');
    const plyBefore = await ev('return window.hist.length;');
    chk('AC5  the opponent replies (waited for, not slept for)', await until('window.puz.step === 2'), true);
    chk('AC5  the reply landed on the board', await ev('return window.hist.length;'), plyBefore + 1);
    chk('AC5  and it is the move the data stored',
      await ev('var m = window.lastMv;' +
               'function nm(i){ return "abcdefgh"[i%8] + (8 - ((i/8)|0)); }' +
               'return nm(m.from) + nm(m.to) + (m.promo || "");'), ms.reply);
    chk('AC5  the step counter advanced to the second solver move',
      await ev('return window.puz.step'), 2);
    const asked = await ev('return document.getElementById("puzSay").textContent;');
    console.log('       prompt: ' + asked);
    chk('AC5  the player is told to finish it', /finish it/i.test(asked), true);
    /* The opponent's reply must not read as the puzzle's solution: the first
       wording said "The answer is Nf6" about the OPPONENT's move. */
    chk('AC5  the prompt says the OPPONENT played the reply, not that it is "the answer"',
      /The opponent plays/.test(asked) && !/The answer is/.test(asked), true);
    /* Honest wording, not a blanket "forced": this puzzle has several replies. */
    chk('AC5  and is told the reply was a choice, not forced',
      /one of \d+ replies/.test(asked), true);
    chk('AC5  without naming the mating square',
      asked.indexOf(ms.mates[0].slice(2, 4)) < 0, true);

    head('R3-M1-AC5 a wrong second move is wrong, and Try again restarts the puzzle');
    const dud = await ev(
      'var S = window.hist[window.hist.length-1];' +
      'var acc = ' + JSON.stringify(ms.mates) + ';' +
      'function nm(i){ return "abcdefgh"[i%8] + (8 - ((i/8)|0)); }' +
      'var m = legal(S, true).filter(function(x){' +
      '  return acc.indexOf(nm(x.from)+nm(x.to)+(x.promo||"")) < 0 && !x.promo; })[0];' +
      'return m ? {from:m.from, to:m.to} : null;');
    chk('     there is a legal second move that is not the answer', !!dud, true);
    await ev(pick(dud.from)); await ev(pick(dud.to));
    chk('AC5  a legal non-mating second move is judged wrong',
      await ev('return window.puz.state'), 'wrong');
    chk('AC5  Try again is offered',
      await ev('return document.getElementById("puzRetry").disabled'), false);
    const midSay = await ev('return document.getElementById("puzSay").textContent;');
    chk('AC5  and says the whole puzzle goes back, not just the move',
      /whole puzzle back/.test(midSay), true);
    await ev('document.getElementById("puzRetry").click();');
    chk('AC5  Try again restores the ORIGINAL position, not the mid-line one',
      toFen(await ev('return window.hist[window.hist.length-1];')),
      await ev('return window.puz.list[' + ms.i + '].fen;'));
    chk('AC5  and resets the step counter, so move one is asked for again',
      await ev('return window.puz.step'), 0);

    /* Found by deepcheck with a live repro: the correct first move followed AT
       ONCE by any move on the opponent's side was scored "Not it", counted a
       try, and cancelled the stored reply -- a right answer turned into a
       failure by a click half a second later. Both clicks happen inside ONE
       page evaluation, so the 520ms timer cannot fire between them and the
       early move is made while the reply is still pending, every time, however
       busy the machine is. */
    head('R3-M1-AC5 a click inside the opponent reply window is ignored, not judged');
    const early = await ev(
      'function nm(i){ return "abcdefgh"[i%8] + (8 - ((i/8)|0)); }' +
      'function tap(s){ document.querySelector(\'[data-sq="\' + s + \'"]\').click(); }' +
      'tap(' + ms.from + '); tap(' + ms.to + ');' +                              // the correct move 1
      'var S = window.hist[window.hist.length-1];' +
      'var stray = legal(S, true).filter(function(x){' +
      '  return nm(x.from) + nm(x.to) + (x.promo || "") !== "' + ms.reply + '"; })[0];' +
      'var before = {state: window.puz.state, hist: window.hist.length, tries: window.puz.tries};' +
      'if(stray){ tap(stray.from); tap(stray.to); }' +                           // early, opponent-side
      'return {hadStray: !!stray, before: before,' +
      '  after: {state: window.puz.state, hist: window.hist.length, tries: window.puz.tries}};');
    chk('     there was a legal opponent move to make early', early.hadStray, true);
    chk('AC5  the early move is refused: still mid-line, not "wrong"', early.after.state, 'mid');
    chk('AC5  no try is counted against the player', early.after.tries, early.before.tries);
    chk('AC5  and the early move added nothing to the board', early.after.hist, early.before.hist);
    chk('AC5  the stored reply still lands afterwards', await until('window.puz.step === 2'), true);
    chk('AC5  and it is the stored one',
      await ev('var m = window.lastMv;' +
               'function nm(i){ return "abcdefgh"[i%8] + (8 - ((i/8)|0)); }' +
               'return nm(m.from) + nm(m.to) + (m.promo || "");'), ms.reply);

    head('R3-M1-AC5 playing the whole line through solves it');
    await ev('puzLoad(' + ms.i + '); return 1;');                      // fresh: the early-click test used it up
    await ev(pick(ms.from)); await ev(pick(ms.to));
    chk('     the opponent replied before the finishing move was asked for',
      await until('window.puz.step === 2'), true);
    const fin = await ev(
      'var S = window.hist[window.hist.length-1];' +
      'var want = ' + JSON.stringify(ms.mates[0]) + ';' +
      'function nm(i){ return "abcdefgh"[i%8] + (8 - ((i/8)|0)); }' +
      'var m = legal(S, true).filter(function(x){ return nm(x.from)+nm(x.to)+(x.promo||"") === want; })[0];' +
      'return m ? {from:m.from, to:m.to} : null;');
    chk('     the stored mating move is legal in the reached position', !!fin, true);
    await ev(pick(fin.from)); await ev(pick(fin.to));
    chk('AC5  the second move solves it', await ev('return window.puz.state'), 'solved');
    chk('AC5  it really is mate on the board',
      await ev('return String(window.overTxt).indexOf("checkmate") >= 0;'), true);
    chk('AC5  counted as solved exactly once',
      await ev('return window.puz.solved["' + ms.id + '"] ? 1 : 0'), 1);
    chk('AC5  Next is enabled only now',
      await ev('return document.getElementById("puzNext").disabled'), false);

    head('R3-M1-AC8 Reveal mid-line gives the whole remaining line, not one move');
    await load();
    await ev('document.getElementById("puzToggle").click();');
    /* Re-find it by id. Entering puzzle mode RESHUFFLES, so ms.i is an index
       into the previous deal and reusing it here silently tests a different
       puzzle -- which is what it did on the first run of this check, landing on
       a survival one-mover and failing for the wrong reason. */
    const msAgain = await ev(
      'for(var i=0;i<window.puz.list.length;i++)' +
      '  if(window.puz.list[i].id === "' + ms.id + '") return i;' +
      'return -1;');
    chk('     re-found ' + ms.id + ' in the new deal', msAgain >= 0, true);
    await ev('puzLoad(' + msAgain + '); return 1;');
    chk('     and it really is the multi-move one',
      await ev('return window.puz.list[' + msAgain + '].id'), ms.id);
    await ev('document.getElementById("puzReveal").click();');
    const revAll = await ev('return document.getElementById("puzSay").textContent;');
    console.log('       reveal: ' + revAll);
    chk('AC8  Reveal names the opponent reply as part of the answer',
      revAll.indexOf(ms.of + ', all losing') >= 0, true);
    chk('AC8  and the mating move too',
      revAll.length > 40 && /…/.test(revAll), true);

    /* ---------------- R3-M2-AC5 : the page is not limited to two moves ----------
     *
     * No shipped puzzle is deeper than mate-in-two, so nothing in the real data
     * can show that the page handles a longer line -- and "the representation
     * needs no second schema change" is a claim about exactly that. This builds
     * a FIVE-ply line (three solver moves, two scripted replies) out of the
     * opening position, where every move is legal by inspection, and plays it
     * through the same code path the real puzzles use.
     *
     * It tests the page's generality only. The generator and validator build
     * and check three-ply lines, deliberately: the multistep family is mate in
     * two. A deeper FAMILY would need its own predicate; a deeper LINE needs
     * nothing from the page.
     */
    head('R3-M2-AC5 a five-ply line is played through by the same code');
    const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    await load();
    await ev('window.TYRANNY_PUZZLES = {schema:5, puzzles:[{id:"syn-deep", family:"synthetic",' +
      ' fen:"' + START + '", sideToMove:"w", solutions:[{from:52,to:36,promo:null}],' +
      ' solutionsSan:["e4"], rationale:"depth test", difficulty:1,' +
      ' line:{plies:5, steps:[' +
      '  {side:"solver", accept:["e2e4"], acceptSan:["e4"]},' +
      '  {side:"opponent", reply:"e7e5", replySan:"e5", of:20},' +
      '  {side:"solver", accept:["g1f3"], acceptSan:["Nf3"]},' +
      '  {side:"opponent", reply:"b8c6", replySan:"Nc6", of:30},' +
      '  {side:"solver", accept:["f1b5"], acceptSan:["Bb5"], mate:true}]}}]}; return 1;');
    await ev('document.getElementById("puzToggle").click();');
    chk('     loaded the synthetic five-ply puzzle', await ev('return window.puz.list[0].id'), 'syn-deep');

    await ev(pick(52)); await ev(pick(36));                      // e2-e4
    chk('deep  move 1 of 3 leaves it open', await ev('return window.puz.state'), 'mid');
    await until('window.puz.step === 2');
    chk('deep  the first scripted reply landed (e7-e5)',
      await ev('return window.hist.length + "/" + window.puz.step'), '3/2');

    /* A wrong move DEEP in the line restarts the whole puzzle, not just a move. */
    await ev(pick(48)); await ev(pick(40));                      // a2-a3: legal, not the idea
    chk('deep  a wrong move mid-line is judged wrong', await ev('return window.puz.state'), 'wrong');
    await ev('document.getElementById("puzRetry").click();');
    chk('deep  Try again restores the ORIGINAL position, five plies back',
      toFen(await ev('return window.hist[window.hist.length-1];')), START);
    chk('deep  and rewinds the step counter to the start',
      await ev('return window.puz.state + "/" + window.puz.step'), 'open/0');

    await ev(pick(52)); await ev(pick(36));                      // e4 again
    await until('window.puz.step === 2');
    await ev(pick(62)); await ev(pick(45));                      // Nf3
    chk('deep  move 2 of 3 also leaves it open, not solved',
      await ev('return window.puz.state + "/" + window.puz.step'), 'mid/3');
    chk('deep  and nothing is recorded as solved with a move still to go',
      await ev('return window.puz.solved["syn-deep"] ? 1 : 0'), 0);
    await until('window.puz.step === 4');
    chk('deep  the second scripted reply landed (b8-c6), one move to go',
      await ev('return window.hist.length + "/" + window.puz.step'), '5/4');
    chk('deep  Next is still disabled with one move to go',
      await ev('return document.getElementById("puzNext").disabled'), true);
    await ev(pick(61)); await ev(pick(25));                      // Bb5
    chk('deep  the third move finally solves it', await ev('return window.puz.state'), 'solved');
    chk('deep  counted as solved exactly once',
      await ev('return window.puz.solved["syn-deep"] ? 1 : 0'), 1);
    chk('deep  and only now is Next enabled',
      await ev('return document.getElementById("puzNext").disabled'), false);

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
