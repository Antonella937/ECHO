import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useLanguage } from '@/lib/i18n';

type LinkState = {kinId:string;enabled:boolean;socialContextEnabled:boolean};
const words:Record<string,[string,string,string,string,string,string,string]> = {
 es:['Motor de respuestas · Kindroid','Kin ID del personaje','Usar Kindroid para responder DM','Guardar conexión','Conexión guardada','No se pudo guardar','Solo afecta a los DM. Las publicaciones y demás funciones siguen usando ECHO.'],
 en:['Reply engine · Kindroid','Character Kin ID','Use Kindroid for DM replies','Save connection','Connection saved','Could not save','Only affects DMs. Posts and other features continue using ECHO.'],
};
export function KindroidLinkPanel({characterId}:{characterId:string}) {
 const language=useLanguage();
 const t=words[language]??words.en;
 const [data,setData]=useState<LinkState>({kinId:'',enabled:false,socialContextEnabled:false});
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState('');
 useEffect(()=>{
   let active=true;
   void customFetch<LinkState>(`/api/characters/kindroid-link?characterId=${encodeURIComponent(characterId)}&universeId=primary`,{responseType:'json'})
     .then(v=>{if(active)setData(v);}).catch(()=>{if(active)setStatus('Unavailable');});
   return ()=>{active=false;};
 },[characterId]);
 async function save(){
   if(!data.kinId.trim()||busy)return;
   setBusy(true);setStatus('');
   try{
     await customFetch('/api/characters/kindroid-link',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId,universeId:'primary',kinId:data.kinId.trim(),enabled:data.enabled,socialContextEnabled:data.socialContextEnabled}),responseType:'json'});
     setStatus(t[4]);
   }catch{setStatus(t[5]);}finally{setBusy(false);}
 }
 return <details className="mt-5 rounded-2xl border border-border bg-card/40" data-testid="kindroid-link-panel">
   <summary className="cursor-pointer px-4 py-4 text-sm font-semibold">{t[0]}</summary>
   <div className="border-t border-border p-4">
     <label htmlFor="kindroid-kin-id" className="mb-2 block text-sm">{t[1]}</label>
     <input id="kindroid-kin-id" value={data.kinId} onChange={e=>{setData(v=>({...v,kinId:e.target.value}));setStatus('');}}
       autoComplete="off" spellCheck={false} className="h-12 w-full rounded-xl border border-border bg-background px-3 text-sm" />
     <label className="mt-4 flex items-center gap-3 text-sm">
       <input type="checkbox" checked={data.enabled} onChange={e=>{setData(v=>({...v,enabled:e.target.checked}));setStatus('');}} />
       {t[2]}
     </label>
     <label className="mt-4 flex items-center gap-3 text-sm">
       <input type="checkbox" checked={data.socialContextEnabled} onChange={e=>{setData(v=>({...v,socialContextEnabled:e.target.checked}));setStatus('');}} />
       {language==='es'?'Compartir contexto social visible de ECHO con Kindroid':'Share visible ECHO social context with Kindroid'}
     </label>
     <p className="mt-2 text-xs text-muted-foreground">{language==='es'?'Incluye publicaciones y comentarios visibles para este personaje en las solicitudes de DM. Kindroid puede conservarlos en su historial. No incluye DM privados de terceros ni modifica su personalidad.':'Includes actor-visible posts and comments in DM requests. Kindroid may retain them in its history. Does not include third-party private DMs or change its persona.'}</p>
     <p className="mt-3 text-xs text-muted-foreground">{t[6]}</p>
     <button type="button" disabled={busy||!data.kinId.trim()} onClick={save}
       className="mt-4 h-11 w-full rounded-xl bg-primary font-semibold text-primary-foreground disabled:opacity-50">{t[3]}</button>
     {status&&<p role="status" className="mt-2 text-xs">{status}</p>}
   </div>
 </details>;
}
