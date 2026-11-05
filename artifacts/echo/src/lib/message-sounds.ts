/** Short original, iPhone-style chimes synthesized locally (no copyrighted audio assets). */
const KEY = 'echo:message-sounds';
export type SoundPreferences = { incoming: boolean; outgoing: boolean; notification: boolean };
const defaults: SoundPreferences = { incoming: true, outgoing: true, notification: true };
export function getSoundPreferences(): SoundPreferences {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return defaults; }
}
export function saveSoundPreferences(next: SoundPreferences) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
  window.dispatchEvent(new Event('echo:sound-preferences'));
}
let context: AudioContext | null = null;
export function unlockMessageAudio() {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume().catch(() => undefined);
  } catch { /* browser does not support Web Audio */ }
}
export function playMessageSound(kind: 'incoming' | 'outgoing' | 'notification') {
  if (!getSoundPreferences()[kind]) return;
  try {
    unlockMessageAudio();
    if (!context || context.state !== 'running') return;
    const now = context.currentTime;
    const notes = kind === 'incoming'
      ? [{ f: 880, t: 0, d: 0.16 }, { f: 1318.5, t: 0.11, d: 0.27 }]
      : kind === 'notification'
        ? [{ f: 1174.66, t: 0, d: 0.14 }, { f: 1567.98, t: 0.13, d: 0.22 }]
        : [{ f: 1046.5, t: 0, d: 0.095 }];
    for (const note of notes) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = note.f;
      gain.gain.setValueAtTime(0.0001, now + note.t);
      gain.gain.exponentialRampToValueAtTime(0.075, now + note.t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.t + note.d);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + note.t);
      oscillator.stop(now + note.t + note.d + 0.01);
    }
  } catch { /* audio must never interrupt messaging */ }
}
