# ARIA: Adaptive Real-time Intelligent Agent

ARIA ships as two separate apps that share the hands-free voice/eye/hand
control concept but target different surfaces:

- **Chrome extension** (`src/`, Manifest V3), places an on-page agent
  cursor on any webpage and lets you control it hands-free: by voice
  (Anthropic Claude API), by eye or head tracking, or by hand gestures.
  Eye and hand tracking run on-device through MediaPipe; no video leaves
  the machine.
- **Desktop app** (`electron/`, "aria-desktop"), a standalone,
  offline-capable Electron overlay: a floating control panel plus a
  transparent, click-through, always-on-top cursor window spanning the
  whole screen. It is not a webpage agent; it has no content script and
  cannot see or act on DOM elements in your browser. See
  [Desktop app](#desktop-app) below.

Core extension loop: say "Hey ARIA," the agent listens, your command plus
page context go to Claude, Claude returns one structured action, the
cursor moves and performs it, and the agent speaks the result.

## Quick start

```bash
npm install                  # installs dependencies, downloads external assets
node scripts/gen-icons.mjs   # generates the icon set (already committed)
npm run build                # -> dist/
```

Then in Chrome: open `chrome://extensions`, enable Developer mode, and
Load unpacked from the `dist/` folder.

For hot-reload during development, run `npm run dev` and load `dist/`
once; CRXJS reloads it from there.

In the popup, paste an Anthropic API key (and, for the wake word, a free
Picovoice access key), pick an input mode, and turn the toggle on.

### External assets

`npm install` downloads the assets that aren't checked into the repo:

| Asset | Source | Used by | Downloaded when |
|---|---|---|---|
| `porcupine_params.pv` | Picovoice CDN | wake word | on install |
| MediaPipe WASM fileset | jsDelivr CDN | eye and hand modes | on install |
| `face_landmarker.task` | Google CDN | eye mode | on first use |
| `hand_landmarker.task` | Google CDN | hand mode | on first use |

Voice mode, the core of the MVP, works without the MediaPipe assets. If
a download fails, run `node scripts/download-assets.mjs` manually, or
see the troubleshooting section of [TRAINING.md](TRAINING.md).

## Architecture (MV3)

```
+--------------+  wake / transcript / vision frames   +------------------+
|  Offscreen   | ------------------------------------>|   Background SW  |
|  document    |   mic + Porcupine + Web Speech STT    |  orchestrator +  |
| (mic/camera) |   camera + MediaPipe (eye/hand)       |  Claude API +    |
+--------------+ <------------------------------------|  task runner     |
        ^          start/stop listening / vision       +--------+---------+
        |                                                       | actions / state
        |                                              +--------v---------+
        |                                              |  Content script  |
        +----------------------------------------------|  cursor, HUD,    |
                       (one per page)                   |  DOM exec, TTS,  |
                                                         |  gaze/hand driver|
                                                         +------------------+
        Popup <-------- status push -------- Background       (+ task modules)
```

Mic and camera access live only in the offscreen document, since MV3
forbids both in the service worker and in content scripts; only derived
features (transcripts, landmark coordinates) cross the message bus.
Every cross-context message is a typed variant in
[`src/shared/messages.ts`](src/shared/messages.ts), and every Claude
action is validated with Zod in
[`src/shared/actions.ts`](src/shared/actions.ts). The API key is
encrypted at rest with AES-GCM (Web Crypto API), using a per-device key
stored in `chrome.storage.local`.

### Claude action contract

Claude receives `{ command, page: { url, title, excerpt, selected_text } }`
and returns one of: `answer`, `click`, `scroll`, `navigate`,
`read_aloud`, `highlight`, `none`, each with a `speech` field the agent
speaks aloud.

## Milestone status

| # | Milestone | Status |
|---|---|---|
| 1 | Scaffold: Vite + TS, MV3 manifest, message bus, shells | done |
| 2 | Agent cursor: states, animations, lerp movement | done |
| 3 | Voice pipeline: offscreen mic, Porcupine, Web Speech STT, TTS queue | done |
| 4 | Claude integration: system prompt, page context, Zod validation, errors | done |
| 5 | DOM actions: 6 types, 6-strategy finder, click-to-teach | done |
| 6 | Popup and settings: toggle, keys, status, mode, tasks | done |
| 7 | Polish and hardening: HUD, service-worker keepalive alarm | done, live multi-site testing still pending (fixture-based DOM-finder benchmark added, see below) |
| 8 | Eye mode spike: FaceMesh iris, 9-point calibration, gaze to cursor, brow/dwell/wink | spike complete |
| 9 | Hand mode spike: Hands, fingertip cursor, gesture classifier, sensitivity | spike complete |
| 10 | Task modules: MCQ, trivia, form fill | done |

## Measured performance

Four harnesses under `scripts/` produce the numbers below straight from
the code in this repo. Rerun the command to regenerate any of them.
None of these numbers were fabricated; the caveats printed by each
harness (elided below) are load-bearing, not boilerplate; read them
before quoting a figure out of context.

**Intent accuracy** - `npm run eval:intent` trains the NN command
classifier on `SEED_DATA` only (never touching `examples.training.json`),
then evaluates the real rule-router + classifier pipeline against
`examples.training.json` as a held-out set:

```
Excluded 12/22 examples.training.json entries because they are verbatim
SEED_DATA commands (not held-out).
Held-out examples: 10
Overall accuracy: 10/10 = 100.0%
```

Caveat printed by the harness: 10 held-out examples across up to 20
classes is a smoke-test of generalisation, not a statistically powered
estimate; treat 100% as "no regressions found on a small sample," not
as a production accuracy claim.

**Pipeline latency (offline stages only)** - `npm run eval:latency`
measures the stages that don't need network access, over 500 iterations
on this machine's Node CPU backend (no `tfjs-node` native bindings
installed, so these are conservative/slower-than-optimal numbers):

