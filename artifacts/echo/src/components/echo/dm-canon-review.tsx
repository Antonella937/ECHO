import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useLanguage } from '@/lib/i18n';

const labels: Record<string,[string,string,string,string,string,string,string,string]> = {
 es:['Acontecimientos del DM','Buscar acontecimientos','Candidatos privados para revisión','No hay candidatos.','No se pudieron cargar.',"Aprobar","Editar","Descartar"],
 en:['DM events','Find events','Private candidates for review','No candidates found.','Could not load events.',"Approve","Edit","Dismiss"],
 pt:['Eventos da DM','Buscar eventos','Candidatos privados para revisão','Nenhum candidato.','Não foi possível carregar.',"Aprovar","Editar","Descartar"],
 fr:['Événements du DM','Rechercher','Suggestions privées à examiner','Aucune suggestion.','Chargement impossible.',"Approuver","Modifier","Ignorer"],
 de:['DM-Ereignisse','Ereignisse suchen','Private Vorschläge zur Prüfung','Keine Vorschläge.','Laden fehlgeschlagen.',"Bestätigen","Bearbeiten","Verwerfen"],
 it:['Eventi DM','Cerca eventi','Proposte private da esaminare','Nessuna proposta.','Caricamento non riuscito.',"Approva","Modifica","Scarta"],
 ko:['DM 사건','사건 찾기','검토할 비공개 후보','후보가 없습니다.','불러오지 못했습니다.',"승인","편집","버리기"],
 ja:['DMの出来事','出来事を検索','確認待ちの非公開候補','候補がありません。','読み込めませんでした。',"承認","編集","却下"],
 zh:['私信事件','查找事件','待审核的私人候选事件','没有候选事件。','加载失败。',"批准","编辑","忽略"],
};
type Candidate={sourceId:string;text:string;actorId:string};
export function DmCanonReview({universeId,peerId,externalOpen,onExternalClose}:{universeId:string;peerId:string;externalOpen?:boolean;onExternalClose?:()=>void}){
 const lang=useLanguage();const t=labels[lang]??labels.en;
 const [items,setItems]=useState<Candidate[]|null>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState(false);
 const [editing,setEditing]=useState<string|null>(null);
 const [drafts,setDrafts]=useState<Record<string,string>>({});
 const load=async()=>{setBusy(true);setError(false);try{
  const result=await customFetch<{candidates:Candidate[]}>(`/api/creator/universes/${encodeURIComponent(universeId)}/dm-canon-candidates/${encodeURIComponent(peerId)}`,{method:'GET',responseType:'json'});
  setItems(result.candidates);
 }catch{setError(true);}finally{setBusy(false);}};
 const decide=async(item:Candidate,action:'approve'|'dismiss')=>{
  setBusy(true);setError(false);
  try{
   await customFetch(`/api/creator/universes/${encodeURIComponent(universeId)}/dm-canon-candidates/${encodeURIComponent(peerId)}/${encodeURIComponent(item.sourceId)}/decision`,{
    method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action,...(action==='approve'&&editing===item.sourceId?{text:drafts[item.sourceId]??item.text}:{})}),
   });
   setItems(old=>old?.filter(x=>x.sourceId!==item.sourceId)??null);
  }catch{setError(true);}finally{setBusy(false);}
 };
 return <div className="group relative inline-block align-middle">
  {externalOpen===undefined&&<details><summary title={t[0]} aria-label={t[0]} className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-border/70 bg-background/55 text-foreground backdrop-blur-md transition hover:bg-secondary/70 [&::-webkit-details-marker]:hidden">
   <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
  </summary></details>}
  {(externalOpen??false)&&<div className="absolute bottom-full left-0 z-50 mb-2 max-h-[55vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-border/70 bg-background/95 p-3 shadow-xl backdrop-blur-xl">
  <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">{t[0]}</p><button type="button" onClick={onExternalClose} aria-label="Cerrar">✕</button></div>
  <button type="button" disabled={busy} onClick={()=>void load()} className="my-2 rounded-lg border border-border px-3 py-2 text-xs">{t[1]}</button>
  {error&&<p role="alert" className="text-xs text-destructive">{t[4]}</p>}
  {items?.length===0&&<p className="text-xs text-muted-foreground">{t[3]}</p>}
  {items&&items.length>0&&<p className="text-xs text-muted-foreground">{t[2]}</p>}
  {items?.map(item=><div key={item.sourceId} className="my-2 rounded-lg bg-secondary p-2 text-sm">
    {editing===item.sourceId?<textarea maxLength={1200} className="w-full rounded border border-border bg-background p-2" value={drafts[item.sourceId]??item.text} onChange={e=>setDrafts(old=>({...old,[item.sourceId]:e.target.value}))}/>:<p className="whitespace-pre-wrap">{item.text}</p>}
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={busy||(editing===item.sourceId&&!(drafts[item.sourceId]??item.text).trim())} onClick={()=>void decide(item,'approve')} className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground">{t[5]}</button>
      <button type="button" disabled={busy} onClick={()=>setEditing(old=>old===item.sourceId?null:item.sourceId)} className="rounded border border-border px-3 py-2 text-xs">{t[6]}</button>
      <button type="button" disabled={busy} onClick={()=>void decide(item,'dismiss')} className="rounded border border-border px-3 py-2 text-xs">{t[7]}</button>
    </div>
  </div>)}
  </div>}
 </div>;
}
