import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';

type Status = 'not_requested'|'pending'|'approved'|'rejected';
export default function BetaRequestPanel() {
  const [status,setStatus]=useState<Status|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    void customFetch<{status:Status}>('/api/beta/request',{responseType:'json'})
      .then(result=>setStatus(result.status))
      .catch(()=>setError('No pudimos consultar tu solicitud. Probá nuevamente más tarde.'));
  },[]);
  const request=async()=>{
    setBusy(true);setError('');
    try {
      const result=await customFetch<{status:Status}>('/api/beta/request',{method:'POST',responseType:'json'});
      setStatus(result.status);
    } catch {setError('No se pudo enviar la solicitud. Intentá de nuevo.');}
    finally {setBusy(false);}
  };
  return <div className="mt-5 text-center">
    {status==='pending'&&<p role="status">Tu solicitud está pendiente de aprobación. Te avisaremos cuando se habilite tu acceso.</p>}
    {status==='approved'&&<p role="status">¡Tu cuenta fue aprobada! Actualizá ECHO para ingresar.</p>}
    {status==='rejected'&&<p role="status">Tu solicitud no fue aprobada por ahora.</p>}
    {status==='not_requested'&&<button type="button" className="ep-button" disabled={busy} onClick={()=>void request()}>{busy?'Enviando…':'Solicitar acceso a la beta'}</button>}
    {error&&<p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
  </div>;
}
