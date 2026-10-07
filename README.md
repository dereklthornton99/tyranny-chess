# Tyranny Chess

Ordinary chess with one addition: **the king may command the execution of his own citizens.**

Any piece may capture a friendly piece, using exactly the geometry it already uses to
capture an enemy. Same board, same objective, same everything else.

**▶ Play it: https://dereklthornton99.github.io/tyranny-chess/**

A second rule set, **Coriantumr** (last man standing is the king), is a switch on the same
page: see [Coriantumr](#coriantumr-a-second-rule-set).

Hot-seat for two players, an engine opponent at three strengths, and **280 puzzles in four
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

## Coriantumr: a second rule set

A rules switch on the same page (**Rules: Tyranny / Coriantumr**), named for the Book of
Mormon figure who was the last man standing. The king is no longer the centre of the game:
**the last piece on the board is the king.** Switching rules starts a fresh game, and the
self-capture toggle, the Tyranny demos and puzzle mode are locked while it is on.

**The rules**

- **King and queen** both slide **up to four squares** in any of the eight directions.
  Pieces in the way block them, an enemy on the last square can be captured, a friend never
  can. They move identically.
- Every other piece moves as in chess, including pawn double steps, en passant and
  promotion. **No self-capture. No check, no checkmate, no castling.** Any move is legal even
  if it leaves your king where it can be taken.
- **Capturing a king is an ordinary capture.** It does not end the game.
- **Succession.** After any capture, if a side still has pieces but **no king and no
  queen**, its closest bishop becomes a king. No bishop: the closest knight, then rook, then
  pawn. *Closest* means the smallest straight-line distance (squared) to the square where
  the capture happened; a tie goes to the lower file, then the lower rank. A queen that is
  alive when the king falls takes command **without changing**; a queen captured while the
  king lives changes nothing.
- A pawn reaching the far rank may become a queen, rook, bishop or knight, and also a
  **king** when its side has no king piece.
- **You win when the opponent has no pieces.** No legal move while you still have pieces is a
  draw; so are the fifty-move rule and threefold repetition. There is no insufficient-material
  draw.

**Decisions that are the owner's** (2026-10-07): a surviving queen takes command rather than
a bishop being promoted; a queen's death needs no replacement queen; ties are settled by a
fixed rule, not a pop-up; a promoting pawn gets the king as a fifth choice; the first
release is two players plus the engine, with puzzles staying Tyranny-only.

**Succession is derived, not remembered.** The engine stores no "the king was lost" flag.
It applies the rule after every capture from the board alone, so a position carries all the
history it needs, undo needs no extra state, and a side whose king returns (a crowned
piece, or a pawn promoted to king) simply has a king again. The rule set rides on the board
state as `S.v === "c"`; it is absent, not false, for Tyranny and standard play, so no
existing function signature changed.

**How it was checked**

- An independent reference, `tools/coriantumr-ref.py`, written in Python with a different
  board representation and a global "after a capture" succession check. `tests/coriantumr-golden.json`
  holds 15 hand-made positions (ties, distance-versus-class, queen-alive cases, promotion
  with and without a king piece, en passant) and 300 sampled ones with a digest of every
  move and resulting board; the JS engine matches all of them.
- Perft from the start position under the variant: **20 / 400 / 9,122 / 207,622** at depths
  1 to 4. Depth 3 was also derived by hand (8,902 plus 20 × 11); the Python reference
  agrees at every depth. Tyranny and standard perft are unchanged.
- Mutation testing: the engine tests carry 19 deliberate breaks of the engine source and the
  engine-opponent tests 7 more (a wrong succession order, a flipped tie-break, a dropped
  variant tag); each must be caught or the suite fails. The page checks were also run once
  against nine deliberate breaks of the page and caught every one; that was a one-off run,
  not a standing test.
- Real-browser checks click the rules button and board squares and read the live DOM: the
  switch, move highlights against an independently written slider, the queen taking command,
  the crowning drawn as a king, the win, the draws, the promotion picker, the puzzle lock,
  and a 50-ply game against the engine with the variant tag intact in every position and no
  page errors.

**The engine plays it, but only as well as its value guess.** It uses the same search with
the variant's terminal rules (no pieces is a loss, no move with pieces is a draw, no
insufficient-material shortcut). The values are the ordinary ones with king and queen both
set to 800, **an estimate that has not been tuned or measured**. Nothing here claims its
strength. `node tools/coriantumr-selfplay.js` reports plain counts at a pinned depth of 3
and a 150-ply cap (2026-10-07): **100 games against a seeded random mover**, 100 won by the
engine (mean 55.3 plies), 0 illegal moves, rule-set tag on every position; **20
engine-versus-engine games** (each opened with 6 seeded random plies so they differ, and all
20 are different games), 0 decisive: 9 ended by repetition and 11 reached the cap. That
matches the endgame table below: the engine wins against a random mover, and two engines
do not finish each other off.

