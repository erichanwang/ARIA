/**
 * Preload: secure bridge between Electron main process and renderer.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ariaDesktop', {
  // Navigation / system
  openUrl:       (url: string) => ipcRenderer.invoke('open-url', url),
  writeClipboard:(text: string) => ipcRenderer.invoke('write-clipboard', text),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  startTimer:    (seconds: number, label: string) => ipcRenderer.invoke('start-timer', seconds, label),
  hideWindow:    () => ipcRenderer.invoke('hide-window'),
  minimizeWindow:() => ipcRenderer.invoke('minimize-window'),
  setPanelPinned:(pinned: boolean) => ipcRenderer.invoke('set-panel-pinned', pinned),
  resizeWindow:  (height: number) => ipcRenderer.invoke('resize-status-window', height),

  // Settings
  getSettings:   () => ipcRenderer.invoke('get-settings'),
  saveSettings:  (s: Record<string, unknown>) => ipcRenderer.invoke('save-settings', s),
  saveVoiceTrainingSample: (sample: { audio: Uint8Array; mimeType: string; prompt: string; spokenText: string; promptIndex: number }) =>
    ipcRenderer.invoke('save-voice-training-sample', sample),
  openVoiceTrainingFolder: () => ipcRenderer.invoke('open-voice-training-folder'),
  startCameraFallback: () => ipcRenderer.invoke('start-camera-fallback'),
  stopCameraFallback: () => ipcRenderer.invoke('stop-camera-fallback'),
  log: (event: string, details?: Record<string, unknown>) =>
    ipcRenderer.send('runtime-log', event, details),

  // Cursor overlay (fire-and-forget, no response needed)
  moveCursor: (pos: { x: number; y: number; visible: boolean; state?: string }) =>
    ipcRenderer.send('cursor-move', pos),

  // Event listeners from main
  onActivate:  (cb: () => void) => ipcRenderer.on('activate',  () => cb()),
  onRlReward:  (cb: () => void) => ipcRenderer.on('rl-reward', () => cb()),
  onRlPunish:  (cb: () => void) => ipcRenderer.on('rl-punish', () => cb()),
  onOpenVoiceTraining: (cb: () => void) => ipcRenderer.on('open-voice-training', () => cb()),
  onOpenEyeTraining: (cb: () => void) => ipcRenderer.on('open-eye-training', () => cb()),
  onOpenHandTraining: (cb: () => void) => ipcRenderer.on('open-hand-training', () => cb()),
  onCameraFallbackFrame: (cb: (frame: { width: number; height: number; data: Uint8Array }) => void) =>
    ipcRenderer.on('camera-fallback-frame', (_event, frame) => cb(frame)),
  onCameraFallbackError: (cb: (error: string) => void) =>
    ipcRenderer.on('camera-fallback-error', (_event, error) => cb(error)),
});
