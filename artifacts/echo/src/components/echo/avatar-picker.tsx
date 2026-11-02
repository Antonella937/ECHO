import { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { compressImage, resolveMedia, uploadPrivateImage } from '@/lib/media';
import { cn } from '@/lib/utils';

const PRESETS = [
  'account-default', 'official-pretty-violence', 'official-false-halo', 'official-saint-vulture',
  'official-stray-kids', 'official-the-hollow', 'official-dead-static',
];

export function AvatarPicker({ value, onChange, onBusy }: { value: string; onChange(v: string): void; onBusy(b: boolean): void }) {
  const input = useRef<HTMLInputElement>(null);
  const token = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (b: boolean) => { setBusy(b); onBusy(b); };

  const upload = async (file: File) => {
    const t = ++token.current;
    setError(null);
    set(true);
    try {
      const data = await compressImage(file, 640, 0.86);
      const path = await uploadPrivateImage(data);
      if (t === token.current) onChange(path);
    } catch (e) {
      if (t === token.current) setError(e instanceof Error ? e.message : 'No se pudo subir la imagen.');
    } finally {
      if (t === token.current) set(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="relative">
          <img src={resolveMedia(value)} alt="Avatar seleccionado" className="h-20 w-20 rounded-full bg-muted object-cover" data-testid="img-editor-avatar" />
          {busy && <span className="absolute inset-0 grid place-items-center rounded-full bg-background/70"><Loader2 className="h-6 w-6 animate-spin text-primary" /></span>}
        </div>
        <div className="flex flex-col gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex h-11 items-center gap-2 rounded-xl bg-secondary px-4 text-sm font-semibold disabled:opacity-60" data-testid="button-upload-avatar">
            <Camera className="h-4 w-4" /> {busy ? 'Subiendo…' : 'Subir foto'}
          </button>
          {busy && (
            <button type="button" onClick={() => { token.current++; set(false); }} className="h-9 text-left text-xs font-semibold text-muted-foreground" data-testid="button-cancel-upload">Cancelar subida</button>
          )}
        </div>
        <input ref={input} type="file" accept="image/*" className="hidden" data-testid="input-avatar-file"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive" data-testid="text-upload-error">{error}</p>}
      <div className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label="Avatares predefinidos">
        {PRESETS.map((k) => {
          const ref = `asset:${k}`;
          return (
            <button key={k} type="button" role="radio" aria-checked={value === ref} aria-label={k} onClick={() => onChange(ref)}
              className={cn('shrink-0 rounded-full p-[2px]', value === ref ? 'bg-primary' : 'bg-transparent')} data-testid={`button-preset-avatar-${k}`}>
              <img src={resolveMedia(ref)} alt="" className="h-11 w-11 rounded-full" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
