import { useState } from 'react';
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
  const costs = {standard:{5:1,10:2},advanced_silent:{5:2,10:4},advanced_audio:{5:3,10:6}} as const;
  return <div><TopBar title="ECHO Video Studio" onBack={back}/><main className="space-y-5 px-4 pb-20 pt-5">
    <div className="rounded-2xl border border-border bg-card/60 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><Film className="h-5 w-5 text-primary"/> ECHO Video/GIF</div><p className="mt-2 text-xs text-muted-foreground">{es?'Preparación sin costo. La generación de videos y los pagos todavía están desactivados.':'Free preparation. Video generation and payments are not enabled yet.'}</p></div>
    <label className="block space-y-2 text-sm font-semibold"><span>{es?'Describí tu video':'Describe your video'}</span><textarea value={prompt} onChange={e=>setPrompt(e.target.value.slice(0,2000))} placeholder={es?'Una escena, un movimiento de cámara, una atmósfera…':'A scene, camera movement, atmosphere…'} className="min-h-32 w-full rounded-xl border border-border bg-card p-3 text-sm font-normal outline-none focus:ring-2 focus:ring-primary" maxLength={2000}/></label>
    <div className="space-y-2"><p className="text-sm font-semibold">{es?'Modalidad':'Mode'}</p><div className="grid grid-cols-1 gap-2">{([{id:'standard',es:'Estándar · sin audio',en:'Standard · silent'},{id:'advanced_silent',es:'Avanzado · sin audio',en:'Advanced · silent'},{id:'advanced_audio',es:'Avanzado · con audio',en:'Advanced · with audio'}] as const).map(x=><button key={x.id} type="button" onClick={()=>setMode(x.id)} aria-pressed={mode===x.id} className={`rounded-xl border px-3 py-3 text-left text-sm ${mode===x.id?'border-primary bg-primary/10':'border-border bg-card/50'}`}>{es?x.es:x.en}</button>)}</div></div>
    <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><p className="text-sm font-semibold">{es?'Duración':'Duration'}</p><select value={duration} onChange={e=>setDuration(Number(e.target.value) as 5|10)} className="w-full rounded-xl border border-border bg-card p-3 text-sm"><option value={5}>5 s</option><option value={10}>10 s</option></select></div><div className="space-y-2"><p className="text-sm font-semibold">{es?'Formato':'Aspect ratio'}</p><select value={aspect} onChange={e=>setAspect(e.target.value as '9:16'|'16:9'|'1:1')} className="w-full rounded-xl border border-border bg-card p-3 text-sm"><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option></select></div></div>
    <div className="rounded-2xl border border-border bg-card/60 p-4"><div className="flex items-center justify-between"><span className="text-sm">{es?'Costo estimado':'Estimated cost'}</span><strong>{costs[mode][duration]} {es?'créditos':'credits'}</strong></div><p className="mt-2 text-xs text-muted-foreground">{es?'Importe provisional. No se descontarán créditos.':'Provisional pricing. No credits will be deducted.'}</p></div>
    <button type="button" disabled className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary/40 px-4 py-3 text-sm font-semibold text-primary-foreground opacity-70"><LockKeyhole className="h-4 w-4"/><WandSparkles className="h-4 w-4"/>{es?'Generación disponible próximamente':'Generation coming soon'}</button>
  </main></div>;
}
