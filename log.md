# ARIA Development Log

## Goal

Build ARIA into a usable background desktop voice assistant with offline intent
classification, continuous listening, local TTS, safe cursor behavior, and a
clickable Linux desktop/application entry. Continue iterative implementation,
training, verification, and documentation until the active development goal is
complete.

## Current State

- Branch: `master` at upstream commit `9e03445`, with uncommitted development changes.
- Desktop: Electron renderer bundles with Vite and starts hidden in the background.
- Cursor: overlay is created lazily only when eye/hand mode emits a visible position.
- Voice input: one-shot and persistent always-listening controls exist.
- Voice output: basic browser-native TTS exists with recognition pause/resume.
- Intent model: bundled headless-trained model exists (175 examples, 100 epochs).
- Model result: 88% training accuracy, 54% validation accuracy; still preliminary.
- Launchers: desktop and Linux application-menu entries are installed.
- Runtime: ARIA is currently running from the clickable launcher.

## Verified

- Extension and model tests: 42 passed.
- Extension production build: passed.
- Electron main and renderer type checks: passed.
- Electron production build: passed.
- Versioned model artifact: 175 examples, 5 tensors, 133,479 bytes.
- Desktop files: validated, executable, application database refreshed.

## Known Gaps

- The preliminary intent model has weak validation accuracy.
- Most desktop actions only report an intent; only navigation and clipboard perform work.
- Electron Web Speech support and microphone behavior need live verification.
- Local launchers require `--no-sandbox` because the installed Electron helper lacks root ownership.
- No desktop runtime regression tests currently cover background, listening, TTS, or cursor behavior.

## Iteration Log

### 2026-07-20 - Baseline desktop implementation

- Pulled the latest upstream commits.
- Fixed extension TypeScript build failures.
- Fixed negative-feedback training so punishment suppresses the wrong class.
- Added headless voice-model training and bundled weights.
- Added Electron renderer bundling and strict renderer type checking.
- Added always-listening and basic TTS controls without emoji labels.
- Changed unsafe global `Space`/`Z` feedback shortcuts to modifier shortcuts.
- Changed desktop startup to hidden/background and cursor overlay to lazy creation.
- Installed desktop and application-menu launchers.

### 2026-07-20 - Background lifecycle

- Added a system tray icon with Show ARIA and Quit ARIA actions.
- Added single-instance locking; opening the launcher again focuses the existing process.
- Changed window close behavior to hide ARIA instead of terminating its background process.
- Kept cursor overlay creation lazy so background startup does not touch cursor behavior.

### 2026-07-20 - Runtime diagnostics

- Added privacy-safe JSONL diagnostics at `~/.aria-desktop.log`.
- Logs model readiness, speech API availability, recognition lifecycle/errors, and TTS lifecycle.
- Transcript content and API keys are never written; only transcript character counts are logged.

### 2026-07-20 - Settings, transcript, and window controls

- Changed settings writes to merge with stored values instead of overwriting unrelated settings.
- Persisted the selected input mode without auto-starting eye/hand cursor behavior on background launch.
- Added a rolling eight-line live voice transcript with interim recognition text.
- Added a Minimize control and tray/shortcut restoration for minimized windows.
- Unified settings persistence so recognition permission failures, toggles, API key, and mode changes all save through the same merged state.
- Added a persisted Pin to top option that moves the panel to the top-right and controls always-on-top behavior.

### 2026-07-20 - Input methods and continuous listening

- Diagnosed Browser speech as a repeatable `network` failure in Electron, not a missing microphone.
- Stopped automatic retry after Browser speech network failures to prevent a tight restart loop.
- Added Offline Whisper, Browser speech, and Type commands input choices.
- Added local microphone capture, silence segmentation, 16 kHz resampling, and queued offline transcription.
- Added visible first-run Offline Whisper model download progress.
- Added continuous offline microphone capture while Always listen is enabled.
- Added a persisted physical microphone selector and lower speech-detection threshold for quiet inputs.
- Added a visible speech-detected state and transcript-free segment duration diagnostics.
- Fixed all offline transcriptions failing because language/task options were incorrectly passed to an English-only Whisper model.
- Verified the corrected full-precision pipeline end to end with Hugging Face's reference JFK speech sample; it returned the expected English transcript.
- Verified through the running Electron renderer that recognized/typed text renders in the transcript, four microphone choices appear (default plus three devices), Pin to top toggles, and Offline Whisper is restored afterward.
- Restricted Electron media permission grants to trusted local `file://` renderer pages.
- Runtime testing found both the default 4-bit and legacy 8-bit Whisper decoders incompatible with the bundled ONNX runtime; switched the encoder and merged decoder to the repository's full-precision files.
- Started a 200-epoch intent-model retraining run using the complete shared training artifact.
- Completed the 200-epoch run at 88% training and 54% validation accuracy.
- Replaced the trainer's order-biased validation split with a deterministic per-intent holdout, followed by final fitting on the complete corpus.
- Corrected training reached 89% training accuracy and 79% balanced validation accuracy.
- Changed the renderer cache fingerprint so newly trained weights replace stale weights even when the artifact schema version is unchanged.
- Hardened the launcher so it refuses to start against missing, legacy, or partially trained model artifacts.
- Changed Train NN to correction-based fine-tuning; without collected feedback it reports the bundled validation result instead of retraining pointlessly.
- Replaced the fixed intent confidence cutoff with a threshold derived from bundled validation accuracy.

