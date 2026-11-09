import { useEffect, useState, type FormEvent } from 'react';
import { useUser } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { getActiveUniverseId } from '@/store/persistence';
import { useSocial } from '@/store/social-store';
import { useLanguage } from '@/lib/i18n';
import { Link } from 'wouter';

type Scene = { sceneId: string; title: string; premise: string; canon: 'main'|'alternate'; participantIds: string[]; status: string; turnSettings?: { mode: 'automatic'|'manual'|'ordered'; order: string[]; nextCharacterId: string|null; cursor: number; style?: 'natural'|'cinematic'|'literary'|'concise'; autoReply?: boolean } };
type SceneEvent = { eventId: string; actorId: string; text: string; visibility: string; createdAt: string };
export default function ScenesPage() {
  const { user } = useUser();
  const { state, me } = useSocial();
  const lang = useLanguage();
  const es = lang === 'es';
  const universeId = user?.id ? getActiveUniverseId(user.id) : 'primary';
  const [scenes,setScenes] = useState<Scene[]>([]);
  const [selected,setSelected] = useState<string|null>(null);
  const [events,setEvents] = useState<SceneEvent[]>([]);
  const [presence,setPresence] = useState<Record<string,'present'|'absent'|'left'>>({});
  const [title,setTitle] = useState('');
  const [premise,setPremise] = useState('');
  const [canon,setCanon] = useState<'main'|'alternate'>('main');
  const [participants,setParticipants] = useState<string[]>([]);
  const [message,setMessage] = useState('');
  const [nextSpeaker,setNextSpeaker] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [showCreate,setShowCreate] = useState(false);
  const characters = state.characters.filter(c => !c.archived && c.id !== me.id);
  const refresh = async () => {
    const result = await customFetch<{scenes:Scene[]}>(`/api/scenes?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json',cache:'no-store'});
    setScenes(result.scenes);
  };
  useEffect(()=>{ if(user?.id) void refresh().catch(()=>setError(es?'No se pudieron cargar las escenas.':'Could not load scenes.')); },[user?.id,universeId]);
  useEffect(()=>{if(!selected)return; let active=true;
    void customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(selected)}/events?${new URLSearchParams({universeId,viewerId:me.id})}`,{method:'GET',responseType:'json',cache:'no-store'})
      .then(r=>{if(active)setEvents(r.events)}).catch(()=>{if(active)setError(es?'No se pudieron cargar los eventos.':'Could not load events.')});
    return()=>{active=false};
  },[selected,universeId,me.id]);
  useEffect(()=>{if(!selected)return;let mounted=true;
    void customFetch<{presence:{characterId:string;presence:'present'|'absent'|'left'}[]}>(`/api/scenes/${encodeURIComponent(selected)}/presence?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json'})
      .then(r=>{if(mounted)setPresence(Object.fromEntries(r.presence.map(p=>[p.characterId,p.presence])));})
      .catch(()=>{});
    return()=>{mounted=false};
  },[selected,universeId]);
  const updatePresence=async(characterId:string,value:'present'|'absent'|'left')=>{
    if(!selected)return;setBusy(true);setError('');
    try{await customFetch(`/api/scenes/${encodeURIComponent(selected)}/presence`,{
      method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({universeId,characterId,presence:value})
    });setPresence(old=>({...old,[characterId]:value}));}
    catch{setError(es?'No se pudo actualizar la presencia.':'Could not update presence.')}
    finally{setBusy(false)}
  };
  const create = async (e:FormEvent) => {e.preventDefault();if(!participants.length)return;setBusy(true);setError('');
    try { const r=await customFetch<{sceneId:string}>('/api/scenes',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,title,premise,canon,participantIds:[me.id,...participants]})});await refresh();setSelected(r.sceneId);setTitle('');setPremise('');setParticipants([]);setShowCreate(false);}
    catch{setError(es?'No se pudo crear la escena.':'Could not create scene.')}finally{setBusy(false)}
  };
  const send = async (e:FormEvent) => {e.preventDefault();if(!selected||!message.trim())return;setBusy(true);setError('');
    try {await customFetch('/api/scenes/events',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,sceneId:selected,actorId:me.id,text:message.trim(),visibility:'participants',audienceIds:[]})});setMessage('');
      const r=await customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(selected)}/events?${new URLSearchParams({universeId,viewerId:me.id})}`,{method:'GET',responseType:'json'});setEvents(r.events);
      if(active?.turnSettings?.autoReply && active?.status==='active' && active.turnSettings?.mode!=='manual'){
        const ai=active.participantIds.filter(id=>id!==me.id);
        const turn=active.turnSettings;
        const chosen=turn?.nextCharacterId && ai.includes(turn.nextCharacterId)?turn.nextCharacterId:
          turn?.mode==='ordered' ? (turn.order??[]).filter(id=>ai.includes(id))[(turn.cursor??0)%Math.max(1,(turn.order??[]).filter(id=>ai.includes(id)).length)]:
          ai.find(id=>id!==r.events.filter(ev=>ai.includes(ev.actorId)).at(-1)?.actorId)??ai[0];
        if(chosen){
          await customFetch(`/api/scenes/${encodeURIComponent(selected)}/reply`,{
            method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({universeId,characterId:chosen})
          });
          const after=await customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(selected)}/events?${new URLSearchParams({universeId,viewerId:me.id})}`,{method:'GET',responseType:'json'});
          setEvents(after.events);
          await refresh();
        }
      }
    }catch{setError(es?'No se pudo enviar.':'Could not send.')}finally{setBusy(false)}
  };
  const active=scenes.find(s=>s.sceneId===selected);
  const updateTurns = async (mode: 'automatic'|'manual'|'ordered', nextCharacterId: string|null = null, options: {style?: 'natural'|'cinematic'|'literary'|'concise';autoReply?:boolean} = {}) => {
    if (!active) return;
    setBusy(true);setError('');
    try {
      const result=await customFetch<{turnSettings:NonNullable<Scene['turnSettings']>}>(`/api/scenes/${encodeURIComponent(active.sceneId)}/turns`,{
        method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({universeId,mode,order:active.turnSettings?.order??active.participantIds,nextCharacterId,style:options.style??active.turnSettings?.style??'natural',autoReply:options.autoReply??active.turnSettings?.autoReply??false})
      });
      setScenes(previous=>previous.map(scene=>scene.sceneId===active.sceneId?{...scene,turnSettings:result.turnSettings}:scene));
      setNextSpeaker('');
    }catch{setError(es?'No se pudieron guardar los turnos.':'Could not save turn settings.')}
    finally{setBusy(false)}
  };
  const generateReply = async (characterId:string)=>{
    if(!active)return;setBusy(true);setError('');
    try{
      await customFetch(`/api/scenes/${encodeURIComponent(active.sceneId)}/reply`,{
        method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({universeId,characterId})
      });
      const [history,listing]=await Promise.all([
        customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(active.sceneId)}/events?${new URLSearchParams({universeId,viewerId:me.id})}`,{method:'GET',responseType:'json'}),
        customFetch<{scenes:Scene[]}>(`/api/scenes?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json'})
      ]);
      setEvents(history.events);setScenes(listing.scenes);
    }catch{setError(es?'No se pudo generar la respuesta. Revisá el turno y los créditos de IA.':'Could not generate a reply. Check turn settings and AI credits.')}
    finally{setBusy(false)}
  };
  const continueScene = async () => {
    if(!active || active.status!=='active' || busy)return;
    const ai = active.participantIds.filter(id=>id!==me.id);
    if(!ai.length)return;
    const turn=active.turnSettings;
    let target=turn?.nextCharacterId && ai.includes(turn.nextCharacterId)?turn.nextCharacterId:null;
    if(!target && turn?.mode==='manual'){
      setError(es?'Elegí primero el próximo personaje.':'Choose the next character first.');
      return;
    }
    if(!target && turn?.mode==='ordered'){
      const order=(turn.order??[]).filter(id=>ai.includes(id));
      target=order.length?order[(turn.cursor??0)%order.length]:null;
    }
    if(!target){
      const last=events.filter(e=>ai.includes(e.actorId)).at(-1)?.actorId;
      target=ai.find(id=>id!==last)??ai[0];
    }
    if(target)await generateReply(target);
  };
  const updateStatus = async (status:'active'|'paused'|'finished')=>{
    if(!active)return;setBusy(true);setError('');
    try{await customFetch(`/api/scenes/${encodeURIComponent(active.sceneId)}/status`,{
      method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,status})
    });setScenes(previous=>previous.map(scene=>scene.sceneId===active.sceneId?{...scene,status}:scene));}
    catch{setError(es?'No se pudo actualizar la escena.':'Could not update scene.')}
    finally{setBusy(false)}
  };
  return <main className="mx-auto w-full max-w-2xl min-w-0 space-y-5 overflow-x-hidden px-4 pt-[calc(env(safe-area-inset-top,0px)+1.5rem)] pb-[calc(env(safe-area-inset-bottom,0px)+7rem)]">
    <div className="sticky top-0 z-10 -mx-4 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur"><h1 className="text-xl font-bold">ECHO Scenes</h1><Link href="/messages" className="shrink-0 text-sm text-muted-foreground">{es?'Volver a mensajes':'Back to messages'}</Link></div>
    <button type="button" onClick={()=>setShowCreate(value=>!value)} className="w-full rounded-xl border border-border p-3 text-left text-sm font-semibold">{showCreate ? (es?"− Ocultar creación":"− Hide creation") : (es?"+ Crear nueva escena":"+ Create new scene")}</button>
    {showCreate&&<form onSubmit={create} className="space-y-3 rounded-2xl border border-border p-4">
      <h2 className="font-semibold">{es?'Crear escena':'Create scene'}</h2>
      <input required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} placeholder={es?'Título':'Title'} className="w-full rounded-xl border border-border bg-background p-3"/>
      <textarea maxLength={4000} value={premise} onChange={e=>setPremise(e.target.value)} placeholder={es?'Premisa':'Premise'} className="w-full rounded-xl border border-border bg-background p-3"/>
      <select value={canon} onChange={e=>setCanon(e.target.value as 'main'|'alternate')} className="w-full rounded-xl border border-border bg-background p-3"><option value="main">{es?'Canon principal':'Main canon'}</option><option value="alternate">{es?'Universo alternativo':'Alternate universe'}</option></select>
      <div className="text-sm font-medium">{es?'Participantes':'Participants'}</div>
      <div className="max-h-40 space-y-2 overflow-y-auto">{characters.map(c=><label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={participants.includes(c.id)} onChange={e=>setParticipants(old=>e.target.checked?[...old,c.id]:old.filter(x=>x!==c.id))}/>{c.name}</label>)}</div>
      <button disabled={busy||!title.trim()||!participants.length} className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50">{es?'Crear':'Create'}</button>
    </form>}
    <section className="space-y-2"><h2 className="font-semibold">{es?'Mis escenas':'My scenes'}</h2>{scenes.map(s=><button key={s.sceneId} onClick={()=>setSelected(s.sceneId)} className={`block w-full rounded-xl border p-3 text-left ${selected===s.sceneId?'border-primary':'border-border'}`}><strong>{s.title}</strong><div className="text-xs text-muted-foreground">{s.canon==='main'?(es?'Principal':'Main'):(es?'Alternativo':'Alternate')} · {s.status}</div></button>)}</section>
    {active&&<section className="space-y-3 rounded-2xl border border-border p-4"><h2 className="font-semibold">{active.title}</h2><p className="text-sm text-muted-foreground">{active.premise}</p><details open className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">{es?'Turnos y estado':'Turns and status'}</summary>
        <div className="space-y-3 pt-3">
          <label className="block space-y-1 text-sm"><span className="font-medium">{es?'Estilo de escritura de IA':'AI writing style'}</span>
            <select disabled={busy||active.status==='finished'} value={active.turnSettings?.style??'natural'}
              onChange={e=>void updateTurns(active.turnSettings?.mode??'automatic',active.turnSettings?.nextCharacterId??null,{style:e.target.value as 'natural'|'cinematic'|'literary'|'concise'})}
              className="w-full rounded-xl border border-border bg-background p-3">
              <option value="natural">{es?'Natural / Conversacional':'Natural / Conversational'}</option>
              <option value="cinematic">{es?'Cinematográfico':'Cinematic'}</option>
              <option value="literary">{es?'Literario / Descriptivo':'Literary / Descriptive'}</option>
              <option value="concise">{es?'Breve / Directo':'Concise / Direct'}</option>
            </select>
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
            <input type="checkbox" className="mt-1" disabled={busy||active.status==='finished'} checked={active.turnSettings?.autoReply??false}
              onChange={e=>void updateTurns(active.turnSettings?.mode??'automatic',active.turnSettings?.nextCharacterId??null,{autoReply:e.target.checked})}/>
            <span><strong>{es?'Autonomía de respuesta':'Reply autonomy'}</strong><span className="mt-1 block text-xs text-muted-foreground">{es?'La IA responde automáticamente una vez después de que escribís. Para continuar sin escribir, usá «Continuar escena».':'AI replies once after you send a message. To continue without writing, use Continue scene.'}</span></span>
          </label>
          <select disabled={busy||active.status==='finished'} value={active.turnSettings?.mode??'automatic'} onChange={e=>void updateTurns(e.target.value as 'automatic'|'manual'|'ordered')} className="w-full rounded-xl border border-border bg-background p-2">
            <option value="automatic">{es?'Automático':'Automatic'}</option><option value="manual">{es?'Manual':'Manual'}</option><option value="ordered">{es?'Por orden':'Ordered'}</option>
          </select>
          <select value={nextSpeaker} onChange={e=>setNextSpeaker(e.target.value)} className="w-full rounded-xl border border-border bg-background p-2">
            <option value="">{es?'Elegir personaje':'Choose character'}</option>
            {active.participantIds.filter(id=>id!==me.id).map(id=><option key={id} value={id}>{state.characters.find(c=>c.id===id)?.name??id}</option>)}
          </select>
          <button type="button" disabled={busy||!nextSpeaker||active.status!=='active'} onClick={()=>void updateTurns(active.turnSettings?.mode??'automatic',nextSpeaker)} className="rounded-xl border border-border px-3 py-2 text-sm">{es?'Elegir próximo turno':'Choose next turn'}</button>
          <div className="space-y-2"><div className="text-sm font-medium">{es?'Presencia narrativa':'Narrative presence'}</div>
            {active.participantIds.map(id=><label key={id} className="flex items-center justify-between gap-2 text-sm">
              <span>{state.characters.find(c=>c.id===id)?.name??id}</span>
              <select disabled={busy||active.status==='finished'} value={presence[id]??'present'} onChange={e=>void updatePresence(id,e.target.value as 'present'|'absent'|'left')} className="rounded-lg border border-border bg-background p-2">
                <option value="present">{es?'Presente':'Present'}</option>
                <option value="absent">{es?'Ausente':'Absent'}</option>
                <option value="left">{es?'Se retiró':'Left'}</option>
              </select>
            </label>)}
          </div>
          <div className="flex gap-2">
            {active.status==='active'&&<button type="button" disabled={busy} onClick={()=>void updateStatus('paused')} className="rounded-xl border border-border px-3 py-2 text-sm">{es?'Pausar':'Pause'}</button>}
            {active.status==='paused'&&<button type="button" disabled={busy} onClick={()=>void updateStatus('active')} className="rounded-xl border border-border px-3 py-2 text-sm">{es?'Reanudar':'Resume'}</button>}
            {active.status!=='finished'&&<button type="button" disabled={busy} onClick={()=>void updateStatus('finished')} className="rounded-xl border border-border px-3 py-2 text-sm">{es?'Finalizar':'Finish'}</button>}
          </div>
        </div>
      </details><div className="flex flex-wrap gap-2">
        {active.status==='active'&&<button type="button" disabled={busy} onClick={()=>void continueScene()} className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">▶ {es?'Continuar escena':'Continue scene'}</button>}
        {active.status==='active'&&active.participantIds.filter(id=>id!==me.id).map(id=><button type="button" key={id} disabled={busy} onClick={()=>void generateReply(id)}
          className="rounded-xl border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">
          ✦ {state.characters.find(c=>c.id===id)?.name??id}
        </button>)}
      </div><div className="max-h-96 space-y-3 overflow-y-auto">{events.map(ev=><article key={ev.eventId} className="rounded-xl bg-secondary p-3 text-sm"><strong>{ev.actorId===me.id?me.name:state.characters.find(c=>c.id===ev.actorId)?.name??ev.actorId}</strong><p className="mt-1 whitespace-pre-wrap">{ev.text}</p></article>)}</div><form onSubmit={send} className="flex min-w-0 gap-2"><input value={message} onChange={e=>setMessage(e.target.value)} maxLength={5000} placeholder={es?'Escribí en la escena…':'Write in scene…'} className="min-w-0 flex-1 rounded-xl border border-border bg-background p-3"/><button disabled={busy||active.status!=='active'||!message.trim()} className="rounded-xl bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{es?'Enviar':'Send'}</button></form></section>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </main>;
}
