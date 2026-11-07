import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import { customFetch } from '@workspace/api-client-react';

type Shared = { kind: 'universe' | 'character'; universeName: string; description: string; characters: Array<{ id: string; name: string; handle?: string; bio?: string; occupation?: string }>; importAvailable: false };
export default function SharedPreviewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState('');
  const importCopy = async () => {
    setImporting(true); setError('');
    try { const result = await customFetch<{kind:string;universeId:string;importedCount:number}>('/api/universe/shared/' + encodeURIComponent(token) + '/import', { method: 'POST', responseType: 'json' });
      setImported(result.kind === 'universe' ? 'Universo copiado. Encontralo en tus universos.' : 'Personaje copiado a tu universo principal.');
    } catch { setError('No se pudo importar. Revisá los límites de tu plan y que el enlace siga activo.'); }
    finally { setImporting(false); }
  };
  useEffect(() => {
    let active = true;
    void customFetch<Shared>('/api/universe/shared/' + encodeURIComponent(token), { responseType: 'json' })
      .then(result => { if (active) setData(result); })
      .catch(() => { if (active) setError('Este enlace no está disponible o fue revocado.'); });
    return () => { active = false; };
  }, [token]);
  return <main className="mx-auto min-h-screen max-w-2xl px-5 py-12 text-foreground">
    <Link href="/" className="text-sm text-primary">ECHO</Link>
    {error ? <p role="alert" className="mt-8">{error}</p> : !data ? <p className="mt-8">Cargando contenido compartido…</p> : <>
      <p className="mt-8 text-xs uppercase tracking-widest text-primary">{data.kind === 'universe' ? 'Universo compartido' : 'Personaje compartido'}</p>
      <h1 className="mt-2 font-display text-4xl">{data.universeName}</h1>
      {data.description && <p className="mt-3 text-muted-foreground">{data.description}</p>}
      <div className="mt-8 grid gap-3">{data.characters.map(ch => <article key={ch.id} className="rounded-2xl border border-border bg-card p-5">
        <h2 className="text-xl font-semibold">{ch.name}</h2>
        {ch.handle && <p className="text-sm text-primary">@{ch.handle}</p>}
        {ch.occupation && <p className="mt-2 text-sm">{ch.occupation}</p>}
        {ch.bio && <p className="mt-2 text-sm text-muted-foreground">{ch.bio}</p>}
      </article>)}</div>
      <p className="mt-6 text-xs text-muted-foreground">La copia incluye los datos públicos básicos de los personajes, sin mensajes, recuerdos, imágenes privadas ni acceso al universo original.</p>
      {imported ? <p role="status" className="mt-4 text-primary">{imported}</p> : <button type="button" disabled={importing} onClick={() => void importCopy()} className="mt-4 rounded-full bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50">{importing ? "Importando…" : "Importar una copia a mi cuenta"}</button>}
    </>}
  </main>;
}
