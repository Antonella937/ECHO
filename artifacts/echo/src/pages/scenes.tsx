import { useEffect, useState, type FormEvent } from 'react';
import { useUser } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { getActiveUniverseId } from '@/store/persistence';
import { useSocial } from '@/store/social-store';
import { useLanguage } from '@/lib/i18n';
import { Link } from 'wouter';

type Scene = { sceneId: string; title: string; premise: string; canon: 'main'|'alternate'; participantIds: string[]; status: string; turnSettings?: { mode: 'automatic'|'manual'|'ordered'; order: string[]; nextCharacterId: string|null; cursor: number } };
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
  const [title,setTitle] = useState('');
  const [premise,setPremise] = useState('');
  const [canon,setCanon] = useState<'main'|'alternate'>('main');
  const [participants,setParticipants] = useState<string[]>([]);
  const [message,setMessage] = useState('');
  const [nextSpeaker,setNextSpeaker] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
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
  const create = async (e:FormEvent) => {e.preventDefault();if(!participants.length)return;setBusy(true);setError('');
    try { const r=await customFetch<{sceneId:string}>('/api/scenes',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,title,premise,canon,participantIds:[me.id,...participants]})});await refresh();setSelected(r.sceneId);setTitle('');setPremise('');setParticipants([]);}
    catch{setError(es?'No se pudo crear la escena.':'Could not create scene.')}finally{setBusy(false)}
  };
  const send = async (e:FormEvent) => {e.preventDefault();if(!selected||!message.trim())return;setBusy(true);setError('');
    try {await customFetch('/api/scenes/events',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,sceneId:selected,actorId:me.id,text:message.trim(),visibility:'participants',audienceIds:[]})});setMessage('');
      const r=await customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(selected)}/events?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json'});setEvents(r.events);
    }catch{setError(es?'No se pudo enviar.':'Could not send.')}finally{setBusy(false)}
  };
  const active=scenes.find(s=>s.sceneId===selected);
  const updateTurns = async (mode: 'automatic'|'manual'|'ordered', nextCharacterId: string|null = null) => {
    if (!active) return;
    setBusy(true);setError('');
    try {
      const result=await customFetch<{turnSettings:NonNullable<Scene['turnSettings']>}>(`/api/scenes/${encodeURIComponent(active.sceneId)}/turns`,{
        method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({universeId,mode,order:active.turnSettings?.order??active.participantIds,nextCharacterId})
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
        customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(active.sceneId)}/events?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json'}),
        customFetch<{scenes:Scene[]}>(`/api/scenes?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json'})
      ]);
      setEvents(history.events);setScenes(listing.scenes);
    }catch{setError(es?'No se pudo generar la respuesta. Revisá el turno y los créditos de IA.':'Could not generate a reply. Check turn settings and AI credits.')}
    finally{setBusy(false)}
  };
  const updateStatus = async (status:'active'|'paused'|'finished')=>{
    if(!active)return;setBusy(true);setError('');
    try{await customFetch(`/api/scenes/${encodeURIComponent(active.sceneId)}/status`,{
      method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,status})
    });setScenes(previous=>previous.map(scene=>scene.sceneId===active.sceneId?{...scene,status}:scene));}
    catch{setError(es?'No se pudo actualizar la escena.':'Could not update scene.')}
    finally{setBusy(false)}
  };
  return <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-5">
    <div className="flex items-center justify-between"><h1 className="text-xl font-bold">ECHO Scenes</h1><Link href="/messages" className="text-sm text-muted-foreground">{es?'Volver a mensajes':'Back to messages'}</Link></div>
    <form onSubmit={create} className="space-y-3 rounded-2xl border border-border p-4">
      <h2 className="font-semibold">{es?'Crear escena':'Create scene'}</h2>
      <input required maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} placeholder={es?'Título':'Title'} className="w-full rounded-xl border border-border bg-background p-3"/>
      <textarea maxLength={4000} value={premise} onChange={e=>setPremise(e.target.value)} placeholder={es?'Premisa':'Premise'} className="w-full rounded-xl border border-border bg-background p-3"/>
      <select value={canon} onChange={e=>setCanon(e.target.value as 'main'|'alternate')} className="w-full rounded-xl border border-border bg-background p-3"><option value="main">{es?'Canon principal':'Main canon'}</option><option value="alternate">{es?'Universo alternativo':'Alternate universe'}</option></select>
      <div className="text-sm font-medium">{es?'Participantes':'Participants'}</div>
      <div className="max-h-40 space-y-2 overflow-y-auto">{characters.map(c=><label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={participants.includes(c.id)} onChange={e=>setParticipants(old=>e.target.checked?[...old,c.id]:old.filter(x=>x!==c.id))}/>{c.name}</label>)}</div>
      <button disabled={busy||!title.trim()||!participants.length} className="rounded-xl bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50">{es?'Crear':'Create'}</button>
    </form>
    <section className="space-y-2"><h2 className="font-semibold">{es?'Mis escenas':'My scenes'}</h2>{scenes.map(s=><button key={s.sceneId} onClick={()=>setSelected(s.sceneId)} className={`block w-full rounded-xl border p-3 text-left ${selected===s.sceneId?'border-primary':'border-border'}`}><strong>{s.title}</strong><div className="text-xs text-muted-foreground">{s.canon==='main'?(es?'Principal':'Main'):(es?'Alternativo':'Alternate')} · {s.status}</div></button>)}</section>
    {active&&<section className="space-y-3 rounded-2xl border border-border p-4"><h2 className="font-semibold">{active.title}</h2><p className="text-sm text-muted-foreground">{active.premise}</p><details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-semibold">{es?'Turnos y estado':'Turns and status'}</summary>
        <div className="space-y-3 pt-3">
          <select disabled={busy||active.status==='finished'} value={active.turnSettings?.mode??'automatic'} onChange={e=>void updateTurns(e.target.value as 'automatic'|'manual'|'ordered')} className="w-full rounded-xl border border-border bg-background p-2">
            <option value="automatic">{es?'Automático':'Automatic'}</option><option value="manual">{es?'Manual':'Manual'}</option><option value="ordered">{es?'Por orden':'Ordered'}</option>
          </select>
          <select value={nextSpeaker} onChange={e=>setNextSpeaker(e.target.value)} className="w-full rounded-xl border border-border bg-background p-2">
            <option value="">{es?'Elegir personaje':'Choose character'}</option>
            {active.participantIds.filter(id=>id!==me.id).map(id=><option key={id} value={id}>{state.characters.find(c=>c.id===id)?.name??id}</option>)}
          </select>
          <button type="button" disabled={busy||!nextSpeaker||active.status!=='active'} onClick={()=>void updateTurns(active.turnSettings?.mode??'automatic',nextSpeaker)} className="rounded-xl border border-border px-3 py-2 text-sm">{es?'Elegir próximo turno':'Choose next turn'}</button>
          <div className="flex gap-2">
            {active.status==='active'&&<button type="button" disabled={busy} onClick={()=>void updateStatus('paused')} className="rounded-xl border border-border px-3 py-2 text-sm">{es?'Pausar':'Pause'}</button>}
            {active.status==='paused'&&<button type="button" disabled={busy} onClick={()=>void updateStatus('active')} className="rounded-xl border border-border px-3 py-2 text-sm">{es?'Reanudar':'Resume'}</button>}
            {active.status!=='finished'&&<button type="button" disabled={busy} onClick={()=>void updateStatus('finished')} className="rounded-xl border border-border px-3 py-2 text-sm">{es?'Finalizar':'Finish'}</button>}
          </div>
        </div>
      </details><div className="flex flex-wrap gap-2">
        {active.status==='active'&&active.participantIds.filter(id=>id!==me.id).map(id=><button type="button" key={id} disabled={busy} onClick={()=>void generateReply(id)}
          className="rounded-xl border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">
          ✦ {state.characters.find(c=>c.id===id)?.name??id}
        </button>)}
      </div><div className="max-h-96 space-y-3 overflow-y-auto">{events.map(ev=><article key={ev.eventId} className="rounded-xl bg-secondary p-3 text-sm"><strong>{ev.actorId===me.id?me.name:state.characters.find(c=>c.id===ev.actorId)?.name??ev.actorId}</strong><p className="mt-1 whitespace-pre-wrap">{ev.text}</p></article>)}</div><form onSubmit={send} className="flex gap-2"><input value={message} onChange={e=>setMessage(e.target.value)} maxLength={5000} placeholder={es?'Escribí en la escena…':'Write in scene…'} className="min-w-0 flex-1 rounded-xl border border-border bg-background p-3"/><button disabled={busy||active.status!=='active'||!message.trim()} className="rounded-xl bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{es?'Enviar':'Send'}</button></form></section>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </main>;
}
