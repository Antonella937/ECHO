import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { customFetch } from '@workspace/api-client-react';
import { getActiveUniverseId } from '@/store/persistence';
import { useSocial } from '@/store/social-store';

type Candidate = {
  sourceId: string; kind: string; excerpt: string; occurredAt: string;
  status: 'needs_owner_review'; verified: false;
};
type Response = { revision: number; candidates: Candidate[] };
const labels: Record<string, string> = {
  promise_kept: 'Promesa cumplida', support_given: 'Apoyo recibido',
  boundary_respected: 'Límite respetado', lie_confirmed: 'Mentira confirmada',
  promise_broken: 'Promesa incumplida', betrayal_confirmed: 'Traición confirmada',
  repair_confirmed: 'Reparación confirmada',
};

/** Manual review: suggestions are never automatically approved or applied. */
export function TrustReview({ actorId, targetId }: { actorId: string; targetId: string }) {
  const { userId } = useAuth();
  const { actions } = useSocial();
  const [data, setData] = useState<Response | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  if (!userId || targetId === 'owner') return null;
  const universeId = getActiveUniverseId(userId);
  const url = `/api/universe/relationships/trust/candidates?${new URLSearchParams({ universeId, actorId, targetId })}`;
  async function load() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await customFetch<Response>(url, { method: 'GET', responseType: 'json', cache: 'no-store' });
      setData(result);
    } catch { setError('No se pudieron consultar los acontecimientos.'); }
    finally { setBusy(false); }
  }
  async function approve(candidate: Candidate) {
    if (!data || !userId || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await customFetch(`/api/universe/relationships/trust/approve?${new URLSearchParams({ universeId })}`, {
        method: 'POST', responseType: 'json',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actorId, targetId, sourceId: candidate.sourceId,
          kind: candidate.kind, expectedRevision: data.revision,
        }),
      });
      setData(null);
      await actions.retrySync();
      setNotice('Acontecimiento confirmado y guardado. Actualizá la lista para ver nuevos candidatos.');
    } catch {
      setData(null);
      setError('No se pudo aprobar. Puede haber cambios pendientes de sincronización. Sincronizá y volvé a consultar.');
    } finally { setBusy(false); }
  }
  return <section className="mt-4 rounded-xl border border-border p-3" aria-label="Revisión de confianza">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-semibold">Acontecimientos de confianza</p>
      <button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">Revisar mensajes</button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Las sugerencias no son hechos confirmados. Solo vos decidís si corresponde cambiar la confianza.</p>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
    {data && (data.candidates.length ? <ul className="mt-3 space-y-3">
      {data.candidates.map(item => <li key={item.sourceId} className="rounded-lg border border-border p-3">
        <p className="text-xs font-semibold">{labels[item.kind] ?? item.kind}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs">{item.excerpt}</p>
        <p className="mt-1 text-xs text-muted-foreground">Sugerencia sin verificar</p>
        <button type="button" disabled={busy} onClick={() => void approve(item)} className="mt-2 rounded-lg border border-primary px-3 py-2 text-xs text-primary disabled:opacity-50">Confirmar acontecimiento</button>
      </li>)}
    </ul> : <p className="mt-3 text-xs text-muted-foreground">No hay sugerencias pendientes para este vínculo.</p>)}
  </section>;
}
