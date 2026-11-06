import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AudioLines, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';

type Entitlements = {
  plan: 'free' | 'plus' | 'premium';
  features: { basicVoices: boolean; customVoices: boolean; music: boolean; videos: boolean };
  voice: { enabled: boolean; engineConfigured: boolean; monthlyCharacterLimit: number; usedCharacters: number;
    remainingCharacters: number; maxDailyMessages: number; usedMessagesToday: number; remainingMessagesToday: number };
};

export function PlanAndQuotaSettings() {
  const [data, setData] = useState<Entitlements | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true); setError(false);
    void customFetch<Entitlements>('/api/account/entitlements', { responseType: 'json' })
      .then(setData).catch(() => { setData(null); setError(true); }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  const name = data?.plan === 'premium' ? 'ECHO Premium' : data?.plan === 'plus' ? 'ECHO Plus' : 'ECHO Free';
  const active = Boolean(data?.features.basicVoices && data.voice.enabled && data.voice.engineConfigured);
  return <section className="mt-9" aria-labelledby="plan-quota-h" data-testid="section-plan-quotas">
    <h2 id="plan-quota-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Plan y capacidad</h2>
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-xs text-muted-foreground">Tu suscripción actual</div><h3 className="mt-1 text-lg font-bold">{loading ? 'Consultando…' : error ? 'No disponible' : name}</h3></div>
        <ShieldCheck className="h-5 w-5 text-muted-foreground" />
      </div>
      {error ? <div role="alert" className="mt-3 text-xs text-destructive">No pudimos verificar tu plan. Las funciones de pago permanecen bloqueadas.</div> : data ? <>
        <div className="mt-4 flex items-center gap-2 text-sm font-semibold"><AudioLines className="h-4 w-4" /> Voces de personajes</div>
        <p className="mt-1 text-xs text-muted-foreground">{!data.features.basicVoices ? 'Disponibles en ECHO Plus y Premium.' : active ? 'Voces habilitadas dentro de tu cuota.' : 'Incluidas en tu plan; la generación aún no está activada para tu cuenta.'}</p>
        <div className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs">
          <div className="flex justify-between gap-2"><span>Caracteres de voz este mes</span><strong>{data.voice.usedCharacters.toLocaleString('es-AR')} / {data.voice.monthlyCharacterLimit.toLocaleString('es-AR')}</strong></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary" style={{ width: data.voice.monthlyCharacterLimit ? `${Math.min(100, 100 * data.voice.usedCharacters / data.voice.monthlyCharacterLimit)}%` : '0%' }} /></div>
          <div className="mt-3 flex justify-between gap-2"><span>Mensajes de voz últimas 24 h</span><strong>{data.voice.usedMessagesToday} / {data.voice.maxDailyMessages}</strong></div>
        </div>
      </> : null}
      <button type="button" onClick={load} disabled={loading} className="mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Actualizar estado</button>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <Link href="/characters/new" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card/60 p-3 text-center text-xs font-semibold"><Plus className="h-4 w-4" /> Crear personaje</Link>
      <Link href="/creator-preview/universes" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card/60 p-3 text-center text-xs font-semibold"><Plus className="h-4 w-4" /> Crear universo</Link>
    </div>
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <h3 className="text-sm font-semibold">Ampliar tu capacidad</h3>
      <p className="mt-1 text-xs text-muted-foreground">Próximamente podrás sumar espacios mensuales sin cambiar de plan. Todavía no hay compras ni cobros habilitados.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" disabled className="rounded-xl border border-border px-3 py-3 text-xs font-semibold opacity-60">+1 espacio de personaje · Próximamente</button>
        <button type="button" disabled className="rounded-xl border border-border px-3 py-3 text-xs font-semibold opacity-60">+1 espacio de mundo · Próximamente</button>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Los espacios adicionales se podrán archivar al vencer, sin borrar inmediatamente los personajes ni sus recuerdos.</p>
    </div>
  </section>;
}
