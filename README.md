# Tyranny Chess

Ordinary chess with one addition: **the king may command the execution of his own citizens.**

Any piece may capture a friendly piece, using exactly the geometry it already uses to
capture an enemy. Same board, same objective, same everything else.

**▶ Play it: https://dereklthornton99.github.io/tyranny-chess/**

Hot-seat for two players, an engine opponent at three strengths, and **240 puzzles in four
families** — positions no other chess program can generate. In three of them the answer is
an execution; in one it is refusing one. One self-contained HTML file, no build step for
the player, no dependencies, no network.

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
escapes from check, every one of them a king move — *measured in an earlier round and not
re-run for this one.*

**You cannot delete your way to nothing.** A capture leaves the *capturer* standing, so
ordinary self-captures bottom out at **king plus one piece**. Only the king can remove that
last man, and only onto a square it could safely occupy anyway.

**Stalemate as a deliberate goal was claimed, searched for, and retracted.** The idea was
that a lone extra piece can be the only thing obliging a lost side to keep moving, so the
king eats it and claims the draw. The position built to show this does not work: after
K⊗h7 White has exactly one stalemating move and **also exactly one mate in one**, so the
shed only draws against an opponent who errs — and the shed is not even forced, since of
Black's four legal moves only Ng5+ avoids a forced loss inside the same three plies.

`tools/shed-sweep.js` then went looking for a position where a shed IS sound against
correct play — not merely one where stalemate is *available*. Over **69,193 positions**
(56,186 of them with a legal self-capture) it returned **91,563 shed verdicts**: 5,071
drawn, **every single one by insufficient material and not one by any stalemate
mechanism**, and **zero** that were drawn *and* in a position that was lost without the
shed. Zero sound king sheds.

The mechanism fails for a stated reason, not a mysterious one: forcing stalemate after a
shed needs the opponent to have no checking move anywhere in its move list, because a check
against a side with no legal moves is mate rather than stalemate.

**Honest limit.** 80,659 of those verdicts were UNDETERMINED — no forced mate and no forced
draw inside the three-ply budget the sweep uses. A sound shed could be in there. What this
supports is *no evidence was found across a large sample under a stated test*, not *no such
position exists*. `tests/shed.js` pins the outcome, including that the retracted wording
stays out of this file and the page.

## Puzzles

240 positions. All four predicates are **depth-free** — exhaustive ply enumeration using
only `legal()`, `apply()` and `inCheck()`, no search and no engine scoring.

| Family | Count | Predicate |
|---|---|---|
| **Survival** | 153 | **Checkmate under standard rules**, three ways out under Tyranny, and **exactly one of them is still alive after the reply**. The other two are legal, look no different, and lose. |
| **Tactical** | 20 | A self-capture is mate in one, no other move is mate in one, **and no ordinary move forces mate within two plies**. |
| **Restraint** | 40 | A self-capture is available and an ordinary move mates at once, and **no self-capture mates in one or forces mate within three plies**. The answer is the ordinary move; the executions are the decoys. |
| **Multistep** | 27 | Exactly one self-capture **forces mate within three plies**, nothing mates in one, and **no ordinary move forces it either**. You have to see past the first move, and skipping the execution does not win. |

### The escape family was retired, and why is the interesting part

It listed **every legal move as a correct answer** — all 34 of them. There was no way to be
wrong. "You are mated under normal rules; now play literally anything" is a prompt, not a
puzzle, and no amount of better position-hunting was going to fix a family that could not
be failed. Survival keeps the setup and adds the missing half. `tests/puzzles.js` now
**rejects** any puzzle whose solutions cover every legal move, so the shape cannot return.

### Where the survival positions come from

