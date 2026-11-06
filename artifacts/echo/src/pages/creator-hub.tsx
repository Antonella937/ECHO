import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { compressImage, uploadPrivateImage, useMediaResolver } from '@/lib/media';
import { BadgeCheck, Camera, Check, Pencil, X } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { useUser } from '@clerk/react';
import { ArrowLeft, ExternalLink, LockKeyhole, MessageCircle, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';

/**
 * Creator Hub is the real account owner's presentation, not a fictional identity.
 * Sharing and access requests intentionally remain disabled until the
 * recipient-scoped authorization API and legal consent are implemented.
 */
export default function CreatorHubPage() {
  const { user } = useUser();
  const customName = typeof user?.unsafeMetadata?.creatorHubDisplayName === 'string' ? user.unsafeMetadata.creatorHubDisplayName : '';
  const alias = customName || user?.fullName?.trim() || user?.firstName?.trim() || user?.username || 'Tu espacio Creator';
  const resolveImage = useMediaResolver();
  const avatarRef = typeof user?.unsafeMetadata?.creatorHubAvatar === 'string' ? user.unsafeMetadata.creatorHubAvatar : '';
  const bannerRef = typeof user?.unsafeMetadata?.creatorHubBanner === 'string' ? user.unsafeMetadata.creatorHubBanner : '';
  const avatarImage = avatarRef ? resolveImage(avatarRef) : '';
  const bannerImage = bannerRef ? resolveImage(bannerRef) : '';
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null);
  const [profileError, setProfileError] = useState('');
  const externalLink = typeof user?.unsafeMetadata?.creatorHubExternalLink === 'string' ? user.unsafeMetadata.creatorHubExternalLink : '';
  const [editingLink, setEditingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [savingLink, setSavingLink] = useState(false);
  async function saveLink() {
    if (!user) return;
    const raw = linkDraft.trim();
    let normalized = raw;
    if (raw && !/^https?:\/\//i.test(raw)) normalized = 'https://' + raw;
    if (normalized) {
      try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.') || parsed.username || parsed.password || normalized.length > 500) throw new Error('invalid');
      } catch { setProfileError('Ingresá un enlace HTTPS válido, por ejemplo instagram.com/tuusuario.'); return; }
    }
    setSavingLink(true); setProfileError('');
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubExternalLink: normalized } });
      await user.reload();
      setEditingLink(false);
    } catch { setProfileError('No pudimos guardar el enlace. Probá de nuevo.'); }
    finally { setSavingLink(false); }
  }
  async function saveName() {
    const next = nameDraft.trim();
    if (next.length < 2 || next.length > 80) { setProfileError('El nombre debe tener entre 2 y 80 caracteres.'); return; }
    if (!user) return;
    setSaving(true); setProfileError('');
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubDisplayName: next } });
      await user.reload(); setEditingName(false);
    } catch { setProfileError('No pudimos guardar el nombre.'); }
    finally { setSaving(false); }
  }
  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>, kind: 'avatar' | 'banner') {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    event.target.value = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) { setProfileError('Elegí una imagen JPG, PNG o WebP de hasta 15 MB.'); return; }
    setUploading(kind); setProfileError('');
    try {
      const data = await compressImage(file, kind === 'avatar' ? 900 : 1920, 0.85);
      const ref = await uploadPrivateImage(data);
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, [kind === 'avatar' ? 'creatorHubAvatar' : 'creatorHubBanner']: ref } });
      await user.reload();
    } catch { setProfileError('No pudimos guardar la imagen. Probá nuevamente.'); }
    finally { setUploading(null); }
  }
  const defaultUsername = (user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'creator').toLowerCase().replace(/[^a-z0-9._]/g, '');
  const savedUsername = typeof user?.unsafeMetadata?.creatorHubUsername === 'string' ? user.unsafeMetadata.creatorHubUsername : '';
  const username = savedUsername || defaultUsername;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [founderVerified, setFounderVerified] = useState(false);
  useEffect(() => {
    let active = true;
    void customFetch<{ lifetimeAccess?: string | null; billingExempt?: boolean }>('/api/account/entitlements', { responseType: 'json' })
      .then(data => { if (active) setFounderVerified(data.lifetimeAccess === 'owner_lifetime' && data.billingExempt === true); })
      .catch(() => { if (active) setFounderVerified(false); });
    return () => { active = false; };
  }, [user?.id]);
  async function saveUsername() {
    const next = draft.trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9._]{3,30}$/.test(next)) { setError('Usá entre 3 y 30 caracteres: letras minúsculas, números, puntos o guiones bajos.'); return; }
    if (!user) return;
    setSaving(true); setError('');
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubUsername: next } });
      await user.reload();
      setEditing(false);
    } catch { setError('No pudimos guardar el usuario. Intentá nuevamente.'); }
    finally { setSaving(false); }
  }
  const nameParts = alias.split(/\s+/).filter(Boolean);
  const initials = nameParts.length > 1
    ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
    : (nameParts[0]?.slice(0, 2).toUpperCase() || 'EC');
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="relative z-20 flex min-h-[88px] shrink-0 items-center justify-between gap-2 px-4 pb-4 pt-[calc(env(safe-area-inset-top,0px)+24px)] text-foreground sm:min-h-[92px] lg:px-8 lg:pt-6">
        <Link href="/" aria-label="Volver al feed de ECHO" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-black/45 px-3 text-sm font-medium backdrop-blur-md hover:bg-black/65"><ArrowLeft size={19} /><span className="hidden sm:inline">Volver al feed de ECHO</span><span className="sm:hidden">Volver</span></Link>
        <Link href="/" aria-label="ECHO — ir al inicio" className="wordmark absolute left-1/2 -translate-x-1/2 text-[28px] leading-none text-foreground sm:text-[32px]">ECHO</Link>
        <h1 className="text-sm font-semibold text-muted-foreground sm:text-base">Creator Hub</h1>
      </header>
      <div className="flex w-full flex-1 flex-col justify-center px-0 pb-6 lg:py-8">
        <section className="w-full overflow-hidden bg-card lg:mx-auto lg:max-w-6xl lg:rounded-[28px] lg:border lg:border-border" aria-label="Perfil Creator Hub">
          <div className="relative flex h-48 flex-col items-center justify-center gap-2 sm:h-60 lg:h-64 bg-[linear-gradient(130deg,hsl(263_18%_19%),hsl(336_15%_16%))] text-muted-foreground">
            {bannerImage ? <img src={bannerImage} alt="Banner de Creator Hub" className="absolute inset-0 h-full w-full object-cover" /> : <span className="select-none text-[clamp(4rem,14vw,9rem)] font-black tracking-[-0.08em] text-white/20" aria-hidden="true">{initials}</span>}
            <input ref={bannerInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Seleccionar banner" onChange={e => void uploadPhoto(e, 'banner')} />
            <button type="button" disabled={uploading !== null} onClick={() => bannerInput.current?.click()} className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><Camera size={15}/>{uploading === 'banner' ? 'Subiendo…' : 'Editar banner'}</button>
          </div>
          <div className="mx-auto w-full max-w-5xl space-y-5 px-5 py-6 sm:px-10 lg:py-7">
            <div className="flex items-start gap-3 sm:items-center">
              <div className="relative shrink-0">
                <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-background bg-secondary text-2xl font-semibold leading-none sm:h-28 sm:w-28" aria-label={`Avatar de ${alias}`}>{avatarImage ? <img src={avatarImage} alt="" className="h-full w-full object-cover" /> : <span className="block text-center leading-none">{initials}</span>}</span>
                <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Seleccionar foto de perfil" onChange={e => void uploadPhoto(e, 'avatar')} />
                <button type="button" disabled={uploading !== null} onClick={() => avatarInput.current?.click()} aria-label="Cambiar foto de perfil" className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-foreground disabled:opacity-50"><Camera size={15}/></button>
              </div>
              <div className="min-w-0 flex-1 pt-3 sm:pt-0">
                <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">{editingName ? <div className="flex min-w-0 items-center gap-1"><input aria-label="Nombre de creador" value={nameDraft} maxLength={80} onChange={e => setNameDraft(e.target.value)} className="min-w-0 rounded-lg border border-border bg-background px-2 py-1 text-sm" /><button type="button" disabled={saving} aria-label="Guardar nombre" onClick={() => void saveName()}><Check size={17}/></button><button type="button" aria-label="Cancelar edición de nombre" onClick={() => setEditingName(false)}><X size={17}/></button></div> : <div className="flex min-w-0 items-center gap-1"><h2 className="min-w-0 truncate text-lg font-semibold leading-tight sm:text-3xl">{alias}</h2><button type="button" aria-label="Editar nombre" onClick={() => {setNameDraft(alias);setProfileError('');setEditingName(true);}} className="shrink-0 p-1 text-muted-foreground"><Pencil size={15}/></button></div>}{founderVerified && <span title="Fundadora verificada de ECHO" aria-label="Fundadora verificada de ECHO"><BadgeCheck className="h-5 w-5 shrink-0 fill-primary text-primary-foreground sm:h-6 sm:w-6" /></span>}</div>
                {founderVerified && <p className="mt-1 text-xs font-semibold text-primary">CEO &amp; Founder of ECHO</p>}
                {editing ? <div className="mt-2 space-y-2"><div className="flex items-center gap-2"><span className="text-muted-foreground">@</span><input aria-label="Nuevo nombre de usuario" value={draft} maxLength={30} onChange={e => setDraft(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" /><button type="button" aria-label="Guardar usuario" disabled={saving} onClick={() => void saveUsername()} className="rounded-full p-2 text-primary disabled:opacity-50"><Check size={18}/></button><button type="button" aria-label="Cancelar edición" onClick={() => {setEditing(false);setError('');}} className="rounded-full p-2"><X size={18}/></button></div>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<p className="text-xs text-muted-foreground">Este alias es independiente de tu email de inicio de sesión.</p></div> : <div className="mt-1 flex items-center gap-2"><p className="truncate text-sm text-muted-foreground">@{username}</p><button type="button" aria-label="Editar nombre de usuario" title="Editar nombre de usuario" onClick={() => {setDraft(username);setError('');setEditing(true);}} className="rounded-full p-1 text-muted-foreground hover:text-foreground"><Pencil size={15}/></button></div>}
              </div>
              <span className="hidden shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground sm:inline-flex">Perfil privado</span>
            </div>
            {profileError && <p role="alert" className="text-xs text-destructive">{profileError}</p>}
            <p className="text-sm leading-relaxed text-muted-foreground">Tu espacio para presentar los mundos, personajes e historias que creás.</p>
            <div className="space-y-2">
              {editingLink ? <div className="flex items-center gap-2"><ExternalLink size={16} className="shrink-0 text-muted-foreground" /><input aria-label="Enlace externo de Creator Hub" type="url" value={linkDraft} maxLength={500} onChange={e => setLinkDraft(e.target.value)} placeholder="https://instagram.com/tuusuario" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" /><button type="button" disabled={savingLink} onClick={() => void saveLink()} aria-label="Guardar enlace" className="p-2 text-primary disabled:opacity-50"><Check size={18}/></button><button type="button" onClick={() => setEditingLink(false)} aria-label="Cancelar enlace" className="p-2"><X size={18}/></button></div> : <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><ExternalLink size={16} className="shrink-0" />{externalLink ? <a href={externalLink} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate underline underline-offset-4 hover:text-foreground">{externalLink.replace(/^https?:\/\//, '')}</a> : <span>Enlace externo opcional</span>}<button type="button" aria-label="Editar enlace externo" onClick={() => {setLinkDraft(externalLink);setProfileError('');setEditingLink(true);}} className="shrink-0 rounded-full p-1 hover:text-foreground"><Pencil size={15}/></button></div>}
            </div>
            <div className="border-t border-border pt-5">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" disabled title="Las solicitudes de acceso todavía no están habilitadas" className="rounded-full bg-secondary px-3 py-3 text-sm font-semibold text-muted-foreground opacity-70">Solicitar acceso</button>
                <button type="button" disabled title="Los mensajes Creator Hub todavía no están habilitados" className="flex items-center justify-center gap-2 rounded-full border border-border px-3 py-3 text-sm text-muted-foreground opacity-60"><MessageCircle size={16} /> Mensaje privado</button>
              </div>
              <div className="mt-5 rounded-2xl bg-secondary/70 px-5 py-8 text-center sm:py-10">
                <LockKeyhole size={23} className="mx-auto mb-3 text-muted-foreground" />
                <h3 className="font-semibold">Contenido privado</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Los personajes y universos compartidos solo serán visibles después de que el creador autorice el acceso.</p>
              </div>
            </div>
          </div>
        </section>
        <p className="mx-auto mt-4 flex max-w-5xl items-start gap-2 px-6 pb-4 text-xs leading-relaxed text-muted-foreground"><ShieldCheck size={16} className="mt-0.5 shrink-0" /> Esta es la base visual de Creator Hub. Las solicitudes de acceso y el contenido compartido se habilitarán cuando existan controles de privacidad completos. Ningún universo se publica automáticamente.</p>
      </div>
    </div>
  );
}
