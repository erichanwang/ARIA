/**
 * ARIA Desktop - Electron main process.
 *
 * Window layout:
 *   statusWin - small control panel (bottom-right corner)
 *   cursorWin - transparent fullscreen always-on-top overlay (click-through)
 *               shows the ARIA eye/hand cursor across the whole screen
 *
 * IPC surface:
 *   cursor-move     renderer → main → cursorWin : move gaze/hand cursor
 *   cursor-click    renderer → main             : dwell / gesture click
 *   rl-feedback     renderer → main             : modifier shortcuts for reward / punish
 *   open-url        renderer → shell
 *   write-clipboard renderer → clipboard
 *   hide-window     renderer → statusWin.hide()
 *   get/save-settings renderer ↔ disk
 */
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  shell,
  clipboard,
  screen,
  Menu,
  nativeImage,
  Tray,
  session,
  Notification,
} from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { fitWindowHeight } from './window-sizing';

const SETTINGS_PATH = path.join(os.homedir(), '.aria-desktop-settings.json');
const RUNTIME_LOG_PATH = path.join(os.homedir(), '.aria-desktop.log');
const APP_ICON_PATH = path.join(__dirname, '..', '..', 'public', 'icons', 'icon128.png');
const STATUS_W = 460;
const STATUS_H = 380;

let statusWin: BrowserWindow | null = null;
let cursorWin: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let fallbackCameraProcess: ChildProcessWithoutNullStreams | null = null;
const FALLBACK_CAMERA_WIDTH = 320;
const FALLBACK_CAMERA_HEIGHT = 240;
const FALLBACK_CAMERA_FRAME_BYTES = FALLBACK_CAMERA_WIDTH * FALLBACK_CAMERA_HEIGHT * 4;

// Keep the original profile path so changing the visible app name does not
// invalidate persisted local models, permissions, or microphone device IDs.
app.setPath('userData', path.join(app.getPath('appData'), 'aria-desktop'));
app.setName('ARIA');
app.setAppUserModelId('ARIA');

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.quit();

function loadSettings(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as Record<string, unknown>; }
  catch { return {}; }
}
function saveSettings(data: Record<string, unknown>): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ ...loadSettings(), ...data }, null, 2), 'utf8');
}
function appendRuntimeLog(event: string, details: Record<string, unknown> = {}): void {
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), event, ...details });
  fs.appendFileSync(RUNTIME_LOG_PATH, `${entry}\n`, 'utf8');
}
function voiceTrainingDirectory(): string {
  return path.join(app.getPath('documents'), 'ARIA Voice Training');
}

/* ─── cursor overlay (full-screen, transparent, click-through) ─── */
function createCursorWindow(): void {
  const { width, height } = screen.getPrimaryDisplay().bounds;
  cursorWin = new BrowserWindow({
    width, height, x: 0, y: 0,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'cursor-preload.js'),
      contextIsolation: false,
    },
  });
  cursorWin.setIgnoreMouseEvents(true, { forward: true });
  cursorWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  void cursorWin.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'cursor.html'));
}

