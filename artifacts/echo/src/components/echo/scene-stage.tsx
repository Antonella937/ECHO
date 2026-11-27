import { customFetch } from '@workspace/api-client-react';
import { useEffect, useState, useRef } from 'react';
import { readCallLooks, writeCallLooks } from '@/store/persistence';
import { Volume2, VolumeX } from 'lucide-react';
import { CallAvatar, type CallAvatarLook } from './call-avatar';

type CharacterSettings = { photo?: File };
type StageSettings = Record<string, CharacterSettings>;

interface SceneStageProps {
  storageScope: string;
  sceneId: string;
  universeId: string;
  viewerId: string;
  cast: Array<{ id: string; name: string; avatar: string }>;
  turn?: { eventId: string; actorId: string; text: string };
  es: boolean;
}

const hair: CallAvatarLook['hair'][] = ['long', 'swept', 'fringe'];
const clothes: CallAvatarLook['clothes'][] = ['black', 'cream', 'burgundy'];

export function SceneStage({ cast, turn, es, storageScope, sceneId, universeId, viewerId }: SceneStageProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<StageSettings>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [settingsError, setSettingsError] = useState('');
  const [voice, setVoice] = useState(false);
  const [mouthCue, setMouthCue] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const [voiceError, setVoiceError] = useState('');
  const [needsPlay, setNeedsPlay] = useState(false);
  const speakerId = turn?.actorId;
  const turnText = turn?.text ?? '';
  const actorOnStage = cast.some(person => person.id === speakerId);
  const actions = [...turnText.matchAll(/\*([^*]+)\*/g)].map(match => match[1]).join(' ');
  const expression = /\b(smiles?|grins?|laughs?|sonr[ií]e|r[ií]e)\b/i.test(actions) ? 'smile'
    : /\b(gasps?|surprised|sorprendid[oa])\b/i.test(actions) ? 'surprised' : 'neutral';

  useEffect(() => {
    let active = true;
    void readCallLooks<StageSettings>(storageScope).then(saved => {
      if (active && saved) setSettings(saved);
    }).catch(() => {
      if (active) setSettingsError(es ? 'No se pudieron cargar las referencias y voces.' : 'Could not load references and voices.');
    }).finally(() => {
      if (active) setReady(true);
    });
    return () => { active = false; };
  }, [storageScope, es]);

  const photos = useRef(new Map<string, { file: File; url: string }>());
  useEffect(() => {
    for (const [id, entry] of photos.current) {
      if (settings[id]?.photo === entry.file) continue;
      URL.revokeObjectURL(entry.url);
      photos.current.delete(id);
    }
    for (const [id, { photo }] of Object.entries(settings)) {
      if (photo && !photos.current.has(id)) photos.current.set(id, { file: photo, url: URL.createObjectURL(photo) });
    }
    setReferences(Object.fromEntries([...photos.current].map(([id, { url }]) => [id, url])));
  }, [settings]);

  useEffect(() => () => {
    for (const { url } of photos.current.values()) URL.revokeObjectURL(url);
    photos.current.clear();
  }, []);

  function changeSettings(id: string, change: Partial<CharacterSettings>) {
    if (!ready) return;
    const updated = { ...settings, [id]: { ...settings[id], ...change } };
    setSettings(updated);
    setSettingsError('');
    void writeCallLooks(storageScope, updated).catch(() => {
      setSettingsError(es ? 'No se pudo guardar la configuración en este navegador.' : 'Could not save settings in this browser.');
    });
  }

  function selectPhoto(id: string, file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10_000_000) {
      setSettingsError(es ? 'Elegí un JPG, PNG o WebP de hasta 10 MB.' : 'Choose a JPG, PNG or WebP up to 10 MB.');
      return;
    }
    changeSettings(id, { photo: file });
  }

  const eventId = turn?.eventId;
  useEffect(() => {
    setSpeaking(false);
    setNeedsPlay(false);
    setVoiceError('');
    const player = audio.current;
    if (!voice || !eventId || !player || !actorOnStage) return;
    const dialogue = turnText.replace(/\*{1,3}[^*]+\*{1,3}/g, '').trim();
    if (!dialogue) return;
    if (dialogue.length > 500) {
      setVoiceError(es ? 'Este turno supera los 500 caracteres de audio.' : 'This turn exceeds the 500-character audio limit.');
      return;
    }
    let active = true;
    let url: string | undefined;
    const controller = new AbortController();
    const words = dialogue.split(/\s+/);
    player.ontimeupdate = () => {
      const index = Math.min(words.length - 1, Math.floor((player.currentTime / player.duration) * words.length));
      setMouthCue(words[index] ?? words[0]);
    };
    player.onplaying = () => { setNeedsPlay(false); setSpeaking(true); };
    player.onpause = player.onended = () => setSpeaking(false);
    void customFetch<Blob>(`/api/scenes/${encodeURIComponent(sceneId)}/events/${encodeURIComponent(eventId)}/voice`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ universeId, viewerId }), responseType: 'blob', signal: controller.signal,
    }).then(blob => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      player.src = url;
      setMouthCue(words[0]);
      void player.play().catch(() => { if (active) setNeedsPlay(true); });
    }).catch(error => {
      if (!active) return;
      setVoiceError(error?.status === 409
        ? (es ? 'Asignale una voz al personaje en su perfil de ECHO.' : 'Assign a voice in the character’s ECHO profile.')
        : (es ? 'No se pudo generar la voz de ECHO para este turno.' : 'Could not generate the ECHO voice for this turn.'));
    });
    return () => {
      active = false;
      controller.abort();
      player.pause();
      player.removeAttribute('src');
      player.load();
      player.ontimeupdate = player.onplaying = player.onpause = player.onended = null;
      if (url) URL.revokeObjectURL(url);
    };
  }, [voice, eventId, actorOnStage, turnText, es, sceneId, universeId, viewerId]);

  return (
    <section aria-label={es ? 'Personajes en escena' : 'Characters on stage'} className="relative z-10 shrink-0">
      <audio ref={audio} />
      <div className="flex gap-3 overflow-x-auto overscroll-x-contain px-2 py-1">
        {cast.map((person, index) => {
          const active = speakerId === person.id;
          const portrait = references[person.id] || person.avatar;
          return (
            <figure key={person.id} className={`relative mx-auto h-[min(23dvh,14rem)] min-w-24 max-w-44 flex-1 overflow-hidden rounded-2xl border bg-neutral-900/75 text-white transition-[opacity,border-color] motion-reduce:transition-none ${active ? 'border-white shadow-lg' : 'border-white/20 opacity-75'}`}>
              <div className="absolute inset-0 grid place-items-center text-3xl font-semibold" aria-hidden="true">{person.name.slice(0, 1)}</div>
              {(index < 4 || active) ? (
                <CallAvatar look={{ hair: hair[index % hair.length], clothes: clothes[index % clothes.length], expression: active ? expression : 'neutral' }}
                  reference={references[person.id]} speaking={active && speaking} mouthCue={active ? mouthCue : ''} />
              ) : portrait && <img src={portrait} alt="" className="absolute inset-0 h-full w-full object-cover" />}
              <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black via-black/75 to-transparent px-2 pb-2 pt-4">
                {person.avatar && <img src={person.avatar} alt="" className="size-6 shrink-0 rounded-full object-cover" />}
                <div className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{person.name}</span>
                  {active && <span className="block text-[10px]">{es ? 'Último turno' : 'Latest turn'}</span>}
                </div>
              </figcaption>
            </figure>
          );
        })}
      </div>
      <div className="mt-1 flex justify-center gap-2">
        <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(open => !open)}
          className="rounded-full border border-white/25 bg-black/65 px-3 py-1.5 text-xs text-white">
          {es ? 'Retratos' : 'Portraits'}
        </button>
        <button type="button" aria-pressed={voice} onClick={() => setVoice(value => !value)}
            className="flex items-center gap-1.5 rounded-full border border-white/25 bg-black/65 px-3 py-1.5 text-xs text-white">
            {voice ? <Volume2 size={14} /> : <VolumeX size={14} />}
            {es ? 'Voces de la escena' : 'Scene voices'}
          </button>
      </div>
      {needsPlay && <button type="button" className="mx-auto mt-1 block text-xs underline"
        onClick={() => void audio.current?.play().catch(() => setVoiceError(es ? 'No se pudo reproducir el audio.' : 'Could not play audio.'))}>
        {es ? 'Reproducir turno' : 'Play turn'}
      </button>}
      {voiceError && <p role="status" className="px-2 text-center text-xs text-white/75">{voiceError}</p>}
      {settingsOpen && (
        <div className="mt-2 max-h-[24dvh] space-y-2 overflow-y-auto rounded-xl border border-white/20 bg-neutral-950/95 p-2 text-xs text-white">
          {cast.map(person => (
            <fieldset key={person.id} disabled={!ready} className="min-w-0 space-y-1 rounded-lg border border-white/20 p-2">
              <legend className="px-1 font-semibold">{person.name}</legend>
              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-lg border border-white/25 px-2 py-1.5 focus-within:ring-2 focus-within:ring-white">
                  {settings[person.id]?.photo ? (es ? 'Cambiar referencia' : 'Replace reference') : (es ? 'Importar referencia' : 'Import reference')}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
                    aria-label={es ? `Importar referencia de ${person.name}` : `Import reference for ${person.name}`}
                    onChange={event => {
                      const file = event.currentTarget.files?.[0];
                      if (file) selectPhoto(person.id, file);
                      event.currentTarget.value = '';
                    }} />
                </label>
                {settings[person.id]?.photo && <button type="button" className="underline" onClick={() => changeSettings(person.id, { photo: undefined })}>
                  {es ? 'Quitar foto' : 'Remove photo'}
                </button>}
              </div>
            </fieldset>
          ))}
          {settingsError && <p role="alert" className="text-red-300">{settingsError}</p>}
        </div>
      )}
    </section>
  );
}
