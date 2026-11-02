import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { ChevronLeft, ChevronRight, ImagePlus, MapPin, Plus, RefreshCw, X } from 'lucide-react';
import { MAX_POST_MEDIA, validatePostMedia } from '@/domain/post-media';
import type { PostMedia } from '@/domain/types';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { CharacterAvatar } from '@/components/echo/avatar';
import { Switch } from '@/components/ui/switch';
import { compressImage, resolveMedia, uploadPrivateImage } from '@/lib/media';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type Mode = 'post' | 'story';

export default function CreatePage() {
  const search = useSearch();
  const initialMode: Mode = new URLSearchParams(search).get('mode') === 'story' ? 'story' : 'post';
  const { me, actions } = useSocial();
  const [, navigate] = useLocation();
  const back = useBack();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [items, setItems] = useState<PostMedia[]>([]);
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [alsoStory, setAlsoStory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** null = append, number = replace that index */
  const replaceAt = useRef<number | null>(null);
  const image = items[0]?.url ?? null;
  const tooManyForStory = mode === 'story' && items.length > 1;

  const pick = (replace: number | null) => {
    if (busy) return;
    replaceAt.current = replace;
    if (fileRef.current) {
      fileRef.current.multiple = replace === null && mode === 'post';
      fileRef.current.click();
    }
  };

  const onFiles = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length || busy) return;
    const replace = replaceAt.current;
    setError(null);
    if (replace === null) {
      const limit = mode === 'story' ? 1 - items.length : MAX_POST_MEDIA - items.length;
      if (mode === 'story' && items.length) {
        // story: single photo, picking again replaces
      } else if (files.length > limit) {
        setError(`Máximo ${MAX_POST_MEDIA} fotos. Te quedan ${Math.max(0, limit)}; elegiste ${files.length}. Elegí menos.`);
        return;
      }
    }
    setBusy(true);
    const failures: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(files.length > 1 ? `Subiendo ${i + 1} de ${files.length}…` : 'Subiendo de forma privada…');
        try {
          const compressed = await compressImage(files[i], mode === 'story' ? 1280 : 1440);
          const url = await uploadPrivateImage(compressed);
          const item: PostMedia = { id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, type: 'image', url };
          setItems((cur) => {
            if (replace !== null && cur[replace]) return cur.map((c, j) => (j === replace ? item : c));
            if (mode === 'story') return [item];
            return cur.length >= MAX_POST_MEDIA ? cur : [...cur, item];
          });
        } catch (e) {
          failures.push(`${files[i].name || `Foto ${i + 1}`}: ${(e as Error).message}`);
        }
      }
      if (failures.length) setError(`No se pudieron subir ${failures.length} foto(s). Las demás se conservaron. ${failures.join(' ')}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const move = (i: number, d: -1 | 1) =>
    setItems((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => setItems((cur) => cur.filter((_, j) => j !== i));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!image) {
      setError('Elige una foto para continuar.');
      return;
    }
    try {
      if (mode === 'story') {
        if (tooManyForStory) {
          setError('Las historias admiten una sola foto. Quitá fotos hasta dejar una.');
          return;
        }
        actions.createStory({ image, caption });
        toast({ title: 'Historia publicada', description: `Como ${me.name}` });
        navigate('/');
        return;
      }
      validatePostMedia(items);
      const id = actions.createPost({ image, media: items, caption, location });
      if (alsoStory) actions.createStory({ image, caption: '' });
      toast({ title: 'Publicado', description: `Como ${me.name}` });
      navigate(`/p/${id}`);
    } catch (err) {
      setError((err as Error).message || 'No se pudo publicar.');
    }
  };

  return (
    <div>
      <TopBar title={mode === 'story' ? 'Nueva historia' : 'Nueva publicación'} onBack={back} />
      <form onSubmit={submit} className="px-4 pb-6 pt-4">
        <div className="mb-5 grid grid-cols-2 rounded-2xl bg-card p-1" role="tablist" aria-label="Tipo de contenido">
          {(['post', 'story'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              disabled={busy}
              onClick={() => { setMode(m); setError(null); }}
              className={cn('h-11 rounded-xl text-sm font-semibold transition-colors', mode === m ? 'bg-secondary text-foreground' : 'text-muted-foreground')}
              data-testid={`tab-mode-${m}`}
            >
              {m === 'post' ? 'Publicación' : 'Historia'}
            </button>
          ))}
        </div>

        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-border p-3">
          <CharacterAvatar character={me} size={40} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Publicando como</div>
            <div className="truncate text-sm font-semibold" data-testid="text-posting-as">{me.name} · @{me.handle}</div>
          </div>
          <Link href="/settings" className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-4 text-xs font-semibold" data-testid="link-create-switch">
            <RefreshCw className="h-3.5 w-3.5" /> Cambiar
          </Link>
        </div>

        <input ref={fileRef} type="file" accept="image/*" multiple={mode === 'post'} className="hidden" disabled={busy} onChange={(e) => onFiles(e.target.files)} data-testid="input-file" />
        {image ? (
          <div className="relative overflow-hidden rounded-[22px] bg-card py-0">
            <img src={resolveMedia(image)} alt={items.length > 1 ? `Vista previa, foto 1 de ${items.length}` : 'Vista previa'} className={cn('mx-auto block object-cover', mode === 'story' ? 'aspect-[9/16] h-[min(240px,34dvh)] rounded-[18px]' : 'h-[min(240px,34dvh)] w-full')} data-testid="img-preview" />
            <button
              type="button"
              disabled={busy}
              onClick={() => pick(0)}
              className="absolute bottom-3 right-3 h-11 rounded-full bg-[hsl(240_8%_3%/0.7)] px-4 text-xs font-semibold backdrop-blur disabled:opacity-50"
              data-testid="button-change-image"
            >
              {busy ? 'Procesando…' : 'Cambiar foto'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => pick(null)}
            className={cn('flex w-full flex-col items-center justify-center gap-3 rounded-[22px] border border-dashed border-[hsl(240_4%_24%)] bg-card/60 transition-colors hover:border-primary/50', 'h-[min(200px,30dvh)]')}
            data-testid="button-pick-image"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-accent text-accent-foreground">
              <ImagePlus className="h-6 w-6" strokeWidth={1.5} />
            </span>
            <span className="font-display text-lg font-light">{busy ? 'Procesando…' : mode === 'post' ? 'Elige fotos' : 'Elige una foto'}</span>
            <span className="px-4 text-center text-xs text-muted-foreground">{busy ? progress ?? 'Subiendo de forma privada…' : mode === 'post' ? `Solo fotos, hasta ${MAX_POST_MEDIA}. Se guardarán en tu cuenta.` : 'JPG, PNG o HEIC compatible. Se guardará en tu cuenta.'}</span>
          </button>
        )}

        {items.length > 0 && (mode === 'post' || items.length > 1) && (
          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span data-testid="text-media-count">{items.length}/{MAX_POST_MEDIA} fotos · solo fotos</span>
              {busy && <span aria-live="polite" data-testid="text-upload-progress">{progress}</span>}
            </div>
            <ol className="no-scrollbar flex gap-2 overflow-x-auto pb-1" aria-label="Orden de las fotos">
              {items.map((m, i) => (
                <li key={m.id} data-media-id={m.id} className="w-[132px] shrink-0 rounded-2xl border border-border bg-card p-1.5" data-testid={`item-media-${i}`}>
                  <div className="relative">
                    <img src={resolveMedia(m.url)} alt={`Foto ${i + 1} de ${items.length}`} className="aspect-[4/5] w-full rounded-xl object-cover" data-testid={`img-media-preview-${i}`} />
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-[hsl(240_8%_3%/0.7)] px-2 py-0.5 text-[11px] font-semibold">{i + 1}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`Mover foto ${i + 1} a la izquierda`} className="grid h-11 w-11 place-items-center rounded-full hover:bg-secondary disabled:opacity-30" data-testid={`button-media-left-${i}`}><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" disabled={busy} onClick={() => remove(i)} aria-label={`Quitar foto ${i + 1}`} className="grid h-11 w-11 place-items-center rounded-full text-destructive hover:bg-secondary disabled:opacity-30" data-testid={`button-media-remove-${i}`}><X className="h-4 w-4" /></button>
                    <button type="button" disabled={busy || i === items.length - 1} onClick={() => move(i, 1)} aria-label={`Mover foto ${i + 1} a la derecha`} className="grid h-11 w-11 place-items-center rounded-full hover:bg-secondary disabled:opacity-30" data-testid={`button-media-right-${i}`}><ChevronRight className="h-4 w-4" /></button>
                  </div>
                </li>
              ))}
              {mode === 'post' && items.length < MAX_POST_MEDIA && (
                <li className="shrink-0">
                  <button type="button" disabled={busy} onClick={() => pick(null)} className="flex h-full min-h-[160px] w-[96px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[hsl(240_4%_24%)] text-xs text-muted-foreground hover:border-primary/50 disabled:opacity-40" data-testid="button-add-media">
                    <Plus className="h-5 w-5" /> Añadir
                  </button>
                </li>
              )}
            </ol>
            {tooManyForStory && (
              <p className="mt-2 text-xs text-primary" data-testid="text-story-too-many">Las historias admiten una sola foto. Quitá fotos hasta dejar una o volvé a Publicación.</p>
            )}
          </div>
        )}

        <label className="mt-5 block">
          <span className="sr-only">Pie de foto</span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 600))}
            rows={2}
            placeholder={mode === 'story' ? 'Texto sobre la historia (opcional)' : 'Escribe un pie de foto…'}
            className="min-h-[76px] w-full resize-none rounded-2xl border border-input bg-card px-4 py-3 text-[15px] leading-relaxed placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
            data-testid="input-caption"
          />
        </label>

        {mode === 'post' && (
          <>
            <label className="mt-3 flex items-center gap-3 rounded-2xl border border-input bg-card px-4">
              <MapPin className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
              <input
                aria-label="Ubicación"
                value={location}
                onChange={(e) => setLocation(e.target.value.slice(0, 80))}
                placeholder="Añadir ubicación"
                className="h-12 flex-1 bg-transparent text-[15px] placeholder:text-muted-foreground focus:outline-none"
                data-testid="input-location"
              />
            </label>
            <label className="mt-3 flex items-center justify-between rounded-2xl border border-border px-4 py-3">
              <span>
                <span className="block text-sm font-medium">Compartir también en tu historia</span>
                <span className="text-xs text-muted-foreground">Aparecerá en el círculo de {me.name.split(' ')[0]}{items.length > 1 ? ' · se usa solo la primera foto' : ''}</span>
              </span>
              <Switch checked={alsoStory} onCheckedChange={setAlsoStory} data-testid="switch-also-story" />
            </label>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-2xl bg-destructive/15 px-4 py-3 text-sm text-destructive" data-testid="text-create-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!image || busy || tooManyForStory}
          className="tap mt-6 h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
          data-testid="button-publish"
        >
          {mode === 'story' ? 'Publicar historia' : 'Publicar'}
        </button>
      </form>
    </div>
  );
}
