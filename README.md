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

## Working on it

There is exactly **one authored file**: `src/tyranny.html`. Everything else is generated
or supporting.

```
src/tyranny.html      the whole game - markup, CSS, rules engine, AI
build.js              src/ -> index.html
index.html            GENERATED. do not edit; your changes will be overwritten
tests/                Node suites, run against src/ not against the built page
```

`src/tyranny.html` is deliberately a *fragment* — it has no `<!doctype>`, `<html>`,
`<head>` or `<body>`. That is the shape the Claude Artifact host wants, since it supplies
that skeleton itself. GitHub Pages wants a complete document, so `build.js` wraps the
fragment into `index.html`.

To change anything: edit `src/tyranny.html`, then

```
node tests/run-all.js     rebuilds index.html, re-extracts the engine, runs every suite
git commit -am "..." && git push
```

Pages redeploys in about a minute.

**The published page cannot drift from the source.** `node build.js --check` rebuilds in
memory and exits non-zero if `index.html` does not match, and CI runs that check on every
push. A commit that edits the source without rebuilding fails loudly instead of quietly
shipping a stale page.

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
- Verified on desktop Chrome only. The iPad bug described below is fixed *by
  construction* — there is no longer any font to substitute — but that fix has not
  been re-tested on an iPad, and nothing here has been tested on Android.

## A note on the pieces

They are inline SVG rather than the Unicode chess characters, and that is deliberate.
**U+265F (♟) became a standard emoji in 2018**, so iOS has a colour-emoji glyph for it and
prefers that font. An emoji glyph ignores CSS `fill` and `-webkit-text-stroke` and carries
its own metrics, so on iPad the pawns rendered black on *both* sides and larger than the
back rank, while the other five chess codepoints — which are not emoji — rendered fine.
Drawing the pieces removes the font dependency entirely.

## License

MIT