### Can a lone king be hunted down? Measured, and the answer is mostly no

Because a king or queen that has been left alone slides four squares in any direction, the
question is whether "last man standing" can be forced. `tools/coriantumr-endgame.js` solves
the small endings by retrograde analysis (working backwards from captures) over every
distinct position, and checks 6,000 of them against the real engine (0 differ; 1,357
crownings and 1,334 last-piece captures all agree).

| Material | Positions per side to move | Bigger side to move: forced win | Lone side to move: bigger side still wins |
|---|---|---|---|
| lone piece against lone piece | 4,032 | 1,208 | 0 |
| plus one more slider | 124,992 | 63,692 (63,592 at once, 100 in three plies) | 8 (all with the lone piece cornered) |
| plus a rook | 249,984 | 113,576, all at once | 0 |
| plus a bishop | 249,984 | 98,200, all at once | 0 |
| plus a knight | 249,984 | 87,480, all at once | 0 |

**What it means.** One extra piece cannot force the capture of a lone four-square slider:
every win is a capture that is already available, so a lone king is lost only to a blunder.
Two sliders trap one only from eight cornered positions. Best-play endings will therefore
usually end by the fifty-move rule or repetition, not by annihilation. **Not covered:**
pawns, three or more attackers, and the fifty-move and repetition rules. Whether to add a
rule so these endings can finish is the owner's call and has not been made.

**Not built:** puzzles in the variant, a pick-your-own-tie step, and any rule patch for
the undrawable endings above.

## Puzzles

280 positions. All four predicates are **depth-free** — exhaustive ply enumeration using
only `legal()`, `apply()` and `inCheck()`, no search and no engine scoring.

| Family | Count | Predicate |
|---|---|---|
| **Survival** | 153 | **Checkmate under standard rules**, three ways out under Tyranny, and **exactly one of them is still alive after the reply**. The other two are legal, look no different, and lose. |
| **Tactical** | 20 | A self-capture is mate in one, no other move is mate in one, **and no ordinary move forces mate within two plies**. |
| **Restraint** | 40 | A self-capture is available and an ordinary move mates at once, and **no self-capture mates in one or forces mate within three plies**. The answer is the ordinary move; the executions are the decoys. |
| **Multistep** | 67 | Exactly one self-capture **forces mate within three plies**, nothing mates in one, and **no ordinary move forces it either**. You have to see past the first move, and skipping the execution does not win. **Played as two moves of yours**: you find the execution, the opponent answers, you finish it. 27 come from the random playout, 40 from real games. |

### Multistep puzzles are played as multistep puzzles

They were not, and that was a defect rather than a design. The family was generated and
validated as forced mates in two, and every one of them really is one — but each record
held a single move and nothing after it, so the page judged that move correct and ended the
puzzle. Every data check was green, because the checks were about the data and not about
what the player is asked to do. The fix has two halves.

**The data.** A puzzle may carry a `line` (schema 5): an ordered list of steps, solver and
opponent alternating, where each solver step holds `accept` — **every** move that is correct
at that point, so finding a different mate is not marked wrong. It stores **one** opponent
reply, and that loses nothing, because the family's defining property is that *every* reply
loses: the generator refuses to emit a line unless every reply has a mating answer, and
`tests/puzzles.js` re-derives all of them rather than the one stored. The stored reply is
the one with the fewest mating answers, ties broken by move string, so the same input
always yields the same file. `depth` was deliberately not reused for this: on survival
puzzles it already means something else.

**The page.** A correct first move leaves the puzzle open, the opponent's reply is played,
and you are asked for the finishing move. A wrong second move offers Try again, which
restarts the whole puzzle; Reveal shows the whole remaining line; Next stays disabled
mid-line, so the second move cannot be skipped. A click made while the opponent's reply is
still pending (about half a second) is ignored rather than judged; before that was fixed, a
stray click right after a correct move was scored "Not it", counted a try, and cancelled the
reply. This interaction is checked in a real headless Chrome — the check round two did not
have. The opponent's step says honestly whether the reply was "the only legal reply" or "one
of 26".

**What this does not make hard.** 17 of the 27 playout puzzles leave the opponent exactly
one legal reply, so their second move is a forced recapture. They now play as two moves, but
the second is easy to see, and only three of the 27 give the opponent more than four replies.

### Where the 40 real-game multistep puzzles come from

From the same Lichess CC0 database as the survival family, mined by
`tools/lichess-multistep.js`. Survival uses the *last* position of each line, where the
loser has just been mated. A multistep puzzle wants the attacker, a move or two earlier, so
**every** position along each line is a candidate and the predicate decides. The database is
a position source and nothing more: no Lichess move is ever used as an answer, and every
solution, line and decoy is re-derived from the FEN by the generator, which throws if a
position stops qualifying.