### 2026-07-20 - Functional desktop actions

- Added clipboard reading with local TTS and improved clipboard copy text extraction.
- Added background focus timers with native desktop notifications.
- Added a persistent local shopping list with add, read, and clear commands.
- Replaced misleading success text for unsupported desktop intents with explicit availability messages.

### 2026-07-20 - Eye calibration bounds

- Fixed the nine calibration positions to use the control overlay dimensions instead of full monitor dimensions.
- Centered the calibration dot on each target so its full 22 px diameter remains inside the overlay.
- Added a 56 px white gaze halo; its 28 px radius equals the existing cursor's 28 px diameter.
- Added personalized open, both-closed, left-wink, and right-wink training based on normalized eyelid aspect ratios.
- Added conservative wink stability, confidence, cooldown, and reopen guards to reduce natural-blink false positives.
- Added a libcamera frame fallback for Intel IPU6 systems where Electron cannot open the raw V4L2 nodes.
- Verified a live personal model with 64 open, 63 closed, 69 left-wink, and 69 right-wink frames, followed by successful left/right wink detections.

### 2026-07-20 - Live microphone diagnosis

- Confirmed the system Default capture source returns only zero-valued samples while the built-in SoundWire microphone has a real signal.
- Lowered the offline speech gate to match the measured built-in microphone level.
- Added a live microphone-level meter and five-second peak diagnostics.
- Removed the duplicate Default device entry and made explicit microphone selection exact rather than silently falling back.
- Raised the gate after live testing so ambient room noise does not trigger one-word Whisper hallucinations.
- Prevented concurrent microphone-start races after TTS and discarded partial/noise queues when TTS pauses capture.
- Stopped speaking responses for no-action transcripts to avoid an audio feedback loop.
- Added deterministic routing for explicit navigation, clipboard, read-aloud, timer, and shopping-list commands before neural fallback.
- Added transcript-free intent-decision diagnostics with action, confidence, and routing source.
- Replaced the fixed speech threshold with an adaptive noise floor and retained roughly 340 ms of pre-roll so quiet sentence starts are not clipped.
- Added a two-second VAD warm-up after microphone starts so initial device noise cannot become a false transcript.
- Made VAD warm-up percentile-based and reject spike-only segments using peak and whole-segment RMS checks.

### 2026-07-20 - Supervised voice dataset workflow

- Added 40 read-aloud prompts spanning varied English consonants, vowels, clusters, inflections, prefixes, suffixes, numbers, names, natural requests, and ARIA command vocabulary.
- Added in-app Record, Stop and compare, Next/Skip, Open folder, and Done controls.
- Saved each selected-microphone recording with its exact reference text in `Documents/ARIA Voice Training`.
- Added per-sample Whisper comparison without executing the recognized phrase as a command.
- Added live sound-wave feedback for continuous listening and training recordings.
- Changed sample capture to review before save: Whisper proposes the spoken text, and the user corrects it so misread prompts are not stored with false labels.
- Evaluated the collected recordings against tiny.en and base.en; base.en reduced corpus word error from 17.9% to 10.4%, so the app now uses base.en.
- Added content-driven desktop window sizing so the normal and training views fit their visible controls without an internal scrollbar.
- Added explicit `ARIA` and `Hey ARIA` wake-prefix handling; a wake word alone prompts for a command, and a following command is routed without the prefix.
- Added local `[HH:MM:SS]` timestamps to every finalized voice transcript line.

### 2026-07-20 - Hand controls

- Shared the 56 px white cursor halo with Hand mode.
- Replaced automatic gesture sampling with guided Capture steps for point, pinch, open palm, fist, peace, thumbs up, thumbs down, and neutral poses.
- Added a live camera preview and minimum sample checks during personal hand-model training.
- Debounced pinch and classified gestures so a held pose produces one stable activation instead of repeated commands.
- Kept the real system pointer unchanged; Hand mode currently drives only ARIA's click-through overlay cursor.

### 2026-07-21 - GNOME desktop styling

- Replaced the translucent AI-overlay styling with a solid GNOME/libadwaita-inspired utility window.
- Added Ubuntu system typography, restrained orange state accents, native-sized controls, and a compact header bar.
- Converted the Voice, Eye, and Hand mode selectors to semantic buttons with pressed-state accessibility.
- Standardized focus, hover, active, disabled, training, transcript, camera, and form-control styling.

## Next Iteration

1. Add observable runtime diagnostics for microphone, speech recognition, TTS, and model readiness.
2. Implement real desktop actions that are safe and testable.
3. Improve intent-model evaluation and training data quality.
4. Add automated tests for the new desktop behavior.
