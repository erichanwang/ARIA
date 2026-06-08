/**
 * Macro recorder and playback.
 * "start recording" / "stop recording [name]" captures a sequence of commands.
 * "run [macro name]" replays them through the normal command pipeline.
 *
 * Macros are persisted to chrome.storage.local.
 */

const MACRO_KEY = 'aria.macros';

export interface Macro {
  name: string;
  commands: string[];
  createdAt: number;
}

export class MacroRecorder {
  private recording = false;
  private buffer: string[] = [];

  isRecording(): boolean {
    return this.recording;
  }

  start(): void {
    this.recording = true;
    this.buffer = [];
  }

  record(command: string): void {
    if (this.recording) this.buffer.push(command);
  }

  async stop(name: string): Promise<Macro> {
    this.recording = false;
    const macro: Macro = { name: name.trim() || 'unnamed', commands: [...this.buffer], createdAt: Date.now() };
    this.buffer = [];
    await saveMacro(macro);
    return macro;
  }

  clear(): void {
    this.recording = false;
    this.buffer = [];
  }
}

export async function loadMacros(): Promise<Macro[]> {
  const raw = await chrome.storage.local.get(MACRO_KEY);
  return (raw[MACRO_KEY] as Macro[] | undefined) ?? [];
}

export async function saveMacro(macro: Macro): Promise<void> {
  const macros = await loadMacros();
  const idx = macros.findIndex((m) => m.name.toLowerCase() === macro.name.toLowerCase());
  if (idx >= 0) macros[idx] = macro;
  else macros.push(macro);
  await chrome.storage.local.set({ [MACRO_KEY]: macros });
}

export async function findMacro(name: string): Promise<Macro | undefined> {
  const macros = await loadMacros();
  return macros.find((m) => m.name.toLowerCase() === name.toLowerCase().trim());
}

/** Returns the macro name if the command is "run <name>", otherwise null. */
export function parseRunMacro(command: string): string | null {
  const m = command.match(/^(?:run|play|execute)\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** Returns true and the name if command is "stop recording <name>". */
export function parseStopRecording(command: string): { stop: true; name: string } | null {
  const m = command.match(/^stop\s+recording\s*(.*)?$/i);
  return m ? { stop: true, name: m[1]?.trim() ?? '' } : null;
}

export function isStartRecording(command: string): boolean {
  return /^start\s+recording$/i.test(command.trim());
}
