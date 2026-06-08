# ARIA - Known Issues & Limitations

Every bug, limitation, and TODO encountered during development that was not fully resolved.

---

## Critical (must fix before store submission)

### KI-01 - Web Speech API unavailable in service worker context - PARTIAL MITIGATION
**Symptom:** Voice mode STT runs in the offscreen document. On some Chromium builds, the offscreen document's SpeechRecognition silently fails to recognize speech after ~30 seconds of idle.
**Root cause:** Chrome throttles offscreen documents that haven't had user gesture recently.
**Workaround:** STT fallback UI (`stt-fallback.ts`) shows a text input; user can type commands.
**Fix applied:** The SW keepalive alarm (`src/background/index.ts`, `rearmWakeWordIfIdle`) now force-restarts the offscreen wake-word listener every ~20s while idle in voice mode, so a silently-dead recognizer gets replaced instead of staying dead. Decision logic is unit tested (`shouldRearmWakeWord`, `tests/keepalive.test.ts`).
**Still open:** This is insurance, not a confirmed fix - whether it actually prevents the throttle-induced failure can only be verified with a real Chrome build + hardware mic over a real idle window. Leaving open until that live test is run.

### KI-02 - MediaPipe WASM models not bundled - FIXED
**Symptom:** Eye and hand modes show an error unless the user manually downloads model files.
**Fix applied:** `Vision.start()` (`src/offscreen/vision.ts`) now HEAD-checks the local `.task` path first and falls back to Google's official model CDN (`storage.googleapis.com`) when it's missing, letting MediaPipe fetch it directly (browser HTTP cache handles "download once, reuse after"). Added `storage.googleapis.com` to `host_permissions` and CSP `connect-src` in `manifest.config.ts` - without that the fetch would have been blocked regardless of the code path. Unit tested in `tests/resolve-model-path.test.ts`.
**Note:** No numeric download-progress bar was added (out of scope for the bug's core ask); the existing "Loading eye/hand tracking…" HUD message still covers the qualitative wait state.

### KI-03 - API key migration - FIXED
**Symptom:** Users who stored their key before the AES-GCM encryption update (key-vault.ts) will have their key stranded as plaintext in `aria.settings`. On first load the vault will return empty string and they'll see an auth error.
**Fix applied:** `loadSettings()` (`src/shared/settings.ts`) now detects a legacy plaintext `apiKey` in the settings blob when the vault is empty, migrates it into the vault via `saveApiKey`, and strips it from the blob. Unit tested in `tests/settings-migration.test.ts`.

---

## High (degrades experience significantly)

### KI-04 - Gaze calibration doesn't persist across extension restarts reliably - FIXED
**Symptom:** Occasionally the calibration transform is not restored from storage after Chrome restart, requiring re-calibration.
**Root cause:** `loadTransform()` in `calibration.ts` read from `localStorage`, which is cleared when the content script is torn down on some page navigations.
**Fix applied:** Calibration is now stored/read via `chrome.storage.local` (async) in `calibration.ts`; `GazeDriver.ensureCalibrated()` (`gaze-driver.ts`) awaits it before deciding whether to run the calibration flow. Unit tested in `tests/calibration.test.ts`.

### KI-05 - Multi-step actions can time out mid-sequence on slow pages - FIXED
**Symptom:** If a step takes >3s (e.g., navigating to a slow page and then clicking), the `withTimeout` wrapper returns null and the sequence halts silently.
**Root cause:** The 3000ms `MSG_TIMEOUT_MS` is too short for navigation + DOM stabilization.
**Fix applied:** Added `waitForTabLoad()` (`src/shared/messages.ts`), which resolves on `chrome.tabs.onUpdated` status `'complete'` (or a timeout ceiling). `orchestrator.ts` now awaits it before re-querying page context whenever the previous action was a `navigate`/`browser_nav`, instead of racing the fixed 3s timeout against a still-loading page. Unit tested in `tests/wait-for-tab-load.test.ts`.

### KI-06 - Popup status does not update when content script is not yet loaded - ALREADY FIXED (doc was stale)
**Symptom:** On a newly opened tab (e.g., `chrome://newtab`), the popup shows stale state because there's no content script to push status from.
**Finding:** The current code already does what the fix note asked: `GET_STATUS` (`src/background/index.ts`) is answered directly from `orchestrator.getStatus()`, an in-memory, background-owned status object with no dependency on any per-tab content script. No code change needed; removing this from the open list.

### KI-07 - Shadow DOM cursor hidden on some pages with `contain: layout` - FIXED
**Symptom:** On pages that use CSS `contain: layout` or `contain: strict` on a full-page element, the overlay shadow root's `position: fixed` elements may be clipped.
**Fix applied:** `overlay.ts` now detects `contain: layout|paint|strict|content` on `<html>`/`<body>` (`pageContainsFixedPositioning()`) and, when present, mounts the host with `position: absolute` and manually tracks `window.scrollX/scrollY` on scroll/resize to keep it viewport-pinned, instead of relying on `position: fixed` (which such an ancestor turns into a non-viewport containing block). Unit tested in `tests/overlay-contain.test.ts`.

### KI-08 - Form fill targets not found on React/Vue SPAs with synthetic labels - FIXED
**Symptom:** `findElement('email')` fails on SPAs where form labels are div-based and not associated with inputs via `for`/`id` or `aria-labelledby`.
**Root cause:** `dom-finder.ts` relies on native interactive element selectors; synthetic label associations aren't covered.
**Fix applied:** `nearestInteractiveToText()` now falls back to `nearbyInteractive()`, which walks up to 3 ancestor "field container" levels from the matched label text looking for any interactive descendant - covering the common `<div class="field"><div>Label</div><input/></div>` pattern. Unit tested in `tests/dom-finder.test.ts` (two new cases).

---

## Medium

### KI-09 - Auto-scroll stops on pages with `overflow: hidden` on body - FIXED
**Symptom:** `auto-scroll.ts` calls `window.scrollBy` which has no effect when the page uses a custom scroll container.
**Fix applied:** Added `resolveScrollTarget()`/`isScrollable()` (`auto-scroll.ts`), which walks up from `document.activeElement` looking for the first ancestor with `overflow-y: auto|scroll` and actual overflow, falling back to `window`. The scroller now scrolls/measures-bottom-of against whichever target was resolved. Unit tested in `tests/auto-scroll-target.test.ts`.

### KI-10 - Reading progress bar appears on non-article pages
**Symptom:** `isReadingProgressMounted()` heuristic (checks for `<article>` tag or long main text) sometimes incorrectly detects article pages.
**Fix needed:** Tune the threshold; expose a toggle in the popup.
**Skipped this pass:** "Tune the threshold" isn't a well-defined target without real-site testing data (what counts as a false positive is subjective); risked tuning against no real cases. Left open rather than guess a number.

### KI-11 - Command palette history limited to last 20 but ranked by frequency
**Symptom:** Frequently-used commands from weeks ago rank above recent-but-infrequent ones, which feels wrong.
**Fix needed:** Implement time-decayed frequency (half-life ~7 days) in `session-context.ts`.
**Skipped this pass:** Prioritized Critical/High severity items given the time budget; this is a real fix but lower-impact UX polish. Left open, not attempted.

### KI-12 - Translate action uses Claude to translate (not a translation API)
**Symptom:** Translation quality varies and token usage is high for long texts.
**Fix needed:** Integrate a dedicated translation API (e.g., DeepL or LibreTranslate) as a cheaper backend for translate actions; use Claude only as fallback.
**Skipped this pass:** Adding a new external API/dependency is feature-expansion, not hardening - out of scope for this pass per the "no new milestones" ground rule. Left open.

### KI-13 - Annotations (`aria.ann.*`) accumulate indefinitely - MOSTLY FIXED
**Symptom:** No cleanup mechanism; storage can fill up over time.
**Fix applied:** Added `pruneAnnotations()` (`annotations.ts`): drops entries older than 90 days and caps each hostname to the most recent 50, run on every save and on page load. Unit tested in `tests/annotations-prune.test.ts`.
**Still open:** A manual "clear annotations" button in the popup was not added (separate UI-scope item, not required for the storage-growth bug itself).

### KI-14 - Tab grouping fails silently on Chrome < 89 - FIXED
**Symptom:** `chrome.tabs.group` and `chrome.tabGroups.update` are not available on Chrome < 89 but minimum_chrome_version is 116, so this isn't an issue for current minimum - but the error path isn't user-facing.
**Fix applied:** The `GROUP_TABS` handler (`src/background/index.ts`) now wraps the `chrome.tabs.group`/`chrome.tabGroups.update` calls in try/catch and speaks "Tab grouping isn't available in this browser." to the active tab on failure, instead of failing silently.

### KI-15 - keyMode 'hosted' field has no implementation
**Symptom:** Setting `keyMode: 'hosted'` in settings has no effect; the orchestrator always uses the BYOK key.
**Status:** Intentional scaffold. Hosted key management requires backend infrastructure.

---

## Low / Won't fix now

### KI-16 - Streaming TTS not implemented
**Description:** `speech.ts` waits for the full answer before speaking. Streaming from Anthropic SSE would reduce perceived latency for answer/summarize actions.
**Notes:** Requires SSE streaming in the background SW + a new message type to push partial text to content.

### KI-17 - No Puppeteer end-to-end tests
**Description:** The test suite has unit tests only. E2E tests covering the golden path (voice → DOM action) require a Chrome driver with extension loading support.
**Notes:** Consider using `chrome-remote-interface` or `puppeteer-core` with `--load-extension`.

### KI-18 - Landing page / store listing not built
**Description:** No `index.html` landing page exists for the project website.
**Notes:** Defer to marketing phase.

### KI-19 - Referral code field not implemented
**Description:** `keyMode` and `usageTracker` scaffolding is in place but no referral/invite flow exists.
**Status:** Intentional scope limit. Add when backend infrastructure exists.

### KI-20 - Bundle analyzer not run
**Description:** Vite bundle visualizer was skipped (not installed). The content script is 28kb which is fine, but deeper chunk analysis for the 108kb background bundle was not done.
**Notes:** Run `npx vite-bundle-visualizer` after adding it as a dev dep.

### KI-21 - HUD not fully keyboard-navigable on page load
**Description:** The HUD renders inside a shadow root with `pointer-events: none` on the host. Tab focus cannot reach the HUD from page keyboard navigation.
**Fix needed:** Implement focus trap with `tabIndex=0` on the HUD host when a confidence prompt is active; restore focus on dismiss.

### KI-22 - Element inspector tooltip not shadow-rooted
**Description:** `element-inspector.ts` appends its tooltip to `document.documentElement`, not the overlay shadow root. On pages with aggressive CSS resets it may render incorrectly.
**Fix needed:** Move tooltip into the overlay shadow root.

### KI-23 - Dev mode debug panel not built
**Description:** The hardening directive included a "dev mode debug panel in settings". This was not implemented; existing popup error guidance partially covers it.
**Notes:** Add a `?debug=true` URL param to popup that exposes raw status, message bus log, and storage dump.
