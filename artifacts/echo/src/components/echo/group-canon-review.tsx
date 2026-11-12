import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useLanguage } from '@/lib/i18n';

const labels: Record<string,[string,string,string,string,string,string,string,string]> = {
  es:['Acontecimientos del grupo','Buscar acontecimientos','Posibles acontecimientos (solo participantes)','No se encontraron candidatos.',"Aprobar","Editar","Descartar","No se pudieron guardar los cambios."],
  en:['Group events','Find events','Possible events (participants only)','No candidates found.',"Approve","Edit","Dismiss","Could not save changes."],
  pt:['Eventos do grupo','Buscar eventos','Possíveis eventos (apenas participantes)','Nenhum candidato encontrado.',"Aprovar","Editar","Descartar","Não foi possível salvar."],
  fr:['Événements du groupe','Rechercher des événements','Événements possibles (participants uniquement)','Aucun candidat trouvé.',"Approuver","Modifier","Ignorer","Enregistrement impossible."],
  de:['Gruppenereignisse','Ereignisse suchen','Mögliche Ereignisse (nur Teilnehmende)','Keine Vorschläge gefunden.',"Bestätigen","Bearbeiten","Verwerfen","Speichern fehlgeschlagen."],
  it:['Eventi del gruppo','Cerca eventi','Possibili eventi (solo partecipanti)','Nessun candidato trovato.',"Approva","Modifica","Scarta","Impossibile salvare."],
  ko:['그룹 사건','사건 찾기','가능한 사건 (참가자 전용)','후보가 없습니다.',"승인","편집","버리기","변경 사항을 저장하지 못했습니다."],
  ja:['グループの出来事','出来事を検索','候補となる出来事（参加者のみ）','候補がありません。',"承認","編集","却下","変更を保存できませんでした。"],
  zh:['群组事件','查找事件','可能的事件（仅参与者）','未找到候选事件。',"批准","编辑","忽略","无法保存更改。"],
};
type Candidate = { sourceId:string; text:string; actorId:string };
export function GroupCanonReview({ groupId, universeId, actorId }: {groupId:string;universeId:string;actorId:string}) {
  const lang = useLanguage();
  const t = labels[lang] ?? labels.en;
  const [items,setItems] = useState<Candidate[]|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState(false);
  const [editing,setEditing] = useState<string|null>(null);
  const [drafts,setDrafts] = useState<Record<string,string>>({});
  const load = async () => {
    setBusy(true);setError(false);
    try {
      const query = new URLSearchParams({ universeId, actorId });
      const result = await customFetch<{candidates:Candidate[]}>(`/api/group-dms/${encodeURIComponent(groupId)}/canon-candidates?${query}`,{method:'GET',responseType:'json'});
      setItems(result.candidates);
    } catch {setError(true);} finally {setBusy(false);}
  };
  const decide=async(item:Candidate,action:'approve'|'dismiss')=>{
    setBusy(true);setError(false);
    try{
      await customFetch(`/api/group-dms/${encodeURIComponent(groupId)}/canon-candidates/decision`,{
        method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({universeId,actorId,messageId:item.sourceId,action,
          ...(action==='approve'&&editing===item.sourceId?{text:drafts[item.sourceId]??item.text}:{})}),
      });
      setItems(old=>old?.filter(x=>x.sourceId!==item.sourceId)??null);
    }catch{setError(true);}finally{setBusy(false);}
  };
  return <details className="border-b border-border px-4 py-2">
    <summary className="cursor-pointer text-sm font-medium">{t[0]}</summary>
    <button type="button" disabled={busy} onClick={() => void load()} className="my-2 rounded-lg border border-border px-3 py-2 text-xs">{t[1]}</button>
    {error && <p role="alert" className="text-xs text-destructive">{t[7]}</p>}
    {items?.length===0 && <p className="text-xs text-muted-foreground">{t[3]}</p>}
    {items && items.length>0 && <p className="text-xs text-muted-foreground">{t[2]}</p>}
    {items?.map(item=><div key={item.sourceId} className="my-2 rounded-lg bg-secondary p-2 text-sm">
      {editing===item.sourceId?<textarea maxLength={1200} className="w-full rounded border border-border bg-background p-2" value={drafts[item.sourceId]??item.text} onChange={e=>setDrafts(old=>({...old,[item.sourceId]:e.target.value}))}/>:<p className="whitespace-pre-wrap">{item.text}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={busy||(editing===item.sourceId&&!(drafts[item.sourceId]??item.text).trim())} onClick={()=>void decide(item,'approve')} className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground">{t[4]}</button>
        <button type="button" disabled={busy} onClick={()=>setEditing(old=>old===item.sourceId?null:item.sourceId)} className="rounded border border-border px-3 py-2 text-xs">{t[5]}</button>
        <button type="button" disabled={busy} onClick={()=>void decide(item,'dismiss')} className="rounded border border-border px-3 py-2 text-xs">{t[6]}</button>
      </div>
    </div>)}
  </details>;
}
