import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { getSupportTickets, updateSupportTicket, type Ticket } from '@/lib/support-tickets';

const states = ['open', 'investigating', 'resolved', 'closed'] as const;

export default function SupportAdminPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const refresh = async () => {
    setLoading(true);
    try {
      const items = await getSupportTickets(true);
      setTickets(items);
      setNotes(Object.fromEntries(items.map(t => [t.id, t.admin_note ?? ''])));
      setStatuses(Object.fromEntries(items.map(t => [t.id, t.status])));
      setError('');
    } catch {
      setTickets([]);
      setNotes({});
      setStatuses({});
      setError('No tenés acceso al panel o no pudimos cargar los reportes.');
    }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const save = async (ticket: Ticket) => {
    setBusy(ticket.id);
    try {
      await updateSupportTicket(ticket.id, statuses[ticket.id] ?? ticket.status, notes[ticket.id] ?? '');
      await refresh();
    } catch { setError('No se pudo actualizar el reporte.'); }
    finally { setBusy(null); }
  };
  return <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6 text-foreground">
    <Link href="/settings" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Configuración</Link>
    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">ECHO · Administración</p>
    <h1 className="mt-2 text-3xl font-semibold">Reportes de soporte</h1>
    <p className="mt-2 text-sm text-muted-foreground">Solo cuentas autorizadas pueden consultar y gestionar reportes.</p>
    {error && <p role="alert" className="mt-5 rounded-xl border border-destructive/40 p-4 text-sm text-destructive">{error}</p>}
    {loading ? <p className="mt-6 text-sm text-muted-foreground">Cargando reportes…</p> : tickets.length === 0 && !error ? <p className="mt-6 text-sm text-muted-foreground">Todavía no hay reportes.</p> : null}
    <div className="mt-6 space-y-4">
      {tickets.map(ticket => <section key={ticket.id} className="rounded-2xl border border-border bg-card/60 p-5">
        <p className="text-xs text-muted-foreground">{ticket.category} · {new Date(ticket.created_at).toLocaleString('es-AR')}</p>
        <p className="mt-2 break-all text-xs text-muted-foreground">Ticket: {ticket.id} · Cuenta: {ticket.owner_id}</p>
        <p className="mt-2 text-sm font-semibold">{ticket.area || 'Sin sección indicada'}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{ticket.description}</p>
        <label className="mt-4 block text-xs font-semibold">Estado
          <select value={statuses[ticket.id] ?? ticket.status} onChange={e => setStatuses(prev => ({ ...prev, [ticket.id]: e.target.value }))} className="mt-2 block w-full rounded-xl border border-border bg-background p-3 text-sm">
            {states.map(state => <option key={state} value={state}>{state}</option>)}
          </select>
        </label>
        <label className="mt-4 block text-xs font-semibold">Nota interna
          <textarea maxLength={2000} rows={3} value={notes[ticket.id] ?? ''} onChange={e => setNotes(prev => ({ ...prev, [ticket.id]: e.target.value }))} className="mt-2 block w-full rounded-xl border border-border bg-background p-3 text-sm" />
        </label>
        <button disabled={busy !== null} onClick={() => void save(ticket)} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">{busy === ticket.id ? 'Guardando…' : 'Guardar cambios'}</button>
      </section>)}
    </div>
  </div>;
}
