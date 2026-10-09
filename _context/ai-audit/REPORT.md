# Tyranny Chess AI audit: Easy, Medium and Hard

> **Update 2026-10-09: the tiers were retuned after this report.** You asked for Easy about 1000, Medium about 1480 and Hard
> unchanged at about 1840. **Everything below describes the tiers as they were on the morning of 2026-10-08** (Easy 1480, Medium
> 1820, Hard 1844). The retuned settings, their measurements, and the proof that Hard is unchanged are in the README's "The three
> strengths". Changes 1 and 2 of section 8 were made in a different form as part of that work: a bare-king rule with a larger
> king-approach bonus (1), and seeded random draws among near-best moves for Easy and Medium (2).

**Date:** 2026-10-08. **The audit itself changed nothing in the game** (the retune described above came afterwards). The measuring tools are in `tools/ai-audit/` and every raw result is in `_context/ai-audit/`, on the local branch `ai-audit`, uncommitted.

Terms used below. A **ply** is one move by one side (two plies make a full move). A **centipawn** (cp) is a hundredth of a pawn; "loses 50 cp" means the move cost half a pawn of advantage, as Stockfish judges it. **Elo** is a strength rating where +100 means winning about 64% of games. **Stockfish** is the strongest open chess engine; version 19 here, run on this laptop.

## Bottom line

1. **The two opening knights are not chance.** The engine's placement table pays +50 for developing a knight and +40 for e4 or d4, and when several moves tie at the top it keeps whichever its move generator lists first (the b1 knight). It has no randomness and no opening book, so the same position always gets the same move. At your defaults (Medium, Tyranny rules) it plays 1.Nc3 and then 2.Nf3 after all 12 common Black replies I tried. Proven by changing the engine on a scratch copy (section 1).
2. **Strength on Stockfish's scale:** Easy about **1480**, Medium about **1820**, Hard about **1844** (each plus or minus roughly 90, from 80 games each).
3. **Hard is only slightly stronger than Medium against an outside opponent**, though Hard beats Medium 36 to 8 with 16 draws. Head-to-head games between two versions of the same engine exaggerate the gap; against Stockfish the two are within about 25 Elo, inside the error bars. Hard spends three times Medium's time and gets 0.4 to 0.6 plies more depth for it.
4. **Tactics are good; quiet-move judgment is the weak spot.** Medium and Hard find the only good move in "critical" positions 77 to 78% of the time (Stockfish at 1900 manages 74%), yet they make the same 28 big errors (200 cp or more) in 478 positions, and only 3 of those 28 are tactical. More depth does not fix them; the evaluation does.
5. **Easy cannot finish a won ending.** With king and queen against a lone king it mates in 3 of 30 tries, and with king and rook in 11 of 30; the rest are drawn by the fifty-move rule. Medium and Hard mate 60 of 60. Raising one bonus in the evaluation makes Easy mate 59 of 60 (tested on a scratch copy).
6. **The rules are right.** 32,566 positions: zero disagreements with python-chess on legal moves or check, and no illegal move in 330 games. One small gap: dead positions with only same-coloured bishops are not called draws.

## 1. Why it opens with two knights

**What it plays.** From the start position as White, every tier plays 1.Nc3. How often its second move is also a knight, over the 12 common Black replies (e5, d5, Nf6, c5, e6, c6, d6, g6, Nc6, b6, f5, a6):

| Tier | Tyranny rules (the page default) | Standard rules |
|---|---|---|
| Easy | 10 of 12 | 10 of 12 |
| Medium | **12 of 12** | 6 of 12 |
| Hard | 7 of 12 | 5 of 12 |

As Black its reply to White's 20 possible first moves is a knight in 16 to 19 of 20, depending on tier and rules, and its first two replies are both knights in up to 16 of 20 (Easy). Medium differs between rule sets because self-capture changes what its search sees; your default is the Tyranny column.

**Why.** Three things, all in `src/tyranny.html`:

