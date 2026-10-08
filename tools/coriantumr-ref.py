#!/usr/bin/env python3
"""coriantumr-ref.py -- an INDEPENDENT reference for the Coriantumr rule set.

WHY THIS FILE EXISTS. The engine in src/tyranny.html and its tests were written by the same hand from the same
reading of the rules. If that reading is wrong, the engine and its tests agree and nothing fails. This file is a
second implementation written from the RULES TEXT below, in another language, without translating the
JavaScript: a different board representation (a dict keyed by (file, rank)), a different way of finding the
successor (a global "after a capture, does the loser still have a royal?" check rather than "a royal just fell"),
and a different perft. Where the two disagree, one of them misread the rules.

THE RULES (settled with Derek, 2026-10-07; run-log decisions eb1e698d4d and cbd4125232):
  * Every piece moves as in chess EXCEPT the king and the queen, which both slide up to 4 squares in each of the
    eight directions (blocked by the first piece on the ray; capturing an enemy there, never a friend).
  * No check, no checkmate, no castling, no self-capture. Any move is legal, even one that leaves your king
    capturable. Capturing a king is an ordinary capture.
  * Pawns: one or two squares from the start rank, diagonal captures, en passant, promotion on the far rank to
    queen, rook, bishop or knight -- and also to a KING when that side has no king piece.
  * SUCCESSION. After a capture, if the side that lost the piece still has pieces but no king and no queen, its
    closest bishop (else knight, else rook, else pawn) becomes a king. Closest = smallest squared straight-line
    distance to the capture square; ties go to the lower file, then the lower rank. If a queen is alive when the
    king falls, nothing changes at all.
  * You win when the opponent has no pieces, so such a side has no moves.
  * NO DRAWS: no fifty-move rule, no repetition draw, no stalemate, no dead position.   (owner, 2026-10-07)
  * REPETITION IS REFUSED, NOT DRAWN. Chess calls a draw when a position occurs a third time. Here a position may
    occur twice, and the move that would make it occur a third time is not allowed. A position is the piece
    placement, the side to move and the en-passant square. Only a move that is neither a capture nor a pawn move
    can recreate an earlier position. If that leaves a side with no ordinary move it sacrifices its royal piece.
    Retreating is never refused for any other reason.   (owner, 2026-10-07)
  * NO LEGAL MOVE -> SACRIFICE. A side that has pieces but no ordinary legal move must move its royal piece off the
    board: its king, else its queen on the lowest file and then the lowest rank. Succession then applies from
    the sacrificed square exactly as if that piece had been captured, and the turn passes.
  * THE LAST PIECE. A side down to exactly one piece may not land on a square that piece has stood on since it became
    the last piece (the square it stands on counts). A capture is exempt, a slide may pass over a used square, and
    the opponent's squares stay available. When both sides are down to one piece (the showdown) both lists begin
    afresh at that moment. A last piece with no unused landing square and no capture has no ordinary move, so it
    must sacrifice itself; if that leaves its side with no pieces, it loses.   (owner, 2026-10-07)

USAGE
  python tools/coriantumr-ref.py perft "<fen>" <depth>      count positions
  python tools/coriantumr-ref.py explain "<fen>"            every move and the board it produces
  python tools/coriantumr-ref.py build [fixture.json]       regenerate the golden fixture (slow)
  python tools/coriantumr-ref.py --check [fixture.json]     recompute everything and compare (exit 1 on drift)
"""
import hashlib
import json
import os
import random
import sys

FILES = "abcdefgh"
KNIGHT = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
DIAGONAL = [(1, 1), (1, -1), (-1, 1), (-1, -1)]
ORTHOGONAL = [(1, 0), (-1, 0), (0, 1), (0, -1)]
EIGHT = DIAGONAL + ORTHOGONAL
START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1"
KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w - - 0 1"
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_FIXTURE = os.path.join(HERE, "..", "tests", "coriantumr-golden.json")


def sq_name(sq):
    return FILES[sq[0]] + str(sq[1] + 1)


def parse_fen(fen):
    parts = fen.split()
    board = {}
    for i, row in enumerate(parts[0].split("/")):
        rank, f = 7 - i, 0
        for ch in row:
            if ch.isdigit():
                f += int(ch)
            else:
                board[(f, rank)] = ch
                f += 1
    ep = None
    if len(parts) > 3 and parts[3] != "-":
        ep = (FILES.index(parts[3][0]), int(parts[3][1]) - 1)
    return {"board": board, "side": parts[1] if len(parts) > 1 else "w", "ep": ep}


