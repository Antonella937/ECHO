import { useState } from 'react';
import { Link } from 'wouter';
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
  const [category, setCategory] = useState<string>('technical');
  const [area, setArea] = useState('');
  const [description, setDescription] = useState('');
  const [consent, setConsent] = useState(false);
  const selected = categories.find(item => item.value === category) ?? categories[0];
  const send = () => {
    if (!description.trim() || !consent) return;
    const subject = `ECHO · ${selected.label}`;
    const body = `Tipo: ${selected.label}\nSección afectada: ${area || 'No indicada'}\n\nDescripción:\n${description.trim()}\n\nNo se adjuntaron datos privados automáticamente.`;
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6 text-foreground">
      <Link href="/settings" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Volver a Configuración</Link>
      <div className="mb-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">ECHO · Asistencia</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Centro de ayuda</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Contanos qué pasó. Los reportes técnicos nos ayudan a mejorar ECHO durante la beta.</p>
      </div>
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <label htmlFor="echo-report-kind" className="block text-sm font-semibold">¿En qué podemos ayudarte?</label>
        <select id="echo-report-kind" value={category} onChange={e => setCategory(e.target.value)} className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-sm">
          {categories.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <label htmlFor="echo-report-area" className="mt-5 block text-sm font-semibold">¿En qué sección ocurrió? (opcional)</label>
        <input id="echo-report-area" maxLength={120} value={area} onChange={e => setArea(e.target.value)} placeholder="Ej.: Personajes, mensajes, imágenes…" className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-sm" />
        <label htmlFor="echo-report-description" className="mt-5 block text-sm font-semibold">Describí el problema</label>
        <textarea id="echo-report-description" required maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} rows={6} placeholder="¿Qué estabas haciendo? ¿Qué esperabas que pasara? ¿Qué pasó realmente?" className="mt-2 w-full resize-y rounded-xl border border-border bg-background p-3 text-sm" />
        <label className="mt-5 flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-0.5 accent-primary" />
          Entiendo que se abrirá mi aplicación de correo para revisar y enviar este reporte. ECHO no adjunta automáticamente conversaciones, imágenes ni datos de sesión.
        </label>
        <button type="button" onClick={send} disabled={!description.trim() || !consent} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">Preparar correo de soporte</button>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Versión beta: este formulario todavía no genera tickets ni los guarda en un panel administrativo. Tu correo se enviará solamente si lo confirmás en tu aplicación de email.</p>
      </div>
    </div>
  );
}