- *The table.* The evaluation adds a bonus per piece per square (Tomasz Michniewski's "simplified evaluation" tables). A knight on b1 or g1 is worth -40 and on c3 or f3 +10, so developing it gains **+50**. A pawn on e2 is worth -20 and on e4 +20, so e4 or d4 gains **+40**.
- *The tie.* Because both sides gain the same, the first moves tie. Exact scores: at depth 5 in Tyranny, d4 +40, Nc3 +40, Nf3 +40, e4 +35; at depth 6 in standard rules, d4, e4, Nc3 and Nf3 are all +0; Easy at depth 2 has Nc3 and Nf3 at +0 and the pawn moves at -10. The root search keeps the first move that reaches the best score, and the move generator lists the b1 knight before the g1 knight.
- *No variation.* There is no randomness and no opening book, so the choice repeats exactly.

**Proof (scratch copies of the engine, not the repo).** Removing the +50 on c3 and f3 changes the first move to **1.d4 in all three tiers**. Reversing only the tie order changes it to **1.Nf3 in all three tiers**. Second-move knights stay frequent in the first experiment (9, 6 and 6 of 12) because other knight squares such as d2 still pay a bonus.

**Is it bad?** Stockfish rates 1.Nc3 at -8 cp against +29 for 1.e4, +24 for 1.Nf3 and +22 for 1.d4: the tie-break happens to pick the weakest of the four moves it sees as equal, by about a third of a pawn. 1.Nc3 d5 2.Nf3 is a sound line (-8). So the opening is **playable but predictable**, not losing.

## 2. Strength

Games against Stockfish limited to a stated rating (its `UCI_Elo` setting), standard rules, balanced four-ply openings, alternating colours, python-chess refereeing, Stockfish thinking 0.25 s a move. One rating per tier by maximum likelihood over all its games; the range is 95%.

| Tier | Rating | 95% range | Results against Stockfish (wins, draws, losses) |
|---|---|---|---|
| Easy | **1480** | 1402 to 1560 | vs 1320: 27, 4, 9; vs 1500: 15, 7, 18 |
| Medium | **1820** | 1734 to 1912 | vs 1500: 33, 0, 7; vs 1750: 21, 9, 10 |
| Hard | **1844** | 1756 to 1940 | vs 1500: 37, 2, 1; vs 1750: 21, 3, 16 |

Between tiers: **Hard v Medium 36, 16, 8** (73%, about +176 Elo, range +102 to +268); **Easy v Medium 0, 0, 30**.

*Reading the scale.* Stockfish's own source (`src/search.h`) says its limited-strength setting "covers CCRL Blitz Elo from 1320 to 3190, approximately". These ratings are on that scale, not Lichess, chess.com or FIDE, and carry that calibration's uncertainty on top of the ranges above. They say how the engine compares with Stockfish at fixed handicaps, not how it will fare against a particular human.

*Why Hard v Medium and Hard v Stockfish disagree.* A deeper search of the same engine exploits its shallower twin's blind spots, which an unrelated opponent does not share, so such head-to-head gaps run larger than gaps against a third party. That fits the data but was not tested separately. Both numbers are real; the Stockfish-based one is the fair measure of Hard's strength.

## 3. Accuracy

478 realistic positions (Stockfish at 1700 playing itself from balanced openings, kept if within 7 pawns of equal), each tier moving once in every position, Stockfish scoring the position before and after at depth 16. Stockfish at five fixed ratings and a random mover played the same positions as yardsticks. "Accuracy %" is Lichess's per-move formula (its source, `AccuracyPercent.scala`, was read for the constants).

| Player | Mean cp lost per move (95% range) | Median | Accuracy % | Within 10 cp | Lost 100+ cp | Found Stockfish's best move |
|---|---|---|---|---|---|---|
| Easy | 80.6 (68.2 to 94.7) | 30 | 83.5 | 36% | 24% | 33% |
| Medium | 53.3 (46.0 to 61.8) | 17 | 87.9 | 43% | 17% | 41% |
| Hard | 52.8 (45.2 to 61.2) | 16 | 88.0 | 44% | 18% | 42% |
| Stockfish 1320 | 92.4 | 36 | 82.3 | 30% | 27% | 24% |
| Stockfish 1600 | 50.4 | 20 | 88.9 | 41% | 17% | 32% |
| Stockfish 1900 | 36.0 | 12 | 91.9 | 48% | 10% | 41% |
| Stockfish 2200 | 33.3 | 10 | 92.2 | 50% | 10% | 41% |
| Stockfish 2500 | 24.5 | 8 | 94.0 | 56% | 6% | 47% |
| Random mover | 382.7 | 237 | 50.5 | 5% | 73% | 3% |

- **Critical positions** (the best move beats the second best by 100 cp or more, 77 of them): the share where the player finds the best move: Easy 68%, Medium 78%, Hard 77%; Stockfish 1320 40%, 1600 55%, 1900 74%, 2200 70%, 2500 88%. Search-based tactics are the engines' strength.
- **Accuracy alone mis-ranks them.** It puts Medium and Hard level with each other (paired difference 0.5 cp per move, range -2.5 to +4.3) and near Stockfish 1600, well below their match ratings. Stockfish's weakened play errs at random; the engine errs systematically but rarely hangs a piece. Accuracy shows the error profile, not strength. Placed on Stockfish's scale by accuracy alone: Easy about 1383 (below 1320 to 1460), Medium about 1574 (1506 to 1682), Hard about 1579 (1510 to 1697).
- **What the big errors are.** Medium and Hard each lose 200 cp or more in 28 of 478 positions, mostly the same positions and the same moves (for example e5?, Be3?, Qxg7?, Kg1?). Following Stockfish's best reply for four plies, only 3 of the 28 lose material, so they are positional or king-safety misjudgments that a search of 4 to 6 plies does not see through. Medium and Hard pick the same move in 86% of positions; where they differ (66 positions), Hard is 50 cp better in 10 and Medium in 8.
- By phase (mean cp lost, Medium / Hard): opening 37 / 40, middlegame 61 / 59, endgame 42 / 43.

## 4. Search depth and time

| Tier | Limit as shipped | Mean depth reached | Range | Mean time used |
|---|---|---|---|---|
| Easy | 2 plies, 150 ms | 2.0 | always 2 | 6 ms |
| Medium | up to 6 plies, 600 ms | 4.5 | 3 to 6 | 590 ms |
| Hard | up to 9 plies, 1800 ms | 5.1 | 4 to 8 | **1804 ms** |

- Hard **never reached its depth-9 cap** in 478 positions, so the cap is decoration; Medium hit its cap of 6 in 25. Three times the time bought 0.4 to 0.6 plies (5.30 against 4.88 with one process alone). The search has no transposition table (which remembers positions already searched), null-move pruning or late-move reductions, so each extra ply costs roughly six times the nodes.
- **No early exit:** Hard uses the whole 1.8 s on essentially every move, including forced ones.
- Speed on this laptop: 377k (Hard) to 437k (Medium) nodes a second alone; running six games at once cost 9 to 15% (344k to 370k), about 0.2 plies, which slightly understates both tiers in the matches. The tiers are time-based, so on a slower device Hard falls toward Medium.
- **Tyranny's self-capture** costs the search 0.52 plies at Medium and 0.37 at Hard, and changes the chosen move in 3% and 8% of positions (60 positions). The Stockfish-based numbers therefore carry over to Tyranny play approximately, but Stockfish cannot judge self-capture tactics at all (your 2026-10-02 probe), so those remain unmeasured.

## 5. Won endings

King and queen, or king and rook, against a lone king, 30 random positions each, Stockfish defending at depth 6, python-chess refereeing with the fifty-move rule:

| Tier | Queen mates | Rook mates | Mean moves to mate (queen / rook) |
|---|---|---|---|
| Easy | **3 of 30** | **11 of 30** | 23.7 / 20.5 |
| Medium | 30 of 30 | 30 of 30 | 6.6 / 9.6 |
| Hard | 30 of 30 | 30 of 30 | 6.6 / 8.9 |

Every Easy failure was the fifty-move rule. In the one failure I replayed, the black king was driven to the h-file corner and White's queen then checked in circles while White's own king stayed on e5. **Cause:** the evaluation's bonus for bringing its king closer is 4 points a square (`mopUp()`), smaller than the queen's placement-table swings, and two plies cannot plan three moves. **Verified on a scratch copy:** raising it to 30 lets Easy mate 30 of 30 with the queen (12.3 moves) and 29 of 30 with the rook; Medium stays at 15 of 15 and 15 of 15 (Hard was not retested). The bonus only applies when the opponent has no pieces besides pawns.

## 6. Rules and games

- **Legal moves and check:** 32,566 positions from complete random games and the audit's own games; 0 disagreements with python-chess on the set of legal moves, 0 on whether the side to move is in check.
- **Dead material:** 14 disagreements in 36,566 positions (those 32,566 plus 4,000 random few-piece positions), every one of them only bishops all on one colour of square. python-chess calls that a dead position (no mate possible); the page does not, so such a game runs on to the fifty-move rule.
- **Games:** 330 games against Stockfish and between tiers, 0 illegal moves. 41 ended in draws (repetition, insufficient material, fifty-move rule, one move-cap); in 9 of them Stockfish rated the AI's position at +300 cp or better at some sampled point, so conversion failures exist but are rare.

## 7. Limits

- Ratings rest on Stockfish's calibration and on 80 games per tier (about plus or minus 90 Elo); distinguishing Medium from Hard would need hundreds of games.
- Stockfish's limited-strength play errs at random, a human's does not, so these numbers do not transfer directly to a human opponent.
- Standard rules only for anything involving Stockfish; Tyranny self-capture play is unmeasured.
- One laptop, one day, the engine run under Node.js (the same V8 engine Chrome uses), not inside the page.
- The 478 positions come from Stockfish at 1700 playing itself, a proxy for amateur games, not real games.

## 8. Possible changes (none applied)

In the order I would take them. The first two are small and already tested on scratch copies; the rest are real engineering and should be measured with `tools/ai-audit` before anything ships.

1. **Easy mating technique** (done 2026-10-09 for Easy and Medium, with the bare-king rule). Raise the king-approach weight in `mopUp()` from 4 to 30. Tested: Easy 59 of 60 mates (was 14 of 60), Medium unaffected. One line; Hard not retested.
2. **Opening variety** (done 2026-10-09 for Easy and Medium by seeded sampling; Hard still plays one fixed opening). Start by choosing randomly among root moves that tie exactly, seeded, and only at the page's call site with a switch that tests leave off. It costs no strength by construction but needs a small re-search of the tied moves, because the current root search only gives a bound for them. A "within 15 cp" margin would vary more but could cost accuracy; untested.
3. **Make Hard harder than Medium** (your decision whether you want that). Options: a transposition table, null-move pruning and late-move reductions, which usually add one to two plies at equal time; or a much larger time budget. Effect untested here; the path-dependent "any repetition is a draw" scoring would need care with a transposition table.
4. **Evaluation terms** (king safety, mobility, pawn structure). The largest accuracy lever, because the big errors are evaluation errors. Needs tuning against this harness.
5. **Early exit on forced or obvious moves.** Pure responsiveness; no strength change.
6. **Same-coloured-bishop dead positions** as draws. Tiny.

## Appendix: reproducing

`tools/ai-audit/`: `engine-server.js` (serves the page's engine), `audit_lib.py`, `positions.py`, `accuracy.py run|summary`, `match.py run|summary`, `tier_elo.py`, `ladder.py`, `endgames.py`, `endgame_counterfactual.py`, `opening_probe.py [--selfcap]`, `opening_counterfactual.py`, `rules_diff.py`, `blunders.py`, `game_analysis.py`, `tyranny_cost.py`. Stockfish 19 is at `signpost-library/_context/chess-test/engine/stockfish/`. The full match run takes about 75 minutes on 6 of 8 cores.
