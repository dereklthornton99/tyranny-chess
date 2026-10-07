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
    return placement(pos["board"]) + " " + pos["side"] + " " + (sq_name(pos["ep"]) if pos["ep"] else "-")


def on_board(sq):
    return 0 <= sq[0] < 8 and 0 <= sq[1] < 8


def moves(pos):
    """All legal moves: (from, to, promo, is_en_passant, is_double_step)."""
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
    captured = board.pop((to[0], frm[1])) if is_ep else board.get(to)
    if promo:
        piece = promo.upper() if white else promo.lower()
    board[to] = piece
    crowned = False
    if captured is not None:
        crowned = crown_if_needed(board, captured.isupper(), to)
    ep = (frm[0], (frm[1] + to[1]) // 2) if is_double else None
    return {"board": board, "side": "b" if pos["side"] == "w" else "w", "ep": ep, "crowned": crowned}


def uci(mv):
    return sq_name(mv[0]) + sq_name(mv[1]) + (mv[2] or "")


def perft(pos, depth):
    ms = moves(pos)
    if depth <= 1:
        return len(ms)
    return sum(perft(make(pos, m), depth - 1) for m in ms)


def children_digest(pos):
    items = sorted(uci(m) + "=" + position_key(make(pos, m)) for m in moves(pos))
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
]


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
    print("checked %d handmade positions and %d sampled positions: %s"
          % (len(fixture["perft"]), len(fixture["children"]), "NO DRIFT" if not bad else "%d DRIFTS" % bad))
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
            print(uci(m).ljust(7), position_key(child), "(crowned)" if child["crowned"] else "")
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
