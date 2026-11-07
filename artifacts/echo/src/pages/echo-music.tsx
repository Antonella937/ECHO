import { useEffect, useRef, useState } from 'react';
import { Music2, LockKeyhole, WandSparkles, ChevronDown, Play, Pause, Upload } from 'lucide-react';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { customFetch } from '@workspace/api-client-react';
import { useSocial } from '@/store/social-store';
import { CharacterAvatar } from '@/components/echo/avatar';

type MusicDraftRecord = { id: string; title: string; prompt: string; characterId: string; createdAt: string; durationSeconds: number; status: 'draft' };
const libraryKey = (id: string) => `echo-music-drafts-v1:${id}`;

export default function EchoMusicPage() {
  const back = useBack();
  const { me } = useSocial();
  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);
  const [localAudioError, setLocalAudioError] = useState('');
  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);
  function importAudio(file: File | undefined) {
    if (!file) return;
    if (!['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/webm'].includes(file.type) || file.size > 30 * 1024 * 1024) {
      setLocalAudioError('Elegí un archivo de audio compatible de hasta 30 MB.');
      return;
    }
    audioRef.current?.pause();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setLocalAudioUrl(url);
    setLocalAudioError('');
    setElapsed(0);
    setActualDuration(0);
    setPlaying(false);
    setPlayerOpen(true);
  }
  const [playerOpen, setPlayerOpen] = useState(false);
  const [library, setLibrary] = useState<MusicDraftRecord[]>([]);
  const [libraryError, setLibraryError] = useState('');
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(libraryKey(me.id)) ?? '[]') as unknown;
      setLibrary(Array.isArray(stored) ? stored.filter((item): item is MusicDraftRecord => !!item && typeof item === 'object' && typeof item.title === 'string' && item.status === 'draft' && item.characterId === me.id).slice(0, 50) : []);
    } catch { setLibrary([]); }
  }, [me.id]);
  function saveDraft(record: MusicDraftRecord) {
    try {
      const next = [record, ...library.filter(item => item.id !== record.id)].slice(0, 50);
      localStorage.setItem(libraryKey(me.id), JSON.stringify(next));
      setLibrary(next);
      setLibraryError('');
    } catch { setLibraryError('No se pudo guardar el borrador en este dispositivo.'); }
  }
  function deleteDraft(id: string) {
    try {
      const next = library.filter(item => item.id !== id);
      localStorage.setItem(libraryKey(me.id), JSON.stringify(next));
      setLibrary(next);
    } catch { setLibraryError('No se pudo eliminar el borrador.'); }
  }
  const audioUrl = localAudioUrl;
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [actualDuration, setActualDuration] = useState(0);
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  const [vocalMode, setVocalMode] = useState<'instrumental' | 'singing'>('instrumental');
  const [lyrics, setLyrics] = useState('');
  const [instruments, setInstruments] = useState('');
  const [language, setLanguage] = useState('en');
  const [durationSeconds, setDurationSeconds] = useState(120);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState('');
  const [preview, setPreview] = useState('');
  const field = 'w-full rounded-xl border border-border bg-card px-3 py-3 text-sm text-foreground outline-none focus:border-primary';
  async function prepare() {
    if (preparing) return;
    setPreparing(true);
    setPrepareError('');
    setPreview('');
    try {
      const result = await customFetch<{ status: string; charged: boolean; request: { prompt: string; music_length_ms: number; force_instrumental: boolean } }>('/api/music/generate/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationSeconds,
          title: title.trim(),
          description: description.trim(),
          genre: genre.trim(),
          mood: mood.trim(),
          instruments: instruments.split(',').map(s => s.trim()).filter(Boolean).slice(0, 12),
          language,
          vocalMode,
          lyrics: vocalMode === 'singing' ? lyrics : '',
        }),
        responseType: 'json',
      });
      if (result.charged || result.status !== 'dry_run') throw new Error('La preparación devolvió un estado inesperado.');
      setPreview(result.request.prompt);
      saveDraft({ id: crypto.randomUUID(), title: title.trim(), prompt: result.request.prompt, characterId: me.id, createdAt: new Date().toISOString(), durationSeconds, status: 'draft' });
      setElapsed(0);
      setPlaying(false);
      setPlayerOpen(true);
    } catch (err) {
      setPrepareError(err instanceof Error ? err.message : 'No se pudo preparar la canción.');
    } finally {
      setPreparing(false);
    }
  }
  if (playerOpen) return <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#100d12] px-6 pb-[calc(env(safe-area-inset-bottom,0px)+36px)] pt-[calc(env(safe-area-inset-top,0px)+22px)] text-white">
    <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#5c364b] via-[#231721] to-[#100d12] opacity-80" />
    <header className="relative z-10 flex items-center justify-between">
      <button type="button" onClick={() => { audioRef.current?.pause(); setPlaying(false); setPlayerOpen(false); }} aria-label="Volver al estudio" className="grid h-11 w-11 place-items-center"><ChevronDown className="h-7 w-7" /></button>
      <span className="text-center text-sm font-semibold">ECHO Music · {audioUrl ? 'Reproduciendo' : 'Preparada'}</span>
      <span className="w-11" />
    </header>
    <div className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-9 py-8">
      <div className="mx-auto flex aspect-square w-full max-w-[390px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/10 shadow-2xl">
        <CharacterAvatar character={me} size={340} className="max-w-full" />
      </div>
      <div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-white/70">{me.name} · ECHO Music</p></div>
      <div>
        <input type="range" min={0} max={Math.max(actualDuration, 1)} step={0.1} value={Math.min(elapsed, Math.max(actualDuration, 1))} disabled={!audioUrl || !actualDuration} onChange={event => { const audio = audioRef.current; if (audio) { audio.currentTime = Number(event.target.value); setElapsed(audio.currentTime); } }} aria-label="Progreso de la canción" className="w-full accent-white disabled:opacity-40" />
        <div className="mt-1 flex justify-between text-xs text-white/65"><span>{formatTime(elapsed)}</span><span>{audioUrl && actualDuration ? formatTime(actualDuration) : '--:--'}</span></div>
        <div className="mt-5 flex justify-center"><button type="button" disabled={!audioUrl} onClick={() => { const audio = audioRef.current; if (!audio) return; if (audio.paused) void audio.play().catch(() => setPlaying(false)); else audio.pause(); }} aria-label={playing ? 'Pausar' : 'Reproducir'} className="grid h-20 w-20 place-items-center rounded-full bg-white text-black disabled:opacity-40">{playing ? <Pause className="h-9 w-9 fill-current" /> : <Play className="ml-1 h-9 w-9 fill-current" />}</button></div>
      </div>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/25 p-3 text-sm font-semibold"><Upload className="h-4 w-4" /> Probar con un audio propio<input type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/webm" className="sr-only" onChange={event => { importAudio(event.target.files?.[0]); event.target.value = ''; }} /></label>
      {localAudioError && <p role="alert" className="text-sm text-red-200">{localAudioError}</p>}
      {audioUrl && <p className="text-center text-xs text-white/60">Audio local de prueba: no se guarda ni se publica.</p>}
      {!audioUrl && <div className="rounded-xl border border-white/20 bg-white/10 p-4 text-center text-sm"><LockKeyhole className="mx-auto mb-2 h-5 w-5" />La canción está preparada, pero la generación de audio todavía no está activada. Cuando ElevenLabs devuelva un archivo, esta pantalla reproducirá el sonido real y la barra avanzará con él.</div>}
      <details className="rounded-xl bg-white/5 p-4 text-xs text-white/75"><summary className="cursor-pointer font-semibold">Ver prompt preparado</summary><p className="mt-3 whitespace-pre-wrap">{preview}</p></details>
    </div>
    <audio ref={audioRef} src={audioUrl ?? undefined} preload="metadata" onLoadedMetadata={event => setActualDuration(event.currentTarget.duration)} onTimeUpdate={event => setElapsed(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
  </div>;
  return <div><TopBar title="ECHO Music Studio" onBack={back} /><main className="mx-auto max-w-2xl space-y-5 px-4 pb-20 pt-5">
    <div className="rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex items-center gap-2 text-lg font-semibold"><Music2 className="h-5 w-5 text-primary" /> Create your sound</div>
      <p className="mt-2 text-xs text-muted-foreground">Configurá una canción original para Eleven Music. La vista previa se prepara en ECHO sin enviar datos a ElevenLabs ni consumir créditos.</p>
    </div>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); prepare(); }}>
      <label className="block space-y-1 text-sm font-medium">Título<input className={field} value={title} maxLength={120} required onChange={e=>setTitle(e.target.value)} placeholder="Nombre de tu canción" /></label>
      <label className="block space-y-1 text-sm font-medium">Describí tu canción<textarea className={field} value={description} maxLength={2000} required minLength={3} rows={4} onChange={e=>setDescription(e.target.value)} placeholder="Una canción de rock alternativo con batería potente..." /></label>
      <div className="grid grid-cols-2 gap-3"><label className="block space-y-1 text-sm">Género<input className={field} value={genre} maxLength={100} onChange={e=>setGenre(e.target.value)} placeholder="Rock, pop..." /></label><label className="block space-y-1 text-sm">Ambiente<input className={field} value={mood} maxLength={100} onChange={e=>setMood(e.target.value)} placeholder="Oscuro, alegre..." /></label></div>
      <label className="block space-y-1 text-sm font-medium">Instrumentos (separados por comas)<input className={field} value={instruments} onChange={e => setInstruments(e.target.value.slice(0, 400))} placeholder="Batería, bajo, guitarra eléctrica" /></label>
      <label className="block space-y-1 text-sm font-medium">Idioma de la voz<select className={field} value={language} onChange={e => setLanguage(e.target.value)}><option value="en">Inglés</option><option value="es">Español</option><option value="ko">Coreano</option><option value="pt">Portugués</option><option value="ja">Japonés</option><option value="fr">Francés</option><option value="de">Alemán</option></select></label>
      <label className="block space-y-1 text-sm font-medium">Duración estimada<select className={field} value={durationSeconds} onChange={e => setDurationSeconds(Number(e.target.value))}><option value={30}>30 segundos</option><option value={60}>1 minuto</option><option value={120}>2 minutos</option><option value={180}>3 minutos</option><option value={240}>4 minutos</option><option value={300}>5 minutos</option></select></label>
      <fieldset className="space-y-2"><legend className="text-sm font-medium">Tipo de canción</legend><div className="flex gap-3">{(['instrumental','singing'] as const).map(mode=><label key={mode} className="flex items-center gap-2 text-sm"><input type="radio" checked={vocalMode===mode} onChange={()=>setVocalMode(mode)} />{mode==='instrumental'?'Instrumental':'Con voz'}</label>)}</div></fieldset>
      {vocalMode==='singing' && <label className="block space-y-1 text-sm">Letra original<textarea className={field} value={lyrics} maxLength={5000} rows={5} onChange={e=>setLyrics(e.target.value)} placeholder="Escribí tu letra acá..." /></label>}
      <button type="submit" disabled={preparing} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground"><WandSparkles className="h-4 w-4"/> {preparing ? "Preparando…" : "Preparar canción · gratis"}</button>
    </form>
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card/60 p-3 text-sm font-semibold"><Upload className="h-4 w-4" /> Probar reproductor con audio propio<input type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/webm" className="sr-only" onChange={event => { importAudio(event.target.files?.[0]); event.target.value = ''; }} /></label>
    {localAudioError && <p role="alert" className="text-sm text-destructive">{localAudioError}</p>}
    {prepareError && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{prepareError}</p>}
    {preview && <section className="rounded-2xl border border-border bg-card/60 p-4" aria-live="polite"><h2 className="text-sm font-semibold">Solicitud preparada · {title} · {durationSeconds}s</h2><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs text-muted-foreground">{preview}</pre><p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="h-4 w-4"/> Generación no activada. Sin cargos.</p></section>}
    <section className="rounded-2xl border border-border bg-card/60 p-4"><h2 className="text-sm font-semibold">Mi biblioteca · borradores</h2><p className="mt-1 text-xs text-muted-foreground">Los prompts se guardan solo en este dispositivo. Todavía no son canciones ni se sincronizan con tu cuenta.</p>
      {libraryError && <p role="alert" className="mt-2 text-xs text-destructive">{libraryError}</p>}
      {library.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">Todavía no preparaste canciones.</p> : <div className="mt-3 space-y-2">{library.map(item => <div key={item.id} className="flex items-center gap-2 rounded-xl border border-border p-3"><Music2 className="h-4 w-4 shrink-0 text-primary"/><button type="button" onClick={() => { setTitle(item.title); setPreview(item.prompt); setDurationSeconds(item.durationSeconds); setPlayerOpen(true); }} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{item.title}</span><span className="text-xs text-muted-foreground">Borrador · {item.durationSeconds}s</span></button><button type="button" onClick={() => deleteDraft(item.id)} className="text-xs text-muted-foreground underline">Eliminar</button></div>)}</div>}
    </section>
    <div className="rounded-2xl border border-border bg-card/60 p-4"><h2 className="text-sm font-semibold">Música para historias y publicaciones</h2><p className="mt-2 text-xs text-muted-foreground">Feed.fm Clips: integración preparada, sin activar ni contratar. La reproducción de fragmentos de 15 o 30 segundos se habilitará únicamente después de confirmar el contrato, los derechos para Argentina y el acceso oficial al catálogo. YouTube: búsqueda disponible, sin derechos de reproducción de audio sobre fotos.</p></div>
  </main></div>;
}
