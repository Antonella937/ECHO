import { useEffect, useState } from 'react';
import { useLanguage } from '@/lib/i18n';
const voiceTranslations: Record<string, Record<string,string>> = {"en":{"Comparar identidad vocal":"Compare voice identity","Comparar voz hablada y cantada":"Compare speaking and singing voices","1. Voz hablada":"1. Speaking voice","2. Voz cantada":"2. Singing voice","Escuchar muestra guardada":"Play saved sample","Elegir canción de Mi biblioteca":"Choose a song from My library","Analizar similitud acústica":"Analyze acoustic similarity","Analizando audio…":"Analyzing audio…","Sí, se parecen":"Yes, they sound alike","No, son diferentes":"No, they sound different","Guardar comparación":"Save comparison","Guardando…":"Saving…","Recuperando comparación guardada…":"Loading saved comparison…","Referencia hablada":"Speaking voice reference","Referencia cantada":"Singing voice reference","Notas sobre el timbre (opcional)":"Timbre notes (optional)","Análisis acústico automático (local)":"Automatic acoustic analysis (on device)"},"pt":{"Comparar identidad vocal":"Comparar identidade vocal","Comparar voz hablada y cantada":"Comparar voz falada e cantada","1. Voz hablada":"1. Voz falada","2. Voz cantada":"2. Voz cantada","Escuchar muestra guardada":"Ouvir amostra salva","Elegir canción de Mi biblioteca":"Escolher música da Minha biblioteca","Analizar similitud acústica":"Analisar semelhança acústica","Analizando audio…":"Analisando áudio…","Sí, se parecen":"Sim, são parecidas","No, son diferentes":"Não, são diferentes","Guardar comparación":"Salvar comparação","Guardando…":"Salvando…","Recuperando comparación guardada…":"Carregando comparação salva…","Referencia hablada":"Referência de voz falada","Referencia cantada":"Referência de voz cantada","Notas sobre el timbre (opcional)":"Notas sobre o timbre (opcional)","Análisis acústico automático (local)":"Análise acústica automática (local)"},"fr":{"Comparar identidad vocal":"Comparer l’identité vocale","Comparar voz hablada y cantada":"Comparer voix parlée et chantée","1. Voz hablada":"1. Voix parlée","2. Voz cantada":"2. Voix chantée","Escuchar muestra guardada":"Écouter l’échantillon enregistré","Elegir canción de Mi biblioteca":"Choisir une chanson de Ma bibliothèque","Analizar similitud acústica":"Analyser la similarité acoustique","Analizando audio…":"Analyse audio…","Sí, se parecen":"Oui, elles se ressemblent","No, son diferentes":"Non, elles sont différentes","Guardar comparación":"Enregistrer la comparaison","Guardando…":"Enregistrement…","Recuperando comparación guardada…":"Chargement de la comparaison enregistrée…","Referencia hablada":"Référence vocale parlée","Referencia cantada":"Référence vocale chantée","Notas sobre el timbre (opcional)":"Notes sur le timbre (facultatif)","Análisis acústico automático (local)":"Analyse acoustique automatique (locale)"},"de":{"Comparar identidad vocal":"Stimmidentität vergleichen","Comparar voz hablada y cantada":"Sprech- und Singstimme vergleichen","1. Voz hablada":"1. Sprechstimme","2. Voz cantada":"2. Singstimme","Escuchar muestra guardada":"Gespeicherte Probe anhören","Elegir canción de Mi biblioteca":"Song aus Meine Bibliothek auswählen","Analizar similitud acústica":"Akustische Ähnlichkeit analysieren","Analizando audio…":"Audio wird analysiert…","Sí, se parecen":"Ja, sie klingen ähnlich","No, son diferentes":"Nein, sie klingen unterschiedlich","Guardar comparación":"Vergleich speichern","Guardando…":"Wird gespeichert…","Recuperando comparación guardada…":"Gespeicherten Vergleich laden…","Referencia hablada":"Sprechstimmenreferenz","Referencia cantada":"Singstimmenreferenz","Notas sobre el timbre (opcional)":"Notizen zur Klangfarbe (optional)","Análisis acústico automático (local)":"Automatische Akustikanalyse (lokal)"},"it":{"Comparar identidad vocal":"Confronta identità vocale","Comparar voz hablada y cantada":"Confronta voce parlata e cantata","1. Voz hablada":"1. Voce parlata","2. Voz cantada":"2. Voce cantata","Escuchar muestra guardada":"Ascolta campione salvato","Elegir canción de Mi biblioteca":"Scegli un brano da La mia libreria","Analizar similitud acústica":"Analizza somiglianza acustica","Analizando audio…":"Analisi audio…","Sí, se parecen":"Sì, si somigliano","No, son diferentes":"No, sono diverse","Guardar comparación":"Salva confronto","Guardando…":"Salvataggio…","Recuperando comparación guardada…":"Caricamento confronto salvato…","Referencia hablada":"Riferimento voce parlata","Referencia cantada":"Riferimento voce cantata","Notas sobre el timbre (opcional)":"Note sul timbro (facoltative)","Análisis acústico automático (local)":"Analisi acustica automatica (locale)"},"ko":{"Comparar identidad vocal":"음성 정체성 비교","Comparar voz hablada y cantada":"말하는 목소리와 노래 목소리 비교","1. Voz hablada":"1. 말하는 목소리","2. Voz cantada":"2. 노래 목소리","Escuchar muestra guardada":"저장된 샘플 듣기","Elegir canción de Mi biblioteca":"내 라이브러리에서 노래 선택","Analizar similitud acústica":"음향 유사도 분석","Analizando audio…":"오디오 분석 중…","Sí, se parecen":"네, 비슷해요","No, son diferentes":"아니요, 달라요","Guardar comparación":"비교 저장","Guardando…":"저장 중…","Recuperando comparación guardada…":"저장된 비교 불러오는 중…","Referencia hablada":"말하는 목소리 참조","Referencia cantada":"노래 목소리 참조","Notas sobre el timbre (opcional)":"음색 메모 (선택)","Análisis acústico automático (local)":"자동 음향 분석 (기기 내)"},"ja":{"Comparar identidad vocal":"声の同一性を比較","Comparar voz hablada y cantada":"話し声と歌声を比較","1. Voz hablada":"1. 話し声","2. Voz cantada":"2. 歌声","Escuchar muestra guardada":"保存済みサンプルを聴く","Elegir canción de Mi biblioteca":"マイライブラリから曲を選択","Analizar similitud acústica":"音響的類似性を分析","Analizando audio…":"音声を分析中…","Sí, se parecen":"はい、似ています","No, son diferentes":"いいえ、異なります","Guardar comparación":"比較を保存","Guardando…":"保存中…","Recuperando comparación guardada…":"保存済みの比較を読み込み中…","Referencia hablada":"話し声の参照","Referencia cantada":"歌声の参照","Notas sobre el timbre (opcional)":"声質のメモ（任意）","Análisis acústico automático (local)":"自動音響分析（端末内）"},"zh":{"Comparar identidad vocal":"比较声音身份","Comparar voz hablada y cantada":"比较说话与歌唱声音","1. Voz hablada":"1. 说话声音","2. Voz cantada":"2. 歌唱声音","Escuchar muestra guardada":"播放已保存样本","Elegir canción de Mi biblioteca":"从我的音乐库选择歌曲","Analizar similitud acústica":"分析声学相似度","Analizando audio…":"正在分析音频…","Sí, se parecen":"是的，听起来相似","No, son diferentes":"不，听起来不同","Guardar comparación":"保存比较","Guardando…":"正在保存…","Recuperando comparación guardada…":"正在加载已保存的比较…","Referencia hablada":"说话声音参考","Referencia cantada":"歌唱声音参考","Notas sobre el timbre (opcional)":"音色备注（可选）","Análisis acústico automático (local)":"自动声学分析（本地）"}};
function voiceText(text: string, language: string): string { return language === 'es' ? text : (voiceTranslations[language]?.[text] ?? voiceTranslations.en[text] ?? text); }

