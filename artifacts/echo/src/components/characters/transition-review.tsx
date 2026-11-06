import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useSocial } from '@/store/social-store';
import { relationshipPresets } from '@/domain/character-core';

type Proposal = { from: string; to: string; rationale: string; requiresOwnerApproval: true };
type History = { memoryId: string; content: string; occurredAt: string };
type Result = { revision: number; proposals: Proposal[]; history: History[] };
export function TransitionReview({ actorId, targetId }: { actorId: string; targetId: string }) {
  const { universeId, actions } = useSocial();
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  if (targetId === 'owner') return null;
  const query = new URLSearchParams({ universeId, actorId, targetId });
  async function load() {
    setBusy(true);
    try {
      setData(await customFetch<Result>('/api/universe/relationships/transitions?' + query, { method: 'GET', responseType: 'json', cache: 'no-store' }));
      setNotice('');
    } catch { setNotice('No se pudieron consultar las transiciones.'); }
    finally { setBusy(false); }
  }
  async function approve(proposal: Proposal) {
    if (!data || busy) return;
    const fromLabel = String(relationshipPresets[proposal.from as keyof typeof relationshipPresets] ?? proposal.from);
    const toLabel = String(relationshipPresets[proposal.to as keyof typeof relationshipPresets] ?? proposal.to);
    if (!window.confirm('¿Confirmás cambiar el vínculo de «' + fromLabel + '» a «' + toLabel + '»? Esto se guardará en su historia.')) return;
    setBusy(true);
    let committed = false;
    try {
      await customFetch('/api/universe/relationships/transitions/approve?' + new URLSearchParams({ universeId }), {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, targetId, from: proposal.from, to: proposal.to, expectedRevision: data.revision }),
      });
      committed = true; setData(null);
      setNotice('Cambio confirmado en el servidor. Actualizando…');
      await actions.refreshAfterApproval();
      setData(await customFetch<Result>('/api/universe/relationships/transitions?' + query, { method: 'GET', responseType: 'json', cache: 'no-store' }));
      setNotice('El vínculo cambió a «' + toLabel + '».');
    } catch {
      setData(null);
      setNotice(committed ? 'El vínculo cambió en el servidor, pero la pantalla no se actualizó. Sincronizá y revisá.' : 'No se pudo confirmar el cambio. Sincronizá y revisá.');
    } finally { setBusy(false); }
  }
  return <section className="mt-4 rounded-xl border border-border p-3">
    <div className="flex items-center justify-between gap-2">
      <strong className="text-sm">Evolución del vínculo</strong>
      <button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg border px-3 py-2 text-xs">Evaluar transiciones</button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Los indicadores solo sugieren posibilidades. Nunca cambian el tipo de relación sin tu confirmación.</p>
    {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
    {data && <div className="mt-2 space-y-2">
      {data.proposals.length ? data.proposals.map(proposal => <div key={proposal.to} className="rounded-lg border p-2">
        <p className="text-xs font-semibold">{String(relationshipPresets[proposal.from as keyof typeof relationshipPresets] ?? proposal.from)} → {String(relationshipPresets[proposal.to as keyof typeof relationshipPresets] ?? proposal.to)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{proposal.rationale}</p>
        <button type="button" disabled={busy} onClick={() => void approve(proposal)} className="mt-2 rounded-lg border px-3 py-2 text-xs">Confirmar transición</button>
      </div>) : <p className="text-xs text-muted-foreground">No hay transiciones sugeridas actualmente.</p>}
      <p className="pt-2 text-sm font-semibold">Historial del vínculo</p>
      {data.history.map(entry => <p key={entry.memoryId} className="text-xs">{entry.content} · {new Date(entry.occurredAt).toLocaleString()}</p>)}
    </div>}
  </section>;
}
