import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import { customFetch } from '@workspace/api-client-react';

type Shared = { kind: 'universe' | 'character'; universeName: string; description: string; characters: Array<{ id: string; name: string; handle?: string; bio?: string; occupation?: string }>; importAvailable: false };
export default function SharedPreviewPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState('');
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
      <p className="mt-6 text-xs text-muted-foreground">Vista previa de solo lectura. No incluye mensajes, recuerdos, configuraciones privadas ni acceso al universo original. La importación estará disponible en una próxima versión.</p>
    </>}
  </main>;
}