Not from a playout. From the **[Lichess puzzle database](https://database.lichess.org/)**,
which is released under **CC0** — 1,902,104 mate-themed puzzles out of real games, each
replayed to the position after the mating move, and every one of those replays agreed with
this engine. Zero disagreements. Each surviving puzzle carries its source id, Lichess
rating and a link to the game it came from.

**A standard puzzle set cannot simply be imported, and this is the number that says so.**
Of 900 standard mate-in-1 positions sampled from real play, **463 — 51.4% — are refuted by
a self-capture** under this rule: the defending king eats its own shield and walks out. An
imported set would ship puzzles whose stated answer is wrong in this game. That same 51.4%
is the seed: a position where standard chess says checkmate and Tyranny says otherwise is
*already* a puzzle about the variant.

Worth knowing about this family: **the answer is always a king move, and that is a theorem
rather than a coincidence.** In a standard-rules checkmate there are no legal ordinary
moves at all, and capturing the checker or blocking the line would both be ordinary moves
— so the only thing the variant newly permits is the king eating its own neighbour.

Three clauses do the real work, and each of them rejects a puzzle that would otherwise
teach the wrong thing. Tactical's *no ordinary move forces mate within two* is the
original: without it, two of three early hand-made puzzles had ordinary moves that mated
anyway, so a player who never considers self-capture wins regardless. Multistep's *nothing
mates in one* stops the family collapsing into tactical with a different label. And
restraint's *no self-capture forces mate within three plies* is stricter than "no
self-capture mates in one" on purpose — an execution that wins one move later is not
wrong, only slower, and a puzzle whose lesson is "the execution also works" teaches no
restraint at all.

A centipawn-margin definition of "tactical" finds **zero** puzzles across ~1,700
engine-scored positions, because a self-capture always loses material and only wins by
winning something back. Mate-in-one is the decisive margin. *Measured in an earlier round
and not re-run for this one.*

**Measured yield**, recorded in `puzzles.json` under `generator.yield` and re-checked by
the suite. Over 500 games and 92,699 unique positions on 2026-09-17: tactical 0.216 per
thousand unique positions, **restraint 1.845**, **multistep 0.291**. Survival is not swept
for and has no entry there — it comes from the Lichess seed.
Multistep is the rarest and by far the most expensive — 181s of the run's 206s were spent
inside its predicate alone. The sweep runs until the rarest family reaches `--target`, so
the common ones overshoot; `--cap` (default 40) keeps the set balanced, and the yield block
records both `found` and `kept` so capping never hides the measurement.

**A harder tier exists and is measured but not shipped.** The predicate above settles a
puzzle by checking the opponent's reply to each candidate. Relax that to "more than one
candidate survives the reply, and only one survives three plies" and the puzzles get
strictly harder — you have to distrust the move that looks fine. Measured on a 60,000-row
slice: **12 deep for every 2 shallow**, so the full database projects to roughly **380** of
them. It is off by default (`--deep`) for one reason: it made that slice run **more than
21x slower**, 35 seconds to over 12 minutes, which puts a full scan around **4.8 hours**.
The cost is measured; the full yield is not.

**The set is shuffled on every entry.** Generation order groups by family, so without it
every session would open with the same 20 tacticals in the same sequence and nobody would
reach a survival puzzle without working through 87 other positions first. The shuffle runs on entry, not
once per page load, so leaving and coming back deals a new order too. It shuffles the
reader's own filtered copy, never the shipped data. One cost worth naming: family order
used to give an implicit easy-to-hard ramp, and mixing the families removes it — the
per-puzzle difficulty bars are what is left.

**The easy tail is gone.** It was 15 puzzles with exactly one legal move — solvable by
elimination rather than insight — and every one of them was an escape. No family left can
produce one: **no puzzle in the set now has fewer than three legal moves**, survival
rejects anything below that, and multistep rejects every one-mover by construction.

Three puzzles are still rated difficulty 1, and they are restraints rather than a leftover
tail: a position with few legal moves and only one or two executions on offer is a genuine
puzzle, just a small one. The spread across the whole set is **3 / 188 / 49**.

## Reading the board

| Marker | Meaning | Notation |
|---|---|---|
| Dot | ordinary move to an empty square | `Nf3` |
| Red ring | capture an enemy piece | `Nxd5` |
| Brass brackets | execute your own piece | `N⊗d2` |

Click a piece, then click a destination. **Esc** deselects — worth knowing, because
clicking one of your own bracketed pieces captures it rather than reselecting it.

**Move markers: ON/OFF** turns all three off together and remembers the choice across a
reload. Only the hint is hidden — the move is still played the same way. **Puzzle mode
turns them off regardless of the setting**, because in a puzzle the brackets are the
answer key, and leaving a puzzle restores whatever the setting actually was rather than a
default.

## The engine

Negamax alpha-beta with iterative deepening, quiescence search on enemy captures, a check
extension, and killer/history move ordering. The search itself needs nothing
variant-specific — self-captures are ordinary entries in the move list. What the variant
needs is correct *terminal* scoring: stalemate 0, mate −MATE+ply, dead material 0, any
repetition 0.

**Do not rank root moves with `think()`.** Its root loop raises alpha as it goes, so the
per-move values it stores are upper bounds on inferior moves, not scores — 68 of 71 were
wrong on one measured position. Use a full-window search per move, or a depth-free test.

## Working on it

There is exactly **one authored file**: `src/tyranny.html`. Everything else is generated
or supporting.

```
src/tyranny.html        the whole game - markup, CSS, rules engine, AI, puzzle mode
build.js                src/ + puzzles/ -> index.html
index.html              GENERATED. do not edit; your changes will be overwritten
puzzles/puzzles.json    GENERATED by tools/gen-puzzles.js
tools/gen-puzzles.js    the sweep, the predicates, the survival merge, and --inline
tools/lichess-seed.js   derives survival puzzles from the Lichess CC0 database
puzzles/survival-seed.json  GENERATED, committed: positions and their provenance
tools/fen-write.js      toFen(state); the page ships only a parser
tools/shed-sweep.js     is a king shed ever sound? --check <fen> classifies one position
tools/ai-selfcapture.js what the engine does with self-captures, and whether it prefers them
tests/                  six Node suites, run against src/ not the built page
tests/browser.js        SEPARATE runner: real DOM checks in headless Chrome, zero deps
_context/               goal tree, run log, and the two measurement records
```

To change anything: edit `src/tyranny.html`, then

```
node tests/run-all.js     rebuilds index.html, re-extracts the engine, runs every suite
```

**Two hazards worth knowing before you edit `src/tyranny.html`.** `tests/extract.js`
slices the engine out of it on four literal strings, and it takes **two** slices, not one.
Code inserted into either range compiles into `tests/engine.js` and every suite fails.
Separately, its cut point is `lastIndexOf('/* ====', <the GAME / UI banner>)` — so a new
`/* ====` banner placed *before* that banner silently shrinks the extracted engine, and
**the suites still pass while covering less**. Put new code after the `GAME / UI` banner.

### Regenerating the puzzles

```
node tools/gen-puzzles.js --games 2500 --target 20 --cap 40 --seed 20260914
node tools/gen-puzzles.js --inline      # writes the set into src/tyranny.html
node build.js
```

The survival family is **not swept for** - it is read from `puzzles/survival-seed.json`,
which `tools/lichess-seed.js` produces from the Lichess dump:

```
zstd -dc lichess_db_puzzle.csv.zst | grep -E "mateIn[123]" \n  | node tools/lichess-seed.js --out puzzles/survival-seed.json
node tools/lichess-seed.js --self-test          # 10 checks, no download needed
```

The seed supplies a position and where it came from, and nothing else is trusted:
`gen-puzzles.js` re-runs the predicate on every entry, recomputes the depth, the decoys and
each refutation from the FEN, and **throws** if its answer disagrees with the seeder.

`--target` is per family and the sweep stops when the **rarest** one reaches it, so budget
for multistep rather than for the average. `--cap` bounds what ships. `--now <iso>` pins
`generatedAt`, which is the only reason "the same seed writes the same bytes" is a property
anything can test — and the suite does test it. Nothing else in the file may be wall-clock;
a `predicateSeconds` field in the yield block made two identical runs differ by exactly two
bytes, and there is now a check for that class.

`--inline` is what makes puzzle mode work in a single-file build with no siblings. The
page reads `window.TYRANNY_PUZZLES` and never fetches — a `fetch` would work on GitHub
Pages and be silently empty when the file is opened locally or published as a single file.

**Nothing can drift.** `node build.js --check` rebuilds in memory and exits non-zero if
`index.html` does not match, and CI runs it on every push. It also compares the copy
inlined in `src/tyranny.html` against `puzzles/puzzles.json` directly, because a stale
inline copy would otherwise be copied faithfully into `index.html` and compared like with
like — passing while shipping the wrong data.

## Tests

The page has a **Run tests** button that executes 48 rule checks in the browser. The same
suites, plus the puzzle validator, run under Node:

```
node tests/run-all.js     388 checks, six files    27 / 8 / 24 / 13 / 290 / 26
node tests/browser.js     114 checks in headless Chrome, against the real DOM
```

Both numbers were printed by those two commands on **2026-09-17**, and the in-page 48 was
read off the page by clicking the button rather than inferred from the source.

**CI runs both, and that is new.** It used to run only the Node suites — which meant the
marker toggle, the puzzle-mode marker suppression and the Try again reset could all have
been deleted with the build staying green, because no suite under `tests/` other than
`browser.js` references any of that surface. CI is pinned to **Node 22** for the same
reason `browser.js` needs it: the global `WebSocket`. The runner checks for that itself and
exits **2** — could-not-run, as distinct from checks-failed — with a message naming the
version, rather than dying on a bare `ReferenceError`. Under `CI` it adds `--no-sandbox`
and `--disable-dev-shm-usage`, which a container needs and a developer machine should not
have.

`tests/browser.js` is a **separate runner on purpose**. It drives headless Chrome over the
DevTools protocol using Node's built-in `WebSocket` — no npm dependency, because this repo
has none — and it is not in `run-all.js`'s loop, so the Node count above stays a number
about Node. It serves the page over `127.0.0.1` rather than `file://`, because
`localStorage` on a file origin is opaque in Chrome and the persistence checks would test
nothing there.

The load-bearing Node check is `perft` in `tests/test.js`: with the variant rule switched
**off**, the engine reproduces the published standard-chess node counts exactly —
20 / 400 / 8,902 / 197,281 — which proves the base engine is correct and that the only new
thing is the rule itself. Variant counts measured at 39 / 1,519 / 63,034.

`tests/puzzles.js` re-derives every committed puzzle from its FEN rather than trusting the
file: the position parses, the side to move matches, every solution is legal and is of the
right kind *for its family*, the family predicate actually holds, and no decoy is also a
solution. For a multistep puzzle it walks the **whole** forcing line — every legal opponent
reply, each with the move that mates it — and names the reply if one escapes. It was
written **before** the generator and caught a real defect in the seed data on its first run.

It also **discriminates**, which is the part that makes the rest mean anything: a section
of deliberate corruptions must each be rejected, including the two the goal tree names as
release blockers — a restraint puzzle whose solution is the self-capture it warns against,
and a multistep that is really a one-mover.

## Honest limits

- The search runs on the main thread, so at **Hard** the page is briefly unresponsive
  (up to ~2s) while it thinks.
- There is **no networked multiplayer**. Two people play on one screen, or each plays
  the engine.
- **The engine DOES play strategic self-captures — but it has never voluntarily executed
  anything above a pawn.** Measured 2026-09-17 by `tools/ai-selfcapture.js` over **2,587
  engine decisions** at a pinned depth 4. It chose a self-capture 33 times: 4 forced, 10
  escaping check, 0 delivering mate, and **19 in none of those categories**. Re-scoring
  those 19 with a full-window search — not with `think()`'s per-move values, which are
  upper bounds — put **17 of 19 strictly ahead of every ordinary move**, one tied, and one
  in a position where every move loses by force. So the engine is not blind to the idea.
  What it will not do is pay for it: **32 of the 33 captured a pawn, and the one exception
  was forced.** That is the stock piece-square-table evaluation showing through, which
  prices an execution purely as the material lost. Reported as a measurement; **no
  evaluation change is proposed off the back of it.**
- **Its horizon is the limit, not the rule.** On a position where a quiet self-capture is
  the unique move forcing mate in two, **Easy misses it and Medium and Hard both find it** —
  the same result with the clock removed and depth pinned.
- **The shed claim was retracted, not softened** — see the stalemate section above for the
  sweep that killed it, and its stated limit.
- **Every survival puzzle offers exactly three ways out.** That is what the predicate
  yielded across 1.9M source puzzles, not a choice — positions with four or more and a
  unique survivor turned out not to exist in the sample. So the family is real but
  uniform in shape, and its difficulty field is 2 for all 153. The deep tier described in
  the Puzzles section is the measured route to a harder spread, at 4.8 hours of compute.
- Verified on desktop Chrome only, now including an automated headless run. The iPad emoji
  bug described below is fixed *by construction* — there is no font left to substitute —
  but that fix has never been re-tested on an iPad, and nothing here has been tested on
  Android.
- **`think()` is still not safe for ranking root moves**, and the 68-of-71 figure quoted
  above was measured in an earlier round and not re-run for this one. The working rule is
  unchanged: full-window per move, or a depth-free test.

## A note on the pieces

They are inline SVG rather than the Unicode chess characters, and that is deliberate.
**U+265F (♟) became a standard emoji in 2018**, so iOS has a colour-emoji glyph for it and
prefers that font. An emoji glyph ignores CSS `fill` and `-webkit-text-stroke` and carries
its own metrics, so on iPad the pawns rendered black on *both* sides and larger than the
back rank, while the other five chess codepoints — which are not emoji — rendered fine.
Drawing the pieces removes the font dependency entirely.

## License

MIT
