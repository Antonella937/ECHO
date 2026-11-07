import { useRef, useState } from 'react';
import { AudioLines, FileAudio, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { useLanguage } from '@/lib/i18n';

const copy = {
  es: ['Voice Studio · Premium','Creá una voz exclusiva para tu personaje.','Describir una voz','Usar audio de referencia','Describí el timbre, acento, ritmo y estilo de la voz.','Ej.: voz grave y cálida, con un poco de aspereza, ritmo tranquilo y acento británico.','Idioma de la voz','Cantidad de opciones','Generar muestras','La generación estará disponible cuando conectemos el proveedor. No se realizarán cargos ni se crearán muestras todavía.','Subí un audio WAV, MP3 o M4A (máximo 20 MB).','Elegir archivo','Usá solo tu propia voz o una voz cuyo titular haya autorizado expresamente su uso.','Confirmo que tengo autorización para crear una voz sintética a partir de este audio.','Archivo seleccionado','Quitarlo','Las muestras generadas podrán escucharse, compararse y guardarse cuando activemos el servicio.','La voz de tu personaje no se modificará hasta que elijas y guardes una muestra.'],
  en: ['Voice Studio · Premium','Create a unique voice for your character.','Describe a voice','Use reference audio','Describe the voice’s tone, accent, pace, and style.','E.g. a deep, warm voice with a subtle rasp, calm pacing and a British accent.','Voice language','Number of options','Generate samples','Generation will be available once a provider is connected. No charges or samples will be created yet.','Upload WAV, MP3 or M4A audio (20 MB maximum).','Choose file','Only use your own voice or one whose owner has explicitly authorized synthetic voice creation.','I confirm I have permission to create a synthetic voice from this audio.','Selected file','Remove','Once enabled, generated samples can be played, compared and saved.','Your character’s voice will not change until you select and save a sample.'],
} as const;
export function PremiumVoiceStudio() {
  const language = useLanguage();
  const labels: readonly string[] = language === 'es' ? copy.es : copy.en;
  const [mode, setMode] = useState<'prompt' | 'reference'>('prompt');
  const [prompt, setPrompt] = useState('');
  const [voiceLanguage, setVoiceLanguage] = useState('en');
  const [count, setCount] = useState(3);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const chooseFile = (next: File | undefined) => {
    setError('');
    if (!next) return;
    const valid = /\\.(wav|mp3|m4a)$/i.test(next.name) && next.size <= 20 * 1024 * 1024;
    if (!valid) { setFile(null); setError('WAV / MP3 / M4A · max 20 MB'); return; }
    setFile(next); setConsent(false);
  };
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
    </>}
    <button type="button" disabled className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground opacity-50"><RefreshCw className="h-4 w-4"/>{labels[8]} ({count})</button>
    <p className="text-xs text-muted-foreground">{labels[9]}</p>
    <p className="text-xs text-muted-foreground">{labels[16]} {labels[17]}</p>
  </section>;
}
