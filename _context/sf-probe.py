"""Can Stockfish score Tyranny positions?  Measured 2026-10-02.  Answer: no.

    python _context/sf-probe.py [family]       e.g. tactical, multistep
    env:  STOCKFISH=<engine.exe>  SF_DEPTH=16  SF_N=8

WHAT IT DOES. For each shipped puzzle it asks Stockfish what the position is
worth under STANDARD rules ("before"), then applies the puzzle's answer by hand
(removing the captured friendly piece, which no standard engine can play) and
asks again ("after").

WHAT IT SHOWED, and why "before" is NOT a Tyranny baseline. Stockfish assumes
NEITHER side can self-capture, so it is blind to the defender's escapes and to
the attacker's self-capture mates:

  tac-0003  r2qQ2r/p1pB2pp/1p1p1k2/8/7P/8/PPPP1P2/RNB1K2R w KQ - 3 10
  Stockfish and python-chess both say Qe6 is checkmate. Under Tyranny it is not:
  Black answers with the king executing his own pawn, Kxg7, onto a square
  nothing covers. The puzzle's real answer is a different move entirely
  (a bishop self-capture that mates at once).

That is a wrong MOVE, not a wrong verdict: White still wins tac-0003, just not by
the move Stockfish names. Whether Stockfish misjudges WHO IS WINNING, as opposed
to which move wins, was NOT measured -- the 12 positions this script probes are
wins by construction, so they cannot show it either way. (An earlier version of
this header said Stockfish "over-rates the attacker"; nothing here establishes
that, and it has been withdrawn.)

So a standard engine names mating moves the variant refutes. That is the property
the variant changes, not noise, and it means this
engine can neither generate puzzles nor rank their difficulty. What produced the
shipped puzzles is the local depth-free predicates (tools/gen-puzzles.js) over
positions from real games (tools/lichess-multistep.js). Nothing in
puzzles.json came from Stockfish.

WHAT IT CANNOT TELL YOU. The "gain" column below is not a difficulty measure.
An earlier version of this header said it was ("the gap between those two
numbers is the puzzle's real difficulty"); the position above is the
counter-example. Read "before" as "what a standard-chess player sees", which is
the HOOK of a puzzle -- the thing a solver has to un-see -- not how hard it is.

TWO BOOKKEEPING DEFECTS THIS FILE HAD, kept in the notes because both look like
chess and neither is: a rook that executes its neighbour must also lose its
castling right, and the en-passant square must be cleared when the turn is
flipped by hand. Without both, python-chess rejected 3 of 6 positions as
invalid, which read as "post-position invalid for SF" and was this script's
fault, not the puzzles'.
"""
import json
import os
import sys

import chess
import chess.engine

SF = os.environ.get("STOCKFISH") or (
    r"C:\Users\crick\Github\Git\signpost-library\_context\chess-test"
    r"\engine\stockfish\stockfish\stockfish-windows-arm64-universal.exe")
PUZZLES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "puzzles", "puzzles.json")
DEPTH = int(os.environ.get("SF_DEPTH", "16"))
IDX = "abcdefgh"


def sq(i):
    """Tyranny board index (r*8+c, r=0 is rank 8) -> python-chess square."""
    r, c = divmod(i, 8)
    return chess.square(c, 7 - r)


def cp(info, board):
    """Score in centipawns from the side-to-move's view; mate as +/-10000."""
    s = info["score"].pov(board.turn)
    if s.is_mate():
        m = s.mate()
        return (10000 - abs(m)) * (1 if m > 0 else -1), m
    return s.score(), None


def main():
    if not os.path.exists(SF):
        print("engine not at", SF)
        return 1
    doc = json.load(open(PUZZLES, encoding="utf-8"))
    want = sys.argv[1] if len(sys.argv) > 1 else None
    pool = [p for p in doc["puzzles"] if want is None or p["family"] == want]
    pool = pool[: int(os.environ.get("SF_N", "8"))]

    eng = chess.engine.SimpleEngine.popen_uci(SF)
    eng.configure({"Threads": 1, "Hash": 64})
    lim = chess.engine.Limit(depth=DEPTH)
    rows = []
    try:
        for p in pool:
            board = chess.Board(p["fen"])
            before, bm = cp(eng.analyse(board, lim), board)
            sol = p["solutions"][0]
            mv = chess.Move(sq(sol["from"]), sq(sol["to"]))
            # The execution is ILLEGAL in standard chess by definition, so it is
            # applied by hand: remove our own piece, move ours onto its square.
            after_board = board.copy()
            after_board.remove_piece_at(mv.to_square)
            piece = after_board.remove_piece_at(mv.from_square)
            if piece is None:
                rows.append((p["id"], p["family"], before, bm, None, None, "no piece on from-square"))
                continue
            after_board.set_piece_at(mv.to_square, piece)
            after_board.turn = not board.turn
            # Bookkeeping the hand-application has to redo itself, because the
            # move was applied by poking squares rather than by push():
            #   - a rook that executed its own neighbour no longer confers castling
            #   - the ep square belonged to the side that has just been flipped away
            after_board.ep_square = None
            after_board.castling_rights &= after_board.clean_castling_rights()
            after_board.clear_stack()
            legal_after = after_board.is_valid()
            if not legal_after:
                rows.append((p["id"], p["family"], before, bm, None, None, "post-position invalid for SF"))
                continue
            inf = eng.analyse(after_board, lim)
            after, am = cp(inf, after_board)
            # after is from the OPPONENT's view now; flip to the solver's view
            after = -after
            am = -am if am is not None else None
            rows.append((p["id"], p["family"], before, bm, after, am, ""))
    finally:
        eng.quit()

    print(f"Stockfish depth {DEPTH}, standard rules.")
    print("'before' is NOT a Tyranny baseline. Stockfish assumes NEITHER side can")
    print("self-capture, so it names moves the variant refutes: tac-0003 is Qe6# to")
    print("Stockfish and not a mate in Tyranny, because Black answers f6xg7 (king")
    print("executes his own pawn onto an unattacked square). A wrong move, not a wrong")
    print("verdict: White still wins. Read 'before' as 'what a standard chess player")
    print("sees', which is the hook, not the difficulty.")
    print(f"{'id':<10} {'family':<10} {'before':>8} {'after':>8} {'gain':>8}  note")
    for pid, fam, b, bm, a, am, note in rows:
        if a is None:
            print(f"{pid:<10} {fam:<10} {b:>8} {'-':>8} {'-':>8}  {note}")
            continue
        gain = a - b
        bs = f"#{bm}" if bm else str(b)
        as_ = f"#{am}" if am else str(a)
        print(f"{pid:<10} {fam:<10} {bs:>8} {as_:>8} {gain:>8}  {note}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
