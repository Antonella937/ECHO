import { useEffect, useRef, useState, type FormEvent, type UIEvent } from 'react';
import { useUser } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { Activity, CalendarDays, ChevronLeft, ChevronRight, Image, MessageCircle, Music2, Settings, StickyNote, Trash2 } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { CharacterPostGallery } from '@/components/characters/post-gallery';
import { useLanguage } from '@/lib/i18n';
import { compressImage, useMediaResolver } from '@/lib/media';
import { useSocial } from '@/store/social-store';

type Screen = 'home' | 'settings' | 'gallery' | 'music' | 'notes' | 'calendar' | 'pulse';
type Entry = { id: string; text: string; date?: string };
type Track = { id: string; title: string; artistName?: string | null; coverPath?: string | null; characterId: string; status: string; audioPath?: string | null };
type Phone = { pulseHidden?: boolean; wallpaper?: string; widgetPhoto?: string; notes?: Entry[]; events?: Entry[]; lastTrack?: Track };
type PulsePost = Entry & { characterId: string; parentId?: string; quoteId?: string };

function readLocal<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; }
  catch { return fallback; }
}

export default function CharacterPhonePage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const { character, universeId, me } = useSocial();
  const account = character(id);
  const back = useBack();
  if (!account || account.archived) return <TopBar title="Celular" onBack={back} />;
  return <PhoneView key={`${user?.id}:${universeId}:${account.id}`} account={account}
    ownerKey={`echo:phone:${user?.id ?? 'local'}:${universeId}`} universeId={universeId} isActive={me.id === account.id} />;
}

