import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useUser } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { useSceneSettingsText } from '@/lib/scene-settings-i18n';

type Style = 'natural' | 'narrative' | 'mixed';
type Timing = 'realistic' | 'instant';
type Length = 'short' | 'balanced' | 'detailed';
interface Preferences { style: Style; responseTiming: Timing; responseLength: Length; autonomousInitiative: boolean }
const defaults: Preferences = { style: 'natural', responseTiming: 'realistic', responseLength: 'balanced', autonomousInitiative: true };

export function DmAiPreferencesPanel({ open, onClose, characterId, universeId }: {
  open: boolean; onClose: () => void; characterId: string; universeId: string;
}) {
  const { user } = useUser();
  const t = useSceneSettingsText();
  const [prefs, setPrefs] = useState<Preferences>(defaults);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open || !user?.id) return;
    let active = true;
    setStatus('');
    customFetch<{ preferences: Preferences }>(`/api/dm/conversation-preferences?${new URLSearchParams({universeId, characterId})}`, { method: 'GET', responseType: 'json', cache: 'no-store' })
      .then(result => { if (active) setPrefs({ ...defaults, ...result.preferences }); })
      .catch(() => { if (active) setStatus(t('failed')); });
    return () => { active = false; };
  }, [open, user?.id, universeId, characterId]);
  if (!open) return null;
  const update = <K extends keyof Preferences>(field: K, value: Preferences[K]) => setPrefs(p => ({ ...p, [field]: value }));
  const save = async () => {
    setSaving(true);
    try {
      await customFetch('/api/dm/conversation-preferences', { method: 'PUT', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ universeId, characterId, preferences: prefs }) });
      setStatus(t('savedOnline'));
    } catch { setStatus(t('failed')); }
    finally { setSaving(false); }
  };
  return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 sm:items-center" role="presentation" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label={t('aiSettings')} onClick={e => e.stopPropagation()} className="max-h-[75dvh] w-[min(94vw,26rem)] overflow-y-auto rounded-2xl border border-border bg-background p-4 shadow-xl">
      <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">{t('aiSettings')}</h2><button type="button" onClick={onClose} aria-label={t('close')} className="rounded-full p-2 hover:bg-secondary"><X className="h-5 w-5" /></button></div>
      
      <details className="mb-3 rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">{t('conversation')}</summary><div className="pt-3">
      <label className="mb-1 block text-sm font-semibold">{t('style')}</label>
      <select value={prefs.style} onChange={e => update('style', e.target.value as Style)} className="mb-4 w-full rounded-xl border border-border bg-background p-3">
        <option value="natural">{t('natural')}</option><option value="narrative">{t('narrative')}</option><option value="mixed">{t('mixed')}</option>
      </select>
      <label className="mb-1 block text-sm font-semibold">{t('timing')}</label>
      <select value={prefs.responseTiming} onChange={e => update('responseTiming', e.target.value as Timing)} className="mb-4 w-full rounded-xl border border-border bg-background p-3">
        <option value="realistic">{t('realistic')}</option><option value="instant">{t('instant')}</option>
      </select>
      <label className="mb-1 block text-sm font-semibold">{t('length')}</label>
      <select value={prefs.responseLength} onChange={e => update('responseLength', e.target.value as Length)} className="mb-4 w-full rounded-xl border border-border bg-background p-3">
        <option value="short">{t('short')}</option><option value="balanced">{t('balanced')}</option><option value="detailed">{t('detailed')}</option>
      </select>
      <label className="mb-4 flex items-center gap-3 text-sm"><input type="checkbox" checked={prefs.autonomousInitiative} onChange={e => update('autonomousInitiative', e.target.checked)} />{t('initiative')}</label>
      </div></details>
      <button type="button" onClick={save} disabled={saving} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">{t('save')}</button>
      {status && <p role="status" className="mt-3 text-xs text-muted-foreground">{status}</p>}
    </section>
  </div>;
}
