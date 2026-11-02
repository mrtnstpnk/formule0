# Formule

A two-player pen-and-paper racing game, playable hot-seat on one phone or
tablet. Based on the classic paper game where each player draws one quick
stroke per turn to move their car along a winding track — cross a wall and
you crash, cross the finish line first and you win.

Single-file prototype: one `index.html` with inline CSS/JS, HTML5 canvas,
no frameworks, no build step.

## How to play

- Players take turns. On your turn, draw **one fast stroke** with your
  finger (or mouse) to move your car.
- Your stroke must start exactly where your car currently is — the very
  first stroke of the game may start anywhere in the green start zone.
- The stroke lasts about 0.8 seconds; a shrinking ring shows how much time
  is left. Going fast covers more ground but is riskier.
- Touch a wall and you crash: the stroke is cut at the point of impact and
  the turn passes to the other player. Your next stroke starts from the
  crash point.
- Stay inside the track and the turn simply passes after your stroke ends.
- First player to cross the checkered finish line while still inside the
  track wins. Tap **Rematch** to play again.

## Running locally

No build step — just serve the file and open it:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser. Works with touch on
phones/tablets and with a mouse for desktop testing.

## Collision regression tests

With Node.js installed, run:

```bash
node --test tests/collision.test.cjs
```

These tests run the game's input handlers with a canvas stub and cover wall
collisions, recovery after a crash, shortcuts, and finish crossings in portrait
and landscape layouts. No dependencies are required.

## Deploying to GitHub Pages

A workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
publishes the repository root to GitHub Pages on every push to `main`.

To enable it on GitHub:

1. Push this repository to GitHub.
2. In the repo settings, go to **Pages** and set **Source** to
   **GitHub Actions**.
3. Push to `main` (or run the workflow manually) — the site will be
   published at `https://<user>.github.io/<repo>/`.

## Code structure

`index.html` is organized into clearly separated sections:

- **Config** — tunables like stroke duration and player colors.
- **Game state machine** — `WAITING_FOR_TOUCH` → `DRAWING` →
  `WAITING_FOR_TOUCH` / `GAME_OVER`.
- **Geometry helpers** — segment intersection, point-in-polygon,
  Catmull-Rom spline interpolation.
- **Track generation** — builds a smooth track corridor (with a start
  zone and checkered finish) from a hand-placed centerline, adapting to
  portrait or landscape viewports.
- **Rendering** — a pre-rendered static track layer plus per-frame
  strokes, crash markers, and the stroke time indicator.
- **Input handling** — Pointer Events unify touch and mouse.
- **Game logic** — turn handling, crash/win detection, reset/rematch.

Only one track is hardcoded for this prototype, but since it's generated
from a centerline + width profile, adding more tracks later just means
adding more centerline/width data.
