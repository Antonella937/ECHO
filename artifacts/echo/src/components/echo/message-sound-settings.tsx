import { useAdvancedSettingsText } from '@/lib/advanced-settings-translations';
import { useState } from 'react';
import { Bell } from 'lucide-react';
import { getSoundPreferences, saveSoundPreferences, playMessageSound, unlockMessageAudio, type SoundPreferences } from '@/lib/message-sounds';

export function MessageSoundSettings() {
  const t = useAdvancedSettingsText();
  const [prefs, setPrefs] = useState<SoundPreferences>(getSoundPreferences);
  const update = (kind: keyof SoundPreferences, checked: boolean) => {
    const next = { ...prefs, [kind]: checked };
    setPrefs(next);
    saveSoundPreferences(next);
    if (checked) { void unlockMessageAudio(); playMessageSound(kind); }
  };
  return (
    <section className="mt-9" aria-labelledby="message-sounds-h">
      <h2 id="message-sounds-h" className="flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        <Bell className="h-4 w-4" /> {t("Sonidos de mensajes")}
      </h2>
      <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
        <p className="mb-3 text-xs text-muted-foreground">{t("Tonos suaves estilo iPhone, exclusivos de ECHO.")}</p>
        {([{ key: 'incoming', label: 'Mensajes recibidos' }, { key: 'outgoing', label: 'Mensajes enviados' }, { key: 'group', label: 'Mensajes de grupos' }, { key: 'notification', label: 'Notificaciones' }] as const).map(({ key, label }) => (
          <label key={key} className="flex min-h-12 items-center justify-between gap-3 border-b border-border/50 text-sm last:border-0">
            <span>{t(label)}</span>
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={prefs[key]} onChange={e => update(key, e.target.checked)} />
          </label>
        ))}
        <p className="mt-3 text-xs text-muted-foreground">{t("Al activar cada tilde escucharás su tono. Los sonidos de ECHO requieren que el navegador permita audio; los avisos push del celular funcionan por separado.")}</p>
      </div>
    </section>
  );
}
