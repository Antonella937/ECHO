import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { AudioLines, Plus, RefreshCw, ShieldCheck, Music2, Clapperboard, CreditCard, ChevronRight } from 'lucide-react';
import { customFetch, useGetCreatorAccount } from '@workspace/api-client-react';

type Entitlements = {
  plan: 'free' | 'plus' | 'premium';
  lifetimeAccess?: 'owner_lifetime' | 'founder_lifetime' | null;
  billingExempt?: boolean;
  features: { basicVoices: boolean; customVoices: boolean; music: boolean; videos: boolean };
  voice: { enabled: boolean; engineConfigured: boolean; monthlyCharacterLimit: number; usedCharacters: number;
    remainingCharacters: number; maxDailyMessages: number; usedMessagesToday: number; remainingMessagesToday: number };
};

export function PlanAndQuotaSettings() {
  const [data, setData] = useState<Entitlements | null>(null);
  const capacity = useGetCreatorAccount();
  const [details, setDetails] = useState<'plans' | 'character' | 'world' | 'music' | 'video' | 'billing' | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true); setError(false);
    void customFetch<Entitlements>('/api/account/entitlements', { responseType: 'json' })
      .then(setData).catch(() => { setData(null); setError(true); }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);
  const name = data?.plan === 'premium' ? 'ECHO Premium' : data?.plan === 'plus' ? 'ECHO Plus' : 'ECHO Free';
  const isOwner = data?.lifetimeAccess === 'owner_lifetime' && data?.billingExempt === true;
  const isTester = data?.lifetimeAccess === 'founder_lifetime' && data?.billingExempt === true;
  const complimentary = isOwner || isTester;
  const active = Boolean(data?.features.basicVoices && data.voice.enabled && data.voice.engineConfigured);
  return <section className="mt-9" aria-labelledby="plan-quota-h" data-testid="section-plan-quotas">
    <h2 id="plan-quota-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Mi plan y suscripciones</h2>
    {isOwner && <div className="mt-3 rounded-2xl border border-primary/40 bg-primary/10 p-5" data-testid="owner-founder-welcome"><div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">ECHO · Founder & Creator</div><h3 className="mt-2 text-xl font-semibold">Este universo empezó con vos, Nela. ♡</h3><p className="mt-2 text-sm text-muted-foreground">Como creadora de ECHO, tenés acceso vitalicio de cortesía a los planes de suscripción, sin pagar cuotas de membresía. Este espacio también es tuyo.</p><p className="mt-3 text-xs text-muted-foreground">Los servicios externos y el consumo de IA pueden generar costos por separado. Las herramientas que aún no se lanzaron se habilitarán cuando estén disponibles.</p></div>}
    {isTester && <div className="mt-3 rounded-2xl border border-primary/40 bg-primary/10 p-5" data-testid="founder-tester-welcome"><div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">ECHO · Founding Tester</div><h3 className="mt-2 text-xl font-semibold">Ala, gracias por ayudar a darle vida a ECHO. ♡</h3><p className="mt-2 text-sm text-muted-foreground">Por acompañar ECHO desde sus primeras pruebas, tenés acceso vitalicio de cortesía a todos los planes y complementos de suscripción, sin pagar membresías.</p><p className="mt-3 text-xs text-muted-foreground">La generación con IA y los servicios externos pueden tener costos de uso. Las funciones que aún no se lanzaron se habilitarán cuando estén disponibles.</p></div>}
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-xs text-muted-foreground">Tu suscripción actual</div><h3 className="mt-1 text-lg font-bold">{loading ? 'Consultando…' : error ? 'No disponible' : isOwner ? 'ECHO Founder · Premium incluido' : isTester ? 'ECHO Founding Tester · Premium incluido' : name}</h3></div>
        <ShieldCheck className="h-5 w-5 text-muted-foreground" />
      </div>
      {complimentary && <p className="mt-2 text-xs font-medium text-primary">Membresía vitalicia · Sin cargos de suscripción</p>}
      {capacity.data && <p className="mt-2 text-xs text-muted-foreground">{capacity.data.characterCount} / {capacity.data.maxCharacters} personajes · {capacity.data.universeCount} / {capacity.data.maxUniverses} mundos</p>}
      {error ? <div role="alert" className="mt-3 text-xs text-destructive">No pudimos verificar tu plan. Las funciones de pago permanecen bloqueadas.</div> : data ? <>
        <div className="mt-4 flex items-center gap-2 text-sm font-semibold"><AudioLines className="h-4 w-4" /> Voces de personajes</div>
        <p className="mt-1 text-xs text-muted-foreground">{!data.features.basicVoices ? 'Disponibles en ECHO Plus y Premium.' : active ? 'Voces habilitadas dentro de tu cuota.' : 'Incluidas en tu plan; la generación aún no está activada para tu cuenta.'}</p>
        <div className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs">
          <div className="flex justify-between gap-2"><span>Caracteres de voz este mes</span><strong>{data.voice.usedCharacters.toLocaleString('es-AR')} / {data.voice.monthlyCharacterLimit.toLocaleString('es-AR')}</strong></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary" style={{ width: data.voice.monthlyCharacterLimit ? `${Math.min(100, 100 * data.voice.usedCharacters / data.voice.monthlyCharacterLimit)}%` : '0%' }} /></div>
          <div className="mt-3 flex justify-between gap-2"><span>Mensajes de voz últimas 24 h</span><strong>{data.voice.usedMessagesToday} / {data.voice.maxDailyMessages}</strong></div>
        </div>
      </> : null}
      <button type="button" onClick={() => setDetails(details === 'plans' ? null : 'plans')} className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">Ver planes Free, Plus y Premium <ChevronRight className="h-4 w-4" /></button>
      <button type="button" onClick={load} disabled={loading} className="mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Actualizar estado</button>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <Link href="/characters/new" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card/60 p-3 text-center text-xs font-semibold"><Plus className="h-4 w-4" /> Crear personaje</Link>
      <Link href="/creator-preview/universes" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card/60 p-3 text-center text-xs font-semibold"><Plus className="h-4 w-4" /> Crear universo</Link>
    </div>
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <h3 className="text-sm font-semibold">Ampliar mi universo</h3>
      <p className="mt-1 text-xs text-muted-foreground">Espacios adicionales mensuales, independientes del plan principal.</p>
      {([['character', '+1 personaje'], ['world', '+1 mundo']] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setDetails(details === id ? null : id)} className="mt-3 flex min-h-14 w-full items-center justify-between rounded-xl border border-border px-3 text-left text-sm font-semibold"><span><Plus className="mr-2 inline h-4 w-4" />{label}</span><ChevronRight className="h-4 w-4" /></button>)}
    </div>
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <h3 className="text-sm font-semibold">Complementos independientes</h3>
      {([['music', 'ECHO Music', Music2], ['video', 'ECHO Video', Clapperboard]] as const).map(([id, label, Icon]) => <button key={id} type="button" onClick={() => setDetails(details === id ? null : id)} className="mt-3 flex min-h-14 w-full items-center justify-between rounded-xl border border-border px-3 text-left text-sm font-semibold"><span className="flex items-center gap-2"><Icon className="h-4 w-4" />{label}</span><ChevronRight className="h-4 w-4" /></button>)}
    </div>
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <button type="button" onClick={() => setDetails(details === 'billing' ? null : 'billing')} className="flex min-h-10 w-full items-center justify-between text-sm font-semibold"><span className="flex items-center gap-2"><CreditCard className="h-4 w-4" />Mis suscripciones y facturación</span><ChevronRight className="h-4 w-4" /></button>
    </div>
    {details && <div role="region" aria-live="polite" className="mt-3 rounded-2xl border border-primary/30 bg-card p-4" data-testid="subscription-detail">
      <h3 className="text-sm font-bold">{details === 'plans' ? 'Comparar planes' : details === 'character' ? 'Espacio adicional de personaje' : details === 'world' ? 'Espacio adicional de mundo' : details === 'music' ? 'ECHO Music' : details === 'video' ? 'ECHO Video' : 'Suscripciones y pagos'}</h3>
      {details === 'plans' ? <div className="mt-3 space-y-2 text-xs text-muted-foreground"><p><strong className="text-foreground">Free:</strong> funciones sociales y creación básica.</p><p><strong className="text-foreground">Plus:</strong> voces genéricas, memoria y capacidad ampliadas.</p><p><strong className="text-foreground">Premium:</strong> todo Plus y futuras voces personalizadas.</p><p>Los precios y las cuotas finales todavía no están definidos. No se puede contratar un plan durante la beta.</p></div>
      : details === 'billing' ? <p className="mt-2 text-xs text-muted-foreground">No hay un procesador de pagos conectado. No se pueden iniciar cobros, cambiar suscripciones ni consultar facturas todavía.</p>
      : <p className="mt-2 text-xs text-muted-foreground">{details === 'character' ? 'Permitirá sumar un personaje por suscripción mensual.' : details === 'world' ? 'Permitirá sumar un mundo con personajes incluidos mediante suscripción mensual.' : details === 'music' ? 'Complemento independiente para generación musical.' : 'Complemento independiente para creación de videos.'} La contratación se habilitará cuando definamos precios y conectemos la facturación.</p>}
      {(details === 'character' || details === 'world') && <Link href="/creator-preview/universes" className="mt-3 flex min-h-11 items-center justify-center rounded-xl border border-border text-xs font-semibold">Ver mi capacidad actual</Link>}
      <button type="button" onClick={() => setDetails(null)} className="mt-3 min-h-10 w-full rounded-xl bg-secondary text-xs font-semibold">Cerrar detalle</button>
    </div>}
    <p className="mt-3 px-1 text-[11px] text-muted-foreground">Beta privada · Sin compras activas. Los espacios adicionales vencidos se archivarán, no se eliminarán de inmediato, cuando esté implementada la gestión de renovaciones.</p>
  </section>;
}
