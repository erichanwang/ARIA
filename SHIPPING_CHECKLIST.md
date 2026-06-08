# ARIA Shipping Checklist

Every file in the project — what it does, production-readiness status, and any open items.

Legend: ✅ Production-ready · ⚠ Needs work before store submission · 🚧 Scaffold / placeholder

---

## Config & Build

| File | What it does | Status |
|---|---|---|
| `manifest.config.ts` | Chrome MV3 manifest: permissions, CSP, icons, content scripts | ✅ |
| `vite.config.ts` | Vite + CRXJS build config, path aliases | ✅ |
| `vitest.config.ts` | Vitest unit test config (jsdom env) | ✅ |
| `tsconfig.json` | TypeScript strict mode config | ✅ |
| `package.json` | Dependencies, npm scripts (build/test/package) | ✅ |
| `scripts/gen-icons.mjs` | Generates PNG icon set from a base SVG | ✅ |
| `scripts/package-extension.mjs` | Build + zip for Chrome Web Store upload | ✅ |

---

## Background (Service Worker)

| File | What it does | Status |
|---|---|---|
| `src/background/index.ts` | SW entry: message routing, tab group handler, update re-injection, tab suggestion throttle | ✅ |
| `src/background/orchestrator.ts` | State machine: idle→listening→thinking→acting; Claude call + confidence check + safe mode; badge updates | ✅ |
| `src/background/claude.ts` | Anthropic Messages API client; Zod response validation; retry/backoff; AbortController timeout | ✅ |
| `src/background/response-cache.ts` | In-memory 5-min TTL cache for Claude responses (same command + URL) | ✅ |
| `src/background/session-context.ts` | Last-5-command history; frequency tracking for palette ranking | ✅ |
| `src/background/macros.ts` | Record/replay multi-step voice command sequences | ✅ |
| `src/background/offscreen-manager.ts` | Ref-counted offscreen document lifecycle; create/release | ✅ |
| `src/background/tasks.ts` | Background task handler: trivia question generation, MCQ, formfill data | ✅ |

---

## Offscreen Document (mic + camera)

| File | What it does | Status |
|---|---|---|
| `src/offscreen/index.ts` | Offscreen message router; owns audio/video context | ✅ |
| `src/offscreen/wake-word.ts` | Picovoice Porcupine wake-word detection | ✅ |
| `src/offscreen/soft-wake-word.ts` | Fallback SpeechRecognition wake word when no Picovoice key | ✅ |
| `src/offscreen/stt.ts` | Web Speech API STT within the offscreen window | ✅ |
| `src/offscreen/vision.ts` | MediaPipe FaceMesh + Hands; emits gaze/fingertip/gesture frames | ✅ |
| `src/offscreen/gestures.ts` | Gesture classifier: pinch, open_palm, peace, thumbs_up/down, swipe | ✅ |

---

## Content Script

| File | What it does | Status |
|---|---|---|
| `src/content/index.ts` | Mount/unmount; SPA guard; message handler; keyboard shortcut registry | ✅ |
| `src/content/overlay.ts` | Shadow root host; OVERLAY_CSS; accent color; reduce-motion/forced-colors; focus mode | ✅ |
| `src/content/cursor.ts` | Glowing AGENT cursor; lerp animation; rAF-batched jumpTo; trail crumbs; mode tinting | ✅ |
| `src/content/hud.ts` | Draggable HUD: state, transcript, command; aria-live regions; confidence prompt | ✅ |
| `src/content/dom-finder.ts` | Semantic element locator (6-strategy cascade); 2s result cache; click-to-teach | ✅ |
| `src/content/dom-actions.ts` | ActionExecutor: runs all 30+ Claude actions; multi-step with abort; annotation; auto-scroll | ✅ |
| `src/content/page-context.ts` | Extracts URL/title/excerpt/selection for Claude; numbered options; prompt injection guard | ✅ |
| `src/content/speech.ts` | TTS wrapper; word-boundary highlighting; multi-language voice resolution | ✅ |
| `src/content/gaze-driver.ts` | Eye mode: calibration → transform → cursor + dwell-click + wink-scroll + reading ruler | ✅ |
| `src/content/hand-driver.ts` | Hand mode: fingertip cursor, pinch/peace/thumbs/three-finger, swipe detection | ✅ |
| `src/content/calibration.ts` | 9-point affine gaze calibration; save/restore transform | ✅ |
| `src/content/synthetic-click.ts` | Dispatches realistic MouseEvent sequence at a coordinate | ✅ |
| `src/content/earcons.ts` | Web Audio oscillator-based audio feedback for state transitions | ✅ |
| `src/content/command-palette.ts` | Ctrl+Shift+P fuzzy command search with frequency-ranked history | ✅ |
| `src/content/history-panel.ts` | Slide-in panel showing last 10 commands with redo buttons | ✅ |
| `src/content/shortcuts-help.ts` | Ctrl+Shift+? keyboard shortcut reference card | ✅ |
| `src/content/onboarding.ts` | 6-step first-launch tutorial overlay | ✅ |
| `src/content/page-outline.ts` | Ctrl+Shift+O collapsible heading navigator sidebar | ✅ |
| `src/content/auto-scroll.ts` | RAF-based smooth auto-scroll; space/+/-/Esc controls | ✅ |
| `src/content/reading-progress.ts` | Thin gradient scroll-depth bar at top of viewport | ✅ |
| `src/content/element-inspector.ts` | Ctrl+hover tooltip with HTML-escaped ARIA attributes | ✅ |
| `src/content/annotations.ts` | Drop yellow sticky notes at cursor position; persisted per hostname | ✅ |
| `src/content/stt-fallback.ts` | Floating text input shown when Web Speech API fails | ✅ |
| `src/content/link-preview.ts` | Tooltip on nearby anchor when cursor approaches | ✅ |
| `src/content/action-preview.ts` | Ghost element preview before click actions execute | ✅ |
| `src/content/page-context.ts` | Page excerpt extraction + visible options enumeration | ✅ |
| `src/content/page-suggestions.ts` | Proactive contextual suggestions from page content | ✅ |
| `src/content/screenshot.ts` | Capture visible viewport via canvas; used for vision action | ✅ |
| `src/content/session-export.ts` | Export command history as JSON/CSV | ✅ |