**Measured, plain counts.** The first 200,000 of 6,157,341 rows (3.25%), on 7 parallel shards
in 19 minutes: **1,125,354** positions tested; **234** passed the multistep predicate;
**167** of those were rejected because the opponent had fewer than two replies; **67** kept,
one per source row. The first **40** in scan order ship. `puzzles/multistep-seed.json`
records the database file's size and SHA-256, because the database is republished and its
rows are not stable. **That hash is of the file named at merge time (`--db`), and the shards
read a pipe and do not verify it**: merging with the wrong `--db` would write a false
provenance line. It is correct for this seed (the file was re-hashed after the scan and
matched), but nothing in the tooling would have caught the mistake, and a fingerprint of the
rows each shard actually read would close it. That has not been built.

Three things that scan taught, each a number rather than an opinion:

- **No mate-theme prefilter.** It would have been the obvious speedup, and it is lossy: only
  7 of the 40 came from rows carrying a mate theme at all. A self-capture opens forced mates
  that standard chess does not have, so the rows worth scanning are not the rows Lichess
  labelled as mates.
- **A small slice misleads.** The first 20,000-row block gave 12 candidates; across the ten
  blocks the range is 4 to 12 with a mean of 6.7. A projection from that first block was
  about twice too high, which is why the yield is reported from the whole 200,000.
- **The full file is not a single run.** One row costs about 40 ms of one core, so the whole
  database is roughly 9 to 10 hours even on 7 shards. That figure is extrapolated from the
  rate, **not run**.

**What these puzzles are not.** `source.rating` is the Lichess rating of the *standard*
puzzle the position came from. The position can sit anywhere along that puzzle's line
(`source.ply` says where) and its answer is a self-capture the standard puzzle never
contains, so the rating is provenance and a loose prior — not the difficulty of this puzzle.
`difficulty` comes from the generator's own rule, like every family. The opponent was
required to have at least two replies, a design choice meant to make "every reply loses"
something you must check rather than a single forced line. It has **not** been measured that
players find these harder, and 32 of the 40 give exactly two replies.

### What a standard engine can and cannot do here

Stockfish 19 (the ARM64 build, depth 16) was tried, because the question was a fair one.
**It cannot score Tyranny positions**, and the reason is the whole variant: it assumes
neither side can capture its own piece, so it is blind to the *defender's* new escapes and
to the attacker's self-capture mates. `tac-0003` is the clean case. Stockfish and
python-chess both say Qe6 is checkmate. Under this rule it is not — Black answers with the
king executing his own pawn onto g7 — and the puzzle's real answer is a different move
entirely, a bishop self-capture that mates at once.

That is a wrong *move*, not a wrong verdict: White still wins there, just not by the move
Stockfish names. How often a standard mate-in-one is refuted here was measured in an earlier
round — 463 of 900 sampled real-game positions, 51.4% — and it too is a statement about
mating *moves*. Whether Stockfish misjudges *who is winning*, as opposed to which move wins,
was **not measured**: the 12 positions probed are wins by construction, so they could not
show it either way.

So nothing in `puzzles.json` came from Stockfish. The probe is
kept as `_context/sf-probe.py`, with that finding in its header, because the measurement is
worth more than the engine. What found the puzzles is the depth-free predicates, and what
made them real positions is the Lichess data.

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
reach a survival puzzle without working through 127 other positions first. The shuffle runs on entry, not
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
puzzle, just a small one. The spread across the whole set is **3 / 200 / 77**.

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
puzzles/puzzles.json    GENERATED by tools/gen-puzzles.js, and by nothing else
tools/gen-puzzles.js    the ONLY writer of puzzles.json: the sweep, the predicates, both
                        seed merges, and --inline
tools/line.js           the continuation a multi-move puzzle is played through
tools/lichess-seed.js   derives survival puzzles from the Lichess CC0 database
puzzles/survival-seed.json  GENERATED, committed: positions and their provenance
tools/lichess-multistep.js  mines the same database for multi-move puzzles, in shards
puzzles/multistep-seed.json GENERATED, committed: positions, provenance, and the
                        database file's SHA-256 so "reproducible" can be checked
tools/fen-write.js      toFen(state); the page ships only a parser
tools/shed-sweep.js     is a king shed ever sound? --check <fen> classifies one position
tools/ai-selfcapture.js what the engine does with self-captures, and whether it prefers them
tools/coriantumr-ref.py independent Python reference for the Coriantumr rules; --check verifies the fixture
tools/coriantumr-endgame.js retrograde solver for the small Coriantumr endings; --self-test checks it against the engine
tools/coriantumr-selfplay.js plain counts for engine games under the Coriantumr rules
tests/                  eight Node suites, run against src/ not the built page
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

