import { useAuth } from '@clerk/react';
import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { useSocial } from '@/store/social-store';
import { useLanguage } from '@/lib/i18n';

type Reaction = { character_id?: string; reaction_text?: string; mode?: string; actually_viewed?: boolean };
type Props = { surface:'post'|'story'; contentId:string; authorId:string; onOpenChange?:(open:boolean)=>void };

const FOUNDER_ID = 'user_3LeoBfUicTthDVixNbkPlqXFkdZ';

/** Creator-only, explicit inspection. Never fires a paid request on mount. */
export function InternalThoughts({surface,contentId,authorId,onOpenChange}:Props) {
  const {userId} = useAuth();
  const {state,universeId} = useSocial();
  const language = useLanguage();
  const es = language === 'es';
  const [open,setOpen] = useState(false);
  const [reactions,setReactions] = useState<Reaction[]>([]);
  const [selected,setSelected] = useState('');
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const requestVersion = useRef(0);
  const pendingGeneration = useRef(false);
  // The API validates accepted follows, blocks, and privacy. Avoid filtering
  // by legacy local follow arrays, which may be stale or incomplete.
  const eligible = state.characters.filter(c=>!c.archived && c.id!==authorId);
  useEffect(()=>{requestVersion.current+=1;setOpen(false);setReactions([]);setSelected('');setError('');onOpenChange?.(false);},[contentId,surface,universeId]);
  if(userId!==FOUNDER_ID) return null;
  const payload={universeId,surface,contentId};
  const load=async()=>{
    const version=++requestVersion.current;
    setLoading(true);setError('');
    try {
      const q=new URLSearchParams(payload);
      const response=await customFetch<{reactions:Reaction[]}>(`/api/internal-reactions?${q.toString()}`,{responseType:'json'});
      if(version===requestVersion.current)setReactions(response.reactions??[]);
    } catch {if(version===requestVersion.current)setError(es?'No se pudieron consultar los pensamientos.':'Could not load private thoughts.');}
    finally {if(version===requestVersion.current)setLoading(false);}
  };
  const generate=async()=>{
    if(!selected || loading || pendingGeneration.current) return;
    pendingGeneration.current=true;
    const version=++requestVersion.current;
    setLoading(true);setError('');
    try {
      const response=await customFetch<{reaction:Reaction}>('/api/internal-reactions/manual',{
        method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...payload,characterId:selected}),
      });
      if(version===requestVersion.current)setReactions(old=>[response.reaction,...old.filter(r=>r.character_id!==selected)]);
    } catch {
      if(version===requestVersion.current)setError(es?'La generación no está disponible o el personaje no tiene acceso.':'Generation unavailable or character lacks access.');
    } finally {pendingGeneration.current=false;if(version===requestVersion.current)setLoading(false);}
  };
  return <section className="mt-2 text-xs" data-testid={`internal-thoughts-${surface}-${contentId}`}>
    <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={()=>{
      if(open){requestVersion.current+=1;setOpen(false);onOpenChange?.(false);} else {setOpen(true);onOpenChange?.(true);void load();}
    }}>{es?'¿Qué pensó?':'What did they think?'}</button>
    {open && <div className="mt-2 rounded-xl border border-border bg-secondary/30 p-3">
      <p className="mb-2 text-muted-foreground">{es?'Privado · Una consulta manual no significa que vio la publicación.':'Private · Manual inspection does not mean the content was viewed.'}</p>
      {reactions.length===0 && !loading && <p className="mb-2 text-muted-foreground">{es?'Todavía no hay pensamientos guardados.':'No saved thoughts yet.'}</p>}
      {reactions.map((reaction,index)=><p key={`${reaction.character_id??index}-${index}`} className="mb-2 whitespace-pre-wrap">
        <strong>{state.characters.find(c=>c.id===reaction.character_id)?.name??(es?'Personaje':'Character')}</strong>
        {' · '}{reaction.actually_viewed?(es?'Vista real':'Verified view'):(es?'Hipotético':'Hypothetical')}
        <span className="block mt-1">{reaction.reaction_text}</span>
      </p>)}
      <div className="flex flex-wrap gap-2">
        <select aria-label={es?'Elegir personaje':'Choose character'} className="min-w-0 flex-1 rounded-md border border-border bg-background p-2" value={selected} onChange={e=>setSelected(e.target.value)}>
          <option value="">{es?'Elegí un personaje':'Choose a character'}</option>
          {eligible.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="button" disabled={!selected||loading||pendingGeneration.current} onClick={()=>void generate()} className="rounded-md border border-border px-3 py-2 disabled:opacity-50">{loading?'…':es?'Consultar':'Inspect'}</button>
      </div>
      {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
    </div>}
  </section>;
}
