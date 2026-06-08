import { ipcRenderer } from 'electron';

// Expose IPC to the cursor overlay renderer (no contextBridge needed - cursor.html is trusted local file)
(globalThis as unknown as Record<string, unknown>)['ariaIpc'] = {
  onCursorUpdate: (cb: (pos: Record<string, unknown>) => void) =>
    ipcRenderer.on('cursor-update', (_e, pos) => cb(pos as Record<string, unknown>)),
};
