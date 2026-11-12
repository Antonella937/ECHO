import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useLanguage } from '@/lib/i18n';

const labels: Record<string,[string,string,string,string,string]> = {
 es:['Acontecimientos del DM','Buscar acontecimientos','Candidatos privados para revisión','No hay candidatos.','No se pudieron cargar.'],
 en:['DM events','Find events','Private candidates for review','No candidates found.','Could not load events.'],
 pt:['Eventos da DM','Buscar eventos','Candidatos privados para revisão','Nenhum candidato.','Não foi possível carregar.'],
 fr:['Événements du DM','Rechercher','Suggestions privées à examiner','Aucune suggestion.','Chargement impossible.'],
 de:['DM-Ereignisse','Ereignisse suchen','Private Vorschläge zur Prüfung','Keine Vorschläge.','Laden fehlgeschlagen.'],
 it:['Eventi DM','Cerca eventi','Proposte private da esaminare','Nessuna proposta.','Caricamento non riuscito.'],
 ko:['DM 사건','사건 찾기','검토할 비공개 후보','후보가 없습니다.','불러오지 못했습니다.'],
 ja:['DMの出来事','出来事を検索','確認待ちの非公開候補','候補がありません。','読み込めませんでした。'],
 zh:['私信事件','查找事件','待审核的私人候选事件','没有候选事件。','加载失败。'],
};
type Candidate={sourceId:string;text:string;actorId:string};
export function DmCanonReview({universeId,peerId}:{universeId:string;peerId:string}){
 const lang=useLanguage();const t=labels[lang]??labels.en;
 const [items,setItems]=useState<Candidate[]|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState(false);
 const load=async()=>{setBusy(true);setError(false);try{
  const result=await customFetch<{candidates:Candidate[]}>(`/api/creator/universes/${encodeURIComponent(universeId)}/dm-canon-candidates/${encodeURIComponent(peerId)}`,{method:'GET',responseType:'json'});
  setItems(result.candidates);
 }catch{setError(true);}finally{setBusy(false);}};
 return <details className="border-b border-border px-4 py-2">
  <summary className="cursor-pointer text-sm font-medium">{t[0]}</summary>
  <button type="button" disabled={busy} onClick={()=>void load()} className="my-2 rounded-lg border border-border px-3 py-2 text-xs">{t[1]}</button>
  {error&&<p role="alert" className="text-xs text-destructive">{t[4]}</p>}
  {items?.length===0&&<p className="text-xs text-muted-foreground">{t[3]}</p>}
  {items&&items.length>0&&<p className="text-xs text-muted-foreground">{t[2]}</p>}
  {items?.map(item=><p key={item.sourceId} className="my-2 rounded-lg bg-secondary p-2 text-sm whitespace-pre-wrap">{item.text}</p>)}
 </details>;
}
