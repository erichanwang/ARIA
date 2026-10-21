# ARIA Shipping Checklist

Every file in the project — what it does, production-readiness status, and any open items.

Legend: [ok] Production-ready · [warn] Needs work before store submission · [todo] Scaffold / placeholder

---

## Config & Build

| File | What it does | Status |
|---|---|---|
| `manifest.config.ts` | Chrome MV3 manifest: permissions, CSP, icons, content scripts | [ok] |
| `vite.config.ts` | Vite + CRXJS build config, path aliases | [ok] |
| `vitest.config.ts` | Vitest unit test config (jsdom env) | [ok] |
| `tsconfig.json` | TypeScript strict mode config | [ok] |
| `package.json` | Dependencies, npm scripts (build/test/package) | [ok] |
| `scripts/gen-icons.mjs` | Generates PNG icon set from a base SVG | [ok] |
| `scripts/package-extension.mjs` | Build + zip for Chrome Web Store upload | [ok] |

---

## Background (Service Worker)

| File | What it does | Status |
|---|---|---|
| `src/background/index.ts` | SW entry: message routing, tab group handler, update re-injection, tab suggestion throttle | [ok] |
| `src/background/orchestrator.ts` | State machine: idle->listening->thinking->acting; Claude call + confidence check + safe mode; badge updates | [ok] |
| `src/background/claude.ts` | Anthropic Messages API client; Zod response validation; retry/backoff; AbortController timeout | [ok] |
| `src/background/response-cache.ts` | In-memory 5-min TTL cache for Claude responses (same command + URL) | [ok] |
| `src/background/session-context.ts` | Last-5-command history; frequency tracking for palette ranking | [ok] |
| `src/background/macros.ts` | Record/replay multi-step voice command sequences | [ok] |
| `src/background/offscreen-manager.ts` | Ref-counted offscreen document lifecycle; create/release | [ok] |
| `src/background/tasks.ts` | Background task handler: trivia question generation, MCQ, formfill data | [ok] |

---

## Offscreen Document (mic + camera)

| File | What it does | Status |
|---|---|---|
| `src/offscreen/index.ts` | Offscreen message router; owns audio/video context | [ok] |
| `src/offscreen/wake-word.ts` | Picovoice Porcupine wake-word detection | [ok] |
| `src/offscreen/soft-wake-word.ts` | Fallback SpeechRecognition wake word when no Picovoice key | [ok] |
| `src/offscreen/stt.ts` | Web Speech API STT within the offscreen window | [ok] |
| `src/offscreen/vision.ts` | MediaPipe FaceMesh + Hands; emits gaze/fingertip/gesture frames | [ok] |
| `src/offscreen/gestures.ts` | Gesture classifier: pinch, open_palm, peace, thumbs_up/down, swipe | [ok] |

---

## Content Script

| File | What it does | Status |
|---|---|---|
| `src/content/index.ts` | Mount/unmount; SPA guard; message handler; keyboard shortcut registry | [ok] |
| `src/content/overlay.ts` | Shadow root host; OVERLAY_CSS; accent color; reduce-motion/forced-colors; focus mode | [ok] |
| `src/content/cursor.ts` | Glowing AGENT cursor; lerp animation; rAF-batched jumpTo; trail crumbs; mode tinting | [ok] |
| `src/content/hud.ts` | Draggable HUD: state, transcript, command; aria-live regions; confidence prompt | [ok] |
| `src/content/dom-finder.ts` | Semantic element locator (6-strategy cascade); 2s result cache; click-to-teach | [ok] |
| `src/content/dom-actions.ts` | ActionExecutor: runs all 30+ Claude actions; multi-step with abort; annotation; auto-scroll | [ok] |
| `src/content/page-context.ts` | Extracts URL/title/excerpt/selection for Claude; numbered options; prompt injection guard | [ok] |
| `src/content/speech.ts` | TTS wrapper; word-boundary highlighting; multi-language voice resolution | [ok] |
| `src/content/gaze-driver.ts` | Eye mode: calibration -> transform -> cursor + dwell-click + wink-scroll + reading ruler | [ok] |
| `src/content/hand-driver.ts` | Hand mode: fingertip cursor, pinch/peace/thumbs/three-finger, swipe detection | [ok] |
| `src/content/calibration.ts` | 9-point affine gaze calibration; save/restore transform | [ok] |
| `src/content/synthetic-click.ts` | Dispatches realistic MouseEvent sequence at a coordinate | [ok] |
| `src/content/earcons.ts` | Web Audio oscillator-based audio feedback for state transitions | [ok] |
| `src/content/command-palette.ts` | Ctrl+Shift+P fuzzy command search with frequency-ranked history | [ok] |
| `src/content/history-panel.ts` | Slide-in panel showing last 10 commands with redo buttons | [ok] |
| `src/content/shortcuts-help.ts` | Ctrl+Shift+? keyboard shortcut reference card | [ok] |
| `src/content/onboarding.ts` | 6-step first-launch tutorial overlay | [ok] |
| `src/content/page-outline.ts` | Ctrl+Shift+O collapsible heading navigator sidebar | [ok] |
| `src/content/auto-scroll.ts` | RAF-based smooth auto-scroll; space/+/-/Esc controls | [ok] |
| `src/content/reading-progress.ts` | Thin gradient scroll-depth bar at top of viewport | [ok] |
| `src/content/element-inspector.ts` | Ctrl+hover tooltip with HTML-escaped ARIA attributes | [ok] |
| `src/content/annotations.ts` | Drop yellow sticky notes at cursor position; persisted per hostname | [ok] |
| `src/content/stt-fallback.ts` | Floating text input shown when Web Speech API fails | [ok] |
| `src/content/link-preview.ts` | Tooltip on nearby anchor when cursor approaches | [ok] |
| `src/content/action-preview.ts` | Ghost element preview before click actions execute | [ok] |
| `src/content/page-context.ts` | Page excerpt extraction + visible options enumeration | [ok] |
| `src/content/page-suggestions.ts` | Proactive contextual suggestions from page content | [ok] |
| `src/content/screenshot.ts` | Capture visible viewport via canvas; used for vision action | [ok] |
| `src/content/session-export.ts` | Export command history as JSON/CSV | [ok] |

