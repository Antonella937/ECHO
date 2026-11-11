import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';

type Application = {owner_id:string;status:'pending'|'approved'|'rejected';created_at:string;updated_at:string};
export default function BetaAdminPage() {
  const [requests,setRequests]=useState<Application[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState<string|null>(null);
  const refresh=async()=>{
    setLoading(true);
    try {
      const data=await customFetch<{requests:Application[]}>('/api/beta/admin/requests',{responseType:'json'});
      setRequests(data.requests);
      setError('');
    } catch {setError('No se pudieron cargar las solicitudes. Verificá tus permisos y la migración de la base de datos.');}
    finally {setLoading(false);}
  };
  useEffect(()=>{void refresh();},[]);
  const decide=async(ownerId:string,status:'approved'|'rejected')=>{
    setBusy(ownerId);setError('');
    try {
      await customFetch('/api/beta/admin/requests/'+encodeURIComponent(ownerId)+'/decision',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status}),responseType:'json'
      });
      await refresh();
    } catch {setError('No se pudo guardar la decisión. Puede haberse alcanzado el cupo.');}
    finally {setBusy(null);}
  };
  return <main className="mx-auto max-w-3xl px-4 pb-24 pt-6 text-foreground">
    <Link href="/settings" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4"/> Configuración</Link>
    <p className="text-xs font-semibold uppercase tracking-widest text-primary">ECHO · Founder</p>
    <h1 className="mt-2 text-2xl font-bold">Solicitudes de beta</h1>
    <p className="mt-2 text-sm text-muted-foreground">Aprobá o rechazá el acceso a la beta privada. Solo tu cuenta Founder puede administrar estas solicitudes.</p>
    <button type="button" onClick={()=>void refresh()} disabled={loading} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border px-4 text-sm"><RefreshCw className="h-4 w-4"/> Actualizar</button>
    {error&&<p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
    {loading?<p className="mt-6 text-sm text-muted-foreground">Cargando…</p>:requests.length===0?<p className="mt-6 text-sm text-muted-foreground">Todavía no hay solicitudes.</p>:
      <div className="mt-5 space-y-3">{requests.map(item=><section key={item.owner_id} className="rounded-2xl border border-border bg-card p-4">
        <p className="break-all text-sm font-medium">{item.owner_id}</p>
        <p className="mt-1 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString('es-AR')} · {item.status}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={busy!==null||item.status==='approved'} onClick={()=>void decide(item.owner_id,'approved')} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40">Aprobar</button>
          <button type="button" disabled={busy!==null||item.status==='rejected'} onClick={()=>void decide(item.owner_id,'rejected')} className="min-h-11 rounded-xl border border-border px-4 text-sm disabled:opacity-40">Rechazar</button>
        </div>
      </section>)}</div>}
  </main>;
}
