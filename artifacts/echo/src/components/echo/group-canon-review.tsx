import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useLanguage } from '@/lib/i18n';

const labels: Record<string,[string,string,string,string]> = {
  es:['Acontecimientos del grupo','Buscar acontecimientos','Posibles acontecimientos (solo participantes)','No se encontraron candidatos.'],
  en:['Group events','Find events','Possible events (participants only)','No candidates found.'],
  pt:['Eventos do grupo','Buscar eventos','Possíveis eventos (apenas participantes)','Nenhum candidato encontrado.'],
  fr:['Événements du groupe','Rechercher des événements','Événements possibles (participants uniquement)','Aucun candidat trouvé.'],
  de:['Gruppenereignisse','Ereignisse suchen','Mögliche Ereignisse (nur Teilnehmende)','Keine Vorschläge gefunden.'],
  it:['Eventi del gruppo','Cerca eventi','Possibili eventi (solo partecipanti)','Nessun candidato trovato.'],
  ko:['그룹 사건','사건 찾기','가능한 사건 (참가자 전용)','후보가 없습니다.'],
  ja:['グループの出来事','出来事を検索','候補となる出来事（参加者のみ）','候補がありません。'],
  zh:['群组事件','查找事件','可能的事件（仅参与者）','未找到候选事件。'],
};
type Candidate = { sourceId:string; text:string; actorId:string };
export function GroupCanonReview({ groupId, universeId, actorId }: {groupId:string;universeId:string;actorId:string}) {
  const lang = useLanguage();
  const t = labels[lang] ?? labels.en;
  const [items,setItems] = useState<Candidate[]|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(false);
  const load = async () => {
    setBusy(true);setError(false);
    try {
      const query = new URLSearchParams({ universeId, actorId });
      const result = await customFetch<{candidates:Candidate[]}>(`/api/group-dms/${encodeURIComponent(groupId)}/canon-candidates?${query}`,{method:'GET',responseType:'json'});
      setItems(result.candidates);
    } catch {setError(true);} finally {setBusy(false);}
  };
  return <details className="border-b border-border px-4 py-2">
    <summary className="cursor-pointer text-sm font-medium">{t[0]}</summary>
    <button type="button" disabled={busy} onClick={() => void load()} className="my-2 rounded-lg border border-border px-3 py-2 text-xs">{t[1]}</button>
    {error && <p role="alert" className="text-xs text-destructive">Error</p>}
    {items?.length===0 && <p className="text-xs text-muted-foreground">{t[3]}</p>}
    {items && items.length>0 && <p className="text-xs text-muted-foreground">{t[2]}</p>}
    {items?.map(item=><p key={item.sourceId} className="my-2 rounded-lg bg-secondary p-2 text-sm whitespace-pre-wrap">{item.text}</p>)}
  </details>;
}