import { customFetch } from '@workspace/api-client-react';
import { compareAcoustics, type AcousticSummary } from '@/lib/acoustic-voice-comparison';

type Track = { id: string; title: string; status: string; audioPath?: string };
type Sample = { id: string; audioObjectPath?: string | null };
type ProjectResponse = { project: { selectedSampleId?: string | null } | null; samples: Sample[] };
type Props = { characterId: string; universeId: string; tracks: Track[]; singingVoiceId: string | null };

export function VoiceIdentityComparison({ characterId, universeId, tracks, singingVoiceId }: Props) {
  const language = useLanguage();
  const vt = (text: string) => voiceText(text, language);
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
  const [acoustic, setAcoustic] = useState<AcousticSummary | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  useEffect(() => { setAcoustic(null); }, [speechUrl, singingUrl]);
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
  async function analyzeAcoustics() {
    if (!speechUrl || !singingUrl || analyzing) return;
    setAnalyzing(true); setError(''); setAcoustic(null);
    try { setAcoustic(await compareAcoustics(speechUrl, singingUrl)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron analizar las referencias.'); }
    finally { setAnalyzing(false); }
  }
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
  return <section className="space-y-3 rounded-xl border border-border bg-secondary/30 p-3" aria-label={vt("Comparar identidad vocal")}>
    <p className="text-sm font-semibold">{vt("Comparar voz hablada y cantada")}</p>
    <p className="text-xs text-muted-foreground">Escuchá ambas referencias antes de decidir si comparten timbre. Esta comparación es manual, privada y no consume créditos ni modifica las voces guardadas.</p>
    <p className="text-xs text-muted-foreground">Voz hablada: {speechReady ? 'configurada' : 'sin muestra Premium detectada'} · Voz cantada: {singingVoiceId ? 'vinculada' : 'todavía sin vincular'}</p>
    <div className="space-y-2">
      <p className="text-xs font-medium">{vt("1. Voz hablada")}</p>
      {speechSampleId && speechPreviewAvailable && <button type="button" onClick={() => void loadSpeechPreview()} disabled={loading} className="rounded-lg border border-border px-3 py-2 text-xs">{vt("Escuchar muestra guardada")}</button>}
      {speechReady && !speechPreviewAvailable && <p className="text-xs text-muted-foreground">La voz hablada está configurada, pero el proveedor no guardó una muestra reproducible. Podés cargar una grabación autorizada para compararla sin generar audio nuevo.</p>}
      <label className="block text-xs text-muted-foreground">O comparar con un archivo de voz autorizado
        <input className="mt-1 block w-full text-xs" type="file" accept="audio/*" onChange={e => { setSpeechFile(e.target.files?.[0] ?? null); setComparison('pending'); }} />
      </label>
      {speechUrl && <audio controls preload="none" src={speechUrl} className="w-full" aria-label={vt("Referencia hablada")} />}
    </div>
    <div className="space-y-2">
      <label className="block text-xs font-medium">2. Voz cantada
        <select className="mt-1 w-full rounded-lg border border-border bg-card p-2 text-sm" value={trackId} onChange={e => setTrackId(e.target.value)}>
          <option value="">{vt("Elegir canción de Mi biblioteca")}</option>
          {candidates.map(track => <option key={track.id} value={track.id}>{track.title}</option>)}
        </select>
      </label>
      {singingUrl && <audio controls preload="none" src={singingUrl} className="w-full" aria-label={vt("Referencia cantada")} />}
    </div>
    {savedComparison && savedReferenceId === trackId && <div className="space-y-1 rounded-lg border border-border bg-card p-3 text-xs">
      <p className="font-semibold">Referencia para futuras voces cantadas</p>
      <p className="text-muted-foreground">{savedComparison.assessment === 'similar'
        ? 'La comparación manual fue favorable. Conservá la voz cantada vinculada y usá las mismas referencias autorizadas cuando prepares nuevas canciones.'
        : 'La comparación manual encontró diferencias. Antes de reemplazar la voz cantada, prepará una referencia vocal clara de 15 a 30 segundos y comprobá su similitud con la voz hablada.'}</p>
      {savedComparison.notes && <p className="whitespace-pre-wrap text-muted-foreground">Características a conservar o corregir: {savedComparison.notes}</p>}
      <p className="text-muted-foreground">La guía no modifica el ID vocal, no clona voces ni genera cargos. La similitud sigue sin verificarse automáticamente.</p>
    </div>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {speechUrl && singingUrl && <div className="space-y-2">
      <div className="space-y-2 rounded-lg border border-border bg-card p-3">
        <p className="text-xs font-semibold">{vt("Análisis acústico automático (local)")}</p>
        <p className="text-xs text-muted-foreground">Compara características de frecuencia y textura de los audios en tu dispositivo, sin subirlos a un servicio de análisis ni gastar créditos. No identifica personas ni certifica que sea la misma voz: una canción con instrumentos o efectos puede alterar mucho el resultado.</p>
        <button type="button" disabled={analyzing || loading} onClick={() => void analyzeAcoustics()} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{analyzing ? 'Analizando audio…' : 'Analizar similitud acústica'}</button>
        {acoustic && <div role="status" className="space-y-1 text-xs">
          <p className="font-semibold">Similitud de características acústicas: {acoustic.score}/100</p>
          <p className="text-muted-foreground">{acoustic.quality}</p>
          {acoustic.speechHz && acoustic.singingHz && <p className="text-muted-foreground">Frecuencia tonal estimada: hablada {acoustic.speechHz} Hz · cantada {acoustic.singingHz} Hz (no es una medida de identidad).</p>}
          <p className="text-muted-foreground">No hay umbral confiable para decidir si dos voces pertenecen a la misma identidad. Escuchá ambas referencias y guardá tu evaluación por separado.</p>
        </div>}
      </div>
      <p className="text-xs font-medium">3. ¿Te parece la misma identidad vocal?</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setComparison('similar')} className="rounded-lg border border-border px-3 py-2 text-xs">{vt("Sí, se parecen")}</button>
        <button type="button" onClick={() => setComparison('different')} className="rounded-lg border border-border px-3 py-2 text-xs">{vt("No, son diferentes")}</button>
      </div>
      <label className="block text-xs text-muted-foreground">Notas sobre el timbre (opcional)
        <textarea value={notes} onChange={event => setNotes(event.target.value.slice(0, 500))} rows={2} placeholder="Gravedad, aspereza, resonancia, acento…" className="mt-1 w-full rounded-lg border border-border bg-card p-2 text-sm" />
      </label>
      {comparison !== 'pending' && <button type="button" disabled={saving || !speechUrl || !singingUrl} onClick={() => void saveComparison()} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar comparación'}</button>}
      {restoring && <p role="status" className="text-xs text-muted-foreground">{vt("Recuperando comparación guardada…")}</p>}
      {savedStatus && <p role="status" className="text-xs text-muted-foreground">{savedStatus}</p>}
      {comparison !== 'pending' && <p role="status" className="text-xs text-muted-foreground">{comparison === 'similar' ? 'Comparación auditiva favorable (no es una verificación biométrica).' : 'Conviene preparar una nueva referencia cantada a partir de la voz hablada autorizada.'} Esta decisión no cambia ni vincula automáticamente la voz del personaje.</p>}
    </div>}
  </section>;
}
