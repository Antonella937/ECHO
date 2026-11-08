import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useUser } from '@clerk/react';
import { useLanguage } from '@/lib/i18n';

type Style = 'natural' | 'narrative' | 'mixed';
type Timing = 'realistic' | 'instant';
type Length = 'short' | 'balanced' | 'detailed';
interface Preferences { style: Style; responseTiming: Timing; responseLength: Length; autonomousInitiative: boolean }
const defaults: Preferences = { style: 'natural', responseTiming: 'realistic', responseLength: 'balanced', autonomousInitiative: true };

export function DmAiPreferencesPanel({ open, onClose, characterId, universeId }: {
  open: boolean; onClose: () => void; characterId: string; universeId: string;
}) {
  const { user } = useUser();
  const { language } = useLanguage();
  const es = language === 'es';
  const [prefs, setPrefs] = useState<Preferences>(defaults);
  const [status, setStatus] = useState('');
  const key = `echo:dm-ai:draft:${user?.id ?? 'anonymous'}:${universeId}:${characterId}`;
  useEffect(() => {
    try { setPrefs({ ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') }); }
    catch { setPrefs(defaults); }
    setStatus('');
  }, [key]);
  if (!open) return null;
  const update = <K extends keyof Preferences>(field: K, value: Preferences[K]) => setPrefs(p => ({ ...p, [field]: value }));
  const save = () => {
    try { localStorage.setItem(key, JSON.stringify(prefs)); setStatus(es ? 'Preferencias guardadas en este dispositivo. Aún no controlan las respuestas de IA.' : 'Saved on this device. AI replies are not controlled by these settings yet.'); }
    catch { setStatus(es ? 'No se pudo guardar.' : 'Could not save.'); }
  };
  return <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 sm:items-center" role="presentation" onClick={onClose}>
    <section role="dialog" aria-modal="true" aria-label={es ? 'Configuración de IA' : 'AI settings'} onClick={e => e.stopPropagation()} className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-border bg-background p-5 shadow-xl sm:rounded-3xl">
      <div className="mb-5 flex items-center justify-between"><h2 className="text-lg font-semibold">{es ? 'Configuración de IA' : 'AI conversation settings'}</h2><button type="button" onClick={onClose} aria-label={es ? 'Cerrar' : 'Close'} className="rounded-full p-2 hover:bg-secondary"><X className="h-5 w-5" /></button></div>
      <p className="mb-4 text-xs text-muted-foreground">{es ? 'Vista preliminar: estos ajustes aún no están conectados al motor de IA.' : 'Preview: these controls are not yet connected to the AI engine.'}</p>
      <label className="mb-1 block text-sm font-semibold">{es ? 'Estilo' : 'Style'}</label>
      <select value={prefs.style} onChange={e => update('style', e.target.value as Style)} className="mb-4 w-full rounded-xl border border-border bg-background p-3">
        <option value="natural">{es ? 'Natural' : 'Natural'}</option><option value="narrative">{es ? 'Narrativo / Roleplay' : 'Narrative / Roleplay'}</option><option value="mixed">{es ? 'Mixto' : 'Mixed'}</option>
      </select>
      <label className="mb-1 block text-sm font-semibold">{es ? 'Respuesta' : 'Response timing'}</label>
      <select value={prefs.responseTiming} onChange={e => update('responseTiming', e.target.value as Timing)} className="mb-4 w-full rounded-xl border border-border bg-background p-3">
        <option value="realistic">{es ? 'Realista' : 'Realistic'}</option><option value="instant">{es ? 'Inmediata' : 'Immediate'}</option>
      </select>
      <label className="mb-1 block text-sm font-semibold">{es ? 'Extensión' : 'Length'}</label>
      <select value={prefs.responseLength} onChange={e => update('responseLength', e.target.value as Length)} className="mb-4 w-full rounded-xl border border-border bg-background p-3">
        <option value="short">{es ? 'Breve' : 'Short'}</option><option value="balanced">{es ? 'Equilibrada' : 'Balanced'}</option><option value="detailed">{es ? 'Detallada' : 'Detailed'}</option>
      </select>
      <label className="mb-4 flex items-center gap-3 text-sm"><input type="checkbox" checked={prefs.autonomousInitiative} onChange={e => update('autonomousInitiative', e.target.checked)} />{es ? 'Iniciativa autónoma' : 'Autonomous initiative'}</label>
      <button type="button" onClick={save} className="w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">{es ? 'Guardar borrador' : 'Save draft'}</button>
      {status && <p role="status" className="mt-3 text-xs text-muted-foreground">{status}</p>}
    </section>
  </div>;
}
