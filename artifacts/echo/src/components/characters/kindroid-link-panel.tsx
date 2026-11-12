import { useUser } from '@clerk/react';
import { getActiveUniverseId } from '@/store/persistence';
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
 const {user}=useUser();
 const universeId=user?.id?getActiveUniverseId(user.id):'primary';
 const t=words[language]??words.en;
 const [data,setData]=useState<LinkState>({kinId:'',enabled:false,socialContextEnabled:false});
 const [busy,setBusy]=useState(false);
 const [status,setStatus]=useState('');
 useEffect(()=>{setData({kinId:'',enabled:false,socialContextEnabled:false});setStatus('');},[characterId,universeId]);
 useEffect(()=>{
   let active=true;
   void customFetch<LinkState>(`/api/characters/kindroid-link?characterId=${encodeURIComponent(characterId)}&universeId=${encodeURIComponent(universeId)}`,{responseType:'json'})
     .then(v=>{if(active)setData(v);}).catch(()=>{if(active)setStatus('Unavailable');});
   return ()=>{active=false;};
 },[characterId,universeId]);
 async function save(){
   if(!data.kinId.trim()||busy)return;
   setBusy(true);setStatus('');
   try{
     await customFetch('/api/characters/kindroid-link',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({characterId,universeId,kinId:data.kinId.trim(),enabled:data.enabled,socialContextEnabled:data.socialContextEnabled}),responseType:'json'});
     setStatus(t[4]);
   }catch{setStatus(t[5]);}finally{setBusy(false);}
 }
 async function disconnect(){
   if(busy||!data.kinId.trim())return;
   setBusy(true);setStatus('');
   try{
     const result=await customFetch<LinkState>('/api/characters/kindroid-link',{
       method:'DELETE',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({characterId,universeId}),responseType:'json'
     });
     setData(result);
     setStatus(language==='es'?'Kindroid desvinculado. El personaje de ECHO sigue intacto.':
       language==='pt'?'Kindroid desvinculado. O personagem do ECHO foi preservado.':
       language==='fr'?'Kindroid dissocié. Le personnage ECHO est conservé.':
       language==='de'?'Kindroid getrennt. Der ECHO-Charakter bleibt erhalten.':
       language==='it'?'Kindroid scollegato. Il personaggio ECHO rimane intatto.':
       language==='ko'?'Kindroid 연결 해제 완료. ECHO 캐릭터는 유지됩니다.':
       language==='ja'?'Kindroidの連携を解除しました。ECHOのキャラクターは保持されます。':
       language==='zh'?'已解除 Kindroid 绑定，ECHO 角色保持不变。':
       'Kindroid disconnected. Your ECHO character is unchanged.');
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
     {data.kinId.trim()&&<button type="button" disabled={busy} onClick={disconnect}
       className="mt-3 h-11 w-full rounded-xl border border-destructive/50 text-sm font-semibold text-destructive disabled:opacity-50">
       {language==='es'?'Desvincular Kindroid (conservar personaje)':language==='pt'?'Desvincular Kindroid (manter personagem)':language==='fr'?'Dissocier Kindroid (conserver le personnage)':language==='de'?'Kindroid trennen (Charakter behalten)':language==='it'?'Scollega Kindroid (mantieni personaggio)':language==='ko'?'Kindroid 연결 해제 (캐릭터 유지)':language==='ja'?'Kindroidの連携解除（キャラクターは保持）':language==='zh'?'解除 Kindroid 绑定（保留角色）':'Disconnect Kindroid (keep character)'}
     </button>}
     {status&&<p role="status" className="mt-2 text-xs">{status}</p>}
   </div>
 </details>;
}
