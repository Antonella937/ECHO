import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useLanguage } from '@/lib/i18n';

const labels: Record<string, [string,string,string,string,string]> = {
  es:['Revisar acontecimientos','Buscar candidatos','Agregar al canon','Sin candidatos públicos pendientes.','No se pudo actualizar el canon.'],
  en:['Review events','Find candidates','Add to canon','No pending public candidates.','Could not update canon.'],
  pt:['Revisar acontecimentos','Buscar candidatos','Adicionar ao cânone','Nenhum candidato público pendente.','Não foi possível atualizar o cânone.'],
  fr:['Examiner les événements','Rechercher des événements','Ajouter au canon','Aucun événement public en attente.','Impossible de mettre à jour le canon.'],
  de:['Ereignisse prüfen','Ereignisse suchen','Zum Kanon hinzufügen','Keine ausstehenden öffentlichen Ereignisse.','Kanon konnte nicht aktualisiert werden.'],
  it:['Esamina eventi','Cerca eventi','Aggiungi al canone','Nessun evento pubblico in attesa.','Impossibile aggiornare il canone.'],
  ko:['사건 검토','후보 찾기','공식 설정에 추가','대기 중인 공개 사건이 없습니다.','공식 설정을 업데이트할 수 없습니다.'],
  ja:['出来事を確認','候補を検索','正史に追加','保留中の公開候補はありません。','正史を更新できませんでした。'],
  zh:['审核事件','查找候选事件','加入正史','没有待审核的公开事件。','无法更新正史。'],
};
type Candidate = { sourceId: string; actorId: string; text: string; occurredAt: string };
export function SceneCanonReview({ sceneId, universeId }: { sceneId: string; universeId: string }) {
  const lang = useLanguage();
  const [items, setItems] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [approved, setApproved] = useState<string[]>([]);
  const t = labels[lang] ?? labels.en;
  const base = `/api/scenes/${encodeURIComponent(sceneId)}/canon-candidates`;
  const load = async () => {
    setBusy(true); setError('');
    try {
      const result = await customFetch<{ candidates: Candidate[] }>(`${base}?${new URLSearchParams({ universeId })}`, { method:'GET', responseType:'json' });
      setItems(result.candidates);
    } catch { setError(t[4]); } finally { setBusy(false); }
  };
  const approve = async (candidate: Candidate) => {
    setBusy(true); setError('');
    try {
      await customFetch(`${base}/${encodeURIComponent(candidate.sourceId)}/approve`, {
        method:'POST', responseType:'json', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ universeId }),
      });
      setApproved(previous => [...previous, candidate.sourceId]);
    } catch { setError(t[4]); } finally { setBusy(false); }
  };
  return <details className="rounded-xl border border-border p-3">
    <summary className="cursor-pointer text-sm font-semibold">{t[0]}</summary>
    <button type="button" disabled={busy} onClick={() => void load()} className="mt-3 rounded-lg border border-border px-3 py-2 text-sm">{t[1]}</button>
    {items?.length === 0 && <p className="mt-2 text-xs text-muted-foreground">{t[3]}</p>}
    {items?.filter(item => !approved.includes(item.sourceId)).map(item => <div key={item.sourceId} className="mt-3 rounded-lg bg-secondary p-3">
      <p className="whitespace-pre-wrap text-sm">{item.text}</p>
      <p className="mt-1 text-xs text-muted-foreground">{item.actorId} · {item.occurredAt}</p>
      <button type="button" disabled={busy} onClick={() => void approve(item)} className="mt-2 rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground">{t[2]}</button>
    </div>)}
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </details>;
}
