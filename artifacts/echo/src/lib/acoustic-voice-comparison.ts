// Lightweight, local acoustic comparison. This is NOT speaker recognition.
// Mixed music, effects and differences between speech/singing strongly affect scores.
export type AcousticSummary = { score: number; speechHz: number | null; singingHz: number | null; quality: string };

type Features = { bands: number[]; zcr: number; pitch: number | null; voicedFrames: number };
function features(samples: Float32Array, rate: number): Features {
  const windowSize = 2048;
  const hop = Math.max(windowSize, Math.floor(rate / 6));
  const bands = new Array<number>(8).fill(0);
  let zcr = 0, frames = 0, voicedFrames = 0;
  const pitches: number[] = [];
  const minLag = Math.max(2, Math.floor(rate / 450));
  const maxLag = Math.min(windowSize / 2, Math.floor(rate / 85));
  for (let pos = 0; pos + windowSize < samples.length && frames < 90; pos += hop) {
    const frame = samples.subarray(pos, pos + windowSize);
    let power = 0, crossings = 0;
    for (let i = 1; i < frame.length; i++) {
      power += frame[i] * frame[i];
      if ((frame[i] >= 0) !== (frame[i - 1] >= 0)) crossings++;
    }
    if (power / windowSize < 0.00006) continue;
    frames++; zcr += crossings / windowSize;
    // Coarse log-frequency energy profile (Goertzel at 8 center frequencies).
    const frequencies = [150, 220, 320, 470, 690, 1010, 1480, 2160];
    frequencies.forEach((frequency, index) => {
      const omega = 2 * Math.PI * frequency / rate;
      const coeff = 2 * Math.cos(omega);
      let q0 = 0, q1 = 0, q2 = 0;
      for (let i = 0; i < windowSize; i++) {
        const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (windowSize - 1));
        q0 = frame[i] * window + coeff * q1 - q2;
        q2 = q1; q1 = q0;
      }
      bands[index] += Math.max(0, q1 * q1 + q2 * q2 - coeff * q1 * q2);
    });
    // Normalized autocorrelation estimates fundamental frequency on voiced frames.
    let best = 0, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag += 2) {
      let dot = 0, a = 0, b = 0;
      for (let i = 0; i < windowSize - lag; i += 4) {
        const x = frame[i], y = frame[i + lag];
        dot += x * y; a += x * x; b += y * y;
      }
      const corr = dot / (Math.sqrt(a * b) + 1e-8);
      if (corr > best) { best = corr; bestLag = lag; }
    }
    if (best > 0.78 && bestLag) { pitches.push(rate / bestLag); voicedFrames++; }
  }
  if (frames < 3) throw new Error('La grabación tiene muy poca señal audible.');
  const total = bands.reduce((a, b) => a + b, 0) || 1;
  pitches.sort((a, b) => a - b);
  return { bands: bands.map(x => Math.sqrt(x / total)), zcr: zcr / frames, pitch: pitches.length >= 3 ? pitches[Math.floor(pitches.length / 2)] : null, voicedFrames };
}
async function decode(url: string): Promise<{ data: Float32Array; rate: number }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('No se pudo descargar una referencia de audio.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 35_000_000) throw new Error('El audio es demasiado grande para analizarlo localmente.');
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(bytes);
    if (buffer.duration < 2) throw new Error('Cada referencia debe durar al menos dos segundos.');
    const channels = buffer.numberOfChannels;
    const length = Math.min(buffer.length, buffer.sampleRate * 35);
    const mono = new Float32Array(length);
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
    }
    return { data: mono, rate: buffer.sampleRate };
  } finally { await context.close(); }
}
export async function compareAcoustics(speechUrl: string, singingUrl: string): Promise<AcousticSummary> {
  const [speech, singing] = await Promise.all([decode(speechUrl), decode(singingUrl)]);
  const a = features(speech.data, speech.rate);
  const b = features(singing.data, singing.rate);
  const dot = a.bands.reduce((sum, x, i) => sum + x * b.bands[i], 0);
  const normA = Math.hypot(...a.bands), normB = Math.hypot(...b.bands);
  const spectral = dot / Math.max(1e-8, normA * normB);
  const crossing = Math.exp(-Math.abs(a.zcr - b.zcr) * 9);
  // Pitch is only weakly weighted because singing changes fundamental frequency.
  const pitch = a.pitch && b.pitch ? Math.exp(-Math.abs(Math.log2(a.pitch / b.pitch)) * 0.65) : null;
  const score = Math.round(100 * (0.8 * spectral + 0.2 * crossing));
  return {
    score: Math.max(0, Math.min(100, score)),
    speechHz: a.pitch ? Math.round(a.pitch) : null,
    singingHz: b.pitch ? Math.round(b.pitch) : null,
    quality: pitch === null || a.voicedFrames < 3 || b.voicedFrames < 3
      ? 'Estimación limitada: no se detectó suficiente voz tonal.'
      : 'Comparación orientativa de espectro y textura; la música de fondo puede alterar el resultado.',
  };
}
