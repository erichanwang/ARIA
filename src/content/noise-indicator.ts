/**
 * Ambient Noise Filter Indicator
 * Shows a live noise level meter in the HUD while in listening state.
 * Uses the Web Audio API to read microphone amplitude.
 */

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let stream: MediaStream | null = null;
let rafId: number | null = null;
let meterEl: HTMLElement | null = null;
let warningShown = false;

const HIGH_NOISE_THRESHOLD = 0.35; // RMS threshold for "too noisy" warning

export async function startNoiseIndicator(hudEl: HTMLElement): Promise<void> {
  if (analyser) return; // already running

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);
  } catch {
    return; // no microphone access — silently skip
  }

  meterEl = document.createElement('div');
  meterEl.className = 'aria-noise-meter';
  hudEl.appendChild(meterEl);
  warningShown = false;

  const data = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    if (!analyser || !meterEl) return;
    analyser.getByteFrequencyData(data);
    const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length) / 255;
    const pct = Math.min(100, Math.round(rms * 300));

    meterEl.style.setProperty('--noise-pct', `${pct}%`);
    const isHigh = rms > HIGH_NOISE_THRESHOLD;
    meterEl.classList.toggle('aria-noise-high', isHigh);

    if (isHigh && !warningShown) {
      warningShown = true;
      const warn = hudEl.querySelector('.aria-noise-warn') ?? document.createElement('div');
      warn.className = 'aria-noise-warn';
      warn.textContent = "It's noisy — I might mishear you";
      hudEl.appendChild(warn);
      setTimeout(() => { warn.remove(); warningShown = false; }, 4000);
    }

    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

export function stopNoiseIndicator(): void {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  meterEl?.remove(); meterEl = null;
  source?.disconnect();
  analyser = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  audioCtx?.close().catch(() => {});
  audioCtx = null;
  warningShown = false;
}