### Task Modules

| File | What it does | Status |
|---|---|---|
| `src/content/tasks/trivia.ts` | Interactive trivia game panel; Claude-generated questions | ✅ |
| `src/content/tasks/mcq.ts` | Multiple-choice quiz overlay from page content | ✅ |
| `src/content/tasks/summarize.ts` | Page summarization panel with TTS | ✅ |
| `src/content/tasks/formfill.ts` | Smart form fill from natural-language description | ✅ |
| `src/content/tasks/accessibility-audit.ts` | Page ARIA audit panel; lists issues with descriptions | ⚠ Output quality depends on Claude prompt tuning |

---

## Popup

| File | What it does | Status |
|---|---|---|
| `src/popup/popup.html` | Settings UI: General/Voice/Eye/Hand/Tasks/History/Macros tabs | ✅ |
| `src/popup/popup.ts` | Popup logic: settings read/write, status updates, macro list, auth error guidance | ✅ |
| `src/popup/popup.css` | Popup styles: dark theme, tabs, toggles, sliders | ✅ |

---

## Shared

| File | What it does | Status |
|---|---|---|
| `src/shared/types.ts` | Domain types: CursorState, InputMode, AriaSettings, HistoryEntry | ✅ |
| `src/shared/actions.ts` | Zod action discriminated union; parseAgentAction; extractFirstJsonObject | ✅ |
| `src/shared/messages.ts` | Typed message bus; withTimeout wrapper; requestTab/requestRuntime helpers | ✅ |
| `src/shared/settings.ts` | loadSettings/saveSettings/patchSettings; API key routed through key-vault | ✅ |
| `src/shared/key-vault.ts` | AES-GCM encryption of API key at rest; getDeviceKey; saveApiKey/loadApiKey | ✅ |
| `src/shared/site-profiles.ts` | Per-domain hints + custom keyboard shortcuts; Zod schema | ✅ |
| `src/shared/tasks.ts` | Shared task request/result types (Zod) | ✅ |
| `src/shared/usage-tracker.ts` | Local usage stats; daily counter; streak; MAX_DAILY_COMMANDS free-tier gate | ✅ |

---

## Tests

| File | What it does | Status |
|---|---|---|
| `tests/dom-finder.test.ts` | 18 tests: 6 matching strategies + teachTarget + isVisible + real-world patterns | ✅ |
| `tests/actions.test.ts` | 20 tests: extractFirstJsonObject + parseAgentAction valid/invalid inputs | ✅ |

---

## Documentation & Distribution

| File | What it does | Status |
|---|---|---|
| `README.md` | Setup, architecture, milestone status, troubleshooting | ✅ |
| `CHANGELOG.md` | v0.1.0 release notes | ✅ |
| `BUILD_LOG.md` | Hardening work log | ✅ |
| `KNOWN_ISSUES.md` | Known bugs and limitations | ✅ (see below) |
| `MVP.md` | Original milestone spec | ✅ |
| `PRD.md` | Full product requirements | ✅ |
| `EXAMPLES.md` | Example command library | ✅ |

---

## Pre-submission checklist

- [x] Anthropic API key field says "sk-ant-…" placeholder — confirm it never logs in background — verified: no `console.*` call in `src/` logs `apiKey`/settings anywhere.
- [ ] Privacy policy URL for Chrome Web Store listing — human/legal task, not code.
- [ ] Store listing screenshots (need real Chrome screenshots, can't auto-generate) — needs a human with a real Chrome build.
- [x] Icon assets: all four sizes present in `public/icons/` — `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png` all present.
- [x] MediaPipe model files committed or documented as required downloads — documented in `public/models/README.md`, and as of the KI-02 fix they now auto-fetch from Google's CDN on first use if not present locally, instead of hard-failing.
- [x] Porcupine model file committed or documented — documented in `public/porcupine-model/README.md`, auto-downloaded by `npm install`.
- [ ] Final manual smoke test: voice → click, scroll, navigate, fill form, summarize — needs a real Chrome + mic; not runnable in this environment.
- [ ] Test on Chrome 116, 120, 125 (minimum_chrome_version is 116) — needs real Chrome builds.
- [x] Verify CSP passes Chrome Web Store review (no `unsafe-eval`) — `manifest.config.ts` CSP uses only `'self'` and `'wasm-unsafe-eval'` (the CWS-permitted WASM allowance, distinct from `'unsafe-eval'`); `connect-src` now also allows `storage.googleapis.com` for the KI-02 model-download fallback.
- [ ] Review Chrome Web Store single-purpose policy (extension must have one clear purpose) — policy judgment call for a human, not a code check.
