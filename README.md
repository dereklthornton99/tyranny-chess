# Tyranny Chess

Ordinary chess with one addition: **the king may command the execution of his own citizens.**

Any piece may capture a friendly piece, using exactly the geometry it already uses to
capture an enemy. Same board, same objective, same everything else.

**▶ Play it: https://dereklthornton99.github.io/tyranny-chess/**

Hot-seat for two players, or against a built-in engine at three strengths.
One self-contained HTML file, no build step, no dependencies, no network.

---

## Where the rule actually lands

It looks like a one-line change to the move generator, and it nearly is — but four
existing rules were quietly leaning on "you cannot land on your own piece."

| | |
|---|---|
| **The king** | You may never capture your own king. Every check and mate routine assumes each side has exactly one, so this is the single hard exclusion. |
| **Pawns** | A pawn takes its own pieces **diagonally only**, exactly as it takes enemies. Its forward push is still blocked by anything ahead of it, so a pawn can never take the pawn directly in front of it. |
| **Castling** | **Completely unchanged** — the traditional move works as it always did. Two knock-on effects: executing your own rook forfeits that castling right, and a piece blocking f1/g1 gains more squares to vacate to. Executing the blocker does *not* help; your capturer just lands where it stood. |
| **En passant** | Unreachable against your own pawn. The capture window is one ply wide and always belongs to the opponent, so it needs no special rule. |

## What it does to the game

**Checkmate gets strictly harder.** The new escape is the king executing its own piece to
reach a flight square. Blocking is *not* a new resource — a friendly piece already on the
check line means there was no check. A 1,669-position sweep found 5,654 self-capture
escapes from check, every one of them a king move.

**You cannot delete your way to nothing.** A capture leaves the *capturer* standing, so
ordinary self-captures bottom out at **king plus one piece**. Only the king can remove that
last man, and only onto a square it could safely occupy anyway.

**Stalemate becomes reachable on purpose.** A lone extra piece is often the only thing
obliging a lost side to keep moving; here the king can eat it and offer the stalemate.
Offer, not claim — it is a swindle against a person and a blunder against a searching
engine, which is why the built-in AI declines it and mates instead.

## Reading the board

| Marker | Meaning | Notation |
|---|---|---|
| Dot | ordinary move to an empty square | `Nf3` |
| Red ring | capture an enemy piece | `Nxd5` |
| Brass brackets | execute your own piece | `N⊗d2` |

Click a piece, then click a destination. **Esc** deselects — worth knowing, because
clicking one of your own bracketed pieces captures it rather than reselecting it.

## The engine

Negamax alpha-beta with iterative deepening, quiescence search on enemy captures, a check
extension, and killer/history move ordering. The search itself needs nothing
variant-specific — self-captures are ordinary entries in the move list. What the variant
needs is correct *terminal* scoring: stalemate 0, mate −MATE+ply, dead material 0, any
repetition 0. That is what lets it reach for a stalemate swindle when lost and refuse one
when winning.

## Tests

The page has a **Run tests** button that executes 48 rule checks in the browser. The same
suites run under Node:

```
node tests/run-all.js
```

72 checks across four files. The load-bearing one is `perft` in `tests/test.js`: with the
variant rule switched **off**, the engine reproduces the published standard-chess node
counts exactly — 20 / 400 / 8,902 / 197,281 — which proves the base engine is correct and
that the only new thing is the rule itself. Variant counts measured at 39 / 1,519 / 63,034,
where the 39 matches a hand derivation written out in the source.

## Honest limits

- The search runs on the main thread, so at **Hard** the page is briefly unresponsive
  (up to ~2s) while it thinks.
- There is **no networked multiplayer**. Two people play on one screen, or each plays
  the engine.
- Mobile layout is proportional by construction (pieces are sized off the board, not the
  viewport) but has not been tested on a physical phone.

## License

MIT
