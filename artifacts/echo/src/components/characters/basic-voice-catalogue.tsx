import { useCharacterDetailsText } from '@/lib/character-details-translations';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { BASIC_VOICES, basicVoicePreviewPath, type BasicVoiceId } from '@/lib/basic-voices';

/** Preview catalogue for the selectable Kokoro voices. */
export function BasicVoiceCatalogue({ selectedVoiceId, onSelect }: { selectedVoiceId?: string; onSelect(id: BasicVoiceId | undefined): void }) {
  const t = useCharacterDetailsText();
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
    <h3 className="text-sm font-semibold">{t("Catálogo de voces · muestras gratuitas")}</h3>
    <p className="mt-1 text-xs text-muted-foreground">{t("Escuchá las diez voces disponibles y elegí la que querés usar. Las muestras no consumen créditos.")}</p>
    <p className="mt-3 text-xs font-medium" data-testid="selected-basic-voice">{selectedVoiceId ? `${t('Voz elegida:')} ${BASIC_VOICES.find(v => v.id === selectedVoiceId)?.label ?? t('Desconocida')}` : t('Todavía no elegiste una voz.')}</p>
    <div className="mt-3 grid grid-cols-2 gap-2">
      {BASIC_VOICES.map(voice => <div key={voice.id} className={`flex min-w-0 flex-col items-start justify-between gap-3 rounded-2xl border p-3 ${selectedVoiceId === voice.id ? "border-primary bg-primary/10" : "border-border bg-secondary/40"}`}>
        <div><p className="text-sm font-medium">{voice.label}</p><p className="text-xs text-muted-foreground">{t(voice.gender === 'female' ? 'Femenina' : 'Masculina')} · {voice.language}</p></div>
        <button type="button" onClick={() => onSelect(selectedVoiceId === voice.id ? undefined : voice.id)} aria-pressed={selectedVoiceId === voice.id} className="min-h-10 w-full rounded-full bg-primary/10 px-3 text-xs font-semibold text-foreground" data-testid={`button-select-basic-voice-${voice.id}`}>{t(selectedVoiceId === voice.id ? '✓ Seleccionada' : 'Elegir voz')}</button>
        <button type="button" onClick={() => void toggle(voice.id)} disabled={unavailable.includes(voice.id)}
          aria-label={playing === voice.id ? `${t('Pausar')} ${voice.label}` : `${t('Escuchar')} ${voice.label}`}
          className="flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-border px-3 text-xs font-semibold disabled:opacity-40"
          data-testid={`button-basic-voice-${voice.id}`}>
          {playing === voice.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {t(unavailable.includes(voice.id) ? 'No disponible' : playing === voice.id ? 'Pausar' : 'Escuchar')}
        </button>
      </div>)}
    </div>
  </section>;
}
