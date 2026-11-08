import { usePlanQuotaText } from '@/lib/plan-quota-translations';
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

type CreditWallet = {
  history: {kind:"photo"|"voice";bucket:"monthly"|"reward"|"purchased";amount:number;event_key:string;created_at:string}[];
  balances: { photo: { monthly: number; reward: number; purchased: number }; voice: { monthly: number; reward: number; purchased: number } };
  dailyReward: { available: boolean; claimedToday: boolean; streak: number; photoCredits: number; voiceCredits: number; nextResetAt: string };
};

export function PlanAndQuotaSettings() {
  const t = usePlanQuotaText();
  const [wallet, setWallet] = useState<CreditWallet | null>(null);
  const [walletError, setWalletError] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimMessage, setClaimMessage] = useState("");
  const loadWallet = () => { void customFetch<CreditWallet>("/api/creator/credits/wallet", { responseType: "json" }).then(value => { setWallet(value); setWalletError(false); }).catch(() => setWalletError(true)); };
  useEffect(() => { loadWallet(); }, []);
  const claimReward = async () => { setClaiming(true); setClaimMessage(""); try { const result = await customFetch<CreditWallet>("/api/creator/credits/daily-reward", { method: "POST", responseType: "json" }); setWallet(result); setClaimMessage(t("¡Recompensa diaria reclamada!")); } catch { setClaimMessage(t("No se pudo reclamar la recompensa. Actualizá para comprobar el estado.")); loadWallet(); } finally { setClaiming(false); } };
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
  return <section className="mt-5 pb-28 lg:pb-8" aria-labelledby="plan-quota-h" data-testid="section-plan-quotas">
    <h2 id="plan-quota-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t("Mi plan y suscripciones")}</h2>
    {isOwner && <div className="mt-3 rounded-2xl border border-primary/40 bg-primary/10 p-5" data-testid="owner-founder-welcome"><div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">ECHO · Founder & Creator</div><h3 className="mt-2 text-xl font-semibold">{t("Este universo empezó con vos, Nela. ♡")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("Como creadora de ECHO, tenés acceso vitalicio de cortesía a los planes de suscripción, sin pagar cuotas de membresía. Este espacio también es tuyo.")}</p><p className="mt-3 text-xs text-muted-foreground">{t("Los servicios externos y el consumo de IA pueden generar costos por separado. Las herramientas que aún no se lanzaron se habilitarán cuando estén disponibles.")}</p></div>}
    {isTester && <div className="mt-3 rounded-2xl border border-primary/40 bg-primary/10 p-5" data-testid="founder-tester-welcome"><div className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary">ECHO · Founding Tester</div><h3 className="mt-2 text-xl font-semibold">{t("Ala, gracias por ayudar a darle vida a ECHO. ♡")}</h3><p className="mt-2 text-sm text-muted-foreground">{t("Por acompañar ECHO desde sus primeras pruebas, tenés acceso vitalicio de cortesía a todos los planes y complementos de suscripción, sin pagar membresías.")}</p><p className="mt-3 text-xs text-muted-foreground">{t("La generación con IA y los servicios externos pueden tener costos de uso. Las funciones que aún no se lanzaron se habilitarán cuando estén disponibles.")}</p></div>}
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div><div className="text-xs text-muted-foreground">{t("Tu suscripción actual")}</div><h3 className="mt-1 text-lg font-bold">{loading ? t("Consultando…") : error ? t("No disponible") : isOwner ? `ECHO Founder · ${t('Premium incluido')}` : isTester ? `ECHO Founding Tester · ${t('Premium incluido')}` : name}</h3></div>
        <ShieldCheck className="h-5 w-5 text-muted-foreground" />
      </div>
      {complimentary && <p className="mt-2 text-xs font-medium text-primary">{t("Membresía vitalicia · Sin cargos de suscripción")}</p>}
      {capacity.data && <p className="mt-2 text-xs text-muted-foreground">{complimentary ? `${capacity.data.characterCount} ${t('personajes')} · ${capacity.data.universeCount} ${t('mundos')} · ${t('Sin límite comercial')}` : `${capacity.data.characterCount} / ${capacity.data.maxCharacters} ${t('personajes')} · ${capacity.data.universeCount} / ${capacity.data.maxUniverses} ${t('mundos')}`}</p>}
      {error ? <div role="alert" className="mt-3 text-xs text-destructive">{t("No pudimos verificar tu plan. Las funciones de pago permanecen bloqueadas.")}</div> : data ? <>
        <div className="mt-4 flex items-center gap-2 text-sm font-semibold"><AudioLines className="h-4 w-4" /> {t("Voces de personajes")}</div>
        <p className="mt-1 text-xs text-muted-foreground">{!data.features.basicVoices ? t("Disponibles en ECHO Plus y Premium.") : active ? t("Voces habilitadas dentro de tu cuota.") : t("Incluidas en tu plan; la generación aún no está activada para tu cuenta.")}</p>
        <div className="mt-3 rounded-xl bg-secondary/60 p-3 text-xs">
          <div className="flex justify-between gap-2"><span>{t("Caracteres de voz este mes")}</span><strong>{data.voice.usedCharacters.toLocaleString()} / {data.voice.monthlyCharacterLimit.toLocaleString()}</strong></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary" style={{ width: data.voice.monthlyCharacterLimit ? `${Math.min(100, 100 * data.voice.usedCharacters / data.voice.monthlyCharacterLimit)}%` : '0%' }} /></div>
          <div className="mt-3 flex justify-between gap-2"><span>{t("Mensajes de voz últimas 24 h")}</span><strong>{data.voice.usedMessagesToday} / {data.voice.maxDailyMessages}</strong></div>
        </div>
      </> : null}
      <button type="button" onClick={() => setDetails(details === 'plans' ? null : 'plans')} className="mt-3 flex min-h-11 w-full items-center justify-between rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground">{t("Ver planes Free, Plus y Premium")} <ChevronRight className="h-4 w-4" /></button>
      <button type="button" onClick={load} disabled={loading} className="mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> {t("Actualizar estado")}</button>
    </div>
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4" data-testid="echo-credit-wallet">
      <h3 className="text-sm font-bold">{t("Mi monedero ECHO")}</h3>
      {wallet ? <>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(["photo","voice"] as const).map(kind => <div key={kind} className="rounded-xl bg-secondary/50 p-3"><div className="text-xs text-muted-foreground">{kind === "photo" ? "Photo Credits" : "Voice Credits"}</div><div className="mt-1 text-2xl font-bold">{Object.values(wallet.balances[kind]).reduce((a,b)=>a+b,0)}</div><div className="mt-1 text-[10px] text-muted-foreground">{t("Mensuales")}: {wallet.balances[kind].monthly} · {t("Regalos")}: {wallet.balances[kind].reward} · {t("Comprados")}: {wallet.balances[kind].purchased}</div></div>)}
        </div>
        <div className="mt-3 rounded-xl border border-border p-3">
          <div className="text-sm font-semibold">{t("Regalo diario")} 🎁</div>
          <p className="mt-1 text-xs text-muted-foreground">{wallet.dailyReward.claimedToday ? t("Ya reclamaste tu recompensa de hoy.") : t("Tu recompensa de hoy está lista.")}</p>
          {wallet.dailyReward.claimedToday && <p className="mt-1 text-xs text-muted-foreground">{t("Racha")}: {wallet.dailyReward.streak}/7 · +{wallet.dailyReward.photoCredits} Photo Credits · +{wallet.dailyReward.voiceCredits} Voice Credits</p>}
          <button type="button" onClick={claimReward} disabled={!wallet.dailyReward.available || claiming} className="mt-3 min-h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{claiming ? t("Reclamando…") : wallet.dailyReward.claimedToday ? t("Recompensa reclamada") : t("Abrir regalo diario")}</button>
          {claimMessage && <p role="status" className="mt-2 text-xs">{claimMessage}</p>}
        </div>
        <details className="mt-3 rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-xs font-semibold">{t("Historial de créditos")}</summary>
          {wallet.history.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">{t("Todavía no hay movimientos.")}</p> :
            <ul className="mt-2 space-y-2">{wallet.history.slice(0,20).map((item,i) => <li key={item.event_key + i} className="flex justify-between gap-2 border-b border-border/50 py-1 text-xs"><span>{item.kind === "photo" ? "Photo" : "Voice"} · {item.bucket === "reward" ? t("Regalo") : item.bucket === "monthly" ? t("Mensual") : t("Compra")}</span><span className={item.amount > 0 ? "font-semibold text-primary" : "font-semibold"}>{item.amount > 0 ? "+" : ""}{item.amount}</span></li>)}</ul>}
        </details>
      </> : <p className="mt-2 text-xs text-muted-foreground">{walletError ? t("El monedero no está disponible por ahora.") : t("Cargando créditos…")}</p>}
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <Link href="/characters/new" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card/60 p-3 text-center text-xs font-semibold"><Plus className="h-4 w-4" /> {t("Crear personaje")}</Link>
      <Link href="/creator-preview/universes" className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card/60 p-3 text-center text-xs font-semibold"><Plus className="h-4 w-4" /> {t("Crear universo")}</Link>
    </div>
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <h3 className="text-sm font-semibold">{t("ECHO Credit Store")}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{t("Packs propuestos · Compras desactivadas durante la beta")}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">{([{ name: '20 Photo Credits', price: '$2.99' }, { name: '50 Photo Credits', price: '$6.49' }, { name: '100 Photo Credits', price: '$11.99' }, { name: '50 Voice Credits', price: '$2.99' }] as const).map(pack => <div key={pack.name} className="rounded-xl border border-border p-3"><div className="text-xs font-semibold">{pack.name}</div><div className="mt-1 text-lg font-bold">{pack.price}</div><div className="mt-1 text-[10px] text-muted-foreground">{t("Próximamente")}</div></div>)}</div>
      <div className="mt-4 border-t border-border pt-3">
        <h4 className="text-xs font-semibold">{t("Ampliar mi universo")}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{complimentary ? t("Tus espacios de personajes y mundos están incluidos de por vida. No necesitás comprar ampliaciones.") : t("Comprás el espacio una sola vez. La IA y la autonomía se cobran por separado.")}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(['character','world'] as const).map(id => <button key={id} type="button" onClick={() => setDetails(details === id ? null : id)} className="min-h-16 rounded-xl border border-border p-3 text-left text-xs font-semibold">
            <Plus className="mb-1 h-4 w-4" />{id === 'character' ? t("+1 personaje") : t("+1 mundo")}
            <span className="mt-1 block text-sm font-bold">{id === "character" ? "$1.99" : "$4.99"}</span><span className="mt-1 block text-[10px] text-muted-foreground">{complimentary ? t("Incluido") : t("Pago único · Próximamente")}</span>{id === "world" && <span className="mt-1 block text-[10px] text-muted-foreground">{t("Incluye 5 espacios de personajes en ese mundo.")}</span>}
          </button>)}
        </div>
      </div>
    </div>
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <h3 className="text-sm font-semibold">{t("Complementos independientes")}</h3>
      {([['music', 'ECHO Music', Music2], ['video', 'ECHO Video', Clapperboard]] as const).map(([id, label, Icon]) => <button key={id} type="button" onClick={() => setDetails(details === id ? null : id)} className="mt-3 flex min-h-14 w-full items-center justify-between rounded-xl border border-border px-3 text-left text-sm font-semibold"><span className="flex items-center gap-2"><Icon className="h-4 w-4" /> {label}</span>{complimentary && <span className="ml-auto mr-2 text-[11px] text-primary">{t("Incluido al lanzarse")}</span>}<ChevronRight className="h-4 w-4" /></button>)}
    </div>
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <button type="button" onClick={() => setDetails(details === 'billing' ? null : 'billing')} className="flex min-h-10 w-full items-center justify-between text-sm font-semibold"><span className="flex items-center gap-2"><CreditCard className="h-4 w-4" />{t("Mis suscripciones y facturación")}</span><ChevronRight className="h-4 w-4" /></button>
    </div>
    {details && <div role="region" aria-live="polite" className="mt-3 rounded-2xl border border-primary/30 bg-card p-4" data-testid="subscription-detail">
      <h3 className="text-sm font-bold">{details === 'plans' ? t("Comparar planes") : details === 'character' ? t("Espacio adicional de personaje") : details === 'world' ? t("Espacio adicional de mundo") : details === 'music' ? 'ECHO Music' : details === 'video' ? 'ECHO Video' : t("Suscripciones y pagos")}</h3>
      {details === 'plans' ? <div className="mt-3 space-y-2 text-xs text-muted-foreground"><p><strong className="text-foreground">Free:</strong> {t('1 mundo y hasta 5 personajes en total. Funciones sociales y perfiles Creator.')}</p><p><strong className="text-foreground">Plus:</strong> {t('3 mundos y hasta 15 personajes en total. Voces básicas cuando se habiliten.')}</p><p><strong className="text-foreground">Premium:</strong> {t('5 mundos y hasta 25 personajes en total. Todo Plus y futuras voces personalizadas.')}</p><p>{t("Creator Hub es un espacio para perfiles, no una membresía.")}</p><div className="mt-3 grid grid-cols-3 gap-2">{([{ label: 'Free', price: '$0', photo: 10, voice: 0 }, { label: 'Plus', price: '$12.99', photo: 60, voice: 30 }, { label: 'Premium', price: '$24.99', photo: 150, voice: 100 }] as const).map(plan => <div key={plan.label} className="rounded-xl border border-border p-2"><div className="font-bold text-foreground">{plan.label}</div><div className="mt-1 text-base font-bold text-foreground">{plan.price}<span className="text-[10px] font-normal"> / {t('mes')}</span></div><div className="mt-2">{plan.photo} Photo Credits</div><div>{plan.voice} Voice Credits</div></div>)}</div><p className="mt-3">{t("Premium: creación de voces personalizadas; mantenimiento de USD 1 por voz activa al mes, sujeto a validación de costos.")}</p><p>{t("Recompensas diarias: Free hasta 5 Photo Credits/mes; Plus hasta 15; Premium hasta 25 Photo Credits y 5 Voice Credits/mes.")}</p><p>{t("Créditos mensuales no acumulables; recompensas válidas por 30 días; créditos comprados sin vencimiento mientras la cuenta esté activa. Las generaciones fallidas devuelven los créditos.")}</p><p className="font-semibold text-foreground">{t("Precios de lanzamiento propuestos. Beta privada: compras y acreditación de créditos todavía no habilitadas.")}</p></div>
      : details === 'billing' ? <p className="mt-2 text-xs text-muted-foreground">{complimentary ? t("Tu membresía ECHO y sus complementos están incluidos de por vida. No necesitás pagar suscripciones. Los costos de proveedores externos y consumo de IA se gestionan por separado.") : t("No hay un procesador de pagos conectado. No se pueden iniciar cobros, cambiar suscripciones ni consultar facturas todavía.")}</p>
      : <p className="mt-2 text-xs text-muted-foreground">{details === 'character' ? t("Un espacio de personaje permanente por USD 1.99, con pago único. La IA y la autonomía son independientes.") : details === 'world' ? t("Un mundo permanente por USD 4.99, con 5 espacios de personajes exclusivos de ese mundo. Pago único; IA y autonomía aparte.") : details === 'music' ? t("Complemento independiente para generación musical.") : t("Complemento independiente para creación de videos.")} {complimentary ? t("Tu acceso de membresía está incluido de por vida. Esta función se habilitará cuando se lance; el consumo de servicios externos se cobra por separado.") : t("Las compras se habilitarán cuando conectemos la facturación.")}</p>}
      {(details === 'character' || details === 'world') && <Link href="/creator-preview/universes" className="mt-3 flex min-h-11 items-center justify-center rounded-xl border border-border text-xs font-semibold">{t("Ver mi capacidad actual")}</Link>}
      <button type="button" onClick={() => setDetails(null)} className="mt-3 min-h-10 w-full rounded-xl bg-secondary text-xs font-semibold">{t("Cerrar detalle")}</button>
    </div>}
    <p className="mt-3 px-1 text-[11px] text-muted-foreground">{t("Beta privada · Sin compras activas. Los espacios adicionales vencidos se archivarán, no se eliminarán de inmediato, cuando esté implementada la gestión de renovaciones.")}</p>
  </section>;
}