function PhoneView({ account, ownerKey, universeId, isActive }: {
  account: NonNullable<ReturnType<ReturnType<typeof useSocial>['character']>>;
  ownerKey: string;
  universeId: string;
  isActive: boolean;
}) {
  const { character, actions } = useSocial();
  const language = useLanguage();
  const es = language === 'es';
  const back = useBack();
  const resolve = useMediaResolver();
  const key = `${ownerKey}:${account.id}`;
  const pulseKey = `${ownerKey}:pulse`;
  const [phone, setPhone] = useState(() => readLocal<Phone>(key, {}));
  const [pulse, setPulse] = useState(() => readLocal<PulsePost[]>(pulseKey, []));
  const [screen, setScreen] = useState<Screen>('home');
  const [showPage, setShowPage] = useState(0);
  const pager = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [date, setDate] = useState('');
  const [response, setResponse] = useState<{ id: string; kind: 'reply' | 'quote' } | null>(null);
  const [galleryPhotos, setGalleryPhotos] = useState<{ id: string; mediaRef: string }[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [audio, setAudio] = useState<{ track: Track; url: string }>();
  const [loadingTrack, setLoadingTrack] = useState<string>();
  const trackRequest = useRef(0);
  const audioUrl = useRef<string | undefined>(undefined);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => {
    trackRequest.current++;
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
  }, []);
  useEffect(() => {
    if (screen !== 'settings') return;
    let active = true;
    const query = new URLSearchParams({ universeId, characterId: account.id });
    void customFetch<{ photos: { id: string; mediaRef: string }[] }>(`/api/character-gallery?${query}`, { responseType: 'json' })
      .then(result => { if (active) setGalleryPhotos(result.photos); })
      .catch(() => { if (active) setGalleryPhotos([]); });
    return () => { active = false; };
  }, [screen, account.id, universeId]);
  useEffect(() => {
    if (screen !== 'music') return;
    let active = true;
    const load = async () => {
      const [own, saved] = await Promise.all([
        customFetch<{ items: Track[] }>('/api/music/library', { responseType: 'json' }),
        customFetch<{ items: Track[] }>(`/api/music/library/character/${encodeURIComponent(account.id)}`, { responseType: 'json' }),
      ]);
      if (active) setTracks([...new Map([...saved.items, ...own.items.filter(item => item.characterId === account.id)]
        .filter(item => item.status === 'saved_audio' && item.audioPath).map(item => [item.id, item])).values()]);
    };
    void load().catch(() => { if (active) setError(es ? 'No se pudo cargar la biblioteca.' : 'Could not load the library.'); });
    return () => { active = false; };
  }, [screen, account.id, es]);

  function save(next: Phone) {
    try { localStorage.setItem(key, JSON.stringify(next)); setPhone(next); setError(''); }
    catch { setError(es ? 'No se pudo guardar en este navegador.' : 'Could not save in this browser.'); }
  }
  function open(next: Screen) {
    if (screen === 'music') {
      trackRequest.current++;
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = undefined;
      setAudio(undefined);
      setLoadingTrack(undefined);
    }
    setError('');
    setDraft('');
    setResponse(null);
    setScreen(next);
    if (next === 'home') setShowPage(0);
  }
  async function changeImage(field: 'wallpaper' | 'widgetPhoto', file?: File) {
    if (!file || uploadingImage) return;
    setUploadingImage(true);
    try { save({ ...phone, [field]: await compressImage(file, field === 'wallpaper' ? 900 : 520, 0.78) }); }
    catch { setError(es ? 'No se pudo abrir la imagen.' : 'Could not open the image.'); }
    finally { setUploadingImage(false); }
  }
  async function play(track: Track) {
    const request = ++trackRequest.current;
    setLoadingTrack(track.id);
    setError('');
    try {
      const blob = await customFetch<Blob>(`/api/music/library/${encodeURIComponent(track.id)}/audio`, { responseType: 'blob' });
      if (request !== trackRequest.current) return;
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(blob);
      setAudio({ track, url: audioUrl.current });
    } catch { if (request === trackRequest.current) setError(es ? 'No se pudo reproducir el tema.' : 'Could not play this track.'); }
    finally { if (request === trackRequest.current) setLoadingTrack(undefined); }
  }
  function publish(event: FormEvent) {
    event.preventDefault();
    const value = draft.trim();
    if (!value || (screen === 'calendar' && !date)) return;
    const item = { id: crypto.randomUUID(), text: value };
    if (screen === 'pulse') {
      const next = [{ ...item, characterId: account.id, date: new Date().toISOString(),
        ...(response?.kind === 'reply' ? { parentId: response.id } : {}),
        ...(response?.kind === 'quote' ? { quoteId: response.id } : {}),
      }, ...pulse];
      try { localStorage.setItem(pulseKey, JSON.stringify(next)); setPulse(next); }
      catch { setError(es ? 'No se pudo guardar el post.' : 'Could not save the post.'); return; }
      setResponse(null);
    } else if (screen === 'calendar') save({ ...phone, events: [...(phone.events ?? []), { ...item, date }] });
    else save({ ...phone, notes: [item, ...(phone.notes ?? [])] });
    setDraft('');
  }

  const timeZone = account.configuration?.routine?.timezone;
  const formatTime = (options: Intl.DateTimeFormatOptions) => {
    try { return new Intl.DateTimeFormat(language, { ...options, timeZone }).format(now); }
    catch { return new Intl.DateTimeFormat(language, options).format(now); }
  };
  const labels = {
    home: account.name, settings: es ? 'Personalizar' : 'Customize', gallery: es ? 'Carrete' : 'Camera roll',
    music: 'ECHO Music', notes: es ? 'Notas' : 'Notes', calendar: es ? 'Calendario' : 'Calendar', pulse: 'Pulse',
  };
  const appIcon = 'grid size-12 place-items-center rounded-2xl border border-white/15 bg-black/55 text-white shadow-sm backdrop-blur-md';
  const tile = (title: string, icon: React.ReactNode, action: Screen | { href: string }, dock = false) => {
    const contents = <><span className={appIcon}>{icon}</span>{!dock && <span className="text-xs">{title}</span>}</>;
    const className = 'flex min-w-0 flex-col items-center gap-1.5 text-center';
    return typeof action === 'string'
      ? <button type="button" className={className} aria-label={title} onClick={() => open(action)}>{contents}</button>
      : <Link href={action.href} className={className} aria-label={title}>{contents}</Link>;
  };
  const widgetImage = phone.widgetPhoto?.startsWith('data:') ? phone.widgetPhoto : phone.widgetPhoto ? resolve(phone.widgetPhoto) : '';
  const trackCover = phone.lastTrack?.coverPath ? resolve(phone.lastTrack.coverPath) : '';
  const fieldClass = 'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm';
  const primaryClass = 'rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50';

  if (screen === 'home') return (
    <main className="mx-auto max-w-md px-3 pb-28">
      <div className="relative isolate mt-3 overflow-hidden rounded-[2rem] border border-white/10 bg-[#15121a] text-white">
        {phone.wallpaper && <img src={phone.wallpaper} alt="" className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-55" />}
        <header className="flex items-center justify-between gap-2 px-3 pt-2">
          <button type="button" onClick={back} aria-label={es ? 'Volver' : 'Back'} className="grid size-11 place-items-center rounded-full bg-black/35"><ChevronLeft size={20} /></button>
          <span className="truncate text-sm font-medium">{account.name}</span>
          <button type="button" onClick={() => open('settings')} aria-label={labels.settings} className="grid size-11 place-items-center rounded-full bg-black/35"><Settings size={18} /></button>
        </header>
        <div ref={pager} onScroll={(event: UIEvent<HTMLDivElement>) => {
          const node = event.currentTarget;
          setShowPage(Math.round(node.scrollLeft / node.clientWidth));
        }} className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]">
          <section aria-label={es ? 'Inicio' : 'Home'} className="min-h-[390px] w-full shrink-0 snap-start px-5 py-6">
            <time className="block font-display text-6xl tabular-nums">{formatTime({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}</time>
            <p className="mt-1 text-sm text-white/75">{formatTime({ weekday: 'long', day: 'numeric', month: 'long' })}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => open(phone.widgetPhoto ? 'gallery' : 'settings')} className="relative grid aspect-square place-items-center overflow-hidden rounded-2xl border border-white/15 bg-black/40" aria-label={phone.widgetPhoto ? labels.gallery : es ? 'Elegir foto del widget' : 'Choose widget photo'}>
                {phone.widgetPhoto ? <img src={widgetImage || undefined} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <Image size={23} />}
              </button>
              <button type="button" onClick={() => open('music')} className="flex min-w-0 flex-col justify-between rounded-2xl border border-white/15 bg-black/45 p-3 text-left backdrop-blur-md">
                {trackCover ? <img src={trackCover} alt="" className="size-10 rounded-lg object-cover" /> : <Music2 size={20} className="text-primary" />}
                <span className="mt-2 block min-w-0"><span className="block truncate text-sm font-semibold">{phone.lastTrack?.title ?? 'ECHO Music'}</span>
                <span className="block truncate text-xs text-white/70">{phone.lastTrack ? (es ? 'Último tema' : 'Last played') : (es ? 'Biblioteca' : 'Library')}</span></span>
              </button>
            </div>
          </section>
          <section aria-label={es ? 'Aplicaciones' : 'Apps'} className="w-full shrink-0 snap-start px-5 py-7">
            <div className="grid grid-cols-3 gap-y-6">
              {!phone.pulseHidden && tile('Pulse', <Activity size={21} />, 'pulse')}
              {tile(labels.notes, <StickyNote size={20} />, 'notes')}
              {tile(labels.calendar, <CalendarDays size={20} />, 'calendar')}
              {tile(labels.settings, <Settings size={20} />, 'settings')}
            </div>
          </section>
        </div>
        <nav className="flex justify-center gap-1" aria-label={es ? 'Pantallas del celular' : 'Phone pages'}>
          {[0, 1].map(index => <button key={index} type="button" aria-current={showPage === index ? 'page' : undefined} aria-label={es ? `Pantalla ${index + 1}` : `Page ${index + 1}`} className="grid size-9 place-items-center" onClick={() => pager.current?.scrollTo({ left: index * (pager.current?.clientWidth ?? 0), behavior: 'smooth' })}><span className={`size-1.5 rounded-full ${showPage === index ? 'bg-primary' : 'bg-white/45'}`} /></button>)}
        </nav>
        <div className="mx-4 mb-4 grid grid-cols-4 gap-2 rounded-3xl border border-white/15 bg-white/10 p-2 backdrop-blur-xl">
          {tile(es ? 'Mensajes' : 'Messages', <MessageCircle size={20} />, { href: isActive ? '/messages' : `/messages/${encodeURIComponent(account.id)}` }, true)}
          {tile('ECHO', <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="size-7 object-contain" />, { href: `/profile/${encodeURIComponent(account.id)}` }, true)}
          {tile(labels.gallery, <Image size={21} />, 'gallery', true)}
          {tile(labels.music, <Music2 size={20} />, 'music', true)}
        </div>
      </div>
    </main>
  );

  const pulseTarget = response ? pulse.find(item => item.id === response.id) : undefined;
  const entries = screen === 'calendar' ? [...(phone.events ?? [])].sort((first, second) => (first.date ?? '').localeCompare(second.date ?? '')) : phone.notes ?? [];
  return <main className="mx-auto max-w-lg px-4 pb-28">
    <TopBar title={labels[screen]} sub={account.name} onBack={() => open('home')} />
    {error && <p role="alert" className="my-3 text-sm text-destructive">{error}</p>}
    {screen === 'settings' && <div className="mt-4 space-y-4">
      <label className="flex items-center justify-between gap-3 rounded-2xl border border-border p-4 text-sm">
        <span>{es ? 'Mostrar Pulse' : 'Show Pulse'}</span>
        <input type="checkbox" checked={!phone.pulseHidden} disabled={uploadingImage} onChange={event => save({ ...phone, pulseHidden: !event.target.checked })} />
      </label>
      {(['wallpaper', 'widgetPhoto'] as const).map(field => <div key={field} className="space-y-2 rounded-2xl border border-border p-4">
        <label className="block text-sm font-semibold">{field === 'wallpaper' ? (es ? 'Fondo del celular' : 'Wallpaper') : (es ? 'Foto del widget' : 'Widget photo')}
          <input type="file" accept="image/*" disabled={uploadingImage} className="mt-2 block w-full text-xs" onChange={event => void changeImage(field, event.currentTarget.files?.[0])} />
        </label>
        {field === 'widgetPhoto' && galleryPhotos.length > 0 && <div className="grid grid-cols-4 gap-2">
          {galleryPhotos.map(photo => <button key={photo.id} type="button" disabled={uploadingImage} aria-pressed={phone.widgetPhoto === photo.mediaRef}
            aria-label={es ? 'Usar foto del carrete' : 'Use camera roll photo'} onClick={() => save({ ...phone, widgetPhoto: photo.mediaRef })}
            className="aspect-square overflow-hidden rounded-lg border border-border bg-secondary aria-pressed:border-primary">
            <img src={resolve(photo.mediaRef) || undefined} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>)}
        </div>}
        {phone[field] && <button type="button" disabled={uploadingImage} className="text-sm text-primary" onClick={() => save({ ...phone, [field]: undefined })}>{es ? 'Quitar imagen' : 'Remove image'}</button>}
      </div>)}
    </div>}
    {screen === 'gallery' && <>
      {!isActive && <button type="button" className={`mt-4 ${primaryClass}`} onClick={() => actions.switchIdentity(account.id)}>
        {es ? `Activar @${account.handle} para publicar` : `Switch to @${account.handle} to publish`}
      </button>}
      <CharacterPostGallery characterId={account.id} universeId={universeId} accountType={account.accountType} publishFromGallery={isActive} />
    </>}
    {screen === 'music' && <section className="mt-4 space-y-3">
      {audio && <div className="space-y-2 rounded-2xl border border-border p-3">
        <p className="text-sm font-semibold">{audio.track.title}</p>
        <audio key={audio.url} src={audio.url} controls autoPlay className="w-full" onPlay={() => save({ ...phone, lastTrack: audio.track })} />
      </div>}
      {tracks.map(track => <button key={track.id} type="button" disabled={Boolean(loadingTrack)} onClick={() => void play(track)} className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2 text-left text-sm">
        <Music2 size={17} className="shrink-0 text-primary" /><span className="flex-1 truncate">{track.title}</span><ChevronRight size={16} />
      </button>)}
      {isActive && <Link href="/music" className="inline-block text-sm text-primary">{es ? 'Abrir ECHO Music' : 'Open ECHO Music'}</Link>}
    </section>}
    {(screen === 'notes' || screen === 'calendar' || screen === 'pulse') && <section className="mt-4 space-y-3">
      <form onSubmit={publish} className="space-y-2 rounded-2xl border border-border p-3">
        {pulseTarget && <div className="flex justify-between gap-2 text-xs text-muted-foreground">
          <span className="truncate">{response?.kind === 'reply' ? (es ? 'En respuesta a' : 'Replying to') : (es ? 'Citando' : 'Quoting')} @{character(pulseTarget.characterId)?.handle}</span>
          <button type="button" onClick={() => setResponse(null)}>{es ? 'Cancelar' : 'Cancel'}</button>
        </div>}
        {screen === 'calendar' && <input type="date" required aria-label={es ? 'Fecha' : 'Date'} value={date} onChange={event => setDate(event.target.value)} className={fieldClass} />}
        <textarea rows={3} required aria-label={labels[screen]} placeholder={screen === 'pulse' ? (es ? `Escribir como @${account.handle}` : `Post as @${account.handle}`) : undefined} maxLength={screen === 'pulse' ? 280 : 500} value={draft} onChange={event => setDraft(event.target.value)} className={fieldClass} />
        <button className={primaryClass} disabled={!draft.trim()}>{screen === 'pulse' ? (es ? 'Publicar' : 'Post') : (es ? 'Guardar' : 'Save')}</button>
      </form>
      {screen === 'pulse' ? pulse.filter(item => character(item.characterId) && !character(item.characterId)?.archived).map(item => {
        const author = character(item.characterId);
        const target = pulse.find(post => post.id === (item.parentId ?? item.quoteId));
        return <article key={item.id} className="space-y-2 rounded-2xl border border-border p-3 text-sm">
          <p className="font-semibold">{author?.name} <span className="font-normal text-muted-foreground">@{author?.handle}</span></p>
          {item.parentId && target && <p className="text-xs text-muted-foreground">{es ? 'En respuesta a' : 'Replying to'} @{character(target.characterId)?.handle}</p>}
          <p className="whitespace-pre-wrap break-words">{item.text}</p>
          {item.quoteId && target && <blockquote className="break-words rounded-xl border border-border p-2 text-xs">@{character(target.characterId)?.handle} · {target.text}</blockquote>}
          <div className="flex gap-4 text-xs text-primary">
            <button type="button" onClick={() => setResponse({ id: item.id, kind: 'reply' })}>{es ? 'Responder' : 'Reply'}</button>
            <button type="button" onClick={() => setResponse({ id: item.id, kind: 'quote' })}>{es ? 'Citar' : 'Quote'}</button>
          </div>
        </article>;
      }) : entries.map(item => <article key={item.id} className="flex items-start gap-3 rounded-2xl border border-border p-3 text-sm">
        <div className="min-w-0 flex-1">
          {item.date && <time dateTime={item.date} className="text-xs text-muted-foreground">{item.date}</time>}
          <p className="whitespace-pre-wrap break-words">{item.text}</p>
        </div>
        <button type="button" aria-label={es ? 'Eliminar' : 'Delete'} onClick={() => save({ ...phone, [screen === 'calendar' ? 'events' : 'notes']: entries.filter(entry => entry.id !== item.id) })}><Trash2 size={17} /></button>
      </article>)}
    </section>}
  </main>;
}
