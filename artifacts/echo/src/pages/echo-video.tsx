import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Film, LockKeyhole, WandSparkles } from 'lucide-react';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { useLanguage } from '@/lib/i18n';

/** Offline studio: no paid generation, checkout or provider requests. */
export default function EchoVideoPage() {
  const back = useBack();
  const language = useLanguage();
  const es = language === 'es';
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'standard'|'advanced_silent'|'advanced_audio'>('standard');
  const [duration, setDuration] = useState<5|10>(5);
  const [aspect, setAspect] = useState<'9:16'|'16:9'|'1:1'>('9:16');
  const [gifJobId, setGifJobId] = useState('');
  const [gifSeconds, setGifSeconds] = useState(3);
  const [gifWidth, setGifWidth] = useState<320|480|640>(480);
  const [gifFps, setGifFps] = useState<10|12|15>(12);
  const [gifMessage, setGifMessage] = useState('');
  const [gifChecking, setGifChecking] = useState(false);
  const [readiness, setReadiness] = useState<{privateStorageConfigured:boolean;bucketVerified:boolean}|null>(null);
  useEffect(() => {
    let active = true;
    void customFetch<{privateStorageConfigured:boolean;bucketVerified:boolean}>('/api/video/readiness', {responseType:'json'})
      .then(value => { if(active) setReadiness(value); }).catch(() => {});
    return () => {active=false;};
  }, []);
  const [library, setLibrary] = useState<Array<{id:string;status:string;mode:string;durationSeconds:number;createdAt:string}>>([]);
  const [libraryUnavailable, setLibraryUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    void customFetch<{items:Array<{id:string;status:string;mode:string;durationSeconds:number;createdAt:string}>;setupRequired?:boolean}>('/api/video/library', {responseType:'json'})
      .then(data => { if (active) {setLibrary(data.items);setLibraryUnavailable(Boolean(data.setupRequired));} })
      .catch(() => { if (active) setLibraryUnavailable(true); });
    return () => {active=false;};
  }, []);
  const [preflight, setPreflight] = useState<{estimatedCredits:number}|null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(false);
  const costs = {standard:{5:1,10:2},advanced_silent:{5:2,10:4},advanced_audio:{5:3,10:6}} as const;
  return <div><TopBar title="ECHO Video Studio" onBack={back}/><main className="space-y-5 px-4 pb-20 pt-5">
    <div className="rounded-2xl border border-border bg-card/60 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><Film className="h-5 w-5 text-primary"/> ECHO Video/GIF</div><p className="mt-2 text-xs text-muted-foreground">{es?'Preparación sin costo. La generación de videos y los pagos todavía están desactivados.':'Free preparation. Video generation and payments are not enabled yet.'}</p></div>
    <label className="block space-y-2 text-sm font-semibold"><span>{es?'Describí tu video':'Describe your video'}</span><textarea value={prompt} onChange={e=>setPrompt(e.target.value.slice(0,2000))} placeholder={es?'Una escena, un movimiento de cámara, una atmósfera…':'A scene, camera movement, atmosphere…'} className="min-h-32 w-full rounded-xl border border-border bg-card p-3 text-sm font-normal outline-none focus:ring-2 focus:ring-primary" maxLength={2000}/></label>
    <div className="space-y-2"><p className="text-sm font-semibold">{es?'Modalidad':'Mode'}</p><div className="grid grid-cols-1 gap-2">{([{id:'standard',es:'Estándar · sin audio',en:'Standard · silent'},{id:'advanced_silent',es:'Avanzado · sin audio',en:'Advanced · silent'},{id:'advanced_audio',es:'Avanzado · con audio',en:'Advanced · with audio'}] as const).map(x=><button key={x.id} type="button" onClick={()=>setMode(x.id)} aria-pressed={mode===x.id} className={`rounded-xl border px-3 py-3 text-left text-sm ${mode===x.id?'border-primary bg-primary/10':'border-border bg-card/50'}`}>{es?x.es:x.en}</button>)}</div></div>
    <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><p className="text-sm font-semibold">{es?'Duración':'Duration'}</p><select value={duration} onChange={e=>setDuration(Number(e.target.value) as 5|10)} className="w-full rounded-xl border border-border bg-card p-3 text-sm"><option value={5}>5 s</option><option value={10}>10 s</option></select></div><div className="space-y-2"><p className="text-sm font-semibold">{es?'Formato':'Aspect ratio'}</p><select value={aspect} onChange={e=>setAspect(e.target.value as '9:16'|'16:9'|'1:1')} className="w-full rounded-xl border border-border bg-card p-3 text-sm"><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option></select></div></div>
    <div className="rounded-2xl border border-border bg-card/60 p-4"><div className="flex items-center justify-between"><span className="text-sm">{es?'Costo estimado':'Estimated cost'}</span><strong>{costs[mode][duration]} {es?'créditos':'credits'}</strong></div><p className="mt-2 text-xs text-muted-foreground">{es?'Importe provisional. No se descontarán créditos.':'Provisional pricing. No credits will be deducted.'}</p></div>
    <button type="button" disabled={checking || prompt.trim().length < 3} onClick={async () => {
      setChecking(true); setError(false); setPreflight(null);
      try {
        const result = await customFetch<{estimatedCredits:number}>('/api/video/preflight', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({prompt:prompt.trim(),mode,durationSeconds:duration,aspectRatio:aspect}),responseType:'json'
        });
        setPreflight(result);
      } catch { setError(true); } finally { setChecking(false); }
    }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-40">
      <WandSparkles className="h-4 w-4"/>{checking ? (es?'Comprobando…':'Checking…') : (es?'Preparar video sin costo':'Prepare video for free')}
    </button>
    {preflight && <p role="status" className="rounded-xl border border-border bg-card p-3 text-sm">{es?'Preparación correcta. Costo estimado:':'Preparation successful. Estimated cost:'} {preflight.estimatedCredits} {es?'créditos. Sin cobros ni llamadas al proveedor.':'credits. No charges or provider calls.'}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{es?'No se pudo comprobar la preparación.':'Could not check the draft.'}</p>}
    <div className="rounded-2xl border border-border bg-card/60 p-4 text-xs text-muted-foreground">
      <p className="font-semibold text-foreground">{es?'Almacenamiento privado':'Private storage'}</p>
      <p className="mt-2">{readiness === null ? (es?'Comprobando configuración…':'Checking configuration…')
        : readiness.privateStorageConfigured
          ? (es?'Credenciales configuradas; falta verificar el bucket y habilitar el procesamiento.':'Credentials configured; bucket verification and processing are still pending.')
          : (es?'Falta configurar el almacenamiento privado de video.':'Private video storage still needs configuration.')}</p>
    </div>
    <section className="space-y-3 rounded-2xl border border-border bg-card/60 p-4" aria-label={es?'Biblioteca de videos':'Video library'}>
      <h2 className="text-sm font-semibold">{es?'Mi biblioteca de videos y GIF':'My video & GIF library'}</h2>
      {libraryUnavailable ? <p className="text-xs text-muted-foreground">{es?'La biblioteca estará disponible cuando se inicialice el almacenamiento.':'Library will be available after storage setup.'}</p>
        : library.length === 0 ? <p className="text-xs text-muted-foreground">{es?'Todavía no generaste videos. Aparecerán acá cuando se active el servicio.':'No generated videos yet. They will appear here when generation is enabled.'}</p>
        : <div className="space-y-2">{library.map(item => <div key={item.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-xs"><span>{item.mode} · {item.durationSeconds}s</span><span className="text-muted-foreground">{item.status}</span></div>)}</div>}
      <p className="text-xs text-muted-foreground">{es?'La conversión a GIF y la descarga estarán disponibles después de conectar el procesamiento privado.':'GIF conversion and downloads will be available after private processing is connected.'}</p>
    </section>
    <section className="space-y-3 rounded-2xl border border-border bg-card/60 p-4" aria-label={es?'Preparación de GIF':'GIF preparation'}>
      <h2 className="text-sm font-semibold">{es?'Convertir video a GIF':'Convert video to GIF'}</h2>
      <p className="text-xs text-muted-foreground">{es?'Seleccioná un video terminado de tu biblioteca para preparar una conversión sin costo.':'Select a finished video from your library to prepare a free conversion.'}</p>
      <select value={gifJobId} onChange={e=>{setGifJobId(e.target.value);setGifMessage('');}} className="w-full rounded-xl border border-border bg-card p-3 text-sm">
        <option value="">{es?'Seleccionar video':'Select video'}</option>
        {library.filter(item=>item.status==='succeeded').map(item=><option key={item.id} value={item.id}>{item.mode} · {item.durationSeconds}s · {new Date(item.createdAt).toLocaleDateString()}</option>)}
      </select>
      <div className="grid grid-cols-3 gap-2">
        <label className="space-y-1 text-xs"><span>{es?'Segundos':'Seconds'}</span><select value={gifSeconds} onChange={e=>setGifSeconds(Number(e.target.value))} className="w-full rounded-xl border border-border bg-card p-2">{[1,2,3,4,5,6,7,8,9,10].map(n=><option key={n} value={n}>{n}s</option>)}</select></label>
        <label className="space-y-1 text-xs"><span>{es?'Ancho':'Width'}</span><select value={gifWidth} onChange={e=>setGifWidth(Number(e.target.value) as 320|480|640)} className="w-full rounded-xl border border-border bg-card p-2">{[320,480,640].map(n=><option key={n} value={n}>{n}px</option>)}</select></label>
        <label className="space-y-1 text-xs"><span>FPS</span><select value={gifFps} onChange={e=>setGifFps(Number(e.target.value) as 10|12|15)} className="w-full rounded-xl border border-border bg-card p-2">{[10,12,15].map(n=><option key={n} value={n}>{n}</option>)}</select></label>
      </div>
      <button type="button" disabled={!gifJobId || gifChecking} className="w-full rounded-xl border border-border p-3 text-sm font-semibold disabled:opacity-40" onClick={async()=>{
        setGifChecking(true);setGifMessage('');
        try {await customFetch('/api/video/gif/preflight',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({videoJobId:gifJobId,startSeconds:0,durationSeconds:gifSeconds,width:gifWidth,fps:gifFps}),responseType:'json'});
          setGifMessage(es?'GIF preparado; la conversión real sigue desactivada.':'GIF prepared; actual conversion is still disabled.');
        }catch{setGifMessage(es?'No se pudo preparar este GIF. Verificá que el video esté terminado y que la duración sea válida.':'Could not prepare this GIF. Check that the video is complete and duration is valid.');}
        finally{setGifChecking(false);}
      }}>{gifChecking?(es?'Comprobando…':'Checking…'):(es?'Preparar GIF sin costo':'Prepare GIF for free')}</button>
      {gifMessage&&<p role="status" className="text-xs text-muted-foreground">{gifMessage}</p>}
    </section>
    <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="h-4 w-4"/>{es?'La generación real sigue desactivada.':'Real generation remains disabled.'}</p>
  </main></div>;
}
