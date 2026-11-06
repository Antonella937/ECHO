import { useState } from 'react';
import { useUser } from '@clerk/react';
import { Bell, BellOff } from 'lucide-react';

const categories = [
  ['messages', 'Mensajes privados'],
  ['likes', 'Me gusta'],
  ['comments', 'Comentarios y respuestas'],
  ['mentions', 'Menciones y etiquetas'],
] as const;
export type PushCategory = typeof categories[number][0];
export type PushPreferences = { enabled: boolean; categories: Record<PushCategory, boolean> };
const defaults: PushPreferences = { enabled: false, categories: { messages: true, likes: true, comments: true, mentions: true } };
export function readPushPreferences(ownerId: string): PushPreferences {
  try {
    const raw = localStorage.getItem('echo:push-preferences:' + ownerId);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PushPreferences>;
    return { enabled: parsed.enabled === true, categories: { ...defaults.categories, ...parsed.categories } };
  } catch { return defaults; }
}
export function PushNotificationSettings() {
  const { user } = useUser();
  const ownerId = user?.id ?? '';
  const [prefs, setPrefs] = useState(() => ownerId ? readPushPreferences(ownerId) : defaults);
  const [notice, setNotice] = useState('');
  const update = (next: PushPreferences) => {
    setPrefs(next);
    if (ownerId) localStorage.setItem('echo:push-preferences:' + ownerId, JSON.stringify(next));
  };
  const request = async () => {
    if (!('Notification' in window)) { setNotice('Este navegador no admite notificaciones.'); return; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setNotice('Para recibir avisos con ECHO cerrado, instalá ECHO en la pantalla de inicio desde Safari.');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setNotice('El permiso no fue concedido. Podés cambiarlo desde los ajustes del teléfono.'); return; }
      // Push delivery is not enabled until a device subscription is registered server-side.
      setNotice('Permiso concedido. La entrega push en segundo plano todavía está en preparación.');
    } catch { setNotice('No se pudo solicitar el permiso desde este navegador.'); }
  };
  return <section className="mt-9" aria-labelledby="push-h">
    <h2 id="push-h" className="flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground"><Bell className="h-4 w-4" /> Notificaciones del celular</h2>
    <div className="mt-3 space-y-3 rounded-2xl border border-border bg-card/60 p-4">
      <p className="text-xs text-muted-foreground">Elegí qué avisos querés recibir. Las notificaciones push con la app cerrada aún están en preparación.</p>
      <label className="flex items-center justify-between gap-3 text-sm font-semibold">
        <span className="flex items-center gap-2">{prefs.enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />} Activar avisos</span>
        <input type="checkbox" checked={prefs.enabled} onChange={e => update({ ...prefs, enabled: e.target.checked })} className="h-5 w-5 accent-primary" />
      </label>
      {categories.map(([key, title]) => <label key={key} className="flex items-center justify-between gap-3 border-t border-border/50 pt-3 text-sm">
        <span>{title}</span>
        <input type="checkbox" disabled={!prefs.enabled} checked={prefs.categories[key]} onChange={e => update({ ...prefs, categories: { ...prefs.categories, [key]: e.target.checked } })} className="h-5 w-5 accent-primary" />
      </label>)}
      <button type="button" onClick={() => void request()} className="rounded-xl border border-border px-3 py-2 text-xs font-semibold">Comprobar permiso del dispositivo</button>
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    </div>
  </section>;
}
