import { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { compressImage, useMediaResolver, uploadPrivateImage } from '@/lib/media';
import { hasCharacterImage } from '../../lib/visual-defaults';
import { CharacterInitials } from './visual-defaults';

export function AvatarPicker({ value, name = '', onChange, onBusy }: { value: string; name?: string; onChange(v: string): void; onBusy(b: boolean): void }) {
  const resolveMedia = useMediaResolver();
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
          {hasCharacterImage(value)
            ? <img src={resolveMedia(value)} alt="Avatar seleccionado" className="h-20 w-20 rounded-full bg-muted object-cover" data-testid="img-editor-avatar" />
            : <CharacterInitials name={name} size={80} testId="img-editor-avatar" />}
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

    </div>
  );
}
