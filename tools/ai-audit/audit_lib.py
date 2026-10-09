"""Shared pieces for the AI audit: a client for the page's engine, Stockfish helpers, the accuracy formulas.

Referee and opponent are independent of the thing being measured: python-chess judges every move and every result,
Stockfish is the yardstick, and the player is the page's own engine code, served by engine-server.js.
"""
import json
import math
import os
import random
import shutil
import subprocess
import sys
import time

import chess
import chess.engine

ROOT = r"C:\Users\crick\Github\Git\tyranny-chess"
SF = os.environ.get("STOCKFISH") or (
    r"C:\Users\crick\Github\Git\signpost-library\_context\chess-test"
    r"\engine\stockfish\stockfish\stockfish-windows-arm64-universal.exe")
NODE = shutil.which("node") or "node"
SERVER = os.path.join(ROOT, "tools", "ai-audit", "engine-server.js")
OUT = os.path.join(ROOT, "_context", "ai-audit")


class JsEngine:
    """The page's engine, one request at a time over a pipe."""

    def __init__(self, server=SERVER, self_cap=False, engine=None):
        self.self_cap = self_cap          # False = standard rules; True = Tyranny, the page's default
        env = dict(os.environ)
        if engine:
            env["AUDIT_ENGINE"] = engine      # a modified copy of tests/engine.js, for counterfactual runs
        self.p = subprocess.Popen([NODE, server], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True, encoding="utf-8", bufsize=1, cwd=ROOT, env=env)
        self.n = 0

    def call(self, **req):
        self.n += 1
        req["id"] = self.n
        self.p.stdin.write(json.dumps(req) + "\n")
        self.p.stdin.flush()
        line = self.p.stdout.readline()
        if not line:
            raise RuntimeError("engine server died: " + (self.p.stderr.read() or "")[:400])
        r = json.loads(line)
        if "error" in r:
            raise RuntimeError("engine server: " + r["error"] + " for " + json.dumps(req)[:300])
        return r

    def move(self, start_fen, moves, level, self_cap=None, seed=None):
        req = dict(op="move", start=start_fen, moves=moves, level=level, selfCap=self.self_cap if self_cap is None else self_cap)
        if seed is not None:
            req["seed"] = seed            # makes a sampling tier replayable; ignored by tiers that do not sample
        return self.call(**req)

    def legal(self, start_fen, moves, self_cap=None):
        return self.call(op="legal", start=start_fen, moves=moves, selfCap=self.self_cap if self_cap is None else self_cap)["moves"]

    def root(self, start_fen, moves, depth, self_cap=None):
        return self.call(op="root", start=start_fen, moves=moves, depth=depth, selfCap=self.self_cap if self_cap is None else self_cap)["moves"]

    def levels(self):
        return self.call(op="levels")["levels"]

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=5)
        except Exception:
            self.p.kill()


def open_sf(elo=None, skill=None, hash_mb=32, threads=1):
    """Stockfish. elo=N limits strength to about N (Stockfish's own scale, 1320 to 3190)."""
    e = chess.engine.SimpleEngine.popen_uci(SF)
    cfg = {"Threads": threads, "Hash": hash_mb}
    if elo is not None:
        cfg.update({"UCI_LimitStrength": True, "UCI_Elo": int(elo)})
    if skill is not None:
        cfg["Skill Level"] = int(skill)
    e.configure(cfg)
    return e


def cp_of(info, pov, cap=1000):
    """Centipawns for `pov` from an analysis result, mate counted as +-100000 and everything clipped to +-cap."""
    v = info["score"].pov(pov).score(mate_score=100000)
    return max(-cap, min(cap, v))


def win_pct(cp):
    """Lichess's win-probability curve."""
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def move_accuracy(win_before, win_after):
    """Lichess's per-move accuracy (modules/analyse/src/main/AccuracyPercent.scala, read 2026-10-08): 100 when the move
    did not lower the mover's win%, else 103.1668100711649 * exp(-0.04354415386753951 * drop) - 3.166924740191411 + 1,
    the +1 being Lichess's 'uncertainty bonus', clamped to 0..100. win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
    (ui/lib/src/ceval/winningChances.ts)."""
    if win_after >= win_before:
        return 100.0
    raw = 103.1668100711649 * math.exp(-0.04354415386753951 * (win_before - win_after)) - 3.166924740191411 + 1
    return max(0.0, min(100.0, raw))


def npm(board):
    """Non-pawn material of both sides, in pawn units (N and B 3, R 5, Q 9). The start position is 62."""
    v = {chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
    return sum(v[p.piece_type] for p in board.piece_map().values() if p.piece_type in v)


def phase_of(board, ply):
    m = npm(board)
    if m <= 26:
        return "endgame"
    if ply <= 20 and m >= 50:
        return "opening"
    return "middlegame"


def result_of(board, claim=True):
    """The page's endings: mate, stalemate, insufficient material, fifty moves, threefold. Returns a result string
    ('1-0', '0-1', '1/2-1/2') and a reason, or (None, None) while the game goes on."""
    if board.is_checkmate():
        return ("0-1" if board.turn == chess.WHITE else "1-0"), "checkmate"
    if board.is_stalemate():
        return "1/2-1/2", "stalemate"
    if board.is_insufficient_material():
        return "1/2-1/2", "insufficient material"
    if board.halfmove_clock >= 100:
        return "1/2-1/2", "fifty-move rule"
    if board.can_claim_threefold_repetition():
        return "1/2-1/2", "threefold repetition"
    return None, None


def elo_from_score(s):
    """Elo difference implied by an expected score s in (0, 1)."""
    s = min(max(s, 1e-6), 1 - 1e-6)
    return -400 * math.log10(1 / s - 1)


def score_ci(w, d, l, z=1.96):
    """Score fraction with a normal-approximation interval that uses the observed win/draw/loss split."""
    n = w + d + l
    if n == 0:
        return None
    s = (w + 0.5 * d) / n
    var = (w * (1 - s) ** 2 + d * (0.5 - s) ** 2 + l * (0 - s) ** 2) / n
    se = math.sqrt(var / n)
    return s, max(0.0, s - z * se), min(1.0, s + z * se)


def make_openings(n, plies=4, seed=1, depth=10, window=60, balanced=80, sf=None):
    """n distinct balanced openings of `plies` half-moves: at each ply a random move among Stockfish's top five that
    is within `window` cp of the best; the final position must be within `balanced` cp of equal."""
    rnd = random.Random(seed)
    own = sf is None
    sf = sf or open_sf()
    seen, out = set(), []
    tries = 0
    try:
        while len(out) < n and tries < n * 40:
            tries += 1
            b = chess.Board()
            line = []
            ok = True
            for _ in range(plies):
                infos = sf.analyse(b, chess.engine.Limit(depth=depth), multipv=5)
                best = cp_of(infos[0], b.turn)
                cands = [i["pv"][0] for i in infos if "pv" in i and cp_of(i, b.turn) >= best - window]
                if not cands:
                    ok = False
                    break
                mv = rnd.choice(cands)
                line.append(mv.uci())
                b.push(mv)
            if not ok:
                continue
            key = tuple(line)
            if key in seen:
                continue
            ev = sf.analyse(b, chess.engine.Limit(depth=depth))
            if abs(cp_of(ev, chess.WHITE)) > balanced:
                continue
            seen.add(key)
            out.append(line)
    finally:
        if own:
            sf.quit()
    return out


def jwrite(path, obj):
    """Write JSON after the content exists (never open for write first)."""
    s = json.dumps(obj, indent=1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(s + "\n")
    os.replace(tmp, path)
