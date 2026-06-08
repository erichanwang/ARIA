import { defineManifest } from '@crxjs/vite-plugin';

/**
 * Manifest V3 definition for ARIA.
 *
 * Architecture notes:
 * - `background` is an ES module service worker (MV3 requirement).
 * - The content script is injected on every page (<all_urls>) so the agent
 *   cursor and DOM executor are always available.
 * - `offscreen` is NOT declared here; offscreen documents are created at
 *   runtime via chrome.offscreen.createDocument(). We only register the HTML
 *   as a web-accessible resource so the SW can load it.
 * - Permissions:
 *   - offscreen   → create the offscreen doc that owns the mic / camera
 *   - storage     → API key + settings (chrome.storage.local only)
 *   - scripting   → programmatic injection fallback
 *   - activeTab/tabs → read active tab + navigate (chrome.tabs.update)
 *   - alarms      → SW keepalive ping (MILESTONE 7)
 *   - tts is intentionally omitted: we use the page's Web Speech Synthesis,
 *     not chrome.tts, so the agent can sync sentence highlighting in the DOM.
 */
export default defineManifest({
  manifest_version: 3,
  name: 'ARIA — Adaptive Real-time Intelligent Agent',
  version: '0.1.0',
  description:
    'A glowing AGENT cursor you control by voice, powered by Claude. Ask, navigate, read, and act on any page hands-free.',
  minimum_chrome_version: '116',
  action: {
    default_popup: 'src/popup/popup.html',
    default_title: 'ARIA',
    default_icon: {
      '16': 'public/icons/icon16.png',
      '32': 'public/icons/icon32.png',
      '48': 'public/icons/icon48.png',
      '128': 'public/icons/icon128.png',
    },
  },
  icons: {
    '16': 'public/icons/icon16.png',
    '32': 'public/icons/icon32.png',
    '48': 'public/icons/icon48.png',
    '128': 'public/icons/icon128.png',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],
  permissions: ['offscreen', 'storage', 'scripting', 'activeTab', 'tabs', 'alarms', 'clipboardRead', 'clipboardWrite', 'bookmarks', 'tabGroups'],
  // Claude's API + Google's model CDN (KI-02: on-demand face/hand landmarker
  // model download) are the only remote hosts we contact. Mic/camera
  // processing itself is local.
  host_permissions: ['https://api.anthropic.com/*', 'https://storage.googleapis.com/*'],
  web_accessible_resources: [
    {
      // Offscreen HTML + any model/wasm assets the offscreen doc lazy-loads.
      resources: [
        'src/offscreen/offscreen.html',
        'public/models/*',
        'public/porcupine-model/*',
        'public/mediapipe-wasm/*',
      ],
      matches: ['<all_urls>'],
    },
  ],
  // The offscreen document loads Porcupine/MediaPipe WASM (eval-free) and the
  // popup is local. No remote code. 'wasm-unsafe-eval' is required for WASM.
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.anthropic.com https://storage.googleapis.com;",
  },
});
