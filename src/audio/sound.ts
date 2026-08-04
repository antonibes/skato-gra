const VOLUME_KEY = "quinto-volume";

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let volume = loadVolume();

function loadVolume(): number {
  const stored = localStorage.getItem(VOLUME_KEY);
  const parsed = stored !== null ? Number(stored) : 0.7;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.7;
}

function ensureContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

export function setVolume(value: number): void {
  volume = Math.max(0, Math.min(1, value));
  localStorage.setItem(VOLUME_KEY, String(volume));
  if (masterGain) masterGain.gain.value = volume;
}

export function getVolume(): number {
  return volume;
}

function tone(freq: number, duration: number, startOffset: number, type: OscillatorType, peak: number) {
  const ctx = ensureContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;

  const t0 = ctx.currentTime + startOffset;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

  osc.connect(gain);
  gain.connect(masterGain!);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export function playPickup(): void {
  tone(560, 0.09, 0, "sine", 0.18);
}

export function playPlace(): void {
  tone(210, 0.13, 0, "triangle", 0.32);
  tone(150, 0.15, 0.02, "triangle", 0.18);
}

export function playWin(): void {
  tone(523.25, 0.14, 0, "sine", 0.26);
  tone(659.25, 0.14, 0.12, "sine", 0.26);
  tone(783.99, 0.24, 0.24, "sine", 0.3);
}

export function playLose(): void {
  tone(392, 0.18, 0, "sine", 0.22);
  tone(311.13, 0.18, 0.15, "sine", 0.22);
  tone(261.63, 0.3, 0.3, "sine", 0.24);
}

export function playDraw(): void {
  tone(392, 0.2, 0, "sine", 0.2);
  tone(392, 0.2, 0.22, "sine", 0.2);
}
