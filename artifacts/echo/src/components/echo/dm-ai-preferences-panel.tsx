import { useEffect, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { useUser } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { useSceneSettingsText } from '@/lib/scene-settings-i18n';

type Style = 'natural' | 'narrative' | 'mixed';
type Timing = 'realistic' | 'instant';
type Length = 'short' | 'balanced' | 'detailed';
interface Preferences { style: Style; responseTiming: Timing; responseLength: Length; autonomousInitiative: boolean }
const defaults: Preferences = { style: 'natural', responseTiming: 'realistic', responseLength: 'balanced', autonomousInitiative: true };

export function DmAiPreferencesPanel({ open, onClose, characterId, universeId, peers = [] }: {
  open: boolean; onClose: () => void; characterId: string; universeId: string; peers?: Array<{ id: string; name: string }>;
}) {
  const { user } = useUser();
  const t = useSceneSettingsText();
  const [prefs, setPrefs] = useState<Preferences>(defaults);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dmEnabled, setDmEnabled] = useState(false);
  const [allowedPeers, setAllowedPeers] = useState<string[]>([]);
  const [permissionsStatus, setPermissionsStatus] = useState('');
  useEffect(() => {
    if (!open || !user?.id) return;
    let active = true;
    setStatus('');
    setSaved(false);
    customFetch<{ preferences: Preferences }>(`/api/dm/conversation-preferences?${new URLSearchParams({universeId, characterId})}`, { method: 'GET', responseType: 'json', cache: 'no-store' })
      .then(result => { if (active) { setPrefs({ ...defaults, ...result.preferences }); } })
      .catch(() => { if (active) setStatus(t('failed')); });
    customFetch<{ enabled: boolean; allowedPeerIds: string[] }>(`/api/dm/character-permissions?${new URLSearchParams({universeId, characterId})}`, { method: 'GET', responseType: 'json', cache: 'no-store' })
      .then(result => { if (active) { setDmEnabled(result.enabled); setAllowedPeers(result.allowedPeerIds); } })
      .catch(() => { if (active) setPermissionsStatus(t('failed')); });
    return () => { active = false; };
  }, [open, user?.id, universeId, characterId]);
  if (!open) return null;
  const markDirty = () => { setSaved(false); setStatus(''); };
  const update = <K extends keyof Preferences>(field: K, value: Preferences[K]) => { markDirty(); setPrefs(p => ({ ...p, [field]: value })); };
  const save = async () => {
    setSaving(true);
    setStatus('');
    setPermissionsStatus('');
    const results = await Promise.allSettled([
      customFetch('/api/dm/conversation-preferences', { method: 'PUT', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ universeId, characterId, preferences: prefs }) }),
      customFetch('/api/dm/character-permissions', { method: 'PUT', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ universeId, characterId, enabled: dmEnabled, allowedPeerIds: allowedPeers }) }),
    ]);
    const succeeded = results.every(result => result.status === 'fulfilled');
    setSaved(succeeded);
    setStatus(succeeded ? t('savedOnline') : t('failed'));
    setSaving(false);
  };
  return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 sm:items-center" role="presentation" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label={t('aiSettings')} onClick={e => e.stopPropagation()} className="max-h-[calc(100dvh-3rem)] w-[min(94vw,26rem)] overflow-y-auto rounded-2xl border border-border bg-background p-4 shadow-xl">
      <div className="mb-5 flex items-center justify-between gap-2"><button type="button" onClick={onClose} aria-label="Volver a la conversación" className="flex items-center gap-2 rounded-full p-2 hover:bg-secondary"><ArrowLeft className="h-5 w-5" /><span className="text-sm">Volver</span></button><h2 className="text-lg font-semibold">{t('aiSettings')}</h2><button type="button" onClick={onClose} aria-label={t('close')} className="rounded-full p-2 hover:bg-secondary"><X className="h-5 w-5" /></button></div>
      
      <details open className="mb-3 rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">{t('conversation')}</summary><div className="pt-3">
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
      <details open className="mb-3 rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">{t('peerDm')}</summary>
        <div className="pt-3 space-y-3">
          <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={dmEnabled} onChange={e => { markDirty(); setDmEnabled(e.target.checked); }} />{t('allow')}</label>
          {peers.filter(peer => peer.id !== characterId).map(peer => <label key={peer.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{peer.name}</span><input type="checkbox" disabled={!dmEnabled} checked={allowedPeers.includes(peer.id)} onChange={e => { markDirty(); setAllowedPeers(current => e.target.checked ? [...current,peer.id] : current.filter(id => id !== peer.id)); }} />
          </label>)}
          {permissionsStatus && <p role="status" className="text-xs text-muted-foreground">{permissionsStatus}</p>}
        </div>
      </details>
      <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-border bg-background px-4 pb-4 pt-3 shadow-[0_-8px_20px_rgba(0,0,0,0.12)]">
        {status && <p role="status" aria-live="polite" className={`mb-2 text-center text-sm font-semibold ${saved ? "text-emerald-500" : "text-destructive"}`}>{saved ? "✓ " : ""}{status}</p>}
        <button type="button" onClick={save} disabled={saving} aria-busy={saving} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60">{saving ? "Guardando…" : saved ? "✓ Guardado" : t('save')}</button>
      </div>
    </section>
  </div>;
}