def placement(board):
    rows = []
    for rank in range(7, -1, -1):
        row, empty = "", 0
        for f in range(8):
            p = board.get((f, rank))
            if p is None:
                empty += 1
            else:
                if empty:
                    row += str(empty)
                    empty = 0
                row += p
        rows.append(row + (str(empty) if empty else ""))
    return "/".join(rows)


def to_fen(pos):
    return placement(pos["board"]) + " " + pos["side"] + " - " + (sq_name(pos["ep"]) if pos["ep"] else "-") + " 0 1"


def position_key(pos):
    key = placement(pos["board"]) + " " + pos["side"] + " " + (sq_name(pos["ep"]) if pos["ep"] else "-")
    lv = pos.get("lv") or {}
    for side in ("w", "b"):
        if lv.get(side):
            key += " " + side.upper() + ",".join(sorted(sq_name(q) for q in lv[side]))
    return key


def repetition_key(pos):
    """Names a position for the repetition rule: placement, side to move, en-passant square. No castling (it does
    not exist here) and no last-piece lists (a lone side's position can never recur while it is bound by them)."""
    return placement(pos["board"]) + " " + pos["side"] + " " + (sq_name(pos["ep"]) if pos["ep"] else "-")


def seen_count(seen, key):
    """How many times a position has occurred so far. The special key "*" stands for every position not listed."""
    return seen.get(key, seen.get("*", 0))


def used_squares(pos, white):
    """The squares `white`'s (or Black's) last piece has stood on since it became the last piece: the carried list, or,
    for a freshly parsed position, the single square it stands on. None when that side has more than one piece."""
    lv = pos.get("lv") or {}
    key = "w" if white else "b"
    if lv.get(key):
        return lv[key]
    mine = [sq for sq, p in pos["board"].items() if p.isupper() == white]
    return frozenset(mine) if len(mine) == 1 else None


def sacrifice_royal(pos):
    """The piece that sacrifices itself when its side cannot move: the king, else the queen on the lowest file,
    then the lowest rank. None when the side has no royal piece."""
    white = pos["side"] == "w"
    mine = {sq: p for sq, p in pos["board"].items() if p.isupper() == white}
    for sq, p in mine.items():
        if p.upper() == "K":
            return sq
    queens = [sq for sq, p in mine.items() if p.upper() == "Q"]
    return min(queens, key=lambda q: (q[0], q[1])) if queens else None


def on_board(sq):
    return 0 <= sq[0] < 8 and 0 <= sq[1] < 8


def moves(pos, seen=None):
    """All legal moves: (from, to, promo, is_en_passant, is_double_step). With `seen` (a dict from repetition keys to
    how often each position has occurred), a move that would be the THIRD occurrence of a position is refused."""
    board, white = pos["board"], pos["side"] == "w"
    own_king = "K" if white else "k"
    has_king = any(p == own_king for p in board.values())
    out = []
    for frm, p in list(board.items()):
        if p.isupper() != white:
            continue
        kind = p.upper()
        f, r = frm
        if kind == "N":
            for df, dr in KNIGHT:
                to = (f + df, r + dr)
                if on_board(to) and (to not in board or board[to].isupper() != white):
                    out.append((frm, to, None, False, False))
        elif kind in "BRQK":
            dirs = DIAGONAL if kind == "B" else ORTHOGONAL if kind == "R" else EIGHT
            reach = 4 if kind in "QK" else 7
            for df, dr in dirs:
                for step in range(1, reach + 1):
                    to = (f + df * step, r + dr * step)
                    if not on_board(to):
                        break
                    occupant = board.get(to)
                    if occupant is None:
                        out.append((frm, to, None, False, False))
                        continue
                    if occupant.isupper() != white:
                        out.append((frm, to, None, False, False))
                    break
        else:  # pawn
            d, start, last = (1, 1, 7) if white else (-1, 6, 0)

            def pawn_to(to, capture):
                if to[1] == last:
                    for promo in "qrbn" + ("" if has_king else "k"):
                        out.append((frm, to, promo, False, False))
                else:
                    out.append((frm, to, None, False, False))

            one = (f, r + d)
            if on_board(one) and one not in board:
                pawn_to(one, False)
                two = (f, r + 2 * d)
                if r == start and two not in board:
                    out.append((frm, two, None, False, True))
            for df in (-1, 1):
                to = (f + df, r + d)
                if not on_board(to):
                    continue
                occupant = board.get(to)
                if occupant is not None and occupant.isupper() != white:
                    pawn_to(to, True)
                elif occupant is None and pos["ep"] == to:
                    out.append((frm, to, None, True, False))
    used = used_squares(pos, white)
    if used:
        # a capture (an occupied target, or en passant) is exempt; a last piece may not land on a square it has used
        out = [m for m in out if m[3] or m[1] in board or m[1] not in used]
    if seen is not None and out:
        kept = []
        for m in out:
            irreversible = m[3] or m[1] in board or board[m[0]].upper() == "P"
            if irreversible or seen_count(seen, repetition_key(make(pos, m))) < 2:
                kept.append(m)
        out = kept
    if not out:
        royal = sacrifice_royal(pos)
        if royal is not None:
            return [(royal, royal, None, False, False)]       # (from, from): the royal piece leaves the board
    return out


