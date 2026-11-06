import { useEffect, useState } from 'react';
import { BadgeCheck, Check, Pencil, X } from 'lucide-react';
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
  const alias = user?.fullName?.trim() || user?.firstName?.trim() || user?.username || 'Tu espacio Creator';
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
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="absolute left-0 right-0 top-0 z-20 flex items-center gap-3 px-4 pb-4 pt-safe text-foreground">
        <Link href="/" aria-label="Volver al inicio" className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/45 backdrop-blur-md hover:bg-black/65"><ArrowLeft size={19} /></Link>
        <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-foreground/70">ECHO</p><h1 className="text-lg font-semibold">Creator Hub</h1></div>
      </header>
      <div className="px-4">
        <section className="overflow-hidden rounded-[28px] border border-border bg-card" aria-label="Perfil Creator Hub">
          <div className="flex h-56 flex-col items-center justify-center gap-2 pt-12 sm:h-72 lg:h-80 bg-[linear-gradient(130deg,hsl(263_18%_19%),hsl(336_15%_16%))] text-muted-foreground">
            <span className="select-none text-[clamp(4rem,14vw,9rem)] font-black tracking-[-0.08em] text-white/20" aria-hidden="true">{initials}</span>
          </div>
          <div className="mx-auto max-w-5xl space-y-7 px-5 py-8 sm:px-10">
            <div className="flex items-center gap-3">
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-4 border-background bg-secondary text-2xl font-semibold sm:h-28 sm:w-28" aria-label={`Avatar de ${alias}: ${initials}`}>{initials}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h2 className="min-w-0 truncate text-2xl font-semibold sm:text-3xl">{alias}</h2>{founderVerified && <span title="Fundadora verificada de ECHO" aria-label="Fundadora verificada de ECHO"><BadgeCheck className="h-6 w-6 fill-primary text-primary-foreground" /></span>}</div>
                {founderVerified && <p className="mt-1 text-xs font-semibold text-primary">CEO &amp; Founder of ECHO</p>}
                {editing ? <div className="mt-2 space-y-2"><div className="flex items-center gap-2"><span className="text-muted-foreground">@</span><input aria-label="Nuevo nombre de usuario" value={draft} maxLength={30} onChange={e => setDraft(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" /><button type="button" aria-label="Guardar usuario" disabled={saving} onClick={() => void saveUsername()} className="rounded-full p-2 text-primary disabled:opacity-50"><Check size={18}/></button><button type="button" aria-label="Cancelar edición" onClick={() => {setEditing(false);setError('');}} className="rounded-full p-2"><X size={18}/></button></div>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<p className="text-xs text-muted-foreground">Este alias es independiente de tu email de inicio de sesión.</p></div> : <div className="mt-1 flex items-center gap-2"><p className="truncate text-sm text-muted-foreground">@{username}</p><button type="button" aria-label="Editar nombre de usuario" title="Editar nombre de usuario" onClick={() => {setDraft(username);setError('');setEditing(true);}} className="rounded-full p-1 text-muted-foreground hover:text-foreground"><Pencil size={15}/></button></div>}
              </div>
              <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">Perfil privado</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">Tu espacio para presentar los mundos, personajes e historias que creás.</p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><ExternalLink size={16} /><span>Enlace externo opcional</span></div>
            <div className="border-t border-border pt-5">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" disabled title="Las solicitudes de acceso todavía no están habilitadas" className="rounded-full bg-secondary px-3 py-3 text-sm font-semibold text-muted-foreground opacity-70">Solicitar acceso</button>
                <button type="button" disabled title="Los mensajes Creator Hub todavía no están habilitados" className="flex items-center justify-center gap-2 rounded-full border border-border px-3 py-3 text-sm text-muted-foreground opacity-60"><MessageCircle size={16} /> Mensaje privado</button>
              </div>
              <div className="mt-6 rounded-2xl bg-secondary/70 px-5 py-12 text-center sm:py-16">
                <LockKeyhole size={23} className="mx-auto mb-3 text-muted-foreground" />
                <h3 className="font-semibold">Contenido privado</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Los personajes y universos compartidos solo serán visibles después de que el creador autorice el acceso.</p>
              </div>
            </div>
          </div>
        </section>
        <p className="mx-auto mt-6 flex max-w-5xl items-start gap-2 px-6 pb-12 text-xs leading-relaxed text-muted-foreground"><ShieldCheck size={16} className="mt-0.5 shrink-0" /> Esta es la base visual de Creator Hub. La edición del perfil, las solicitudes y el contenido compartido se habilitarán cuando existan controles de privacidad completos. Ningún universo se publica automáticamente.</p>
      </div>
    </div>
  );
}
