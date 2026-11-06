import { useHelpCenterText } from '@/lib/help-center-translations';
import { useEffect, useState } from 'react';
import { useUser } from '@clerk/react';
import { Link } from 'wouter';
import { getSupportTickets, submitSupportTicket, type Ticket } from '@/lib/support-tickets';
import { ArrowLeft, Bug, ShieldAlert, CreditCard, LockKeyhole, LifeBuoy } from 'lucide-react';

const email = 'echoverse.support.n@gmail.com';
const categories = [
  { value: 'technical', label: 'Problema técnico', icon: Bug },
  { value: 'safety', label: 'Denunciar contenido o conducta', icon: ShieldAlert },
  { value: 'billing', label: 'Pagos, créditos o reintegros', icon: CreditCard },
  { value: 'privacy', label: 'Privacidad y datos personales', icon: LockKeyhole },
  { value: 'other', label: 'Otra consulta', icon: LifeBuoy },
] as const;

export default function HelpCenterPage() {
  const { user } = useUser();
  const t = useHelpCenterText();
  const [category, setCategory] = useState<string>('technical');
  const [area, setArea] = useState('');
  const [description, setDescription] = useState('');
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsError, setTicketsError] = useState(false);
  const refreshTickets = async () => {
    try { setTickets(await getSupportTickets()); setTicketsError(false); }
    catch { setTickets([]); setTicketsError(true); }
  };
  useEffect(() => {
    let active = true;
    setTickets([]);
    setTicketsError(false);
    if (user?.id) {
      void getSupportTickets().then(items => {
        if (active) { setTickets(items); setTicketsError(false); }
      }).catch(() => {
        if (active) { setTickets([]); setTicketsError(true); }
      });
    }
    return () => { active = false; };
  }, [user?.id]);
  const send = async () => {
    if (!description.trim() || !consent || sending) return;
    setSending(true);
    setFeedback('');
    try {
      const id = await submitSupportTicket(category, area, description.trim());
      setFeedback(t("Reporte recibido. Número de seguimiento: ") + id);
      void refreshTickets();
      setDescription('');
      setArea('');
      setConsent(false);
    } catch {
      setFeedback(t("No pudimos guardar el reporte. Intentá nuevamente o escribinos a ") + email);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 text-foreground">
      <Link href="/settings" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Volver a Configuración</Link>
      <div className="mb-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">{t("ECHO · Asistencia")}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{t("Centro de ayuda")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("Contanos qué pasó. Los reportes técnicos nos ayudan a mejorar ECHO durante la beta.")}</p>
      </div>
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <label htmlFor="echo-report-kind" className="block text-sm font-semibold">{t("¿En qué podemos ayudarte?")}</label>
        <select id="echo-report-kind" value={category} onChange={e => setCategory(e.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-sm">
          {categories.map(item => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
        </select>
        <label htmlFor="echo-report-area" className="mt-5 block text-sm font-semibold">{t("¿En qué sección ocurrió? (opcional)")}</label>
        <input id="echo-report-area" maxLength={120} value={area} onChange={e => setArea(e.target.value)} placeholder={t("Ej.: Personajes, mensajes, imágenes…")} className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-sm" />
        <label htmlFor="echo-report-description" className="mt-5 block text-sm font-semibold">{t("Describí el problema")}</label>
        <textarea id="echo-report-description" required maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} rows={6} placeholder={t("¿Qué estabas haciendo? ¿Qué esperabas que pasara? ¿Qué pasó realmente?")} className="mt-2 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm" />
        <label className="mt-5 flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 accent-primary" />
          Autorizo enviar esta descripción al equipo de soporte. No se adjuntan automáticamente conversaciones, imágenes ni datos de sesión.
        </label>
        <button type="button" onClick={() => void send()} disabled={!description.trim() || !consent || sending} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">{sending ? t('Enviando…') : t('Enviar reporte')}</button>
        {feedback && <p role="status" className="mt-3 break-words text-xs text-muted-foreground">{feedback}</p>}
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('Los reportes quedan asociados a tu cuenta. Para soporte alternativo: ')}{email}</p>
      </div>
      <section className="mt-7" aria-label={t("Mis reportes")}>
        <h2 className="text-lg font-semibold">{t("Mis reportes")}</h2>
        {ticketsError && <p className="mt-2 text-sm text-muted-foreground">{t("No pudimos cargar tus reportes.")}</p>}
        {!ticketsError && tickets.length === 0 && <p className="mt-2 text-sm text-muted-foreground">{t("Todavía no enviaste reportes.")}</p>}
        <div className="mt-3 space-y-3">
          {tickets.map(ticket => <article key={ticket.id} className="rounded-xl border border-border bg-card/60 p-4">
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold">{ticket.category}</span><span className="text-xs text-muted-foreground">{ticket.status}</span></div>
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{ticket.description}</p>
            <p className="mt-2 break-all text-xs text-muted-foreground">{ticket.id}</p>
          </article>)}
        </div>
      </section>
    </div>
  );
}