def crown_if_needed(board, lost_white, at):
    """The succession rule, stated the way a reader of the rules text would: AFTER A CAPTURE, if the side that lost
    the piece has pieces but no king and no queen, crown its closest bishop, else knight, rook, pawn."""
    mine = [(sq, p) for sq, p in board.items() if p.isupper() == lost_white]
    if not mine or any(p.upper() in "KQ" for _, p in mine):
        return False
    for cls in "BNRP":
        candidates = [sq for sq, p in mine if p.upper() == cls]
        if candidates:
            best = min(candidates, key=lambda s: ((s[0] - at[0]) ** 2 + (s[1] - at[1]) ** 2, s[0], s[1]))
            board[best] = "K" if lost_white else "k"
            return True
    return False


def make(pos, mv):
    frm, to, promo, is_ep, is_double = mv
    board = dict(pos["board"])
    piece = board.pop(frm)
    white = piece.isupper()
    crowned = False
    if frm == to:                                   # the royal piece sacrifices itself: succession from its square
        crowned = crown_if_needed(board, white, frm)
    else:
        captured = board.pop((to[0], frm[1])) if is_ep else board.get(to)
        if promo:
            piece = promo.upper() if white else promo.lower()
        board[to] = piece
        if captured is not None:
            crowned = crown_if_needed(board, captured.isupper(), to)
    ep = (frm[0], (frm[1] + to[1]) // 2) if is_double else None
    child = {"board": board, "side": "b" if pos["side"] == "w" else "w", "ep": ep, "crowned": crowned}
    def count(bd, w):
        return sum(1 for p in bd.values() if p.isupper() == w)
    now_w, now_b = count(board, True), count(board, False)
    was_w, was_b = count(pos["board"], True), count(pos["board"], False)
    fresh = now_w == 1 and now_b == 1 and not (was_w == 1 and was_b == 1)          # the showdown has just begun
    lv = {}
    for side_white, n, was in ((True, now_w, was_w), (False, now_b, was_b)):
        if n != 1:
            continue
        at = next(sq for sq, p in board.items() if p.isupper() == side_white)
        prev = used_squares(pos, side_white)
        if fresh or was != 1 or not prev:
            lv["w" if side_white else "b"] = frozenset([at])
        elif white == side_white:
            lv["w" if side_white else "b"] = frozenset(prev) | {to}
        else:
            lv["w" if side_white else "b"] = frozenset(prev)
    if lv:
        child["lv"] = lv
    return child


def uci(mv):
    return sq_name(mv[0]) + sq_name(mv[1]) + (mv[2] or "")


def perft(pos, depth):
    ms = moves(pos)
    if depth <= 1:
        return len(ms)
    return sum(perft(make(pos, m), depth - 1) for m in ms)


def children_digest(pos, seen=None):
    items = sorted(uci(m) + "=" + position_key(make(pos, m)) for m in moves(pos, seen))
    return len(items), hashlib.sha1("\n".join(items).encode()).hexdigest()


def captures_royal(pos):
    for m in moves(pos):
        victim = pos["board"].get(m[1])
        if victim is not None and victim.upper() in "KQ":
            return True
    return False


# -------------------------------------------------------------------------- fixture
HANDMADE = [
    # name, fen, deepest perft to record
    ("start", START, 4),
    ("kiwipete", KIWIPETE, 3),
    ("queen is the only royal; two bishops tie on distance (b2, f2), lower file wins on a rook capture on d4",
     "3rk3/8/8/8/3Q4/8/1B3B2/8 b - - 0 1", 3),
    ("two bishops tie on distance AND file (d2, d6), lower rank wins; a rook on h4 takes the queen on d4",
     "4k3/8/3B4/8/3Q3r/8/3B4/8 b - - 0 1", 3),
    ("squared straight-line distance, not king-steps: g7 is 3 steps away, h4 is 4, yet h4 is closer (16 against 18)",
     "3rk3/6B1/8/8/3Q3B/8/8/8 b - - 0 1", 3),
    ("squared straight-line distance, not city-block: f6 is 4 blocks away, a4 is 3, yet f6 is closer (8 against 9)",
     "3rk3/8/5B2/8/B2Q4/8/8/8 b - - 0 1", 3),
    ("class order beats distance: a far bishop is crowned although a knight stands next to the queen",
     "3rk3/8/8/8/3Q4/3N4/8/B7 b - - 0 1", 3),
    ("a queen captured while the king lives: nothing is crowned", "3rk3/8/8/8/3Q4/8/1B3B2/4K3 b - - 0 1", 3),
    ("no bishop: the closest knight is crowned", "3rk3/8/8/1N6/3Q4/8/5N2/8 b - - 0 1", 3),
    ("no bishop or knight: the closest rook is crowned", "3rk3/8/8/8/3Q4/8/R6R/8 b - - 0 1", 3),
    ("only pawns left behind: the closest pawn is crowned", "3rk3/8/8/8/3Q4/8/P1P3P1/8 b - - 0 1", 3),
    ("king captured while a queen lives: nothing changes",
     "3rk3/8/8/8/3K4/8/1B3B2/Q7 b - - 0 1", 3),
    ("pawn about to promote with no king piece: a king is among the choices",
     "8/8/8/8/8/8/p7/1Q2q3 b - - 0 1", 3),
    ("pawn about to promote WITH a king piece: no king choice",
     "4k3/8/8/8/8/8/p7/1Q2K3 b - - 0 1", 3),
    ("en passant with royals en prise", "4k3/8/8/3pP3/8/8/8/3QK3 w - d6 0 1", 3),
    ("boxed in: the king on a8 cannot move and nor can pawns a7, b7, b8, so it sacrifices itself and the closest "
     "pawn (a7 and b8 tie, the lower file wins) is crowned", "KP6/PP6/8/8/8/8/8/7k w - - 0 1", 3),
    ("boxed in with a queen as the only royal: the queen sacrifices itself and a pawn is crowned",
     "QP6/PP6/8/8/8/8/8/7k w - - 0 1", 3),
    ("never offered when an ordinary move exists: the king is boxed in but the queen can move",
     "KP6/PP6/8/8/8/8/8/Q6k w - - 0 1", 3),
    ("several queens and no king left: nothing changes and every queen stays a queen",
     "R3k3/8/8/8/8/8/3qq3/4K3 w - - 0 1", 3),
    ("a boxed-in king beside a boxed-in queen: the king sacrifices itself, the queen takes command, no pawn is crowned",
     "KQP5/PPP5/8/8/8/8/8/7k w - - 0 1", 3),
    ("two boxed-in queens and no king: the queen on the lowest file (a8) sacrifices itself, the other stays a queen",
     "QQP5/PPP5/8/8/8/8/8/7k w - - 0 1", 3),
    ("two boxed-in queens on the same file and no king: the lower rank (a7) sacrifices itself, the queen on a8 stays",
     "QP6/QP6/PP6/8/8/8/8/7k w - - 0 1", 3),
]

D4_REACH = ["c4", "b4", "a4", "e4", "f4", "g4", "h4", "d5", "d6", "d7", "d8", "d3", "d2", "d1", "e5", "f6", "g7", "h8",
            "c5", "b6", "a7", "e3", "f2", "g1", "c3", "b2", "a1"]     # the 27 squares a 4-square slider reaches from d4

# Positions with last-piece lists (squares as names). spec = {"w": [...], "b": [...]} for the sides that are down to
# one piece; None means "derive each list from the position".
LONE = [
    # name, fen, spec, deepest perft
    ("a showdown that has just begun: each piece's list holds only the square it stands on",
     "8/7k/8/8/3K4/8/8/8 w - - 0 1", None, 3),
    ("a slide may pass over a used square (b2) but not land on it; the corner king still reaches c3",
     "8/7k/8/8/8/8/8/K7 w - - 0 1", {"w": ["a1", "b2"], "b": ["h7"]}, 3),
    ("the opponent's squares stay available: Black has used d4 and White's king may land on it",
     "8/7k/8/8/8/8/8/K7 w - - 0 1", {"w": ["a1"], "b": ["h7", "d4"]}, 3),
    ("a capture is exempt: the enemy queen stands on a square White's king has used and the king may still take it",
     "8/8/5q2/8/3K4/8/8/8 w - - 0 1", {"w": ["d4", "f6"], "b": ["f6"]}, 2),
    ("every one of the 27 squares the king on d4 could reach is used: it has no ordinary move, so it sacrifices "
     "itself and loses",
     "8/7k/8/8/3K4/8/8/8 w - - 0 1", {"w": D4_REACH + ["d4"], "b": ["h7"]}, 2),
    ("a last piece against two pieces is bound before any showdown: Black's lone king may not land on h6 or g6",
     "8/7k/8/8/3K4/8/8/R7 b - - 0 1", {"b": ["h7", "h6", "g6"]}, 3),
    ("a late showdown: each side has only a few unused squares left (White f6, b2, a1; Black h8, g8)",
     "8/7k/8/8/3K4/8/8/8 w - - 0 1",
     {"w": [q for q in D4_REACH if q not in ("f6", "b2", "a1")] + ["d4"],
      "b": ["h6", "h5", "h4", "h3", "g7", "f7", "e7", "d7", "g6", "f5", "e4", "d3", "h7"]}, 3),
]


# Positions with a table of earlier occurrences. Each spec is (move, times seen) for the position AFTER that move,
# or ("*", n) for every position. The fixture stores the resulting keys, so the JavaScript side needs no spec language.
REPEAT = [
    ("the second occurrence is allowed, the third is refused: Kb1-b2 would be the third time, Kb1-a1 only the second",
     "8/p6k/8/8/8/8/P7/1K6 w - - 0 1", [("b1b2", 2), ("b1a1", 1)]),
    ("every ordinary move would be a third occurrence and there is no pawn move or capture to fall back on, so the "
     "royal sacrifices", "8/7k/8/8/8/8/8/KR6 w - - 0 1", [("*", 2)]),
    ("a pawn move and a capture are never refused however often the position has been seen; the king's quiet moves are",
     "8/7k/8/8/8/1p6/P1K5/8 w - - 0 1", [("*", 2)]),
    ("nothing seen yet: the list is exactly the ordinary legal moves", "8/p6k/8/8/8/8/P7/1K6 w - - 0 1", []),
]


def seen_table(pos, spec):
    seen = {}
    ms = {uci(m): m for m in moves(pos)}
    for key, times in spec:
        if key == "*":
            seen["*"] = times
        else:
            seen[repetition_key(make(pos, ms[key]))] = times
    return seen


def parse_square(name):
    return (FILES.index(name[0]), int(name[1]) - 1)


def lone_position(fen, spec):
    pos = parse_fen(fen)
    if spec:
        pos["lv"] = {k: frozenset(parse_square(n) for n in v) for k, v in spec.items()}
    return pos


def selfplay_snapshots(rng, games):
    snaps = []
    for _ in range(games):
        pos = parse_fen(START)
        for ply in range(150):
            ms = moves(pos)
            if not ms:
                break
            if ply >= 6 and ply % 3 == 0:
                snaps.append((to_fen(pos), "royal" if captures_royal(pos) else "plain",
                              len(pos["board"])))
            caps = [m for m in ms if pos["board"].get(m[1]) is not None or m[3]]
            mv = rng.choice(caps) if caps and rng.random() < 0.7 else rng.choice(ms)
            pos = make(pos, mv)
            if pos["crowned"]:
                snaps.append((to_fen(pos), "crowned", len(pos["board"])))
    return snaps


def build(seed=20261007, games=160):
    rng = random.Random(seed)
    snaps = selfplay_snapshots(rng, games)
    seen, by_tag = set(), {"crowned": [], "royal": [], "plain": []}
    for fen, tag, n in snaps:
        if fen in seen:
            continue
        seen.add(fen)
        by_tag[tag].append((fen, n))
    chosen = []
    chosen += by_tag["crowned"][:70]
    chosen += by_tag["royal"][:90]
    rest = by_tag["plain"]
    rng.shuffle(rest)
    chosen += rest[:140]
    perft_rows, child_rows = [], []
    for name, fen, depth in HANDMADE:
        pos = parse_fen(fen)
        perft_rows.append({"name": name, "fen": fen,
                           "perft": {str(d): perft(pos, d) for d in range(1, depth + 1)}})
    repeat_rows = []
    for name, fen, spec in REPEAT:
        pos = parse_fen(fen)
        table = seen_table(pos, spec)
        count, digest = children_digest(pos, table)
        repeat_rows.append({"name": name, "fen": fen, "seen": table, "moves": count, "sha1": digest,
                            "allowed": sorted(uci(m) for m in moves(pos, table))})
    lone_rows = []
    for name, fen, spec, depth in LONE:
        pos = lone_position(fen, spec)
        count, digest = children_digest(pos)
        lone_rows.append({"name": name, "fen": fen, "lv": spec, "moves": count, "sha1": digest,
                              "perft": {str(d): perft(pos, d) for d in range(1, depth + 1)}})
    for fen, n in chosen:
        pos = parse_fen(fen)
        count, digest = children_digest(pos)
        child_rows.append({"fen": fen, "moves": count, "sha1": digest, "perft2": perft(pos, 2),
                           "perft3": perft(pos, 3) if len(child_rows) % 12 == 0 else None})
    return {
        "generatedBy": "tools/coriantumr-ref.py",
        "what": ("Golden values from the independent Python reference. The JavaScript engine is tested against "
                 "these; they were NOT produced by it. Regenerate with `build`, verify with `--check`."),
        "seed": seed, "games": games,
        "counts": {"snapshots": len(snaps), "unique": len(seen), "crowned": len(by_tag["crowned"]),
                   "royalCapturable": len(by_tag["royal"]), "kept": len(chosen)},
        "perft": perft_rows,
        "lone": lone_rows,
        "repeat": repeat_rows,
        "children": child_rows,
    }


def check(path):
    fixture = json.load(open(path, encoding="utf-8"))
    bad = 0
    for row in fixture["perft"]:
        pos = parse_fen(row["fen"])
        for d, want in row["perft"].items():
            got = perft(pos, int(d))
            if got != want:
                bad += 1
                print("PERFT DRIFT", row["name"][:50], "depth", d, "fixture", want, "reference", got)
    for row in fixture.get("lone", []):
        pos = lone_position(row["fen"], row["lv"])
        if children_digest(pos) != (row["moves"], row["sha1"]):
            bad += 1
            print("LAST-PIECE CHILDREN DRIFT", row["name"][:50])
        for d, want in row["perft"].items():
            if perft(pos, int(d)) != want:
                bad += 1
                print("LAST-PIECE PERFT DRIFT", row["name"][:50], "depth", d)
    for row in fixture.get("repeat", []):
        pos = parse_fen(row["fen"])
        if children_digest(pos, row["seen"]) != (row["moves"], row["sha1"]) or \
                sorted(uci(m) for m in moves(pos, row["seen"])) != row["allowed"]:
            bad += 1
            print("REPEAT DRIFT", row["name"][:50])
    for row in fixture["children"]:
        pos = parse_fen(row["fen"])
        count, digest = children_digest(pos)
        if (count, digest) != (row["moves"], row["sha1"]):
            bad += 1
            print("CHILDREN DRIFT", row["fen"])
        if perft(pos, 2) != row["perft2"]:
            bad += 1
            print("PERFT2 DRIFT", row["fen"])
        if row["perft3"] is not None and perft(pos, 3) != row["perft3"]:
            bad += 1
            print("PERFT3 DRIFT", row["fen"])
    print("checked %d handmade positions, %d last-piece positions, %d repetition positions and %d sampled positions: %s"
          % (len(fixture["perft"]), len(fixture.get("lone", [])), len(fixture.get("repeat", [])), len(fixture["children"]),
             "NO DRIFT" if not bad else "%d DRIFTS" % bad))
    return 1 if bad else 0


def main(argv):
    if len(argv) >= 2 and argv[0] == "perft":
        pos = parse_fen(argv[1])
        depth = int(argv[2]) if len(argv) > 2 else 1
        print(perft(pos, depth))
        return 0
    if len(argv) >= 2 and argv[0] == "explain":
        pos = parse_fen(argv[1])
        for m in sorted(moves(pos), key=uci):
            child = make(pos, m)
            print(uci(m).ljust(7), position_key(child), "(crowned)" if child["crowned"] else "",
                  "(sacrifice)" if m[0] == m[1] else "")
        return 0
    if argv and argv[0] == "build":
        path = argv[1] if len(argv) > 1 else DEFAULT_FIXTURE
        fixture = build()
        text = json.dumps(fixture, indent=1) + "\n"
        json.loads(text)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print("wrote", os.path.normpath(path), fixture["counts"])
        return 0
    if argv and argv[0] == "--check":
        return check(argv[1] if len(argv) > 1 else DEFAULT_FIXTURE)
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
