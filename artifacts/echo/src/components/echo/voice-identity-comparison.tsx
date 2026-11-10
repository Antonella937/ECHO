import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';

type Track = { id: string; title: string; status: string; audioPath?: string };
type Sample = { id: string; audioObjectPath?: string | null };
type ProjectResponse = { project: { selectedSampleId?: string | null } | null; samples: Sample[] };
type Props = { characterId: string; universeId: string; tracks: Track[]; singingVoiceId: string | null };

export function VoiceIdentityComparison({ characterId, universeId, tracks, singingVoiceId }: Props) {
  const [speechFile, setSpeechFile] = useState<File | null>(null);
  const [speechUrl, setSpeechUrl] = useState('');
  const [speechSampleId, setSpeechSampleId] = useState('');
  const [speechPreviewAvailable, setSpeechPreviewAvailable] = useState(false);
  const [speechReady, setSpeechReady] = useState(false);
  const [trackId, setTrackId] = useState('');
  const [singingUrl, setSingingUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [comparison, setComparison] = useState<'pending' | 'similar' | 'different'>('pending');
  const [notes, setNotes] = useState('');
  const [savedStatus, setSavedStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [savedComparison, setSavedComparison] = useState<{ assessment: 'similar' | 'different'; notes: string } | null>(null);
  const [savedReferenceId, setSavedReferenceId] = useState('');
  const candidates = tracks.filter(t => t.status === 'saved_audio' && Boolean(t.audioPath));
  useEffect(() => {
    let active = true;
    setSavedStatus(''); setSavedComparison(null); setSavedReferenceId(''); setRestoring(true);
    void customFetch<{ comparison: { singingTrackId: string; assessment: 'similar' | 'different'; notes: string } | null }>(
      '/api/music/voices/comparison?' + new URLSearchParams({ universeId, characterId }), { responseType: 'json' })
      .then(data => { if (active && data.comparison) { setTrackId(data.comparison.singingTrackId); setComparison(data.comparison.assessment); setNotes(data.comparison.notes); setSavedComparison({ assessment: data.comparison.assessment, notes: data.comparison.notes }); setSavedReferenceId(data.comparison.singingTrackId); setSavedStatus('Comparación guardada anteriormente.'); } })
      .catch(() => {})
      .finally(() => { if (active) setRestoring(false); });
    setSpeechSampleId(''); setSpeechReady(false); setSpeechPreviewAvailable(false); setComparison('pending');
    void customFetch<ProjectResponse>('/api/voices/premium/projects?' + new URLSearchParams({ characterId, universeId }), { responseType: 'json' })
      .then(result => {
        if (!active) return;
        const selected = result.samples.find(s => s.id === result.project?.selectedSampleId);
        setSpeechReady(Boolean(selected));
        if (selected) { setSpeechSampleId(selected.id); setSpeechPreviewAvailable(Boolean(selected.audioObjectPath)); }
      }).catch(() => {});
    return () => { active = false; };
  }, [characterId, universeId]);
  useEffect(() => {
    if (!speechFile) { setSpeechUrl(''); return; }
    const url = URL.createObjectURL(speechFile); setSpeechUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [speechFile]);
  useEffect(() => {
    setSingingUrl('');
    if (!trackId) return;
    let active = true;
    let url = '';
    setLoading(true); setError('');
    void customFetch<Blob>('/api/music/library/' + encodeURIComponent(trackId) + '/audio', { responseType: 'blob' })
      .then(blob => {
        if (!blob.type.startsWith('audio/')) throw Error('El archivo no es audio.');
        url = URL.createObjectURL(blob);
        if (active) setSingingUrl(url); else URL.revokeObjectURL(url);
      }).catch(() => { if (active) setError('No se pudo cargar la referencia cantada.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [trackId]);
  async function saveComparison() {
    if (!trackId || comparison === 'pending' || !speechUrl || !singingUrl || saving) return;
    setSaving(true); setSavedStatus('');
    try {
      await customFetch('/api/music/voices/comparison', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId, characterId, singingTrackId: trackId, speechSampleId: speechFile ? null : speechSampleId || null, assessment: comparison, notes }), responseType: 'json' });
      setSavedComparison({ assessment: comparison, notes }); setSavedReferenceId(trackId);
      setSavedStatus('Comparación guardada en tu cuenta.');
    } catch { setSavedStatus('No se pudo guardar. Verificá que la actualización del servidor esté desplegada.'); }
    finally { setSaving(false); }
  }
  async function loadSpeechPreview() {
    if (!speechSampleId) return;
    setLoading(true); setError('');
    try {
      const result = await customFetch<{ url: string }>('/api/voices/premium/samples/' + encodeURIComponent(speechSampleId) + '/play', { responseType: 'json' });
      setSpeechUrl(result.url);
    } catch { setError('Esta voz hablada no tiene una muestra reproducible. Podés cargar un audio de referencia sin modificar la voz guardada.'); }
    finally { setLoading(false); }
  }
  return <section className="space-y-3 rounded-xl border border-border bg-secondary/30 p-3" aria-label="Comparar identidad vocal">
    <p className="text-sm font-semibold">Comparar voz hablada y cantada</p>
    <p className="text-xs text-muted-foreground">Escuchá ambas referencias antes de decidir si comparten timbre. Esta comparación es manual, privada y no consume créditos ni modifica las voces guardadas.</p>
    <p className="text-xs text-muted-foreground">Voz hablada: {speechReady ? 'configurada' : 'sin muestra Premium detectada'} · Voz cantada: {singingVoiceId ? 'vinculada' : 'todavía sin vincular'}</p>
    <div className="space-y-2">
      <p className="text-xs font-medium">1. Voz hablada</p>
      {speechSampleId && speechPreviewAvailable && <button type="button" onClick={() => void loadSpeechPreview()} disabled={loading} className="rounded-lg border border-border px-3 py-2 text-xs">Escuchar muestra guardada</button>}
      {speechReady && !speechPreviewAvailable && <p className="text-xs text-muted-foreground">La voz hablada está configurada, pero el proveedor no guardó una muestra reproducible. Podés cargar una grabación autorizada para compararla sin generar audio nuevo.</p>}
      <label className="block text-xs text-muted-foreground">O comparar con un archivo de voz autorizado
        <input className="mt-1 block w-full text-xs" type="file" accept="audio/*" onChange={e => { setSpeechFile(e.target.files?.[0] ?? null); setComparison('pending'); }} />
      </label>
      {speechUrl && <audio controls preload="none" src={speechUrl} className="w-full" aria-label="Referencia hablada" />}
    </div>
    <div className="space-y-2">
      <label className="block text-xs font-medium">2. Voz cantada
        <select className="mt-1 w-full rounded-lg border border-border bg-card p-2 text-sm" value={trackId} onChange={e => setTrackId(e.target.value)}>
          <option value="">Elegir canción de Mi biblioteca</option>
          {candidates.map(track => <option key={track.id} value={track.id}>{track.title}</option>)}
        </select>
      </label>
      {singingUrl && <audio controls preload="none" src={singingUrl} className="w-full" aria-label="Referencia cantada" />}
    </div>
    {savedComparison && <div className="space-y-1 rounded-lg border border-border bg-card p-3 text-xs">
      <p className="font-semibold">Referencia para futuras voces cantadas</p>
      <p className="text-muted-foreground">{savedComparison.assessment === 'similar'
        ? 'La comparación manual fue favorable. Conservá la voz cantada vinculada y usá las mismas referencias autorizadas cuando prepares nuevas canciones.'
        : 'La comparación manual encontró diferencias. Antes de reemplazar la voz cantada, prepará una referencia vocal clara de 15 a 30 segundos y comprobá su similitud con la voz hablada.'}</p>
      {savedComparison.notes && <p className="whitespace-pre-wrap text-muted-foreground">Características a conservar o corregir: {savedComparison.notes}</p>}
      <p className="text-muted-foreground">La guía no modifica el ID vocal, no clona voces ni genera cargos. La similitud sigue sin verificarse automáticamente.</p>
    </div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {speechUrl && singingUrl && <div className="space-y-2">
      <p className="text-xs font-medium">3. ¿Te parece la misma identidad vocal?</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setComparison('similar')} className="rounded-lg border border-border px-3 py-2 text-xs">Sí, se parecen</button>
        <button type="button" onClick={() => setComparison('different')} className="rounded-lg border border-border px-3 py-2 text-xs">No, son diferentes</button>
      </div>
      <label className="block text-xs text-muted-foreground">Notas sobre el timbre (opcional)
        <textarea value={notes} onChange={event => setNotes(event.target.value.slice(0, 500))} rows={2} placeholder="Gravedad, aspereza, resonancia, acento…" className="mt-1 w-full rounded-lg border border-border bg-card p-2 text-sm" />
      </label>
      {comparison !== 'pending' && <button type="button" disabled={saving || !speechUrl || !singingUrl} onClick={() => void saveComparison()} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar comparación'}</button>}
      {restoring && <p role="status" className="text-xs text-muted-foreground">Recuperando comparación guardada…</p>}
      {savedStatus && <p role="status" className="text-xs text-muted-foreground">{savedStatus}</p>}
      {comparison !== 'pending' && <p role="status" className="text-xs text-muted-foreground">{comparison === 'similar' ? 'Comparación auditiva favorable (no es una verificación biométrica).' : 'Conviene preparar una nueva referencia cantada a partir de la voz hablada autorizada.'} Esta decisión no cambia ni vincula automáticamente la voz del personaje.</p>}
    </div>}
  </section>;
}