/* ─── status control panel ─── */
function createStatusWindow(): void {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const pinned = loadSettings()['panelPinned'] === true;
  statusWin = new BrowserWindow({
    width: STATUS_W, height: STATUS_H,
    x: x + width - STATUS_W - 24,
    y: pinned ? y + 24 : y + height - STATUS_H - 24,
    frame: false, transparent: true, alwaysOnTop: pinned,
    icon: APP_ICON_PATH,
    resizable: false, skipTaskbar: true, show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  statusWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  statusWin.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    statusWin?.hide();
  });
  void statusWin.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function setPanelPinned(pinned: boolean): void {
  if (!statusWin) return;
  const { x, y, width, height } = screen.getDisplayMatching(statusWin.getBounds()).workArea;
  const bounds = statusWin.getBounds();
  statusWin.setAlwaysOnTop(pinned);
  statusWin.setPosition(x + width - bounds.width - 24, pinned ? y + 24 : y + height - bounds.height - 24);
}

function showStatusWindow(): void {
  if (!statusWin) return;
  if (statusWin.isMinimized()) statusWin.restore();
  statusWin.show();
  statusWin.focus();
}

function showVoiceTrainingWindow(): void {
  showStatusWindow();
  statusWin?.webContents.send('open-voice-training');
}

function showEyeTrainingWindow(): void {
  showStatusWindow();
  statusWin?.webContents.send('open-eye-training');
}

function showHandTrainingWindow(): void {
  showStatusWindow();
  statusWin?.webContents.send('open-hand-training');
}

function createTray(): void {
  const icon = nativeImage.createFromPath(APP_ICON_PATH).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('ARIA Desktop');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show ARIA', click: showStatusWindow },
    { label: 'Build Voice Dataset', click: showVoiceTrainingWindow },
    { label: 'Train Eye Controls', click: showEyeTrainingWindow },
    { label: 'Train Hand Controls', click: showHandTrainingWindow },
    { type: 'separator' },
    { label: 'Quit ARIA', click: () => app.quit() },
  ]));
  tray.on('click', showStatusWindow);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const trustedLocalPage = webContents.getURL().startsWith('file://');
    callback(trustedLocalPage && permission === 'media');
  });
  createStatusWindow();
  createTray();
  if (process.argv.includes('--voice-training')) {
    statusWin?.webContents.once('did-finish-load', showVoiceTrainingWindow);
  } else if (process.argv.includes('--eye-training')) {
    statusWin?.webContents.once('did-finish-load', showEyeTrainingWindow);
  } else if (process.argv.includes('--hand-training')) {
    statusWin?.webContents.once('did-finish-load', showHandTrainingWindow);
  }
  appendRuntimeLog('app-ready', { platform: process.platform });

  // Global hotkey: activate voice in status window
  const activateKey = process.platform === 'darwin' ? 'Cmd+Space' : 'Ctrl+Space';
  globalShortcut.register(activateKey, () => {
    showStatusWindow();
    statusWin?.webContents.send('activate');
  });

  // Modifier shortcuts avoid intercepting normal typing system-wide.
  globalShortcut.register('CommandOrControl+Shift+Y', () => statusWin?.webContents.send('rl-reward'));
  globalShortcut.register('CommandOrControl+Shift+N', () => statusWin?.webContents.send('rl-punish'));
});

app.on('second-instance', (_event, argv) => {
  if (argv.includes('--voice-training')) showVoiceTrainingWindow();
  else if (argv.includes('--eye-training')) showEyeTrainingWindow();
  else if (argv.includes('--hand-training')) showHandTrainingWindow();
  else showStatusWindow();
});
app.on('before-quit', () => { isQuitting = true; });
app.on('will-quit', () => {
  fallbackCameraProcess?.kill('SIGTERM');
  globalShortcut.unregisterAll();
});

