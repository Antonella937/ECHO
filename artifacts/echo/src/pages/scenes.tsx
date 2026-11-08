import { useEffect, useState, type FormEvent } from 'react';
import { useUser } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { getActiveUniverseId } from '@/store/persistence';
import { useSocial } from '@/store/social-store';
import { useLanguage } from '@/lib/i18n';
import { Link } from 'wouter';

type Scene = { sceneId: string; title: string; premise: string; canon: 'main'|'alternate'; participantIds: string[]; status: string };
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
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const characters = state.characters.filter(c => !c.archived && c.id !== me.id);
  const refresh = async () => {
    const result = await customFetch<{scenes:Scene[]}>(`/api/scenes?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json',cache:'no-store'});
    setScenes(result.scenes);
  };
  useEffect(()=>{ if(user?.id) void refresh().catch(()=>setError(es?'No se pudieron cargar las escenas.':'Could not load scenes.')); },[user?.id,universeId]);
  useEffect(()=>{if(!selected)return; let active=true;
    void customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(selected)}/events?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json',cache:'no-store'})
      .then(r=>{if(active)setEvents(r.events)}).catch(()=>{if(active)setError(es?'No se pudieron cargar los eventos.':'Could not load events.')});
    return()=>{active=false};
  },[selected,universeId]);
  const create = async (e:FormEvent) => {e.preventDefault();if(!participants.length)return;setBusy(true);setError('');
    try { const r=await customFetch<{sceneId:string}>('/api/scenes',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,title,premise,canon,participantIds:participants})});await refresh();setSelected(r.sceneId);setTitle('');setPremise('');setParticipants([]);}
    catch{setError(es?'No se pudo crear la escena.':'Could not create scene.')}finally{setBusy(false)}
  };
  const send = async (e:FormEvent) => {e.preventDefault();if(!selected||!message.trim())return;setBusy(true);setError('');
    try {await customFetch('/api/scenes/events',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,sceneId:selected,actorId:me.id,text:message.trim(),visibility:'participants',audienceIds:[]})});setMessage('');
      const r=await customFetch<{events:SceneEvent[]}>(`/api/scenes/${encodeURIComponent(selected)}/events?${new URLSearchParams({universeId})}`,{method:'GET',responseType:'json'});setEvents(r.events);
    }catch{setError(es?'No se pudo enviar.':'Could not send.')}finally{setBusy(false)}
  };
  const active=scenes.find(s=>s.sceneId===selected);
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
    {active&&<section className="space-y-3 rounded-2xl border border-border p-4"><h2 className="font-semibold">{active.title}</h2><p className="text-sm text-muted-foreground">{active.premise}</p><div className="max-h-96 space-y-3 overflow-y-auto">{events.map(ev=><article key={ev.eventId} className="rounded-xl bg-secondary p-3 text-sm"><strong>{ev.actorId===me.id?me.name:state.characters.find(c=>c.id===ev.actorId)?.name??ev.actorId}</strong><p className="mt-1 whitespace-pre-wrap">{ev.text}</p></article>)}</div><form onSubmit={send} className="flex gap-2"><input value={message} onChange={e=>setMessage(e.target.value)} maxLength={5000} placeholder={es?'Escribí en la escena…':'Write in scene…'} className="min-w-0 flex-1 rounded-xl border border-border bg-background p-3"/><button disabled={busy||!message.trim()} className="rounded-xl bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{es?'Enviar':'Send'}</button></form></section>}
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  </main>;
}
