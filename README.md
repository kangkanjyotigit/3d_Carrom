# Carrom 3D 🎯

A physics-accurate 3D carrom game — real board rules, real flick controls, real physics. Classic 4 corner pockets, the home board everyone knows.

## Run it

```bash
cd Carrom3D
python -m http.server 8765
```

Then open **http://localhost:8765/carrom.html** (needs internet for the Three.js/cannon-es CDN modules; a local server is required because the game loads ES modules).

## How to play

- **Place the striker**: drag it left/right along the bottom baseline line.
- **Flick**: press anywhere and drag *away* from the striker — release to shoot. The white line shows your aim and first-bounce prediction; length = power. (Flicking straight back from the striker works too.)
- **Camera**: right-drag (or two fingers) to orbit, scroll/pinch to zoom.
- **Restart**: `R` key or the ↻ button.

## Rules (real carrom)

- First to pocket all **9 of your own coins** wins.
- Pocket your own coin → play again. Pocket the opponent's coin → it counts for *them* (bad!) and your turn ends.
- **Queen 👑 (+3)**: after pocketing the queen, pocket one of your own coins to cover it — if the opponent pockets one of theirs first, they steal it.
- **Fouls** (turn passes): striker in a pocket → one of your pocketed coins returns to the centre (and the queen returns if uncovered); first contact on an opponent's coin; dry shot (no contact).
- Coins that leave the playing surface (wedge into a cushion) return to the centre.

## Technical notes

- **Engine**: Three.js (rendering) + cannon-es (physics), one self-contained HTML file.
- **Physics authenticity**: board friction implemented as constant deceleration (μ=0.35) because cannon-es's solver friction on flat cylinder bases is pathologically wrong (~1000× amplified). Pieces are clamped to the play surface — carrom coins are flat discs and never fly, stack, or climb cushions.
- **AI**: plans direct shots to pockets with physical launch-speed modeling (braking losses over path length + measured 0.63 energy-transfer ratio), clearance checking, and a stop-shot model on first contact; plays a cautious but beatable game. Toggle 🤖 AI / 👥 2P in the top-right.

## Project layout

| File | Purpose |
|---|---|
| `carrom.html` | The entire game (single file) |
| `_test/` | Verification harness & simulator (same cannon-es config, AI-vs-AI full games, rule-engine unit tests, physics calibration) |
| `_test/cannon-es.mjs` | Local snapshot of the physics engine used by the tests |

Verified: full AI-vs-AI games terminate with a legal winner (e.g. 9-6, 9-3), zero dry shots, no hangs; 10/10 rule-resolution cases; physics calibration matches predictions (μ_eff 0.348 vs 0.35 target, cushion restitution 0.94, transfer ratio 0.63).
