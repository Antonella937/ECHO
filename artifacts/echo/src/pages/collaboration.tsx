import { useSharedStatusText } from '@/lib/shared-status-translations';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { customFetch } from '@workspace/api-client-react';

type World = {name:string;description:string;revision:number};
export default function CollaborationPage() {
  const t = useSharedStatusText();
  const {ownerId,universeId}=useParams<{ownerId:string;universeId:string}>();
  const [world,setWorld]=useState<World|null>(null);
  const [name,setName]=useState('');
  const [description,setDescription]=useState('');
  const [status,setStatus]=useState('');
  const [saving,setSaving]=useState(false);
  const url='/api/universe/collaborations/'+encodeURIComponent(ownerId)+'/'+encodeURIComponent(universeId);
  useEffect(()=>{let live=true;void customFetch<World>(url,{responseType:'json'}).then(data=>{if(live){setWorld(data);setName(data.name||'');setDescription(data.description||'');}}).catch(()=>{if(live)setStatus(t(t("No tenés acceso a este mundo o se revocó tu permiso.")));});return()=>{live=false;};},[url]);
  const save=async()=>{
    if(!world)return;
    setSaving(true);setStatus('');
    try{const result=await customFetch<{revision:number}>(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description,expectedRevision:world.revision}),responseType:'json'});
      setWorld({...world,name,description,revision:result.revision});setStatus(t(t("Cambios guardados en el mundo compartido.")));
    }catch{setStatus(t(t("No se guardó. Puede haber cambios de otra persona: recargá la página antes de editar.")));}
    finally{setSaving(false);}
  };
  return <main className="mx-auto min-h-screen max-w-xl space-y-5 px-5 py-12">
    <Link href="/" className="text-primary">ECHO</Link>
    <h1 className="text-3xl font-semibold">{t("Mundo colaborativo")}</h1>
    <p className="text-sm text-muted-foreground">{t("Espacio compartido con permisos limitados. Por ahora podés editar el nombre y la descripción del mundo; las conversaciones y memorias privadas permanecen protegidas.")}</p>
    {world && <><label className="block text-sm">{t("Nombre")}<input className="mt-2 w-full rounded-xl border border-border bg-background p-3" maxLength={60} value={name} onChange={e=>setName(e.target.value)}/></label>
    <label className="block text-sm">{t("Descripción")}<textarea className="mt-2 w-full rounded-xl border border-border bg-background p-3" maxLength={500} rows={5} value={description} onChange={e=>setDescription(e.target.value)}/></label>
    <button type="button" disabled={saving||!name.trim()} onClick={()=>void save()} className="rounded-full bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50">{saving?t(t("Guardando…")):t(t("Guardar cambios compartidos"))}</button></>}
    {status && <p role="status">{status}</p>}
  </main>;
}
