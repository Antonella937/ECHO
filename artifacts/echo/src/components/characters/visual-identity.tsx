import { useCharacterDetailsText } from '@/lib/character-details-translations';
import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import type { IdentityReference } from '@/domain/types';
import { compressImage, uploadPrivateImage, useMediaResolver } from '@/lib/media';
import { Area } from './ui';

function ReferencePhoto({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  return <div className="relative h-full w-full overflow-hidden rounded-xl bg-secondary">
    {status === 'loading' && <div role="status" aria-label="Loading image" className="absolute inset-0 grid place-items-center"><span className="h-7 w-7 animate-spin rounded-full border-2 border-primary/20 border-t-primary" /></div>}
    {status === 'error' && <div role="status" aria-label="Image unavailable" className="absolute inset-0 grid place-items-center text-muted-foreground"><ImagePlus className="h-7 w-7 opacity-60" /></div>}
    <img key={src} src={src} alt={alt} loading="lazy" onLoad={() => setStatus('loaded')} onError={() => setStatus('error')} className={className + (status === 'loaded' ? '' : ' opacity-0')} />
  </div>;
}

export function VisualIdentity({ avatar, identity, onChange, onBusy }: {
  avatar: string;
  identity: IdentityReference | undefined;
  onChange: (next: IdentityReference) => void;
  onBusy: (busy: boolean) => void;
}) {
  const t = useCharacterDetailsText();
  const resolve = useMediaResolver();
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const patch = (change: Partial<IdentityReference>) => onChange({
    ...(identity ?? { provider: 'mock', referenceImages: [], seed: 0, appearance: '', styleNotes: '', updatedAt: new Date(0).toISOString() }), ...change, updatedAt: new Date().toISOString(),
  });
  const images = identity?.referenceImages ?? [];
  async function addFiles(files: FileList | null) {
    if (!files?.length || uploading) return;
    setError('');
    const selected = Array.from(files);
    if (images.length + selected.length > 5) {
      setError(t("Podés guardar hasta 5 fotos adicionales por personaje."));
      return;
    }
    setUploading(true);
    onBusy(true);
    try {
      const uploaded: string[] = [];
      for (const file of selected) {
        if (!file.type.startsWith('image/')) throw new Error(t("Solo se admiten imágenes."));
        uploaded.push(await uploadPrivateImage(await compressImage(file, 1440)));
      }
      patch({ referenceImages: [...images, ...uploaded] });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("No se pudo subir la referencia."));
    } finally {
      setUploading(false);
      onBusy(false);
      if (picker.current) picker.current.value = '';
    }
  }
  return <section className="mt-6 rounded-2xl border border-border bg-card/40 p-4" data-testid="section-character-visual-identity">
    <h3 className="font-display text-lg">{t("Identidad visual")}</h3>
    <p className="mt-1 mb-4 text-xs text-muted-foreground">{t("Estas referencias ayudan a mantener la apariencia del personaje en futuras imágenes IA. La foto de perfil es la referencia facial principal.")}</p>
    <div className="mb-4 flex items-center gap-3">
      {avatar && <div className="h-20 w-20 shrink-0"><ReferencePhoto src={resolve(avatar)} alt={t("Referencia facial principal")} className="h-20 w-20 object-cover" /></div>}
      <div className="text-xs text-muted-foreground">{t("Foto de perfil · referencia principal del rostro. Se actualiza desde el selector de avatar de arriba.")}</div>
    </div>
    <Area id="character-facial-description" label={t("Descripción facial")} value={identity?.facialDescription ?? ''} onChange={facialDescription => patch({ facialDescription })} max={4000} rows={3} />
    <Area id="character-body-description" label={t("Descripción física y corporal")} value={identity?.bodyDescription ?? ''} onChange={bodyDescription => patch({ bodyDescription })} max={4000} rows={3} />
    <Area id="character-visual-style" label={t("Estilo y detalles visuales (opcional)")} value={identity?.styleNotes ?? ''} onChange={styleNotes => patch({ styleNotes })} max={4000} rows={2} />
    <p className="mb-2 text-sm font-medium">{t('Fotos adicionales')} ({images.length}/5)</p>
    <div className="grid grid-cols-3 gap-2">
      {images.map((ref, index) => <div key={ref + index} className="relative overflow-hidden rounded-xl bg-secondary">
        <ReferencePhoto key={resolve(ref)} src={resolve(ref)} alt={`${t('Referencia')} ${index + 1}`} className="aspect-[3/4] w-full object-cover" />
        <button type="button" aria-label={`${t('Eliminar referencia')} ${index + 1}`} onClick={() => patch({ referenceImages: images.filter((_, i) => i !== index) })} className="absolute right-1 top-1 rounded-full bg-black/70 p-2 text-white"><X className="h-4 w-4" /></button>
      </div>)}
      {images.length < 5 && <button type="button" disabled={uploading} onClick={() => picker.current?.click()} className="flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs text-muted-foreground disabled:opacity-50"><ImagePlus className="h-6 w-6" />{t(uploading ? 'Subiendo…' : 'Agregar foto')}</button>}
    </div>
    <input ref={picker} type="file" accept="image/*" multiple className="hidden" onChange={e => void addFiles(e.target.files)} />
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
    <p className="mt-3 text-xs text-muted-foreground">{t("Las fotos se almacenan de forma privada. Guardá el personaje para conservar los cambios. Cambiar el avatar no elimina estas referencias.")}</p>
  </section>;
}