### Task Modules

| File | What it does | Status |
|---|---|---|
| `src/content/tasks/trivia.ts` | Interactive trivia game panel; Claude-generated questions | [ok] |
| `src/content/tasks/mcq.ts` | Multiple-choice quiz overlay from page content | [ok] |
| `src/content/tasks/summarize.ts` | Page summarization panel with TTS | [ok] |
| `src/content/tasks/formfill.ts` | Smart form fill from natural-language description | [ok] |
| `src/content/tasks/accessibility-audit.ts` | Page ARIA audit panel; lists issues with descriptions | [warn] Output quality depends on Claude prompt tuning |

---

## Popup

| File | What it does | Status |
|---|---|---|
| `src/popup/popup.html` | Settings UI: General/Voice/Eye/Hand/Tasks/History/Macros tabs | [ok] |
| `src/popup/popup.ts` | Popup logic: settings read/write, status updates, macro list, auth error guidance | [ok] |
| `src/popup/popup.css` | Popup styles: dark theme, tabs, toggles, sliders | [ok] |

---

## Shared

| File | What it does | Status |
|---|---|---|
| `src/shared/types.ts` | Domain types: CursorState, InputMode, AriaSettings, HistoryEntry | [ok] |
| `src/shared/actions.ts` | Zod action discriminated union; parseAgentAction; extractFirstJsonObject | [ok] |
| `src/shared/messages.ts` | Typed message bus; withTimeout wrapper; requestTab/requestRuntime helpers | [ok] |
| `src/shared/settings.ts` | loadSettings/saveSettings/patchSettings; API key routed through key-vault | [ok] |
| `src/shared/key-vault.ts` | AES-GCM encryption of API key at rest; getDeviceKey; saveApiKey/loadApiKey | [ok] |
| `src/shared/site-profiles.ts` | Per-domain hints + custom keyboard shortcuts; Zod schema | [ok] |
| `src/shared/tasks.ts` | Shared task request/result types (Zod) | [ok] |
| `src/shared/usage-tracker.ts` | Local usage stats; daily counter; streak; MAX_DAILY_COMMANDS free-tier gate | [ok] |

---

## Tests

| File | What it does | Status |
|---|---|---|
| `tests/dom-finder.test.ts` | 18 tests: 6 matching strategies + teachTarget + isVisible + real-world patterns | [ok] |
| `tests/actions.test.ts` | 20 tests: extractFirstJsonObject + parseAgentAction valid/invalid inputs | [ok] |

---

## Documentation & Distribution

| File | What it does | Status |
|---|---|---|
| `README.md` | Setup, architecture, milestone status, troubleshooting | [ok] |
| `CHANGELOG.md` | v0.1.0 release notes | [ok] |
| `BUILD_LOG.md` | Hardening work log | [ok] |
| `KNOWN_ISSUES.md` | Known bugs and limitations | [ok] (see below) |
| `MVP.md` | Original milestone spec | [ok] |
| `PRD.md` | Full product requirements | [ok] |
| `EXAMPLES.md` | Example command library | [ok] |

---

## Pre-submission checklist

- [x] Anthropic API key field says "sk-ant-…" placeholder — confirm it never logs in background — verified: no `console.*` call in `src/` logs `apiKey`/settings anywhere.
- [ ] Privacy policy URL for Chrome Web Store listing — human/legal task, not code.
- [ ] Store listing screenshots (need real Chrome screenshots, can't auto-generate) — needs a human with a real Chrome build.
- [x] Icon assets: all four sizes present in `public/icons/` — `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` all present.
- [x] MediaPipe model files committed or documented as required downloads — documented in `public/models/README.md`, and as of the KI-02 fix they now auto-fetch from Google's CDN on first use if not present locally, instead of hard-failing.
- [x] Porcupine model file committed or documented — documented in `public/porcupine-model/README.md`, auto-downloaded by `npm install`.
- [ ] Final manual smoke test: voice -> click, scroll, navigate, fill form, summarize — needs a real Chrome + mic; not runnable in this environment.
- [ ] Test on Chrome 116, 120, 125 (minimum_chrome_version is 116) — needs real Chrome builds.
- [x] Verify CSP passes Chrome Web Store review (no `unsafe-eval`) — `manifest.config.ts` CSP uses only `'self'` and `'wasm-unsafe-eval'` (the CWS-permitted WASM allowance, distinct from `'unsafe-eval'`); `connect-src` now also allows `storage.googleapis.com` for the KI-02 model-download fallback.
- [ ] Review Chrome Web Store single-purpose policy (extension must have one clear purpose) — policy judgment call for a human, not a code check.