```
1. transcript -> rule router                median 0.003ms   p95 0.011ms
2. rule miss -> NN classify                  median 0.321ms   p95 0.943ms
3. Claude response -> action validation      median 0.017ms   p95 0.069ms
Total (stages 1-3)                           median 0.348ms   p95 1.001ms
```

**Not measured:** the Claude API round trip. It requires a live
`ANTHROPIC_API_KEY` and network access, neither available in this
environment. That stage dominates real end-to-end latency in practice; do not read the numbers above as the full user-perceived latency.

**DOM-finder benchmark** - `npm run eval:dom-finder` runs the 6-strategy
finder against 20 fixture DOM structures (login forms, nav bars, card
CTAs, icon-only buttons, the KI-08 synthetic-label SPA patterns, and a
deliberate no-match case):

```
Hit rate: 20/20 = 100.0%
Fallback distribution (of 20 hits): text 8, aria-label 4, attribute 2,
  name-id 2, nearest-interactive 2, submit-intent 1, none 1
```

This is a fixture benchmark, not a live crawl; it cannot stand in for
the "live multi-site testing" item in [KNOWN_ISSUES.md](KNOWN_ISSUES.md).
It previously surfaced a real miss: a bare `<label>Country</label>` next
to a `<select>` resolved to the label itself, because `label` is in the
finder's own interactive-element list and matched strategy 2 (visible
text) on its own text before the nearest-interactive fallback ever ran.
Fixed by resolving any label match to its associated control (native
`for`/wrapping via `HTMLLabelElement.control`, falling back to the KI-08
nearby-container search) before returning it - see
`resolveLabelControl()` in `src/content/dom-finder.ts` and the new cases
in `tests/dom-finder.test.ts`.

