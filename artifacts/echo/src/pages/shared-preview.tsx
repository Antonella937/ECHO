import { useSharedStatusText } from '@/lib/shared-status-translations';
import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import { customFetch } from '@workspace/api-client-react';

type Shared = { kind: 'universe' | 'character'; universeName: string; description: string; characters: Array<{ id: string; name: string; handle?: string; bio?: string; occupation?: string }>; importAvailable: boolean; collaborationInvite: boolean };
export default function SharedPreviewPage() {
  const t = useSharedStatusText();
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState('');
  const [joined, setJoined] = useState('');
  const [joining, setJoining] = useState(false);
  const join = async () => {
    setJoining(true); setError('');
    try { const result = await customFetch<{ownerId:string;universeId:string}>('/api/universe/shared/' + encodeURIComponent(token) + '/join', { method: 'POST', responseType: 'json' });
      setJoined('/collaboration/' + encodeURIComponent(result.ownerId) + '/' + encodeURIComponent(result.universeId));
    } catch { setError(t(t("Este enlace no es una invitación de colaboración o ya no está disponible."))); }
    finally { setJoining(false); }
  };
  const importCopy = async () => {
    setImporting(true); setError('');
    try { const result = await customFetch<{kind:string;universeId:string;importedCount:number}>('/api/universe/shared/' + encodeURIComponent(token) + '/import', { method: 'POST', responseType: 'json' });
      setImported(result.kind === 'universe' ? t(t("Universo copiado. Encontralo en tus universos.")) : t(t("Personaje copiado a tu universo principal.")));
    } catch { setError(t(t("No se pudo importar. Revisá los límites de tu plan y que el enlace siga activo."))); }
    finally { setImporting(false); }
  };
  useEffect(() => {
    let active = true;
    void customFetch<Shared>('/api/universe/shared/' + encodeURIComponent(token), { responseType: 'json' })
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setError(t(t("Este enlace no está disponible o fue revocado."))); });
    return () => { active = false; };
  }, [token]);
  return <main className="mx-auto min-h-screen max-w-2xl px-5 py-12 text-foreground">
    <Link href="/" className="text-sm text-primary">ECHO</Link>
    {error ? <p role="alert" className="mt-8">{error}</p> : !data ? <p className="mt-8">{t("Cargando contenido compartido…")}</p> : <>
      <p className="mt-8 text-xs uppercase tracking-widest text-primary">{data.kind === 'universe' ? t(t("Universo compartido")) : t(t("Personaje compartido"))}</p>
      <h1 className="mt-2 font-display text-4xl">{data.universeName}</h1>
      {data.description && <p className="mt-3 text-muted-foreground">{data.description}</p>}
      <div className="mt-8 grid gap-3">{data.characters.map(ch => <article key={ch.id} className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-xl font-semibold">{ch.name}</h2>
        {ch.handle && <p className="text-sm text-primary">@{ch.handle}</p>}
        {ch.occupation && <p className="mt-2 text-sm">{ch.occupation}</p>}
        {ch.bio && <p className="mt-2 text-sm text-muted-foreground">{ch.bio}</p>}
      </article>)}</div>
      <p className="mt-6 text-xs text-muted-foreground">{t("La copia incluye los datos públicos básicos de los personajes, sin mensajes, recuerdos, imágenes privadas ni acceso al universo original.")}</p>
      {joined && <Link href={joined} className="mt-4 block text-primary underline">{t("Abrir mundo compartido")}</Link>}
      {data.kind === "universe" && data.collaborationInvite && !joined && <button type="button" disabled={joining} onClick={() => void join()} className="mt-4 ml-2 rounded-full border border-primary px-5 py-3 text-primary disabled:opacity-50">{joining ? t("Uniéndote…") : t("Unirme como colaboradora")}</button>}
      {imported ? <p role="status" className="mt-4 text-primary">{imported}</p> : data.importAvailable ? <button type="button" disabled={importing} onClick={() => void importCopy()} className="mt-4 rounded-full bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50">{importing ? t("Importando…") : t("Importar una copia a mi cuenta")}</button> : null}
    </>}
  </main>;
}