/* ─── IPC ─── */
ipcMain.handle('open-url',        (_e, url: string) => shell.openExternal(url));
ipcMain.handle('write-clipboard', (_e, text: string) => { clipboard.writeText(text); });
ipcMain.handle('read-clipboard',  () => clipboard.readText());
ipcMain.handle('start-timer', (_e, seconds: number, label: string) => {
  const safeSeconds = Math.max(1, Math.min(24 * 60 * 60, Math.round(seconds)));
  setTimeout(() => {
    if (Notification.isSupported()) new Notification({ title: 'ARIA Timer', body: label }).show();
    appendRuntimeLog('timer-finished', { seconds: safeSeconds });
  }, safeSeconds * 1000);
  appendRuntimeLog('timer-started', { seconds: safeSeconds });
  return safeSeconds;
});
ipcMain.handle('hide-window',     () => statusWin?.hide());
ipcMain.handle('minimize-window', () => statusWin?.minimize());
ipcMain.handle('set-panel-pinned', (_e, pinned: boolean) => setPanelPinned(pinned));
ipcMain.handle('resize-status-window', (_e, contentHeight: number) => {
  if (!statusWin) return STATUS_H;
  const workArea = screen.getDisplayMatching(statusWin.getBounds()).workArea;
  const nextHeight = fitWindowHeight(contentHeight, workArea.height);
  const pinned = loadSettings()['panelPinned'] === true;
  statusWin.setBounds({
    x: workArea.x + workArea.width - STATUS_W - 24,
    y: pinned ? workArea.y + 24 : workArea.y + workArea.height - nextHeight - 24,
    width: STATUS_W,
    height: nextHeight,
  });
  return nextHeight;
});
ipcMain.handle('get-settings',    () => loadSettings());
ipcMain.handle('save-settings',   (_e, data: Record<string, unknown>) => saveSettings(data));
ipcMain.handle('save-voice-training-sample', (_e, data: {
  audio: Uint8Array;
  mimeType: string;
  prompt: string;
  spokenText: string;
  promptIndex: number;
}) => {
  const prompt = data.prompt.trim().slice(0, 2000);
  const spokenText = data.spokenText.trim().slice(0, 2000);
  const audio = Buffer.from(data.audio);
  if (!prompt) throw new Error('Training prompt is empty');
  if (!spokenText) throw new Error('Words actually spoken are empty');
  if (audio.length === 0 || audio.length > 25 * 1024 * 1024) throw new Error('Invalid training audio size');
  const directory = voiceTrainingDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const extension = data.mimeType.includes('ogg') ? 'ogg' : 'webm';
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${data.promptIndex + 1}`;
  const file = `${id}.${extension}`;
  fs.writeFileSync(path.join(directory, file), audio);
  fs.appendFileSync(path.join(directory, 'metadata.jsonl'), `${JSON.stringify({
    file,
    text: spokenText,
    prompt,
    promptIndex: data.promptIndex,
    mimeType: data.mimeType,
    createdAt: new Date().toISOString(),
  })}\n`, 'utf8');
  const count = fs.readFileSync(path.join(directory, 'metadata.jsonl'), 'utf8').trim().split('\n').length;
  appendRuntimeLog('voice-training-sample-saved', { bytes: audio.length, count, promptIndex: data.promptIndex });
  return { count, file };
});
ipcMain.handle('open-voice-training-folder', () => {
  const directory = voiceTrainingDirectory();
  fs.mkdirSync(directory, { recursive: true });
  return shell.openPath(directory);
});
ipcMain.handle('start-camera-fallback', () => {
  if (fallbackCameraProcess) return true;
  const child = spawn('gst-launch-1.0', [
    '-q', 'libcamerasrc', '!', 'videorate', '!',
    `video/x-raw,width=${FALLBACK_CAMERA_WIDTH},height=${FALLBACK_CAMERA_HEIGHT},framerate=10/1,format=RGBA`,
    '!', 'fdsink', 'fd=1',
  ]);
  fallbackCameraProcess = child;
  let pending = Buffer.alloc(0);
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= FALLBACK_CAMERA_FRAME_BYTES) {
      const frame = pending.subarray(0, FALLBACK_CAMERA_FRAME_BYTES);
      pending = pending.subarray(FALLBACK_CAMERA_FRAME_BYTES);
      statusWin?.webContents.send('camera-fallback-frame', {
        width: FALLBACK_CAMERA_WIDTH,
        height: FALLBACK_CAMERA_HEIGHT,
        data: new Uint8Array(frame),
      });
    }
  });
  child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-1000); });
  child.on('error', (error) => {
    appendRuntimeLog('camera-fallback-error', { error: error.message });
    statusWin?.webContents.send('camera-fallback-error', error.message);
    fallbackCameraProcess = null;
  });
  child.on('exit', (code, signal) => {
    if (fallbackCameraProcess === child) fallbackCameraProcess = null;
    appendRuntimeLog('camera-fallback-end', { code, signal, error: code ? stderr.trim().slice(-300) : undefined });
  });
  appendRuntimeLog('camera-fallback-start');
  return true;
});
ipcMain.handle('stop-camera-fallback', () => {
  fallbackCameraProcess?.kill('SIGTERM');
  fallbackCameraProcess = null;
});
ipcMain.on('runtime-log', (_e, event: string, details?: Record<string, unknown>) => {
  appendRuntimeLog(event, details);
});

// Relay cursor position from vision renderer → cursorWin
ipcMain.on('cursor-move', (_e, pos: { x: number; y: number; visible: boolean; state?: string }) => {
  if (pos.visible && !cursorWin) createCursorWindow();
  cursorWin?.webContents.send('cursor-update', pos);
});
