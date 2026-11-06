import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { BASIC_VOICES, basicVoicePreviewPath, type BasicVoiceId } from '@/lib/basic-voices';

/** Free, pre-generated sample catalogue. This does not enable live speech synthesis. */
export function BasicVoiceCatalogue({ selectedVoiceId, onSelect }: { selectedVoiceId?: string; onSelect(id: BasicVoiceId | undefined): void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);
  const toggle = async (id: BasicVoiceId) => {
    if (playing === id) { audioRef.current?.pause(); setPlaying(null); return; }
    audioRef.current?.pause();
    const audio = new Audio(basicVoicePreviewPath(id));
    audioRef.current = audio;
    audio.onended = () => setPlaying(null);
    audio.onerror = () => { setPlaying(null); setUnavailable(p => p.includes(id) ? p : [...p, id]); };
    try { await audio.play(); setPlaying(id); }
    catch { setPlaying(null); setUnavailable(p => p.includes(id) ? p : [...p, id]); }
  };
  return <section className="mt-6 rounded-2xl border border-border bg-card/60 p-4" data-testid="basic-voice-catalogue">
    <h3 className="text-sm font-semibold">Catálogo de voces · muestras gratuitas</h3>
    <p className="mt-1 text-xs text-muted-foreground">Escuchá las diez voces en inglés. Son muestras grabadas; los mensajes hablados todavía no están habilitados.</p>
    <p className="mt-3 text-xs font-medium" data-testid="selected-basic-voice">{selectedVoiceId ? `Voz elegida: ${BASIC_VOICES.find(v => v.id === selectedVoiceId)?.label ?? 'Desconocida'}` : 'Todavía no elegiste una voz.'}</p>
    <div className="mt-3 grid grid-cols-2 gap-2">
      {BASIC_VOICES.map(voice => <div key={voice.id} className={`flex min-w-0 flex-col items-start justify-between gap-3 rounded-2xl border p-3 ${selectedVoiceId === voice.id ? "border-primary bg-primary/10" : "border-border bg-secondary/40"}`}>
        <div><p className="text-sm font-medium">{voice.label}</p><p className="text-xs text-muted-foreground">{voice.gender === 'female' ? 'Femenina' : 'Masculina'} · {voice.language}</p></div>
        <button type="button" onClick={() => onSelect(selectedVoiceId === voice.id ? undefined : voice.id)} aria-pressed={selectedVoiceId === voice.id} className="min-h-10 w-full rounded-full bg-primary/10 px-3 text-xs font-semibold text-foreground" data-testid={`button-select-basic-voice-${voice.id}`}>{selectedVoiceId === voice.id ? "✓ Seleccionada" : "Elegir voz"}</button>
        <button type="button" onClick={() => void toggle(voice.id)} disabled={unavailable.includes(voice.id)}
          aria-label={playing === voice.id ? `Pausar ${voice.label}` : `Escuchar ${voice.label}`}
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-border px-3 text-xs font-semibold disabled:opacity-40"
          data-testid={`button-basic-voice-${voice.id}`}>
          {playing === voice.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {unavailable.includes(voice.id) ? 'No disponible' : playing === voice.id ? 'Pausar' : 'Escuchar'}
        </button>
      </div>)}
    </div>
  </section>;
}
