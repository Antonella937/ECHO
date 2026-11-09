import { customFetch } from '@workspace/api-client-react';
import { useCreatorHubDmCopy } from '@/lib/creator-hub-notifications';
import { useAdvancedSettingsText } from '@/lib/advanced-settings-translations';
import { useEffect, useState } from 'react';
import { useUser } from '@clerk/react';
import { Bell, BellOff } from 'lucide-react';
import { getOneSignal, connectOneSignalOwner, isOneSignalConfigured } from '@/lib/onesignal';

const categories = [
  ['messages', 'Mensajes privados'],
  ['groups', 'Mensajes de grupos'],
  ['likes', 'Me gusta'],
  ['comments', 'Comentarios y respuestas'],
  ['mentions', 'Menciones y etiquetas'],
  ['creatorHub', 'Creator Hub'],
] as const;
export type PushCategory = typeof categories[number][0];
export type PushPreferences = { enabled: boolean; categories: Record<PushCategory, boolean> };
const defaults: PushPreferences = { enabled: false, categories: { messages: true, groups: true, likes: true, comments: true, mentions: true, creatorHub: true } };
export function readPushPreferences(ownerId: string): PushPreferences {
  try {
    const raw = localStorage.getItem('echo:push-preferences:' + ownerId);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PushPreferences>;
    return { enabled: parsed.enabled === true, categories: { ...defaults.categories, ...parsed.categories } };
  } catch { return defaults; }
}
export function PushNotificationSettings() {
  const t = useAdvancedSettingsText();
  const creatorCopy = useCreatorHubDmCopy();
  const { user } = useUser();
  const ownerId = user?.id ?? '';
  const [prefs, setPrefs] = useState(() => ownerId ? readPushPreferences(ownerId) : defaults);
  const [notice, setNotice] = useState('');
  useEffect(() => { if (ownerId) setPrefs(readPushPreferences(ownerId)); }, [ownerId]);
  const syncCreatorHubPush = async (enabled: boolean) => {
    await customFetch("/api/creator-hub/social/dm-notifications/push-preference", { method: "PUT", responseType: "json", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
  };
  const update = (next: PushPreferences) => {
    setPrefs(next);
    if (ownerId) localStorage.setItem('echo:push-preferences:' + ownerId, JSON.stringify(next));
  };
  const request = async () => {
    if (!ownerId) { setNotice(t("Iniciá sesión para activar las notificaciones.")); return; }
    if (!isOneSignalConfigured()) { setNotice(t("OneSignal todavía no está configurado.")); return; }
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setNotice(t("En iPhone, abrí ECHO desde Safari y agregalo a la pantalla de inicio antes de activar los avisos."));
      return;
    }
    try {
      setNotice(t("Conectando con OneSignal…"));
      await connectOneSignalOwner(ownerId);
      const client = await getOneSignal();
      const allowed = await client.Notifications.requestPermission();
      if (!allowed) { setNotice(t("No se concedió permiso para notificaciones.")); return; }
      update({ ...prefs, enabled: true });
      setNotice(t('Notificaciones activadas en este dispositivo.'));
      // Creator Hub preference is optional; its API must not turn a successful
      // OneSignal subscription into a misleading generic 'Load failed' error.
      try { await syncCreatorHubPush(prefs.categories.creatorHub); }
      catch { setNotice(t('Notificaciones activadas. No se pudo sincronizar la preferencia de Creator Hub.')); }
    } catch (error) {
      console.warn('OneSignal subscription setup failed', error);
      setNotice(t('No se pudo completar la conexión de notificaciones. Comprobá tu conexión e intentá nuevamente.'));
    }
  };
  return <section className="mt-9" aria-labelledby="push-h">
    <h2 id="push-h" className="flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground"><Bell className="h-4 w-4" /> {t("Notificaciones del celular")}</h2>
    <div className="mt-3 space-y-3 rounded-2xl border border-border bg-card/60 p-4">
      <p className="text-xs text-muted-foreground">{t("Elegí qué avisos querés recibir. Para recibir avisos con ECHO cerrado, activá las notificaciones en este dispositivo. Los mensajes grupales todavía requieren conexión de envío push desde el servidor.")}</p>
      <label className="flex items-center justify-between gap-3 text-sm font-semibold">
        <span className="flex items-center gap-2">{prefs.enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />} {t("Activar avisos")}</span>
        <input type="checkbox" checked={prefs.enabled} onChange={e => { if (e.target.checked) { void request(); } else { const next = { ...prefs, enabled: false }; update(next); void syncCreatorHubPush(false).catch(() => setNotice(t("No se pudo desactivar el aviso de Creator Hub."))); } }} className="h-5 w-5 accent-primary" />
      </label>
      {categories.map(([key, title]) => <label key={key} className="flex items-center justify-between gap-3 border-t border-border/50 pt-3 text-sm">
        <span>{key === 'creatorHub' ? creatorCopy.setting : t(title)}</span>
        <input type="checkbox" disabled={!prefs.enabled} checked={prefs.categories[key]} onChange={e => { const next = { ...prefs, categories: { ...prefs.categories, [key]: e.target.checked } }; update(next); if (key === "creatorHub") void syncCreatorHubPush(next.enabled && next.categories.creatorHub).catch(() => setNotice(t("No se pudo activar OneSignal."))); }} className="h-5 w-5 accent-primary" />
      </label>)}
      <button type="button" onClick={() => void request()} className="rounded-xl border border-border px-3 py-2 text-xs font-semibold">{t("Activar notificaciones en este dispositivo")}</button>
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    </div>
  </section>;
}
