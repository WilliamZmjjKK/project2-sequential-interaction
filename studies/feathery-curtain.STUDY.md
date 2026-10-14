# Feathery Curtain

A single-screen, phone-first touch study in two steps. A curtain of short cream threads hangs from the top of a navy screen. **Step 1:** the user drags down to stretch the threads past a target line; on success the threads unfurl into a full screen of overlapping, colour-graded feathers ("plumage") with a chime. **Step 2:** the user strokes the feathers, which ruffle under the finger and play notes from a D-major pentatonic scale, so a stroke becomes a short melody.

Source: exported from claude.ai artifact `KYvjQNvCbJ88MpcPqHw1Bj` (version `1791334347-a0c7`). `index.html` is a byte-identical copy of the published page (sha256 `ce72baac…7b62ec`); line numbers below refer to it.

## Running it

- No build step, no dependencies, no asset files. Everything (styles, feather geometry, palette, sound synthesis) is inline in `index.html`.
- Open `index.html` directly in a browser, or serve the folder: `npm start` (runs `npx http-server`), or `python3 -m http.server`.
- Best viewed on a phone or in browser dev-tools device mode. On screens ≥ 560px wide the stage is shown as a 430×900 phone-shaped card centred on the page.
- Requires: Canvas 2D, Pointer Events, Web Audio API (`AudioContext`, falls back to `webkitAudioContext`), `ResizeObserver` (falls back to `resize`). Audio starts only after the first touch (browser autoplay rules). `navigator.vibrate` is used if present.
- Note: the platform wrapper put `<title>` inside `<body>` (line 2); browsers accept this. It was left untouched to keep the export identical.

## Main visual and interactive components

| Component | What it is | Where |
|---|---|---|
| Stage | Full-bleed container (phone-card on wide screens), `touch-action: none` | HTML L98; CSS `#stage` L27–47 |
| Canvas `#cv` | All drawing: threads, beads, feathers, guide, ring, specks | HTML L99; `frame()` L417–585 |
| Threads + beads | Vertical lines from the top edge, each ending in a pulsing bead; lengths animate | built in `layout()` L211–245; drawn L482–500 |
| Feathers | Bezier feather shape (`SHAPE` L121) filled with a navy→teal→gold→cream gradient by row (`STOPS` L122, `color()` L150); overlay sprite of shaft + barbs | grid in `layout()`; sprite `buildSprite()` L186; drawn L454–478 |
| Pull guide | Dashed "PULL TO HERE" line at 70% screen width, % readout, target circle filling with progress, dotted remaining-distance line, animated chevrons, finger ring | L502–552 |
| Success ring | Target line snaps solid, two rings expand from the release point | L554–565 |
| Specks | Small drifting motes on success and while stroking | spawned in `succeed()` / `excite()`; drawn L567–577 |
| Caption pill `.cap` | Bottom pill with 2 step dots and instruction text | HTML L100–103; CSS L49–78 |
| Replay button `#replay` | Top-right circular "Start over", hidden until step 2 | HTML L104–106; CSS L80–94; handler L412 |
| Sound engine | Web Audio: master + compressor, feedback delay echo, looping filtered noise ("silk swish"), 3-oscillator bell voice with air-noise attack | L247–302 |

## States, user actions, feedback and transitions

State variable `state` (L179): `'rest' → 'pull' → 'bloom' → 'float'`, with `reset()` back to `'rest'`.

1. **rest** — short threads, beads pulse. Caption: "Touch the screen". Dot 1 active.
   - *Pointer down* (L343): starts audio, enters **pull**, records start point, computes a `gain` so the target is reachable from where the finger landed. Caption → "Drag down".
2. **pull** — dragging down (L362–373):
   - Threads near the finger stretch most (Gaussian falloff, L432); feathers fade in as threads pass them, growing more solid with progress (`solidGoal`, L435).
   - Guide shows % progress and fills the target circle; chevrons fade out as progress rises.
   - Feedback sound: soft rising pentatonic note each time another feather row is uncovered (L371–372); swish noise volume follows finger speed and its filter brightens with progress (L579–584).
   - *Release before 100%* (L396–399): threads spring back to **rest**; guide lingers 1.7 s (`hintHold`) so the target stays visible.
   - *Reach 100%* → `succeed()` (L306).
3. **bloom** (~1.35 s, L424) — `succeed()` fires a 4-note arpeggio chime + low D and a short vibration, spawns 30 specks, starts the ring. Threads extend to full height in a ripple outward from the finger (`th.delay`), a shimmer band sweeps down the feathers (L440–447). Dot 1 turns gold, dot 2 active, caption "Stroke the feathers", replay button shown.
4. **float** — full plumage gently waves (reduced to 35% under `prefers-reduced-motion`); threads fade out.
   - *Pointer down* (L353): feathers near the finger get a spring impulse + glow (`excite()` L324), one note plays; pitch from position (`pitchAt()` L338 — lower and further right = higher).
   - *Stroke* (L374–389): continuous ruffling; a new note every ≥30 px of travel / 90 ms when pitch changes (or after 72 px), louder when faster. After 4 notes the caption fades away (`.quiet`).
   - *Release* (L400–406): if the stroke played ≥2 notes, a resolving "home" tone (D) closes the phrase.
   - *Replay button* → `reset()` (L317): back to **rest**, feathers settled, caption and dots restored.

Feather physics: each feather is a damped angular spring (`f.a`, `f.va`) plus decaying excitement `f.e` that drives glow and slight scale lift (L458–477).

## Tuning knobs

- `CFG.TARGET_FRAC_W` (0.70) — required pull distance as a fraction of screen width (capped at 68% of height).
- `CFG.REST_FRAC_H` (0.10) — resting thread length as a fraction of screen height.
- `FW, FH, DX, DY` (L120) — feather size and grid spacing; `STOPS` palette; `SCALE` notes.
- Layout is deterministic: `rng(23)` seeds jitter, so the curtain looks the same each load at a given size; resizing rebuilds it (`ResizeObserver`, L588).

## Notes for connecting to other studies

- All code is one IIFE (L110–591) with no exports; to sequence it, wrap it in an `init(stageEl)` / `destroy()` pair or load it in an iframe.
- Natural hand-off points: `succeed()` (end of step 1) and the first ≥4-note stroke in **float** (`heard >= 4`, end of step 2). A sequence controller could hook either to advance to the next study.
- The `requestAnimationFrame` loop and the `AudioContext` are never torn down; a host should cancel the loop and `AC.close()` when leaving the study.
- The CSS custom properties on `:root` (L6–17) define the shared look (navy `#0f1730`, cream ink `#f7f0e2`, gold `#e2b24a`); other studies can reuse them for visual continuity.
- `feathery-3-plumage.svg` is referenced only in comments as the design source; it is not loaded and not required.
