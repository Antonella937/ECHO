import { customFetch } from '@workspace/api-client-react';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { MicOff, PhoneOff, Send, Volume2 } from 'lucide-react';
import type { Message } from '@/domain/types';
import { useMediaResolver } from '@/lib/media';
import { readCallLooks, writeCallLooks } from '@/store/persistence';

type Participant = { id: string; name: string; avatar: string };

interface VideoCallProps {
  storageScope: string;
  universeId: string;
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

export function DmVideoCall({ storageScope, universeId, me, peer, messages, onSend, onClose }: VideoCallProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const seen = useRef(new Set(messages.map(message => message.id)));
  const player = useRef<HTMLAudioElement>(null);
  const voiceRun = useRef(new AbortController());
  const queue = useRef(Promise.resolve());
  const [mouthOpen, setMouthOpen] = useState(false);
  const [blink, setBlink] = useState(false);
  const [preparedAudio, setPreparedAudio] = useState<{ text: string; senderId: string }>();
  const [latest, setLatest] = useState<Message>();
  const [replies, setReplies] = useState(() => messages.filter(message => message.senderId === peer.id && message.text.trim()).slice(-1));
  const [copyStatus, setCopyStatus] = useState<{ id: string; copied: boolean }>();
  const [dialogue, setDialogue] = useState('');
  const [speaker, setSpeaker] = useState<string>();
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState('');
  const [looksOpen, setLooksOpen] = useState(false);
  const [lookUrls, setLookUrls] = useState<Record<string, string>>({});
  const lookUrlsRef = useRef<Record<string, string>>({});
  const savedFiles = useRef<Record<string, File>>({});
  const [looksReady, setLooksReady] = useState(false);
  const [lookError, setLookError] = useState('');
  const audioAvailable = true;
  const replayTurn = messages.filter(message => message.text.trim() &&
    (message.senderId === me.id || message.senderId === peer.id)).at(-1);
  const latestAudioReady = !!replayTurn && preparedAudio?.senderId === replayTurn.senderId &&
    preparedAudio.text === replayTurn.text;

  function replayLatestTurn() {
    if (!replayTurn) return;
    if (latestAudioReady) {
      void player.current?.play().catch(() => setError('No se pudo reproducir el audio.'));
      return;
    }
    stopSpeaking();
    speak(replayTurn.text, replayTurn.senderId);
  }

  useEffect(() => {
    let end: number;
    const timer = window.setInterval(() => {
      setBlink(true);
      end = window.setTimeout(() => setBlink(false), 130);
    }, 4200);
    return () => { window.clearInterval(timer); window.clearTimeout(end); };
  }, []);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const resize = () => {
      composer.style.height = 'auto';
      if (composer.value) composer.style.height = `${composer.scrollHeight}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [dialogue]);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    const viewport = window.visualViewport;
    const fit = () => {
      if (!viewport || !dialog) return;
      dialog.style.setProperty('--echo-call-height', `${viewport.height}px`);
      dialog.style.top = `${viewport.offsetTop}px`;
    };
    fit();
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    return () => {
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      dialog?.close();
    };
  }, []);

  useEffect(() => {
    const newTurns = messages.filter(message => !seen.current.has(message.id) && message.text.trim());
    messages.forEach(message => seen.current.add(message.id));
    const lastTurn = newTurns.at(-1);
    if (lastTurn) setLatest(lastTurn);
    const incoming = newTurns.filter(message => message.senderId === peer.id);
    if (incoming.length) setReplies(previous => [...previous, ...incoming]);
  }, [messages, peer.id]);

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
    voiceRun.current.abort();
    voiceRun.current = new AbortController();
    queue.current = Promise.resolve();
    setSpeaker(undefined);
    setMouthOpen(false);
    setPreparedAudio(undefined);
  }

  function speak(text: string, senderId: string) {
    if (muted) return;
    const spoken = text.replace(/\*{1,3}[^*]+\*{1,3}/g, '').trim();
    if (!spoken) return;
    if (spoken.length > 500) {
      setError('Este turno supera el límite de 500 caracteres para la voz.');
      return;
    }
    const signal = voiceRun.current.signal;
    queue.current = queue.current.then(async () => {
      const audio = player.current;
      if (!audio || signal.aborted) return;
      setError('');
      let url: string | undefined;
      let frame = 0;
      try {
        const blob = await customFetch<Blob>('/api/voices/call/synthesize', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ universeId, characterId: senderId, text: spoken }),
          responseType: 'blob', signal,
        });
        if (signal.aborted) return;
        let samples: Float32Array | undefined;
        let rate = 0;
        try {
          const context = new OfflineAudioContext(1, 1, 16000);
          const decoded = await context.decodeAudioData(await blob.arrayBuffer());
          samples = decoded.getChannelData(0);
          rate = decoded.sampleRate;
        } catch { /* Audio playback can still proceed if analysis is unavailable. */ }
        if (signal.aborted) return;
        url = URL.createObjectURL(blob);
        audio.src = url;
        await new Promise<void>(resolve => {
          const finish = () => {
            signal.removeEventListener('abort', finish);
            audio.onplaying = audio.onended = audio.onerror = null;
            audio.pause();
            audio.removeAttribute('src');
            resolve();
          };
          const animate = () => {
            const cursor = Math.floor(audio.currentTime * rate);
            let energy = 0;
            if (samples && !audio.paused) {
              for (let n = 0; n < 24; n++) energy += (samples[cursor + n * 16] ?? 0) ** 2;
            }
            setMouthOpen(energy / 24 > 0.001);
            frame = requestAnimationFrame(animate);
          };
          audio.onplaying = () => {
            setPreparedAudio(undefined);
            setSpeaker(senderId);
            cancelAnimationFrame(frame);
            animate();
          };
          audio.onended = finish;
          audio.onerror = () => { setError('No se pudo reproducir la voz de ECHO.'); finish(); };
          signal.addEventListener('abort', finish, { once: true });
          void audio.play().catch(() => { if (!signal.aborted) setPreparedAudio({ text, senderId }); });
        });
      } catch (cause) {
        if (!signal.aborted) {
          const status = (cause as { status?: number }).status;
          if (status === 409) setError('Asignale una voz a este personaje en su ficha de ECHO.');
          else if (status === 402) setError('No quedan créditos de voz para este turno.');
          else setError('No se pudo generar la voz de ECHO para este turno.');
        }
      } finally {
        cancelAnimationFrame(frame);
        if (url) URL.revokeObjectURL(url);
        if (!signal.aborted) { setSpeaker(undefined); setMouthOpen(false); setPreparedAudio(undefined); }
      }
    });
  }

  useEffect(() => {
    if (latest?.senderId === peer.id) speak(latest.text, peer.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest?.id]);

  useEffect(() => {
    voiceRun.current = new AbortController();
    return () => voiceRun.current.abort();
  }, []);

  useEffect(() => {
    for (const [key, url] of Object.entries(lookUrls)) {
      if (!key.includes(':') || !url) continue;
      const image = new Image();
      image.src = url;
    }
  }, [lookUrls]);

  useEffect(() => () => {
    Object.values(lookUrlsRef.current).forEach(url => URL.revokeObjectURL(url));
  }, []);

  function renderParticipant(person: Participant) {
    const idle = lookUrls[person.id + ':idle'];
    const talking = lookUrls[person.id + ':talk'];
    if (idle && talking) {
      const active = speaker === person.id && mouthOpen;
      const frame = blink ? lookUrls[person.id + (active ? ':talk-blink' : ':blink')] : undefined;
      return <CallPortrait person={{ ...person, avatar: frame || (active ? talking : idle) }} />;
    }
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
    const isVideo = file && !id.includes(':') && ['video/mp4', 'video/quicktime'].includes(file.type);
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
      className="fixed inset-0 m-0 h-[var(--echo-call-height,100dvh)] max-h-none w-full max-w-none overflow-hidden border-0 bg-neutral-950 p-0 text-white">
      <audio ref={player} />
      <div className="relative isolate flex h-full min-h-0 flex-col gap-2 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-[max(12px,env(safe-area-inset-top))]">
        <div className="absolute inset-0 -z-10 bg-neutral-950">
          {renderParticipant(peer)}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/65" />
        </div>
        <header className="flex shrink-0 items-center justify-between gap-2">
          <h2 className="min-w-0 truncate rounded-full bg-black/45 px-4 py-2 text-sm font-semibold backdrop-blur-md">{peer.name}</h2>
          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-black/40 p-1 backdrop-blur-md">
            <button type="button" aria-expanded={looksOpen} onClick={() => setLooksOpen(open => !open)}
              className="min-h-10 rounded-full px-3 text-xs font-medium">Looks</button>
            {audioAvailable && (
              <button type="button" aria-label={muted ? 'Activar voces de ECHO' : 'Silenciar voces'} title={muted ? 'Activar voces de ECHO (usa créditos)' : 'Silenciar voces'} aria-pressed={muted}
                className={`grid size-10 place-items-center rounded-full ${muted ? 'bg-white text-black' : 'bg-white/10'}`}
                onClick={() => { if (!muted) stopSpeaking(); setMuted(!muted); }}>
                {muted ? <MicOff size={18} /> : <Volume2 size={18} />}
              </button>
            )}
            <button type="button" aria-label="Colgar" onClick={onClose}
              className="grid size-11 place-items-center rounded-full bg-red-700">
              <PhoneOff size={19} />
            </button>
          </div>
        </header>
        {looksOpen && (
          <section aria-label="Looks de la llamada" className="max-h-[33dvh] shrink-0 overflow-y-auto rounded-xl bg-black/60 p-3 text-xs backdrop-blur-md">
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
                  {([['idle', 'Boca cerrada'], ['talk', 'Boca abierta'], ['blink', 'Cerrada, ojos cerrados'], ['talk-blink', 'Abierta, ojos cerrados']] as const).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-1">
                      <label className="min-w-0 flex-1 cursor-pointer rounded-lg border border-white/25 p-2">
                        {label}{lookUrls[person.id + ':' + key] && ' ✓'}
                        <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={event => {
                          const file = event.currentTarget.files?.[0];
                          if (file) changeLook(person.id + ':' + key, file);
                          event.currentTarget.value = '';
                        }} />
                      </label>
                      {lookUrls[person.id + ':' + key] && <button type="button" aria-label={`Quitar ${label} de ${person.name}`}
                        onClick={() => changeLook(person.id + ':' + key)}>×</button>}
                    </div>
                  ))}
                </fieldset>
              ))}
            </div>
            <p className="mt-3 text-white/75">Cargá boca cerrada y abierta y activá el parlante para animar el retrato con la voz de ECHO. Generar voz usa créditos.</p>
            {lookError && <p role="alert" className="mt-2 text-red-300">{lookError}</p>}
          </section>
        )}
        {!looksOpen && lookError && <p role="alert" className="text-xs text-red-300">{lookError}</p>}
        <div className="relative min-h-0 flex-1">
          <div className={`absolute bottom-1 right-1 aspect-[3/4] w-[24%] max-w-28 max-h-full overflow-hidden rounded-2xl border-2 bg-neutral-800 shadow-lg ${speaker === me.id ? 'border-white' : 'border-white/30'}`}>
            {renderParticipant(me)}
            <span className="absolute inset-x-0 bottom-0 truncate bg-black/65 px-2 py-1 text-xs">{me.name}</span>
          </div>
        </div>
        {replies.length > 0 && (
          <section aria-label={`Respuestas de ${peer.name}`} className="max-h-[min(24dvh,10rem)] shrink-0 space-y-3 overflow-y-auto rounded-2xl bg-black/55 px-3 py-2 text-sm backdrop-blur-md">
            {[...replies].reverse().map(reply => (
              <article key={reply.id} className="select-text">
                <div className="flex items-center justify-between gap-2">
                  <strong>{peer.name}</strong>
                  <button type="button" className="rounded-lg bg-white/15 px-3 py-2 text-xs"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(reply.text);
                        setCopyStatus({ id: reply.id, copied: true });
                      } catch {
                        setCopyStatus({ id: reply.id, copied: false });
                      }
                    }}>
                    {copyStatus?.id === reply.id && copyStatus.copied ? 'Copiado' : 'Copiar respuesta'}
                  </button>
                </div>
                <p className="whitespace-pre-wrap break-words">{reply.text}</p>
                {copyStatus?.id === reply.id && !copyStatus.copied && (
                  <p role="status" className="text-xs text-white/80">Mantené presionado el texto para copiarlo.</p>
                )}
              </article>
            ))}
          </section>
        )}
        {replayTurn && !muted && (
          <button type="button" disabled={!!speaker} onClick={replayLatestTurn}
            className="shrink-0 self-start rounded-lg bg-white/10 px-3 py-1 text-xs disabled:opacity-40">
            Escuchar último mensaje · {replayTurn.senderId === me.id ? me.name : peer.name}
          </button>
        )}
        {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
        <form onSubmit={submit} className="flex shrink-0 items-end gap-2 rounded-[28px] border border-white/25 bg-black/30 p-1.5 shadow-lg backdrop-blur-md focus-within:border-white/45">
          <textarea ref={composerRef} rows={1} aria-label={`Escribir como ${me.name}`} placeholder={`Escribí como ${me.name}…`}
            value={dialogue} onChange={event => setDialogue(event.target.value)} maxLength={10000}
            className="box-border max-h-[max(44px,min(144px,calc(var(--echo-call-height,100dvh)/4)))] min-h-11 min-w-0 flex-1 resize-none overflow-y-auto overscroll-contain rounded-3xl bg-transparent px-3 py-2.5 text-base leading-6 outline-none placeholder:text-white/75" />
          <button type="submit" aria-label="Enviar diálogo" disabled={!dialogue.trim()}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-black disabled:opacity-40">
            <Send size={18} />
          </button>
        </form>
      </div>
    </dialog>
  );
}