**Speech-to-text accuracy** - `npm run eval:stt` transcribes labeled
recordings under `~/Documents/ARIA Voice Training/` with the same model
the desktop app uses (`onnx-community/whisper-base.en` via
`@huggingface/transformers`, same dtype config as
`electron/src/renderer/app.ts`'s `getOfflineTranscriber()`), and scores
against the ground-truth transcripts in that folder's `metadata.jsonl`
(read in place; never copied into the repo):

```
Aggregate over 6 samples: WER 10.6%, word accuracy 89.4%
```

Normalisation: lowercase, tokens matching `[a-z0-9]+` (apostrophes kept
mid-word), all other punctuation stripped, the same normalisation the
desktop app itself uses for its "Word match" display, via
`wordErrorRate()` in `src/shared/transcript-metrics.ts`. Aggregate WER is
total edit distance over total reference words, not a mean of per-sample
WER. This is a smoke test, not a statistically powered estimate: n=6
recordings from a single speaker and microphone - do not generalise this
number to other speakers, accents, or recording conditions.

To create a larger reproducible smoke set without checking personal audio
into Git, run `node scripts/generate-stt-fixtures.mjs` (requires `espeak-ng`
or `espeak`) and then run
`ARIA_STT_DATASET_DIR=.voice-training/stt-fixtures npm run eval:stt`.
The generator creates 16 WAV files from checked-in labels in
`scripts/stt-fixtures.json`; these are deterministic TTS fixtures, not a
replacement for multi-speaker recorded speech. The environment variable is
also useful for evaluating any locally collected labeled dataset.

The expanded fixture measurement on 2026-07-22 was:

```
Aggregate over 16 samples: WER 4.7%, word accuracy 95.3%
```

Worst fixture results were `fixture-03.wav` at 25.0% WER (75.0% accuracy),
`fixture-02.wav` and `fixture-08.wav` at 14.3% WER (85.7% accuracy), and
`fixture-12.wav` at 11.1% WER (88.9% accuracy). These are TTS smoke-set
results; they must not be compared with the six personal recordings as if
they measured the same acoustic conditions.

## Desktop app

`electron/` ("aria-desktop") is a separate, real Electron application -
not a build target of the Chrome extension. It reuses the same voice/eye
/hand control ideas but runs standalone: two windows (`electron/src/main.ts`),
a small always-on-top status/control panel and a transparent,
click-through, fullscreen cursor overlay window that the eye/hand tracker
drives across the *entire screen*, not just a webpage.

### How it differs from the extension

| | Extension | Desktop |
|---|---|---|
| Surface | One tab's DOM (content script) | Whole screen (no DOM access) |
| Cursor scope | Moves/clicks elements on the page | Moves a screen-space overlay cursor only |
| Intent understanding | Every command goes to Claude | A local TensorFlow.js classifier (`src/background/command-classifier.ts`-equivalent, trained via `npm run train:voice`) plus a small rule router try first; Claude (`claude-haiku-4-5`) is called only as a fallback when local confidence is low and a key is configured (`callClaude()` in `electron/src/renderer/app.ts`) |
| Speech-to-text | Web Speech API (online, in the offscreen document) | Offline Whisper (`onnx-community/whisper-base.en` via `@huggingface/transformers`, runs fully on-device) by default, or Chromium's online speech service, or typed text |
| Available actions | click, scroll, navigate, read_aloud, highlight, none, + task modules | navigate (opens system default browser), copy/read clipboard, focus_timer, shopping_list, none. DOM actions like click/scroll are not applicable outside a page and are reported as "not available in desktop mode yet" |
| Eye/hand tracking | Renders cursor inside the page's shadow-root overlay | Renders cursor in its own fullscreen transparent window, so it's visible over any application, not just a browser tab |

### Build and run

```bash
cd electron
npm install         # installs Electron, @huggingface/transformers, tfjs, MediaPipe
npm run build        # tsc (main + preload) + tsc (renderer) + vite build -> electron/dist/
npm start             # npm run build, then launches Electron
```

Or, from the repo root, `./aria.sh` does the same (installing
`electron/node_modules` and building `electron/dist/` on first run only)
plus a pre-flight check that a voice-intent model exists:

```bash
npm run train:voice   # trains electron/src/renderer/intent-model.json
./aria.sh
```

The app starts hidden in the background with a tray icon. Press
`Ctrl+Space` (`Cmd+Space` on macOS) to show the status panel; the cursor
overlay window is only created once eye or hand mode starts sending
cursor positions. `Ctrl+Shift+Y`/`Ctrl+Shift+N` reward/punish the last
intent decision for the RL feedback loop (see
[Training and model improvement](#training-and-model-improvement)).
`Pin to top` keeps the panel above other windows.

Desktop input methods:

- Offline Whisper runs transcription locally and is the recommended
  default. Its compact model downloads on first use and is cached after
  that. See [Measured performance](#measured-performance) above for a
  real accuracy number against labeled recordings.
- Browser speech uses Chromium's online speech service. Some Electron
  builds return a network error; ARIA stops retrying and reports the
  failure instead of hanging.
- Type commands is a microphone-independent testing fallback.

When Offline Whisper is selected, the Microphone control picks a
physical input device and remembers the choice. Use System default to
follow the desktop's current default input.

Build Voice Dataset presents 40 varied, natural read-aloud prompts.
After each recording, ARIA shows Whisper's transcript and a word-match
percentage without executing it as a command, so you can correct "Words
actually spoken" before saving and keep a misread prompt from being
paired with audio that doesn't match it. Samples (and their ground-truth
transcripts, `metadata.jsonl`) are stored under
`Documents/ARIA Voice Training`; this is exactly the dataset
`npm run eval:stt` reads to measure real STT accuracy.

With Always listen enabled, the selected microphone method stays active
and restarts after ARIA finishes speaking. Recognition pauses during TTS
so ARIA doesn't transcribe its own voice.

## Training and model improvement

See [TRAINING.md](TRAINING.md) for reinforcement learning feedback
(reward or punish with Ctrl+Shift+Y/N), how training adapts to dataset
size, best practices for collecting examples, and how to read accuracy
metrics and detect overfitting. `npm run train:voice` (see
[Desktop app](#desktop-app) above) trains the desktop app's bundled
voice-intent model before first launch.

## Known issues

Tracked in [KNOWN_ISSUES.md](KNOWN_ISSUES.md), which lists severity,
symptom, root cause, and fix status for each open item. As of this
branch, the critical and high-severity issues from that list have been
addressed and covered with tests in `tests/`, with two exceptions noted
there: offscreen wake-word throttling (real-Chrome-only behavior that
can't be confirmed fixed without live hardware) and full multi-site DOM
testing (needs a live browser pass against real sites, not just the
unit-level DOM-finder tests).

Two open design decisions worth flagging directly:

1. The wake word is a placeholder. It uses Porcupine's built-in
   "Blueberry" keyword standing in for "Hey ARIA," since no custom model
   has been trained yet. Swap in a custom `.ppn` file in
   `src/offscreen/wake-word.ts` once one exists; that requires training
   through the Picovoice console.
2. Streaming TTS is intentionally not implemented for the action path.
   The response is a single JSON action, so partial JSON can't safely be
   spoken; the `answer` action speaks as soon as the full (short)
   response arrives.

## Scripts

```bash
npm run dev             # Vite + CRXJS dev build with hot reload
npm run build           # typecheck + production build -> dist/
npm run typecheck       # tsc --noEmit
npm test                # vitest run
npm run eval:intent     # intent-accuracy harness (see Measured performance)
npm run eval:latency    # offline pipeline latency harness
npm run eval:dom-finder # DOM-finder fixture benchmark
npm run eval:stt        # speech-to-text accuracy against labeled recordings
```

## License

MIT. See [LICENSE](LICENSE).