The multi-move family has a second seed, `puzzles/multistep-seed.json`, built the same way
but scanned in parallel shards (the corpus is 6.16 million rows and one row costs about
40 ms on one core):

```
# K shards over the first R rows - run these side by side, one per core
zstd -dc lichess_db_puzzle.csv.zst | node tools/lichess-multistep.js --rows R --shard I/K --out shard-I.json
# combine them; refuses unless every shard 0..K-1 is present and agrees on every setting
node tools/lichess-multistep.js --merge shard-0.json ... --db lichess_db_puzzle.csv.zst --cap 40
node tools/lichess-multistep.js --self-test
node tools/line.js --self-test
```

`gen-puzzles.js` derives **both** seeds before it starts the sweep, so a stale one fails in
seconds rather than after a multi-minute sweep is thrown away. A test now proves that,
because the generator's own comment claimed exactly this while the code ran the sweep
first. `--multistep none` skips the multistep seed, which is how the sweep's own output is
checked in isolation.

**One writer.** `puzzles.json` is written by `tools/gen-puzzles.js` and by nothing else.
An earlier standalone tool edited the file in place to add the continuations; the generator
knew nothing about it, so a plain regeneration would have written schema 4 again and
dropped every one of them, with nothing failing until somebody committed the result. It was
deleted, its logic moved into `tools/line.js`, and the generator was run in full with the
committed parameters to prove it reproduces the file **byte for byte**. `tests/puzzles.js`
now keeps that true cheaply: it rebuilds every committed sweep record through the
generator's own `buildEntry` and compares the schema constant to the file.

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
node tests/run-all.js     638 checks, eight files  27 / 8 / 24 / 13 / 396 / 117 / 27 / 26
node tests/browser.js     241 checks in headless Chrome, against the real DOM
```

Both numbers were printed by those two commands on **2026-10-07**, and the in-page 48 was
read off the page by clicking the button rather than inferred from the source. Before the
Coriantumr work they were 494 and 166; the Tyranny and standard suites are unchanged and
the rest are additions (`coriantumr.js` 117, `coriantumr-ai.js` 27, 75 more browser checks).

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

**The browser suite was flaky before this round, and randomness was the cause, not Chrome.**
The puzzle set is shuffled on every entry, and two sections drew on whichever puzzle came up
first. One was a "select every piece" sweep that also *played* a move whenever the next piece
it clicked was a legal target of the one it had just selected, which under this rule includes
friendly pieces: it executed a move in 195 of today's 280 puzzles, and in five survival
puzzles that move was the answer, so the puzzle came out marked solved and a later check
failed. The other took the first restraint puzzle dealt, and two of the 40 are solved by a
promotion, which a two-click helper cannot finish because it opens a piece-choice dialog.
Together that was roughly a 7% chance of a failing run (5 of 240 plus 2 of 40) before any of
this round's work, so earlier clean runs were partly luck. Each cause was reproduced
deterministically on a real page and then fixed at the root: the sweep clears its selection
before every click and asserts it played nothing, and both picks now come from the data in id
order, not from the deal. The waits for the page's own timers also poll instead of sleeping,
because a fixed 900 ms sleep failed once with every core busy. Afterwards the suite passed six
runs in a row, and two more with 12 busy loops on 8 cores. That is evidence, not a proof
that no other deal-dependent check exists.

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

Since the continuation work it also does three things the older checks could not. It
re-derives every stored `line` from the FEN alone and mutates each rule it checks. It
rebuilds every committed sweep record through the generator's own `buildEntry` and compares
the generator's schema constant to the file, so a generator that has drifted from the data
fails in under a second instead of after a regeneration. And it compares the puzzle counts
this README quotes to the data, so those counts cannot go stale without a test failing.

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
- **A standard engine cannot rank these puzzles.** Measured with Stockfish 19 at depth 16:
  it assumes neither side can capture its own piece, so it calls checkmate on positions the
  variant says are not mate (`tac-0003`: Qe6 is mate to Stockfish, and Black escapes by
  executing his own pawn). Nothing in the set is scored, ranked or selected by it.
- **The real-game multistep puzzles' provenance is looser than it looks.** `source.rating`
  belongs to the standard puzzle the position came from, not to the puzzle you are solving,
  and requiring the opponent to have two replies is a design choice, not a measured effect
  on difficulty. The yield figures come from a 3.25% prefix of the database; the projection
  to the whole file is labelled as one and has not been run.
- **Nobody can see the source link.** All 193 survival and real-game multistep puzzles carry
  a Lichess id, rating and a link to the game, but the page never reads that field. It is in
  `puzzles.json` and nowhere on screen.
- **Most of the new second moves are two-way choices, not wide ones.** 32 of the 40
  real-game multistep puzzles give the opponent exactly two replies, and 38 of the 40 have a
  single mating answer at the end.
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
