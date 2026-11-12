import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';

type Entry = {
  id: string; title: string; content: string; category: 'world_knowledge'|'shared_memory'|'secret';
  truth_status: 'confirmed'|'rumor'|'belief'|'unknown'; knowledge_scope: 'everyone'|'selected'|'nobody';
  known_character_ids: string[]; keywords: string[]; status: 'draft'|'published'|'archived';
  source_type: 'manual'|'ai_suggestion'|'conversation';
};
type Draft = {
  title: string; content: string; category: Entry['category']; truthStatus: Entry['truth_status'];
  knowledgeScope: Entry['knowledge_scope']; knownCharacterIds: string[]; keywords: string[];
  sourceType: Entry['source_type'];
};
const empty = (): Draft => ({ title:'',content:'',category:'world_knowledge',truthStatus:'confirmed',
  knowledgeScope:'everyone',knownCharacterIds:[],keywords:[],sourceType:'manual' });
export function WorldJournals({ universeId, characters }: {
  universeId: string; characters: Array<{id:string;name:string}>;
}) {
  const [entries,setEntries]=useState<Entry[]>([]);
  const [entriesUniverse,setEntriesUniverse]=useState(universeId);
  const currentUniverseRef=useRef(universeId);
  currentUniverseRef.current=universeId;
  const [draft,setDraft]=useState<Draft>(empty);
  const [editing,setEditing]=useState<string|null>(null);
  const [keywordInput,setKeywordInput]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [opened,setOpened]=useState(false);
  const url=`/api/universe/${encodeURIComponent(universeId)}/journals`;
  const load=async()=> {
    const requestedUniverse=universeId;
    const data=await customFetch<{entries:Entry[]}>(url,{responseType:'json'});
    if(currentUniverseRef.current===requestedUniverse){
      setEntries(data.entries);setEntriesUniverse(requestedUniverse);
    }
  };
  // A universe switch must never briefly show the previous world's private entries.
  useEffect(()=>{
    setEntries([]);
    setEntriesUniverse(universeId);
    setDraft(empty());
    setEditing(null);
    setKeywordInput('');
    setError('');
    setBusy(false);
    setOpened(false);
  },[universeId]);
  useEffect(()=>{ if(!opened)return; let active=true;
    void customFetch<{entries:Entry[]}>(url,{responseType:'json'})
      .then(data=>{if(active && currentUniverseRef.current===universeId){
        setEntries(data.entries);setEntriesUniverse(universeId);
      }})
      .catch(e=>{if(active && currentUniverseRef.current===universeId)
        setError(e instanceof Error?e.message:'No se pudieron cargar los Journals');});
    return()=>{active=false;};
  },[opened,url]);
  const save=async()=>{
    const requestedUniverse=universeId;
    setBusy(true);setError('');
    try {
      await customFetch(editing?`${url}/${editing}`:url,{
        method:editing?'PUT':'POST',body:JSON.stringify({...draft,keywords:keywordInput.split(',').map(x=>x.trim()).filter(Boolean)}),
        headers:{'Content-Type':'application/json'},responseType:'json'
      });
      if(currentUniverseRef.current===requestedUniverse){
        setEditing(null);setDraft(empty());setKeywordInput('');await load();
      }
    }catch(e){if(currentUniverseRef.current===requestedUniverse)
      setError(e instanceof Error?e.message:'Error al guardar');}
    finally{if(currentUniverseRef.current===requestedUniverse)setBusy(false);}
  };
  const approve=async(id:string)=>{
    const requestedUniverse=universeId;
    setBusy(true);setError('');
    try{await customFetch(`${url}/${id}/approve`,{method:'POST',responseType:'json'});await load();}
    catch(e){if(currentUniverseRef.current===requestedUniverse)
      setError(e instanceof Error?e.message:'No se pudo aprobar');}
    finally{if(currentUniverseRef.current===requestedUniverse)setBusy(false);}
  };
  const archive=async(id:string)=>{
    const requestedUniverse=universeId;
    setBusy(true);setError('');
    try{await customFetch(`${url}/${id}/archive`,{method:'POST',responseType:'json'});await load();}
    catch(e){if(currentUniverseRef.current===requestedUniverse)
      setError(e instanceof Error?e.message:'No se pudo archivar');}
    finally{if(currentUniverseRef.current===requestedUniverse)setBusy(false);}
  };
  const edit=(e:Entry)=>{
    setEditing(e.id);setKeywordInput(e.keywords.join(', '));setDraft({title:e.title,content:e.content,category:e.category,
      truthStatus:e.truth_status,knowledgeScope:e.knowledge_scope,
      knownCharacterIds:e.known_character_ids,keywords:e.keywords,sourceType:e.source_type});
  };
  return <section className="mt-5 space-y-3 rounded-2xl border border-border p-3">
    <button type="button" className="flex min-h-11 w-full items-center justify-between text-left font-semibold"
      onClick={()=>setOpened(v=>!v)}>World Journals <span>{opened?'−':'+'}</span></button>
    {opened&&<>
      <p className="text-xs text-muted-foreground">Conocimiento general, recuerdos y secretos. Las entradas nuevas se guardan como borrador; solo se publican al aprobarlas.</p>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      {entriesUniverse===universeId&&entries.map(e=><div key={e.id} className="space-y-1 rounded-xl bg-secondary/40 p-3">
        <div className="text-sm font-semibold">{e.title}</div>
        <p className="text-xs text-muted-foreground">{e.category} · {e.status} · {e.knowledge_scope}</p>
        <p className="line-clamp-3 whitespace-pre-wrap text-xs">{e.content}</p>
        <div className="flex gap-2">
          {e.status!=='archived'&&<button type="button" className="min-h-11 rounded-lg bg-secondary px-3 text-xs" disabled={busy} onClick={()=>edit(e)}>Editar</button>}
          {e.status!=='archived'&&<button type="button" className="min-h-11 rounded-lg bg-secondary px-3 text-xs" disabled={busy} onClick={()=>void archive(e.id)}>Archivar</button>}
          {e.status==='draft'&&<button type="button" className="min-h-11 rounded-lg bg-primary px-3 text-xs text-primary-foreground" disabled={busy} onClick={()=>void approve(e.id)}>Aprobar</button>}
        </div>
      </div>)}
      <div className="space-y-2 border-t border-border pt-3">
        <h3 className="text-sm font-semibold">{editing?'Editar Journal':'Nuevo Journal'}</h3>
        <input aria-label="Título del Journal" placeholder="Título" className="w-full rounded-xl border border-border bg-background p-3 text-sm"
          value={draft.title} onChange={e=>setDraft(v=>({...v,title:e.target.value}))}/>
        <textarea aria-label="Contenido del Journal" placeholder="Contenido" className="min-h-32 w-full rounded-xl border border-border bg-background p-3 text-sm"
          value={draft.content} onChange={e=>setDraft(v=>({...v,content:e.target.value}))}/>
        <label className="block text-xs">Tipo
          <select className="mt-1 w-full rounded-xl border border-border bg-background p-3" value={draft.category}
            onChange={e=>setDraft(v=>({...v,category:e.target.value as Draft['category'],
              knowledgeScope:e.target.value==='secret'?'nobody':v.knowledgeScope,
              knownCharacterIds:e.target.value==='secret'?[]:v.knownCharacterIds}))}>
            <option value="world_knowledge">Conocimiento del mundo</option>
            <option value="shared_memory">Recuerdo compartido</option>
            <option value="secret">Secreto</option>
          </select>
        </label>
        <label className="block text-xs">Veracidad
          <select className="mt-1 w-full rounded-xl border border-border bg-background p-3" value={draft.truthStatus}
            onChange={e=>setDraft(v=>({...v,truthStatus:e.target.value as Draft['truthStatus']}))}>
            <option value="confirmed">Confirmado</option><option value="rumor">Rumor</option>
            <option value="belief">Creencia</option><option value="unknown">Desconocido</option>
          </select>
        </label>
        <label className="block text-xs">Quién puede saberlo
          <select className="mt-1 w-full rounded-xl border border-border bg-background p-3" value={draft.knowledgeScope}
            onChange={e=>setDraft(v=>({...v,knowledgeScope:e.target.value as Draft['knowledgeScope'],
              knownCharacterIds:e.target.value==='selected'?v.knownCharacterIds:[]}))}>
            {draft.category!=='secret'&&<option value="everyone">Todos los personajes</option>}<option value="selected">Solo seleccionados</option>
            <option value="nobody">Ninguno todavía</option>
          </select>
        </label>
        {draft.knowledgeScope==='selected'&&<fieldset className="space-y-1">
          <legend className="text-xs">Personajes que conocen esta entrada</legend>
          {characters.map(c=><label key={c.id} className="flex min-h-9 items-center gap-2 text-xs">
            <input type="checkbox" checked={draft.knownCharacterIds.includes(c.id)}
              onChange={e=>setDraft(v=>({...v,knownCharacterIds:e.target.checked?
                [...v.knownCharacterIds,c.id]:v.knownCharacterIds.filter(id=>id!==c.id)}))}/>
            {c.name}
          </label>)}
        </fieldset>}
        <label className="block text-xs">Palabras clave (separadas por coma)
          <input className="mt-1 w-full rounded-xl border border-border bg-background p-3" value={keywordInput}
            onChange={e=>setKeywordInput(e.target.value)}/>
        </label>
        <div className="flex gap-2">
          <button type="button" className="min-h-11 flex-1 rounded-xl bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
            disabled={busy||!draft.title.trim()||!draft.content.trim()||(draft.knowledgeScope==='selected'&&!draft.knownCharacterIds.length)} onClick={()=>void save()}>Guardar borrador</button>
          {editing&&<button type="button" className="min-h-11 rounded-xl bg-secondary px-3 text-sm" onClick={()=>{setEditing(null);setDraft(empty());setKeywordInput('');}}>Cancelar</button>}
        </div>
      </div>
    </>}
  </section>;
}
