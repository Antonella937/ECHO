import { useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { ImagePlus, MapPin, RefreshCw } from 'lucide-react';
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
  const [image, setImage] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [alsoStory, setAlsoStory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const compressed = await compressImage(file, mode === 'story' ? 1280 : 1440);
      setImage(await uploadPrivateImage(compressed));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!image) {
      setError('Elige una foto para continuar.');
      return;
    }
    if (mode === 'story') {
      actions.createStory({ image, caption });
      toast({ title: 'Historia publicada', description: `Como ${me.name}` });
      navigate('/');
      return;
    }
    const id = actions.createPost({ image, caption, location });
    if (alsoStory) actions.createStory({ image, caption: '' });
    toast({ title: 'Publicado', description: `Como ${me.name}` });
    navigate(`/p/${id}`);
  };

  return (
    <div>
      <TopBar title={mode === 'story' ? 'Nueva historia' : 'Nueva publicación'} onBack={back} />
      <form onSubmit={submit} className="px-4 pb-10 pt-4">
        <div className="mb-5 grid grid-cols-2 rounded-2xl bg-card p-1" role="tablist" aria-label="Tipo de contenido">
          {(['post', 'story'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn('h-10 rounded-xl text-sm font-semibold transition-colors', mode === m ? 'bg-secondary text-foreground' : 'text-muted-foreground')}
              data-testid={`tab-mode-${m}`}
            >
              {m === 'post' ? 'Publicación' : 'Historia'}
            </button>
          ))}
        </div>

        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-border p-3">
          <CharacterAvatar character={me} size={40} />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Publicando como</div>
            <div className="truncate text-sm font-semibold" data-testid="text-posting-as">{me.name} · @{me.handle}</div>
          </div>
          <Link href="/settings" className="flex h-9 items-center gap-1.5 rounded-full bg-secondary px-3 text-xs font-semibold" data-testid="link-create-switch">
            <RefreshCw className="h-3.5 w-3.5" /> Cambiar
          </Link>
        </div>

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} data-testid="input-file" />
        {image ? (
          <div className="relative overflow-hidden rounded-[22px] bg-card">
            <img src={resolveMedia(image)} alt="Vista previa" className={cn('w-full object-cover', mode === 'story' ? 'aspect-[9/16] max-h-[70dvh]' : 'aspect-[4/5]')} data-testid="img-preview" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="absolute bottom-3 right-3 h-10 rounded-full bg-[hsl(240_8%_3%/0.7)] px-4 text-xs font-semibold backdrop-blur"
              data-testid="button-change-image"
            >
              Cambiar foto
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className={cn('flex w-full flex-col items-center justify-center gap-3 rounded-[22px] border border-dashed border-[hsl(240_4%_24%)] bg-card/60 transition-colors hover:border-primary/50', mode === 'story' ? 'aspect-[9/14]' : 'aspect-[4/5]')}
            data-testid="button-pick-image"
          >
            <span className="grid h-16 w-16 place-items-center rounded-full bg-accent text-accent-foreground">
              <ImagePlus className="h-7 w-7" strokeWidth={1.5} />
            </span>
            <span className="font-display text-lg font-light">{busy ? 'Procesando…' : 'Elige una foto'}</span>
            <span className="text-xs text-muted-foreground">{busy ? 'Subiendo de forma privada…' : 'JPG, PNG o HEIC compatible. Se guardará en tu cuenta.'}</span>
          </button>
        )}

        <label className="mt-5 block">
          <span className="sr-only">Texto</span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 600))}
            rows={3}
            placeholder={mode === 'story' ? 'Texto sobre la historia (opcional)' : 'Escribe un pie de foto…'}
            className="w-full resize-none rounded-2xl border border-input bg-card px-4 py-3 text-[15px] leading-relaxed placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
            data-testid="input-caption"
          />
        </label>

        {mode === 'post' && (
          <>
            <label className="mt-3 flex items-center gap-3 rounded-2xl border border-input bg-card px-4">
              <MapPin className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
              <input
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
                <span className="text-xs text-muted-foreground">Aparecerá en el círculo de {me.name.split(' ')[0]}</span>
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
          disabled={!image || busy}
          className="tap mt-6 h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
          data-testid="button-publish"
        >
          {mode === 'story' ? 'Publicar historia' : 'Publicar'}
        </button>
      </form>
    </div>
  );
}
