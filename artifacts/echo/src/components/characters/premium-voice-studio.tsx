import { useContext, useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { MediaScopeContext } from '@/lib/media';
import { AudioLines, FileAudio, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

const copy = {
  es: ['Voice Studio · Premium','Creá una voz exclusiva para tu personaje.','Describir una voz','Usar audio de referencia','Describí el timbre, acento, ritmo y estilo de la voz.','Ej.: voz grave y cálida, con un poco de aspereza, ritmo tranquilo y acento británico.','Idioma de la voz','Cantidad de opciones','Generar muestras','La generación estará disponible cuando conectemos el proveedor. No se realizarán cargos ni se crearán muestras todavía.','Subí un audio WAV, MP3 o M4A (máximo 20 MB).','Elegir archivo','Usá solo tu propia voz o una voz cuyo titular haya autorizado expresamente su uso.','Confirmo que tengo autorización para crear una voz sintética a partir de este audio.','Archivo seleccionado','Quitarlo','Las muestras generadas podrán escucharse, compararse y guardarse cuando activemos el servicio.','La voz de tu personaje no se modificará hasta que elijas y guardes una muestra.'],
  en: ['Voice Studio · Premium','Create a unique voice for your character.','Describe a voice','Use reference audio','Describe the voice’s tone, accent, pace, and style.','E.g. a deep, warm voice with a subtle rasp, calm pacing and a British accent.','Voice language','Number of options','Generate samples','Generation will be available once a provider is connected. No charges or samples will be created yet.','Upload WAV, MP3 or M4A audio (20 MB maximum).','Choose file','Only use your own voice or one whose owner has explicitly authorized synthetic voice creation.','I confirm I have permission to create a synthetic voice from this audio.','Selected file','Remove','Once enabled, generated samples can be played, compared and saved.','Your character’s voice will not change until you select and save a sample.'],
} as const;
export function PremiumVoiceStudio({ characterId }: { characterId?: string }) {
  const scope = useContext(MediaScopeContext);
  const universeId = scope?.universeId ?? 'primary';
  const language = useLanguage();
  const labels: readonly string[] = language === 'es' ? copy.es : copy.en;
  const [access,setAccess]=useState<'loading'|'allowed'|'locked'>('loading');
  useEffect(()=>{
    let cancelled=false;
    void customFetch<{features:{customVoices:boolean}}>('/api/account/entitlements',{responseType:'json'})
      .then(data=>{if(!cancelled)setAccess(data.features.customVoices?'allowed':'locked');})
      .catch(()=>{if(!cancelled)setAccess('locked');});
    return()=>{cancelled=true;};
  },[]);
  const [mode, setMode] = useState<'prompt' | 'reference'>('prompt');
  const [prompt, setPrompt] = useState('');
  const [voiceLanguage, setVoiceLanguage] = useState('en');
  const [count, setCount] = useState(3);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);
  const [references,setReferences]=useState<{id:string;contentType:string;size:number}[]>([]);
  const [playingUrl,setPlayingUrl]=useState<string | null>(null);
  const [generationAvailable,setGenerationAvailable]=useState(false);
  const [samples,setSamples]=useState<{id:string;status:string}[]>([]);
  const [sampleUrl,setSampleUrl]=useState<string|null>(null);
  const [projectId,setProjectId]=useState<string|null>(null);
  const [selectedSampleId,setSelectedSampleId]=useState<string|null>(null);
  const [selecting,setSelecting]=useState<string|null>(null);
  const [generating,setGenerating]=useState(false);
  const loadProject=async()=>{
    if(!characterId)return;
    const data=await customFetch<{project:{id:string;selectedSampleId?:string|null}|null;samples:{id:string;status:string}[];generationAvailable:boolean}>(`/api/voices/premium/projects?universeId=${encodeURIComponent(universeId)}&characterId=${encodeURIComponent(characterId)}`,{responseType:'json'});
    setGenerationAvailable(data.generationAvailable);setSamples(data.samples);setProjectId(data.project?.id??null);setSelectedSampleId(data.project?.selectedSampleId??null);
  };
  const generate=async()=>{
    if(!characterId||generating)return;
    setGenerating(true);setError('');
    try{
      await customFetch('/api/voices/premium/projects',{method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,characterId,mode:'prompt',prompt,language:voiceLanguage,variantCount:count,consentConfirmed:false})});
      await customFetch('/api/voices/premium/generate',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,characterId})});
      await loadProject();
    }catch{setError(language==='es'?'No se pudieron generar las muestras. Revisá los límites o la configuración de ElevenLabs.':'Could not generate previews. Check limits or ElevenLabs configuration.');}
    finally{setGenerating(false);}
  };
  const selectSample=async(id:string)=>{
    if(!projectId||selecting)return;
    setSelecting(id);setError('');
    try{
      await customFetch('/api/voices/premium/select',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId,sampleId:id})});
      setSelectedSampleId(id);
      await loadProject();
    }catch{setError(language==='es'?'No se pudo seleccionar esta voz. Intentá de nuevo.':'Could not select this voice. Please try again.');}
    finally{setSelecting(null);}
  };
  const playSample=async(id:string)=>{
    try{const data=await customFetch<{url:string}>(`/api/voices/premium/samples/${id}/play`,{responseType:'json'});setSampleUrl(data.url);}
    catch{setError(language==='es'?'No se pudo reproducir la muestra.':'Could not play preview.');}
  };

  const loadReferences=async()=>{
    if(!characterId)return;
    const data=await customFetch<{references:{id:string;contentType:string;size:number}[]}>(`/api/voices/premium/references?universeId=${encodeURIComponent(universeId)}&characterId=${encodeURIComponent(characterId)}`,{responseType:'json'});
    setReferences(data.references);
  };
  const playReference=async(id:string)=>{
    try{
      const data=await customFetch<{url:string}>(`/api/voices/premium/references/${encodeURIComponent(id)}/play`,{responseType:'json'});
      setPlayingUrl(data.url);
    }catch{setError(language==='es'?'No se pudo reproducir el audio.':'Could not play the recording.');}
  };
  const deleteReference=async(id:string)=>{
    if(!window.confirm(language==='es'?'¿Eliminar este audio de referencia?':'Delete this reference audio?'))return;
    try{
      await customFetch(`/api/voices/premium/references/${encodeURIComponent(id)}`,{method:'DELETE',responseType:'json'});
      setPlayingUrl(null);await loadReferences();
    }catch{setError(language==='es'?'No se pudo eliminar el audio.':'Could not delete the recording.');}
  };
  useEffect(() => {
    if (!characterId) return;
    let cancelled = false;
    void customFetch<{project: {mode:'prompt'|'reference';prompt:string;language:string;variantCount:number;consentConfirmed:boolean}|null}>(`/api/voices/premium/projects?universeId=${encodeURIComponent(universeId)}&characterId=${encodeURIComponent(characterId)}`,{responseType:'json'})
      .then(data=>{if(cancelled||!data.project)return;const p=data.project;setMode(p.mode);setPrompt(p.prompt);setVoiceLanguage(p.language);setCount(p.variantCount);setConsent(p.consentConfirmed);setSaved(true);})
      .catch(()=>{});
    return ()=>{cancelled=true;};
  },[characterId,universeId]);
  useEffect(()=>{void loadReferences().catch(()=>{});void loadProject().catch(()=>{});},[characterId,universeId]);
  const saveDraft=async()=>{
    if(!characterId||saving||(mode==='prompt'&&!prompt.trim())||(mode==='reference'&&(!file||!consent)))return;
    setSaving(true);setError('');setSaved(false);
    try {
      if(mode==='reference' && file){
        const ext=file.name.split('.').pop()?.toLowerCase();
        const contentType=ext==='wav'?'audio/wav':ext==='mp3'?'audio/mpeg':'audio/mp4';
        const signed=await customFetch<{uploadURL:string;objectPath:string}>('/api/voices/premium/reference/request-url',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,characterId,contentType,size:file.size,consentConfirmed:true})});
        const response=await fetch(signed.uploadURL,{method:'PUT',headers:{'Content-Type':contentType},body:file});
        if(!response.ok)throw Error('VOICE_UPLOAD_FAILED');
        await customFetch('/api/voices/premium/reference/verify',{method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,characterId,objectPath:signed.objectPath,contentType,consentConfirmed:true})});
        setUploadedPath(signed.objectPath);
        await loadReferences();
      }
      await customFetch('/api/voices/premium/projects',{method:'PUT',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({universeId,characterId,mode,prompt,language:voiceLanguage,variantCount:count,consentConfirmed:mode==='reference'&&consent})});
      setSaved(true);
    } catch {setError(language==='es'?'No se pudo guardar el proyecto. Verificá tu acceso Premium y volvé a intentar.':'Could not save the project. Check Premium access and try again.');}
    finally {setSaving(false);}
  };
  const input = useRef<HTMLInputElement>(null);
  const chooseFile = (next: File | undefined) => {
    setError('');
    if (!next) return;
    const valid = /\.(wav|mp3|m4a)$/i.test(next.name) && next.size <= 20 * 1024 * 1024;
    if (!valid) { setFile(null); setError('WAV / MP3 / M4A · max 20 MB'); return; }
    setFile(next); setConsent(false);setUploadedPath(null);
  };
  if(access==='loading')return <section className="mt-6 rounded-2xl border border-border p-4 text-xs text-muted-foreground">{language==='es'?'Comprobando acceso a Voice Studio…':'Checking Voice Studio access…'}</section>;
  if(access==='locked')return <section className="mt-6 space-y-2 rounded-2xl border border-primary/30 bg-card/60 p-4" data-testid="premium-voice-studio-locked"><div className="flex items-center gap-2"><AudioLines className="h-5 w-5 text-primary"/><h3 className="text-sm font-semibold">Voice Studio · Premium</h3></div><p className="text-xs text-muted-foreground">{language==='es'?'La generación de voces mediante descripción y la clonación con audio de referencia son exclusivas de ECHO Premium.':'Voice creation from a description and reference-audio voice cloning are exclusive to ECHO Premium.'}</p></section>;
  return <section className="mt-6 space-y-4 rounded-2xl border border-primary/30 bg-card/60 p-4" data-testid="premium-voice-studio">
    <div className="flex items-center gap-2"><AudioLines className="h-5 w-5 text-primary"/><h3 className="text-sm font-semibold">{labels[0]}</h3></div>
    <p className="text-xs text-muted-foreground">{labels[1]}</p>
    <div className="grid grid-cols-2 gap-2">
      <button type="button" aria-pressed={mode === 'prompt'} onClick={() => setMode('prompt')} className={`min-h-11 rounded-xl border px-3 text-sm ${mode === 'prompt' ? 'border-primary bg-primary/10' : 'border-border'}`}><Sparkles className="mr-1 inline h-4 w-4"/>{labels[2]}</button>
      <button type="button" aria-pressed={mode === 'reference'} onClick={() => setMode('reference')} className={`min-h-11 rounded-xl border px-3 text-sm ${mode === 'reference' ? 'border-primary bg-primary/10' : 'border-border'}`}><FileAudio className="mr-1 inline h-4 w-4"/>{labels[3]}</button>
    </div>
    {mode === 'prompt' ? <>
      <label htmlFor="echo-voice-prompt" className="block text-sm font-medium">{labels[4]}</label>
      <textarea id="echo-voice-prompt" rows={4} maxLength={1500} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={labels[5]} className="w-full resize-y rounded-xl border border-border bg-background p-3 text-base"/>
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs">{labels[6]}<select value={voiceLanguage} onChange={e => setVoiceLanguage(e.target.value)} className="min-h-11 w-full rounded-xl border border-border bg-background px-2 text-base"><option value="en">English</option><option value="es">Español</option><option value="pt">Português</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="it">Italiano</option><option value="ko">한국어</option><option value="ja">日本語</option><option value="zh">中文</option></select></label>
        <label className="space-y-1 text-xs">{labels[7]}<select value={count} onChange={e => setCount(Number(e.target.value))} className="min-h-11 w-full rounded-xl border border-border bg-background px-2 text-base"><option value={2}>2</option><option value={3}>3</option></select></label>
      </div>
    </> : <>
      <p className="text-sm text-muted-foreground">{labels[10]}</p>
      <input ref={input} type="file" accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4" className="sr-only" onChange={e => chooseFile(e.target.files?.[0])}/>
      <button type="button" onClick={() => input.current?.click()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border"><Upload className="h-4 w-4"/>{labels[11]}</button>
      {file && <div className="flex items-center justify-between gap-2 text-sm"><span className="min-w-0 truncate">{labels[14]}: {file.name}</span><button type="button" className="text-primary underline" onClick={() => {setFile(null);setConsent(false);if(input.current)input.current.value='';}}>{labels[15]}</button></div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1"/><span>{labels[13]}</span></label>
      <p className="text-xs text-muted-foreground">{labels[12]}</p>
      <p className="text-xs text-muted-foreground">{uploadedPath?(language==='es'?'Audio guardado de forma privada para este personaje.':'Audio saved privately for this character.'):(language==='es'?'El audio solo se subirá cuando confirmes el consentimiento y guardes.':'Audio uploads only after you confirm consent and save.')}</p>
      {references.length>0&&<div className="space-y-2"><p className="text-xs font-medium">{language==='es'?'Audios de referencia guardados':'Saved reference recordings'}</p>{references.map((reference,i)=><div key={reference.id} className="flex items-center gap-2 text-xs"><span className="flex-1">{language==='es'?'Audio':'Recording'} {i+1} · {(reference.size/1024/1024).toFixed(1)} MB</span><button type="button" className="text-primary underline" onClick={()=>void playReference(reference.id)}>{language==='es'?'Escuchar':'Play'}</button><button type="button" className="text-destructive underline" onClick={()=>void deleteReference(reference.id)}>{language==='es'?'Eliminar':'Delete'}</button></div>)}{playingUrl&&<audio controls src={playingUrl} className="w-full"/>}</div>}
    </>}
    <button type="button" disabled={!characterId||saving||(mode==='prompt'&&!prompt.trim())||(mode==='reference'&&(!file||!consent))} onClick={()=>void saveDraft()} className="mb-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-primary/40 px-4 text-sm font-semibold text-primary disabled:opacity-50">{saving?'…':language==='es'?'Guardar proyecto de voz':'Save voice project'}</button>
    {saved&&<p role="status" className="text-xs text-primary">{language==='es'?'Proyecto guardado. Generación pendiente de activación.':'Project saved. Generation is not yet enabled.'}</p>}
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
    <button type="button" disabled={!generationAvailable||!characterId||generating||mode!=='prompt'||prompt.trim().length<20||prompt.length>1000} onClick={()=>void generate()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"><RefreshCw className="h-4 w-4"/>{generating?'…':labels[8]} ({count})</button>
    {samples.filter(x=>x.status==='ready').length>0&&<div className="space-y-2 text-sm"><p>{language==='es'?'Muestras generadas':'Generated previews'}</p>{samples.filter(x=>x.status==='ready').map((sample,i)=><div key={sample.id} className="flex items-center gap-2 py-1"><button type="button" onClick={()=>void playSample(sample.id)} className="flex-1 rounded-lg border px-3 py-2">{language==='es'?'Escuchar muestra':'Play preview'} {i+1}</button><button type="button" disabled={!projectId||!!selecting} onClick={()=>void selectSample(sample.id)} className="rounded-lg border border-primary/40 px-3 py-2 text-primary disabled:opacity-50" aria-pressed={selectedSampleId===sample.id}>{selectedSampleId===sample.id?(language==='es'?'✓ Seleccionada':'✓ Selected'):selecting===sample.id?'…':(language==='es'?'Elegir voz':'Choose voice')}</button></div>)}{sampleUrl&&<audio controls src={sampleUrl} className="w-full"/>}<p className="text-xs text-muted-foreground">{language==='es'?'La voz seleccionada se guarda para este personaje. La síntesis real se habilitará al conectar el proveedor.':'The selected voice is saved for this character. Live synthesis requires the provider to be enabled.'}</p></div>}
    {!characterId&&<p className="text-xs text-muted-foreground">{language==='es'?'Guardá primero el personaje para asociarle un proyecto de voz.':'Save the character before creating a voice project.'}</p>}
    {!generationAvailable&&<p className="text-xs text-muted-foreground">{labels[9]}</p>}
    <p className="text-xs text-muted-foreground">{labels[16]} {labels[17]}</p>
  </section>;
}
