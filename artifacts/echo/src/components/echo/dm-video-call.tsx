import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MicOff, PhoneOff, Send, Volume2 } from 'lucide-react';
import type { Message } from '@/domain/types';
import { useMediaResolver } from '@/lib/media';
import { readCallLooks, writeCallLooks } from '@/store/persistence';

type Participant = { id: string; name: string; avatar: string };

interface VideoCallProps {
  storageScope: string;
  me: Participant;
  peer: Participant;
  messages: Message[];
  onSend: (dialogue: string) => void;
  onClose: () => void;
}

function CallPortrait({ person }: { person: Participant }) {
  const resolveMedia = useMediaResolver();
  const src = person.avatar.startsWith('blob:') ? person.avatar : person.avatar ? resolveMedia(person.avatar) : '';
  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden bg-neutral-800 text-3xl text-white/60">
      <span aria-hidden="true">{person.name.slice(0, 1)}</span>
      {src && (
        <img key={src} src={src} alt="" onError={event => { event.currentTarget.hidden = true; }}
          className="absolute inset-0 h-full w-full object-cover object-center" />
      )}
    </div>
  );
}

export function DmVideoCall({ storageScope, me, peer, messages, onSend, onClose }: VideoCallProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const seen = useRef(new Set(messages.map(message => message.id)));
  const utterances = useRef(new Set<SpeechSynthesisUtterance>());
  const [latest, setLatest] = useState<Message>();
  const [dialogue, setDialogue] = useState('');
  const [speaker, setSpeaker] = useState<string>();
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [looksOpen, setLooksOpen] = useState(false);
  const [lookUrls, setLookUrls] = useState<Record<string, string>>({});
  const lookUrlsRef = useRef<Record<string, string>>({});
  const savedFiles = useRef<Record<string, File>>({});
  const [looksReady, setLooksReady] = useState(false);
  const [lookError, setLookError] = useState('');
  const [language, setLanguage] = useState('en');
  const audioAvailable = typeof window.speechSynthesis?.speak === 'function' && typeof SpeechSynthesisUtterance === 'function';

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    const newTurns = messages.filter(message => !seen.current.has(message.id) && message.text.trim());
    messages.forEach(message => seen.current.add(message.id));
    const lastTurn = newTurns.at(-1);
    if (lastTurn) setLatest(lastTurn);
  }, [messages]);

  useEffect(() => {
    let active = true;
    void readCallLooks<{ files: Record<string, File> }>(storageScope)
      .then(saved => {
        if (!active || !saved) return;
        savedFiles.current = saved.files;
        const urls = Object.fromEntries(Object.entries(saved.files).map(([id, file]) => [id, URL.createObjectURL(file)]));
        lookUrlsRef.current = urls;
        setLookUrls(urls);
      })
      .catch(() => { if (active) setLookError('No se pudieron cargar los looks guardados.'); })
      .finally(() => { if (active) setLooksReady(true); });
    return () => { active = false; };
  }, [storageScope]);

  function saveLooks() {
    void writeCallLooks(storageScope, { files: { ...savedFiles.current } })
      .catch(() => setLookError('No se pudo guardar el look en este iPhone.'));
  }

  function stopSpeaking() {
    if (utterances.current.size) {
      utterances.current.clear();
      window.speechSynthesis.cancel();
    }
    setSpeaker(undefined);
  }

  function speak(text: string, senderId: string) {
    if (!audioAvailable || muted) return;
    const spoken = text.replace(/\*{1,3}[^*]+\*{1,3}/g, '').trim();
    if (!spoken) return;
    const audio = new SpeechSynthesisUtterance(spoken);
    audio.lang = language;
    const voices = window.speechSynthesis.getVoices().filter(voice => voice.lang.split('-')[0] === language);
    const voice = voices[senderId === me.id ? Math.min(1, voices.length - 1) : 0];
    if (voice) audio.voice = voice;
    audio.onstart = () => {
      if (utterances.current.has(audio)) setSpeaker(senderId);
    };
    audio.onend = audio.onerror = () => {
      if (utterances.current.delete(audio)) setSpeaker(undefined);
    };
    utterances.current.add(audio);
    window.speechSynthesis.speak(audio);
  }

  useEffect(() => {
    if (latest?.senderId === peer.id) speak(latest.text, peer.id);
    // A newly received message triggers speech once. Voice controls apply to subsequent turns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id]);

  useEffect(() => () => {
    if (utterances.current.size) {
      utterances.current.clear();
      window.speechSynthesis.cancel();
    }
  }, []);

  useEffect(() => () => {
    Object.values(lookUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
  }, []);

  function renderParticipant(person: Participant) {
    const source = lookUrls[person.id];
    if (source && savedFiles.current[person.id]?.type.startsWith('video/')) {
      return <>
        <CallPortrait person={person} />
        <video key={source} src={source} autoPlay loop muted playsInline aria-label={`Clip de ${person.name}`}
          className="absolute inset-0 h-full w-full object-cover"
          onError={event => {
            event.currentTarget.hidden = true;
            setLookError('No se pudo reproducir el clip. Probá con un MP4 o MOV compatible con tu iPhone.');
          }} />
      </>;
    }
    return <CallPortrait person={{ ...person, avatar: source || person.avatar }} />;
  }

  function changeLook(id: string, file?: File) {
    const isVideo = file && ['video/mp4', 'video/quicktime'].includes(file.type);
    const isPhoto = file && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
    if (file && ((!isVideo && !isPhoto) || file.size > (isVideo ? 50_000_000 : 10_000_000))) {
      setLookError('Elegí una foto JPG, PNG o WebP de hasta 10 MB, o un clip MP4 o MOV de hasta 50 MB.');
      return;
    }
    const previous = lookUrlsRef.current[id];
    if (previous) URL.revokeObjectURL(previous);
    const url = file ? URL.createObjectURL(file) : '';
    lookUrlsRef.current = { ...lookUrlsRef.current, [id]: url };
    setLookUrls(lookUrlsRef.current);
    if (file) savedFiles.current[id] = file;
    else delete savedFiles.current[id];
    setLookError('');
    saveLooks();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = dialogue.trim();
    if (!text) return;
    try {
      onSend(text);
      setDialogue('');
      setError('');
      speak(text, me.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el mensaje.');
    }
  }

  return (
    <dialog ref={dialogRef} aria-label={`Videollamada con ${peer.name}`}
      onCancel={event => { event.preventDefault(); onClose(); }}
      className="m-auto h-dvh max-h-dvh w-full max-w-lg overflow-hidden bg-neutral-950 p-0 text-white backdrop:bg-black/80 sm:h-[min(54rem,96dvh)] sm:rounded-3xl">
      <div className="flex h-full min-h-0 flex-col gap-3 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))]">
        <header className="flex shrink-0 items-center justify-between gap-2 px-1">
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{peer.name}</h2>
            <p className="text-xs text-white/65">Videollamada simulada</p>
          </div>
          <button type="button" aria-expanded={looksOpen} onClick={() => setLooksOpen(open => !open)}
            className="shrink-0 rounded-lg bg-neutral-800 px-2 py-2 text-xs">Looks</button>
          {audioAvailable && (
            <>
              <select aria-label="Idioma de las voces" value={language} onChange={event => setLanguage(event.target.value)}
                className="ml-auto rounded-lg bg-neutral-800 p-2 text-xs">
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
              <button type="button" aria-label={muted ? 'Activar voces' : 'Silenciar voces'} aria-pressed={muted}
                className="grid size-10 shrink-0 place-items-center rounded-full bg-neutral-800"
                onClick={() => { if (!muted) stopSpeaking(); setMuted(!muted); }}>
                {muted ? <MicOff size={18} /> : <Volume2 size={18} />}
              </button>
            </>
          )}
          <button type="button" aria-label="Colgar" onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-red-700">
            <PhoneOff size={19} />
          </button>
        </header>
        {looksOpen && (
          <section aria-label="Looks de la llamada" className="max-h-[33dvh] shrink-0 overflow-y-auto rounded-xl bg-white/10 p-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              {[me, peer].map(person => (
                <fieldset key={person.id} disabled={!looksReady} className="min-w-0 space-y-2">
                  <legend className="mb-1 max-w-full truncate font-semibold">{person.name}</legend>
                  <label className="block cursor-pointer rounded-lg border border-white/25 p-2 focus-within:ring-2 focus-within:ring-white">
                    {lookUrls[person.id] ? 'Cambiar foto o clip' : 'Elegir foto o clip'}
                    <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" className="sr-only"
                      aria-label={`Elegir foto o clip de ${person.name}`}
                      onChange={event => {
                        const file = event.currentTarget.files?.[0];
                        if (file) changeLook(person.id, file);
                        event.currentTarget.value = '';
                      }} />
                  </label>
                  {lookUrls[person.id] && <button type="button" className="px-2 py-1 underline"
                    onClick={() => changeLook(person.id)}>Usar foto de perfil</button>}
                </fieldset>
              ))}
            </div>
            {lookError && <p role="alert" className="mt-2 text-red-300">{lookError}</p>}
          </section>
        )}
        {!looksOpen && lookError && <p role="alert" className="text-xs text-red-300">{lookError}</p>}
        <div className={`relative min-h-24 flex-1 overflow-hidden rounded-3xl border-2 bg-gradient-to-b from-neutral-700 to-neutral-900 ${speaker === peer.id ? 'border-white/90' : 'border-white/10'}`}>
          {renderParticipant(peer)}
          <div className={`absolute bottom-3 right-3 aspect-[3/4] w-1/4 max-w-28 overflow-hidden rounded-2xl border-2 bg-neutral-800 shadow-lg ${speaker === me.id ? 'border-white' : 'border-white/30'}`}>
            {renderParticipant(me)}
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-2 py-1 text-xs">{me.name}</span>
          </div>
        </div>
        <div aria-live="polite" aria-label="Diálogo de la llamada" className="max-h-[22dvh] shrink-0 overflow-y-auto rounded-xl bg-white/10 px-3 py-2 text-sm">
          {latest ? (
            <p key={latest.id} className="whitespace-pre-wrap break-words"><strong>{latest.senderId === me.id ? me.name : peer.name}</strong> {latest.text}</p>
          ) : (
            <p className="text-white/65">Escribí para empezar la llamada.</p>
          )}
        </div>
        {latest && audioAvailable && !muted && (
          <button type="button" disabled={!!speaker} onClick={() => { stopSpeaking(); speak(latest.text, latest.senderId); }}
            className="shrink-0 self-start rounded-lg bg-white/10 px-3 py-1 text-xs disabled:opacity-40">
            Escuchar último mensaje
          </button>
        )}
        {!audioAvailable && <p className="text-xs text-white/70">Las voces no están disponibles en este navegador.</p>}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <form onSubmit={submit} className="flex shrink-0 items-end gap-2">
          <textarea rows={2} aria-label={`Escribir como ${me.name}`} placeholder={`Escribí como ${me.name}…`}
            value={dialogue} onChange={event => setDialogue(event.target.value)} maxLength={10000}
            className="min-w-0 flex-1 resize-none rounded-xl bg-neutral-800 p-3 text-base placeholder:text-white/65" />
          <button type="submit" aria-label="Enviar diálogo" disabled={!dialogue.trim()}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-black disabled:opacity-40">
            <Send size={18} />
          </button>
        </form>
      </div>
    </dialog>
  );
}
