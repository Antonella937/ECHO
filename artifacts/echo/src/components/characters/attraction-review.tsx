import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useSocial } from '@/store/social-store';

type Candidate = { sourceId: string; excerpt: string };
type Entry = { memoryId: string; content: string; occurredAt: string };
const types = {
  mutual_flirting_confirmed: 'Coqueteo mutuo',
  affection_reciprocated: 'Afecto correspondido',
  romantic_interest_confirmed: 'Interés romántico confirmado',
  romantic_boundary_respected: 'Límite respetado',
  romantic_interest_declined: 'Interés romántico rechazado',
  romantic_distance_confirmed: 'Distanciamiento romántico',
};
export function AttractionReview({ actorId, targetId }: { actorId: string; targetId: string }) {
  const { universeId, actions } = useSocial();
  const [items, setItems] = useState<Candidate[]>([]);
  const [history, setHistory] = useState<Entry[]>([]);
  const [revision, setRevision] = useState<number | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const query = new URLSearchParams({ universeId, actorId, targetId });
  async function load() {
    setBusy(true);
    try {
      const result = await customFetch<{ revision: number; candidates: Candidate[] }>('/api/universe/relationships/attraction/candidates?' + query, { method: 'GET', responseType: 'json' });
      const past = await customFetch<{ entries: Entry[] }>('/api/universe/relationships/attraction/history?' + query, { method: 'GET', responseType: 'json' });
      setItems(result.candidates); setRevision(result.revision); setHistory(past.entries); setMessage('');
    } catch { setMessage('No se pudo consultar el historial.'); }
    finally { setBusy(false); }
  }
  async function approve(item: Candidate) {
    if (revision === null || !selected[item.sourceId]) return;
    setBusy(true);
    try {
      await customFetch('/api/universe/relationships/attraction/approve?' + new URLSearchParams({ universeId }), {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actorId, targetId, sourceId: item.sourceId, kind: selected[item.sourceId], expectedRevision: revision }),
      });
      setRevision(null); setItems([]); await actions.refreshAfterApproval();
      setMessage('Acontecimiento confirmado. Revisá nuevamente para ver el historial.');
    } catch { setRevision(null); setMessage('No se pudo confirmar. Sincronizá y volvé a consultar.'); }
    finally { setBusy(false); }
  }
  if (targetId === 'owner') return null;
  return <section className="mt-4 rounded-xl border border-border p-3">
    <div className="flex items-center justify-between gap-2">
      <strong className="text-sm">Evolución de atracción</strong>
      <button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg border px-3 py-2 text-xs">Revisar mensajes</button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">Seleccioná el acontecimiento real antes de confirmar. Ningún cambio es automático.</p>
    {message && <p role="status" className="mt-2 text-xs">{message}</p>}
    {revision !== null && <ul className="mt-2 space-y-2">{items.map(item => <li key={item.sourceId} className="rounded-lg border p-2">
      <p className="text-xs">{item.excerpt}</p>
      <select aria-label="Acontecimiento" className="mt-2 w-full rounded-lg border bg-background p-2 text-xs" value={selected[item.sourceId] ?? ''} onChange={e => setSelected(s => ({ ...s, [item.sourceId]: e.target.value }))}>
        <option value="">Elegir acontecimiento</option>
        {Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button type="button" disabled={busy || !selected[item.sourceId]} onClick={() => void approve(item)} className="mt-2 rounded-lg border px-3 py-2 text-xs">Confirmar</button>
    </li>)}</ul>}
    <p className="mt-3 text-sm font-semibold">Historial de atracción</p>
    {history.map(entry => <p key={entry.memoryId} className="mt-2 text-xs">{entry.content} · {new Date(entry.occurredAt).toLocaleString()}</p>)}
  </section>;
}
