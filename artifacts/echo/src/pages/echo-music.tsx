import { useState } from 'react';
import { Music2, LockKeyhole, WandSparkles } from 'lucide-react';
import { TopBar, useBack } from '@/components/echo/top-bar';

export default function EchoMusicPage() {
  const back = useBack();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  const [vocalMode, setVocalMode] = useState<'instrumental' | 'singing'>('instrumental');
  const [lyrics, setLyrics] = useState('');
  const [preview, setPreview] = useState('');
  const field = 'w-full rounded-xl border border-border bg-card px-3 py-3 text-sm text-foreground outline-none focus:border-primary';
  function prepare() {
    const lines = [description.trim(), genre.trim() && 'Genre: ' + genre.trim(), mood.trim() && 'Mood: ' + mood.trim(), 'Vocals: ' + vocalMode, vocalMode === 'singing' && lyrics.trim() && 'Original lyrics:\n' + lyrics.trim()];
    setPreview(lines.filter(Boolean).join('\n'));
  }
  return <div><TopBar title="ECHO Music Studio" onBack={back} /><main className="mx-auto max-w-2xl space-y-5 px-4 pb-20 pt-5">
    <div className="rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex items-center gap-2 text-lg font-semibold"><Music2 className="h-5 w-5 text-primary" /> Create your sound</div>
      <p className="mt-2 text-xs text-muted-foreground">Prepará canciones originales con IA. La generación está desactivada: no se consumirán créditos ni se enviarán datos a proveedores.</p>
    </div>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); prepare(); }}>
      <label className="block space-y-1 text-sm font-medium">Título<input className={field} value={title} maxLength={120} required onChange={e=>setTitle(e.target.value)} placeholder="Nombre de tu canción" /></label>
      <label className="block space-y-1 text-sm font-medium">Describí tu canción<textarea className={field} value={description} maxLength={2000} required minLength={3} rows={4} onChange={e=>setDescription(e.target.value)} placeholder="Una canción de rock alternativo con batería potente..." /></label>
      <div className="grid grid-cols-2 gap-3"><label className="block space-y-1 text-sm">Género<input className={field} value={genre} maxLength={100} onChange={e=>setGenre(e.target.value)} placeholder="Rock, pop..." /></label><label className="block space-y-1 text-sm">Ambiente<input className={field} value={mood} maxLength={100} onChange={e=>setMood(e.target.value)} placeholder="Oscuro, alegre..." /></label></div>
      <fieldset className="space-y-2"><legend className="text-sm font-medium">Tipo de canción</legend><div className="flex gap-3">{(['instrumental','singing'] as const).map(mode=><label key={mode} className="flex items-center gap-2 text-sm"><input type="radio" checked={vocalMode===mode} onChange={()=>setVocalMode(mode)} />{mode==='instrumental'?'Instrumental':'Con voz'}</label>)}</div></fieldset>
      {vocalMode==='singing' && <label className="block space-y-1 text-sm">Letra original<textarea className={field} value={lyrics} maxLength={5000} rows={5} onChange={e=>setLyrics(e.target.value)} placeholder="Escribí tu letra acá..." /></label>}
      <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground"><WandSparkles className="h-4 w-4"/> Preparar canción</button>
    </form>
    {preview && <section className="rounded-2xl border border-border bg-card/60 p-4" aria-live="polite"><h2 className="text-sm font-semibold">Vista previa · {title}</h2><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs text-muted-foreground">{preview}</pre><p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="h-4 w-4"/> Generación no activada. Sin cargos.</p></section>}
    <div className="rounded-2xl border border-border bg-card/60 p-4"><h2 className="text-sm font-semibold">Música para historias y publicaciones</h2><p className="mt-2 text-xs text-muted-foreground">Spotify y YouTube: conexiones pendientes de autorización oficial. La reproducción de fragmentos comerciales requerirá permisos específicos.</p></div>
  </main></div>;
}
