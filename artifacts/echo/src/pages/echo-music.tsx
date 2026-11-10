import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/lib/i18n';

import { Music2, LockKeyhole, WandSparkles, ChevronDown, Play, Pause, Upload, Library, Trash2, Disc3, Download } from 'lucide-react';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { customFetch } from '@workspace/api-client-react';
import { useSocial } from '@/store/social-store';
import { uploadPrivateFile, useMediaResolver } from '@/lib/media';

const musicEnglish: Record<string,string> = {
  "Elegí un archivo de audio compatible de hasta 30 MB.": "Choose a supported audio file up to 30 MB.",
  "No se pudo actualizar la publicación de esta canción.": "Could not update this track's publishing status.",
  "No se pudo cargar el audio compartido.": "Could not load the shared audio.",
  "Guardado en este dispositivo. La sincronización en la nube está pendiente.": "Saved on this device. Cloud sync is pending.",
  "No se pudo guardar el borrador en este dispositivo.": "Could not save the draft on this device.",
  "No se pudo guardar el audio.": "Could not save the audio.",
  "Eliminado de este dispositivo, pero no se pudo sincronizar la eliminación.": "Deleted on this device, but cloud deletion could not sync.",
  "No se pudo eliminar el borrador.": "Could not delete the draft.",
  "La preparación devolvió un estado inesperado.": "Preparation returned an unexpected status.",
  "No se pudo preparar la canción.": "Could not prepare the song.",
  "Volver al estudio": "Back to studio",
  "Reproduciendo": "Now playing",
  "Preparada": "Prepared",
  "Portada de ": "Cover art for ",
  "Elegir fragmento para compartir": "Choose a clip to share",
  "Inicio del fragmento": "Clip start",
  "Fragmento: ": "Clip: ",
  "Los fragmentos de canciones publicadas se pueden adjuntar desde Crear publicación o historia.": "Clips from published tracks can be added when creating a post or story.",
  "Escuchar fragmento": "Preview clip",
  "Progreso de la canción": "Song progress",
  "Pausar": "Pause",
  "Reproducir": "Play",
  "Guardando en almacenamiento privado…": "Saving to private storage…",
  "Guardar este audio en ECHO": "Save this audio to ECHO",
  "Audio guardado en almacenamiento privado. Aparece en tu biblioteca de este dispositivo.": "Audio saved in private storage. It appears in this device's library.",
  "Probar con un audio propio": "Try your own audio",
  "Audio local de prueba: no se guarda hasta que elijas guardarlo.": "Local test audio: it will not be saved unless you choose to save it.",
  "La canción está preparada, pero la generación de audio todavía no está activada. Cuando Mureka devuelva el archivo, podrás reproducirlo desde ECHO.": "Your song is prepared, but audio generation is not enabled yet. Once Mureka returns audio, you will be able to play it in ECHO.",
  "Ver prompt preparado": "View prepared prompt",
  "Secciones de ECHO Music": "ECHO Music sections",
  "Crear música": "Create music",
  "Mi biblioteca": "My library",
  " canciones guardadas · ": " saved tracks · ",
  " borradores": " drafts",
  "Biblioteca conectada a tu cuenta de ECHO.": "Library connected to your ECHO account.",
  "Sincronización pendiente: también se muestran los registros locales.": "Sync pending: local records are also shown.",
  "Canciones guardadas": "Saved tracks",
  "Borradores": "Drafts",
  "Todavía no guardaste canciones": "You haven't saved any tracks yet",
  "Todavía no tenés borradores": "You don't have any drafts yet",
  "Probá con un audio propio y guardalo en ECHO.": "Try your own audio and save it to ECHO.",
  "Prepará una canción con un prompt para verla acá.": "Prepare a song with a prompt to see it here.",
  "Ir al estudio": "Go to studio",
  "Audio guardado": "Saved audio",
  "Prompt preparado": "Prepared prompt",
  "Escuchar canción": "Play track",
  "Descargar": "Download",
  "Guardar voz": "Save voice",
  "Voz cantada vinculada": "Singing voice linked",
  "Identidad vocal": "Voice identity",
  "Voz hablada y cantada configuradas; timbre aún sin verificar": "Speech and singing voices configured; timbre not yet verified",
  "Voz hablada configurada; falta vincular la cantada": "Speech voice configured; singing voice not linked",
  "Voz cantada configurada; falta configurar la hablada": "Singing voice configured; speech voice not configured",
  "Sin identidad vocal configurada": "No voice identity configured",
  "Vincular voz existente": "Link existing voice",
  "ID de voz de Mureka": "Mureka voice ID",
  "Guardar vínculo": "Save voice link",
  "Solo ingresá un ID de voz de Mureka que hayas creado y tengas derecho a utilizar. Esto no clona voces ni consume créditos.": "Only enter a Mureka voice ID you created and have permission to use. This does not clone voices or use credits.",
  "Confirmo que tengo permiso para utilizar esta voz": "I confirm I have permission to use this voice",
  "No se pudo vincular la voz": "Could not link the voice",
  "Sin voz cantada configurada": "No singing voice configured",
  "Proteger identidad vocal": "Protect vocal identity",
  "Evita generar canciones cantadas con una voz diferente a la del personaje.": "Prevents generating sung tracks with a different voice from the character.",
  "Continuar con voz nueva": "Continue with a new voice",
  "Todavía no hay voz cantada vinculada. ¿Querés generar con una voz nueva?": "No singing voice is linked yet. Generate with a new voice?",
  "Preparar voz de Nela": "Prepare Nela voice",
  "Subir muestra vocal": "Upload vocal sample",
  "Desde una canción de mi biblioteca": "From a song in my library",
  "Consultar costo sin generar": "Check price without generating",
  "Desde un archivo de audio": "From an audio file",
  "Elegí cómo preparar la voz permanente": "Choose how to prepare the permanent voice",
  "La canción debe contener una voz clara y autorizada; el fragmento todavía no se extrae ni se envía al proveedor.": "The track must contain a clear, authorized vocal; the clip is not yet extracted or sent to the provider.",
  "Confirmo que tengo permiso para utilizar esta voz y crear una identidad vocal reutilizable": "I confirm I have permission to use this voice and create a reusable vocal identity",
  "Referencia seleccionada. La creación de la voz requiere un paso de clonación confirmado.": "Reference selected. Creating the voice requires a confirmed cloning step.",
  "Muestra vocal lista": "Vocal sample ready",
  "Seleccioná un MP3 o M4A de menos de 10 MB y entre 15 y 30 segundos.": "Choose an MP3 or M4A under 10 MB, between 15 and 30 seconds.",
  "El audio debe ser tuyo o contar con autorización para usar esa voz.": "You must own the audio or have permission to use this voice.",
  "Archivo incompatible o demasiado grande.": "Unsupported file or file too large.",
  "Duración incompatible: usá entre 15 y 30 segundos.": "Invalid duration: use 15 to 30 seconds.",
  "La muestra está preparada. La clonación no se ejecutará sin confirmar el costo.": "Sample ready. Cloning will not run without confirming the cost.",
  "Elegí 15 a 30 segundos donde se escuche claramente la cantante.": "Choose 15 to 30 seconds where the singer is clearly audible.",
  "Crear la voz clonada cuesta aproximadamente USD 5 en fal.ai. Esta pantalla no realiza el cargo ni crea el clon.": "Creating a cloned voice costs approximately USD 5 on fal.ai. This screen does not charge or create a clone.",
  "Referencia vocal preparada. Falta activar la clonación con confirmación de pago.": "Vocal reference prepared. Cloning requires payment confirmation before activation.",
  "Cerrar": "Close",
  "Descargando…": "Downloading…",
  "No se pudo descargar la canción.": "Could not download this track.",
  "Ver borrador": "View draft",
  "Dejar privado": "Make private",
  "Compartir": "Share",
  "Eliminar ": "Delete ",
  " de la biblioteca": " from library",
  "Canciones compartidas en ECHO": "Tracks shared on ECHO",
  "Solo se escuchan las canciones que sus propietarios publicaron expresamente.": "Only tracks explicitly published by their owners can be played.",
  "Todavía no hay canciones compartidas.": "No shared tracks yet.",
  "Cargando…": "Loading…",
  "Eliminar un registro no borra todavía el archivo privado del almacenamiento.": "Deleting a library entry does not yet delete its private stored file.",
  "Configurá una canción original para ECHO Music. La vista previa prepara tu solicitud sin generar audio ni consumir créditos.": "Set up an original song for ECHO Music. The preview does not call fal.ai or consume credits.",
  "Título": "Title",
  "Nombre de tu canción": "Your song title",
  "Describí tu canción": "Describe your song",
  "Una canción de rock alternativo con batería potente...": "An alternative rock track with powerful drums...",
  "Género": "Genre",
  "Ambiente": "Mood",
  "Oscuro, alegre...": "Dark, upbeat...",
  "Instrumentos (separados por comas)": "Instruments (comma-separated)",
  "Batería, bajo, guitarra eléctrica": "Drums, bass, electric guitar",
  "Idioma de la voz": "Vocal language",
  "Inglés": "English",
  "Español": "Spanish",
  "Coreano": "Korean",
  "Portugués": "Portuguese",
  "Japonés": "Japanese",
  "Francés": "French",
  "Alemán": "German",
  "Duración estimada": "Estimated duration",
  " segundos": " seconds",
  " minuto": " minute",
  " minutos": " minutes",
  "Tipo de canción": "Song type",
  "Con voz": "With vocals",
  "Letra original": "Original lyrics",
  "Escribí tu letra acá...": "Write your lyrics here...",
  "Preparando…": "Preparing…",
  "Preparar canción · gratis": "Prepare song · free",
  "Probar reproductor con audio propio": "Test player with your own audio",
  "Solicitud preparada · ": "Prepared request · ",
  "Generación no activada. Sin cargos.": "Generation not enabled. No charges.",
  "Mi biblioteca · borradores": "My library · drafts",
  "Los audios se guardan en almacenamiento privado. ": "Audio files are stored privately. ",
  "Biblioteca conectada a tu cuenta.": "Library connected to your account.",
  "Biblioteca local; sincronización en la nube pendiente.": "Local library; cloud sync pending.",
  "Todavía no preparaste canciones.": "You haven't prepared any songs yet.",
  "Audio privado guardado": "Private audio saved",
  "Borrador": "Draft",
  "Eliminar": "Delete",
  "Música para historias y publicaciones": "Music for stories and posts",
  "Feed.fm Clips: integración preparada, sin activar ni contratar. La reproducción de fragmentos de 15 o 30 segundos se habilitará únicamente después de confirmar el contrato, los derechos para Argentina y el acceso oficial al catálogo. YouTube: búsqueda disponible, sin derechos de reproducción de audio sobre fotos.": "Feed.fm Clips: integration prepared but not activated or contracted. Playing 15- or 30-second clips requires an approved agreement, rights for Argentina, and official catalog access. YouTube search is available, but does not grant rights to play audio over photos.",
  "Crear canciones": "Create songs",
  "Crear canciones ›": "Create songs ›",
  "Preparar canción": "Prepare song",
  "Instrumental": "Instrumental"
};
function translateMusic(label:string, lang:string):string { return lang === 'es' ? label : (musicEnglish[label] ?? label); }

type MusicDraftRecord = { id: string; title: string; prompt: string; characterId: string; createdAt: string; durationSeconds: number; status: 'draft' | 'saved_audio'; audioPath?: string; publishedAt?: string | null };
const libraryKey = (id: string) => `echo-music-drafts-v1:${id}`;

/** Locally trims an owned track to a mono 16 kHz PCM WAV.
 * This does NOT isolate singing from instruments; use only when the selected
 * passage is already vocal-dominant or after a separate stem-extraction step.
 */
async function trimLibraryVocalReference(audio:Blob,startSeconds:number,lengthSeconds:number):Promise<File> {
  if(!Number.isFinite(startSeconds) || startSeconds<0 || !Number.isFinite(lengthSeconds) || lengthSeconds<15 || lengthSeconds>30) throw new Error('VOICE_CLIP_RANGE_INVALID');
  const source=new AudioContext();
  let decoded:AudioBuffer;
  try {decoded=await source.decodeAudioData(await audio.arrayBuffer());}
  finally {await source.close();}
  if(startSeconds+lengthSeconds>decoded.duration+0.05) throw new Error('VOICE_CLIP_OUT_OF_RANGE');
  const sampleRate=16000,frameCount=Math.floor(lengthSeconds*sampleRate);
  const offline=new OfflineAudioContext(1,frameCount,sampleRate);
  const node=offline.createBufferSource();node.buffer=decoded;node.connect(offline.destination);
  node.start(0,startSeconds,lengthSeconds);
  const rendered=await offline.startRendering();
  const samples=rendered.getChannelData(0);
  const bytes=new ArrayBuffer(44+samples.length*2),view=new DataView(bytes);
  const ascii=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  ascii(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);ascii(8,'WAVE');ascii(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++){const value=Math.max(-1,Math.min(1,samples[i]));view.setInt16(44+i*2,value<0?value*32768:value*32767,true);}
  return new File([bytes],'echo-vocal-reference.wav',{type:'audio/wav'});
}

export default function EchoMusicPage() {
  const back = useBack();
  const interfaceLanguage = useLanguage();
  const t = (label:string) => translateMusic(label, interfaceLanguage);
  const { me } = useSocial();
  const [musicAccess, setMusicAccess] = useState<'loading' | 'active' | 'inactive' | 'error'>('loading');
  const [paidTestEnabled, setPaidTestEnabled] = useState(false);
  const [generationJob, setGenerationJob] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState('');
  const [generating, setGenerating] = useState(false);
  useEffect(() => { customFetch<{paidTestEnabled?:boolean}>('/api/music/status', {responseType:'json'})
    .then(result => setPaidTestEnabled(Boolean(result.paidTestEnabled))).catch(() => {}); }, []);
  useEffect(() => {
    let mounted = true;
    customFetch<{active:boolean}>('/api/music/entitlement', { responseType:'json' })
      .then(data => { if(mounted) setMusicAccess(data.active ? 'active' : 'inactive'); })
      .catch(() => { if(mounted) setMusicAccess('error'); });
    return () => { mounted = false; };
  }, []);
  const resolvePrivateAudio = useMediaResolver();
  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [localAudioUrl, setLocalAudioUrl] = useState<string | null>(null);
  const [localAudioError, setLocalAudioError] = useState('');
  const [savingAudio, setSavingAudio] = useState(false);
  const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null);
  const [savedAudioPath, setSavedAudioPath] = useState<string | null>(null);
  const resolvedSavedAudio = savedAudioPath ? resolvePrivateAudio(savedAudioPath) : '';
  const coverUrl = me.avatar ? resolvePrivateAudio(me.avatar, { sourceType: 'avatar', sourceContentId: me.id, sourceCharacterId: me.id }) : '';
  useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);
  function importAudio(file: File | undefined) {
    if (!file) return;
    if (!['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/webm'].includes(file.type) || file.size > 30 * 1024 * 1024) {
      setLocalAudioError(t("Elegí un archivo de audio compatible de hasta 30 MB."));
      return;
    }
    audioRef.current?.pause();
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setLocalAudioUrl(url);
    setSelectedAudioFile(file);
    setSavedAudioPath(null);
    setLocalAudioError('');
    setElapsed(0);
    setActualDuration(0);
    setClipStart(0);
    setPlaying(false);
    setPlayerOpen(true);
  }
  const [playerOpen, setPlayerOpen] = useState(false);
  const [library, setLibrary] = useState<MusicDraftRecord[]>([]);
  const [studioTab, setStudioTab] = useState<'create' | 'library'>('create');
  const [libraryFilter, setLibraryFilter] = useState<'saved_audio' | 'draft'>('saved_audio');
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [publishedTracks, setPublishedTracks] = useState<Array<{ id: string; characterId: string; title: string; durationSeconds: number }>>([]);
  const [loadingSharedId, setLoadingSharedId] = useState<string | null>(null);
  const [libraryError, setLibraryError] = useState('');
  const [cloudLibraryAvailable, setCloudLibraryAvailable] = useState(false);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(libraryKey(me.id)) ?? '[]') as unknown;
      setLibrary(Array.isArray(stored) ? stored.filter((item): item is MusicDraftRecord => !!item && typeof item === 'object' && typeof item.title === 'string' && (item.status === 'draft' || (item.status === 'saved_audio' && typeof item.audioPath === 'string')) && item.characterId === me.id).slice(0, 50) : []);
    } catch { setLibrary([]); }
  }, [me.id]);
  useEffect(() => {
    let active = true;
    void customFetch<{ items: Array<MusicDraftRecord & { createdAt: string }> }>('/api/music/library', { responseType: 'json' })
      .then(result => {
        if (!active) return;
        setCloudLibraryAvailable(true);
        const cloudItems = result.items.filter(item => item.characterId === me.id);
        setLibrary(current => {
          const merged = [...cloudItems, ...current.filter(local => !cloudItems.some(remote => remote.id === local.id))].slice(0, 100);
          return merged;
        });
      }).catch(() => { if (active) setCloudLibraryAvailable(false); });
    return () => { active = false; };
  }, [me.id]);
  async function togglePublish(item: MusicDraftRecord) {
    if (publishingId || item.status !== 'saved_audio') return;
    setPublishingId(item.id); setLibraryError('');
    try {
      const publish = !item.publishedAt;
      await customFetch('/api/music/library/' + encodeURIComponent(item.id) + (publish ? '/publish' : '/unpublish'), { method: 'POST', responseType: 'json' });
      setLibrary(current => current.map(track => track.id === item.id ? { ...track, publishedAt: publish ? new Date().toISOString() : null } : track));
      const result = await customFetch<{ items: typeof publishedTracks }>('/api/music/published', { responseType: 'json' });
      setPublishedTracks(result.items);
    } catch { setLibraryError(t("No se pudo actualizar la publicación de esta canción.")); }
    finally { setPublishingId(null); }
  }
  async function playSharedTrack(item: { id: string; title: string; durationSeconds: number }) {
    if (loadingSharedId) return;
    setLoadingSharedId(item.id); setLibraryError('');
    try {
      const blob = await customFetch<Blob>('/api/music/published/' + encodeURIComponent(item.id) + '/audio', { responseType: 'blob' });
      if (!blob.type.startsWith('audio/')) throw new Error('Formato de audio no compatible');
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setLocalAudioUrl(url); setSavedAudioPath(null); setSelectedAudioFile(null);
      setTitle(item.title); setPreview(''); setElapsed(0); setActualDuration(0); setClipStart(0);
      setPlayerOpen(true);
    } catch { setLibraryError(t("No se pudo cargar el audio compartido.")); }
    finally { setLoadingSharedId(null); }
  }
  useEffect(() => {
    if (studioTab !== 'library') return;
    let active = true;
    void customFetch<{ items: typeof publishedTracks }>('/api/music/published', { responseType: 'json' })
      .then(result => { if (active) setPublishedTracks(result.items); })
      .catch(() => {});
    return () => { active = false; };
  }, [studioTab]);
  async function syncDraft(record: MusicDraftRecord) {
    try {
      await customFetch('/api/music/library', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: record.id, characterId: record.characterId, title: record.title,
          prompt: record.prompt, durationSeconds: record.durationSeconds, status: record.status,
          audioPath: record.audioPath ?? null }), responseType: 'json' });
      setCloudLibraryAvailable(true);
    } catch {
      setCloudLibraryAvailable(false);
      setLibraryError(t("Guardado en este dispositivo. La sincronización en la nube está pendiente."));
    }
  }
  function saveDraft(record: MusicDraftRecord) {
    try {
      const next = [record, ...library.filter(item => item.id !== record.id)].slice(0, 50);
      localStorage.setItem(libraryKey(me.id), JSON.stringify(next));
      setLibrary(next);
      setLibraryError('');
      void syncDraft(record);
    } catch { setLibraryError(t("No se pudo guardar el borrador en este dispositivo.")); }
  }
  async function saveCurrentAudio() {
    if (!selectedAudioFile || savingAudio) return;
    setSavingAudio(true);
    setLocalAudioError('');
    try {
      const attachment = await uploadPrivateFile(selectedAudioFile);
      if (attachment.type !== 'audio') throw new Error('El archivo subido no es audio.');
      const record: MusicDraftRecord = {
        id: crypto.randomUUID(), title: title.trim() || selectedAudioFile.name,
        prompt: preview, characterId: me.id, createdAt: new Date().toISOString(),
        durationSeconds: Math.round(actualDuration || durationSeconds),
        status: 'saved_audio', audioPath: attachment.url,
      };
      saveDraft(record);
      setSavedAudioPath(attachment.url);
    } catch (error) {
      setLocalAudioError(error instanceof Error ? error.message : t("No se pudo guardar el audio."));
    } finally { setSavingAudio(false); }
  }
  function deleteDraft(id: string) {
    try {
      const next = library.filter(item => item.id !== id);
      localStorage.setItem(libraryKey(me.id), JSON.stringify(next));
      setLibrary(next);
      void customFetch('/api/music/library/' + encodeURIComponent(id), { method: 'DELETE', responseType: 'json' }).catch(() => setLibraryError(t("Eliminado de este dispositivo, pero no se pudo sincronizar la eliminación.")));
    } catch { setLibraryError(t("No se pudo eliminar el borrador.")); }
  }
  const audioUrl = resolvedSavedAudio || localAudioUrl;
  const filteredLibrary = library.filter(item => item.status === libraryFilter).sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [voiceSource, setVoiceSource] = useState<MusicDraftRecord | null>(null);
  const [voiceStart, setVoiceStart] = useState(0);
  const [voiceLength, setVoiceLength] = useState(20);
  const [libraryClipBusy,setLibraryClipBusy] = useState(false);
  const [libraryClipStatus,setLibraryClipStatus] = useState('');
  const [separationJobId,setSeparationJobId]=useState('');
  const [separationStatus,setSeparationStatus]=useState('');
  const [separationBusy,setSeparationBusy]=useState(false);
  async function prepareVocalSeparationJob(){
    if(!me?.id || !voiceSample || !voiceSampleStorageKey || !voiceCloneConsent || separationBusy)return;
    setSeparationBusy(true);setSeparationStatus('');
    try{
      const result=await customFetch<{jobId:string;status:string}>('/api/music/voices/separation/jobs',{
        method:'POST',headers:{'Content-Type':'application/json'},responseType:'json',
        body:JSON.stringify({characterId:me.id,storageKey:voiceSampleStorageKey,durationSeconds:voiceSample.duration,consentConfirmed:true})
      });
      setSeparationJobId(result.jobId);setSeparationStatus(t('Separación vocal preparada, sin cargo.'));
    }catch(error){setSeparationStatus(error instanceof Error?error.message:'VOCAL_SEPARATION_PREPARATION_FAILED');}
    finally{setSeparationBusy(false);}
  }
  async function confirmVocalSeparation(){
    if(!separationJobId || separationBusy)return;
    if(!window.confirm(interfaceLanguage==='es'
      ? 'Separar la voz con Demucs puede generar un cargo adicional en fal.ai, independiente de la clonación. ¿Autorizás este gasto?'
      : 'Separating vocals with Demucs may incur an additional fal.ai charge, separate from cloning. Authorize this expense?'))return;
    setSeparationBusy(true);
    try{
      const result=await customFetch<{status:string}>('/api/music/voices/separation/jobs/'+encodeURIComponent(separationJobId)+'/confirm',{
        method:'POST',headers:{'Content-Type':'application/json'},responseType:'json',
        body:JSON.stringify({chargeConfirmed:true,consentConfirmed:true})
      });
      setSeparationStatus(t('Estado de separación')+': '+result.status);
    }catch(error){setSeparationStatus(error instanceof Error?error.message:'VOCAL_SEPARATION_SPENDING_DISABLED');}
    finally{setSeparationBusy(false);}
  }
  async function syncVocalSeparationResult(){
    if(!separationJobId || separationBusy)return;
    setSeparationBusy(true);
    try{
      const result=await customFetch<{status:string;isolatedStorageKey?:string}>('/api/music/voices/separation/jobs/'+encodeURIComponent(separationJobId)+'/sync',{
        method:'POST',headers:{'Content-Type':'application/json'},body:'{}',responseType:'json'
      });
      setSeparationStatus(t('Estado de separación')+': '+result.status);
      if(result.status==='completed' && result.isolatedStorageKey){
        setVoiceSampleStorageKey(result.isolatedStorageKey);
        setVoiceCloneJobId('');setVoiceCloneJobStatus('');
        setSeparationStatus(t('Voz aislada guardada de forma privada. Ya podés preparar su clonación.'));
      }
    }catch(error){setSeparationStatus(error instanceof Error?error.message:'VOCAL_SEPARATION_SYNC_UNAVAILABLE');}
    finally{setSeparationBusy(false);}
  }
  async function prepareLibraryClip() {
    if(!voiceSource || !me?.id || libraryClipBusy || voiceSource.status!=='saved_audio' || !voiceSource.audioPath?.startsWith('generated/')) return;
    setLibraryClipBusy(true);setLibraryClipStatus('');
    try {
      const audio=await customFetch<Blob>('/api/music/generation/'+encodeURIComponent(voiceSource.id)+'/audio',{responseType:'blob'});
      if(!audio.type.startsWith('audio/'))throw new Error('VOICE_CLIP_SOURCE_INVALID');
      const file=await trimLibraryVocalReference(audio,voiceStart,voiceLength);
      setVoiceSample({name:file.name,file,size:file.size,duration:voiceLength});
      setVoiceSampleStorageKey('');setVoiceCloneJobId('');setVoiceCloneJobStatus('');
      setLibraryClipStatus(t('Fragmento preparado en este dispositivo. No se envió ni se cobró nada.'));
    }catch(error){setLibraryClipStatus(error instanceof Error?error.message:'VOICE_CLIP_PREPARATION_FAILED');}
    finally{setLibraryClipBusy(false);}
  }
  async function downloadLibraryTrack(item: MusicDraftRecord) {
    if (downloadingId || item.status !== 'saved_audio' || !item.audioPath?.startsWith('generated/')) return;
    setDownloadingId(item.id);
    setLibraryError('');
    try {
      const blob = await customFetch<Blob>('/api/music/generation/' + encodeURIComponent(item.id) + '/audio', { responseType: 'blob' });
      if (!blob.type.startsWith('audio/')) throw new Error('INVALID_GENERATED_AUDIO');
      const extension = blob.type.includes('wav') ? 'wav' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') || blob.type.includes('aac') ? 'm4a' : 'mp3';
      const filename = (item.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\\s+/g, '_') || 'ECHO_Music') + '.' + extension;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setLibraryError(t("No se pudo descargar la canción."));
    } finally {
      setDownloadingId(null);
    }
  }
  async function openLibraryItem(item: MusicDraftRecord) {
    if (loadingSharedId) return;
    audioRef.current?.pause();
    setLibraryError('');
    setTitle(item.title); setPreview(item.prompt); setDurationSeconds(item.durationSeconds);
    setElapsed(0); setActualDuration(0); setClipStart(0);
    // Generated music uses an authenticated server stream, not a legacy
    // /objects/uploads path. Fetch with Clerk auth before opening the player.
    if (item.status === 'saved_audio' && item.audioPath?.startsWith('generated/')) {
      setLoadingSharedId(item.id);
      try {
        const blob = await customFetch<Blob>(
          '/api/music/generation/' + encodeURIComponent(item.id) + '/audio',
          { responseType: 'blob' },
        );
        if (!blob.type.startsWith('audio/')) throw new Error('INVALID_GENERATED_AUDIO');
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setSavedAudioPath(null); setLocalAudioUrl(url); setSelectedAudioFile(null);
        setPlayerOpen(true);
      } catch {
        setLibraryError(t("No se pudo cargar el audio compartido."));
      } finally { setLoadingSharedId(null); }
      return;
    }
    setSavedAudioPath(item.audioPath ?? null); setLocalAudioUrl(null); setSelectedAudioFile(null);
    setPlayerOpen(true);
  }
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [actualDuration, setActualDuration] = useState(0);
  const [clipStart, setClipStart] = useState(0);
  const [clipLength, setClipLength] = useState<15 | 30>(15);
  const clipEnd = Math.min(actualDuration || 0, clipStart + clipLength);
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [genre, setGenre] = useState('');
  const [mood, setMood] = useState('');
  const [vocalMode, setVocalMode] = useState<'instrumental' | 'singing'>('instrumental');
  const [singingVoiceId, setSingingVoiceId] = useState<string | null>(null);
  const [voiceConsistency, setVoiceConsistency] = useState('unconfigured');
  const [protectSingingVoice, setProtectSingingVoice] = useState(true);
  const [voiceSample, setVoiceSample] = useState<{name:string;duration:number;size:number;file:File}|null>(null);
  const [voiceSampleError, setVoiceSampleError] = useState('');
  const [voiceCloneConsent, setVoiceCloneConsent] = useState(false);
  const [voiceCloneQuote, setVoiceCloneQuote] = useState<string>('');
  const [voiceCloneQuoteBusy, setVoiceCloneQuoteBusy] = useState(false);
  async function previewVoiceClone(source: 'upload' | 'library') {
    if (!me?.id || !voiceCloneConsent || voiceCloneQuoteBusy) return;
    if (source === 'upload' && (!voiceSample || !voiceSample.file || voiceSample.file.size !== voiceSample.size)) return;
    if (source === 'library' && (!voiceSource || voiceSource.status !== 'saved_audio' || !voiceSource.audioPath?.startsWith('generated/') || voiceSource.durationSeconds < 15 || voiceStart + voiceLength > voiceSource.durationSeconds)) return;
    setVoiceCloneQuoteBusy(true); setVoiceCloneQuote('');
    try {
      const result = await customFetch<{estimatedCostUsd:number;status:string}>('/api/music/voices/clone/quote', {
        method:'POST', headers:{'Content-Type':'application/json'},responseType:'json',
        body:JSON.stringify(source === 'upload'
          ? {characterId:me.id,source,durationSeconds:voiceSample!.duration,
              fileName:voiceSample!.name,fileSizeBytes:voiceSample!.size,consentConfirmed:true}
          : {characterId:voiceSource!.characterId,source,durationSeconds:voiceLength,
              libraryTrackId:voiceSource!.id,consentConfirmed:true})
      });
      setVoiceCloneQuote(result.status === 'preview_only' ? 'USD ' + result.estimatedCostUsd.toFixed(2) + ' · ' + t('La muestra está preparada. La clonación no se ejecutará sin confirmar el costo.') : 'INVALID_QUOTE');
    } catch (error) {setVoiceCloneQuote(error instanceof Error ? error.message : 'QUOTE_UNAVAILABLE');}
    finally {setVoiceCloneQuoteBusy(false);}
  }
  const [voiceSampleUploadBusy,setVoiceSampleUploadBusy] = useState(false);
  const [voiceSampleStorageKey,setVoiceSampleStorageKey] = useState('');
  const [voiceSampleUploadError,setVoiceSampleUploadError] = useState('');
  const [voiceSamplePreflightBusy,setVoiceSamplePreflightBusy] = useState(false);
  const [voiceSamplePreflightStatus,setVoiceSamplePreflightStatus] = useState('');
  const [voiceCloneJobId,setVoiceCloneJobId] = useState('');
  const [voiceCloneJobStatus,setVoiceCloneJobStatus] = useState('');
  const [voiceCloneJobBusy,setVoiceCloneJobBusy] = useState(false);
  async function prepareVoiceCloneJob() {
    if (!me?.id || !voiceSample || !voiceSampleStorageKey || !voiceCloneConsent || voiceCloneJobBusy) return;
    setVoiceCloneJobBusy(true);setVoiceCloneJobStatus('');
    try {
      const result=await customFetch<{jobId:string;status:string;estimatedCostUsd:number}>('/api/music/voices/clone/jobs',{
        method:'POST',headers:{'Content-Type':'application/json'},responseType:'json',
        body:JSON.stringify({characterId:me.id,storageKey:voiceSampleStorageKey,
          durationSeconds:voiceSample.duration,consentConfirmed:true})
      });
      setVoiceCloneJobId(result.jobId);
      setVoiceCloneJobStatus(t('Trabajo de clonación preparado, sin cargo.') + ' · USD ' + result.estimatedCostUsd.toFixed(2));
    } catch(error) {setVoiceCloneJobStatus(error instanceof Error?error.message:'VOICE_CLONE_JOB_PREPARATION_UNAVAILABLE');}
    finally {setVoiceCloneJobBusy(false);}
  }
  async function confirmVoiceCloneCharge() {
    if (!voiceCloneJobId || voiceCloneJobBusy || !voiceCloneConsent) return;
    const agreed=window.confirm(interfaceLanguage === 'en'
      ? 'Cloning this singing voice may charge approximately USD 5. Confirm that you authorize this paid operation?'
      : 'Clonar esta voz cantada puede costar aproximadamente USD 5. ¿Confirmás que autorizás este gasto?');
    if (!agreed) return;
    setVoiceCloneJobBusy(true);setVoiceCloneJobStatus('');
    try {
      const result=await customFetch<{status:string}>('/api/music/voices/clone/jobs/'+encodeURIComponent(voiceCloneJobId)+'/confirm',{
        method:'POST',headers:{'Content-Type':'application/json'},responseType:'json',
        body:JSON.stringify({chargeConfirmed:true,consentConfirmed:true})
      });
      setVoiceCloneJobStatus(t('Estado de clonación')+': '+result.status);
    } catch(error) {setVoiceCloneJobStatus(error instanceof Error?error.message:'VOICE_CLONE_SPENDING_DISABLED');}
    finally {setVoiceCloneJobBusy(false);}
  }
  async function syncVoiceCloneResult() {
    if (!voiceCloneJobId || voiceCloneJobBusy) return;
    setVoiceCloneJobBusy(true);
    try {
      const result=await customFetch<{status:string;vocalId?:string}>('/api/music/voices/clone/jobs/'+encodeURIComponent(voiceCloneJobId)+'/sync',{
        method:'POST',headers:{'Content-Type':'application/json'},body:'{}',responseType:'json'
      });
      setVoiceCloneJobStatus(t('Estado de clonación')+': '+result.status);
      if(result.status==='completed' && result.vocalId) setSingingVoiceId(result.vocalId);
    } catch(error) {setVoiceCloneJobStatus(error instanceof Error?error.message:'VOICE_CLONE_SYNC_UNAVAILABLE');}
    finally {setVoiceCloneJobBusy(false);}
  }
  async function refreshVoiceCloneJob() {
    if (!voiceCloneJobId || voiceCloneJobBusy) return;
    setVoiceCloneJobBusy(true);
    try {
      const result=await customFetch<{job:{status:string;provider_vocal_id?:string|null}}>('/api/music/voices/clone/jobs/'+encodeURIComponent(voiceCloneJobId),{responseType:'json'});
      setVoiceCloneJobStatus(t('Estado de clonación')+': '+result.job.status);
      if (result.job.status==='completed' && result.job.provider_vocal_id) setSingingVoiceId(result.job.provider_vocal_id);
    } catch(error) {setVoiceCloneJobStatus(error instanceof Error?error.message:'VOICE_CLONE_JOB_LOOKUP_UNAVAILABLE');}
    finally {setVoiceCloneJobBusy(false);}
  }
  async function verifyStoredVocalSample() {
    if (!me?.id || !voiceSample || !voiceCloneConsent || !voiceSampleStorageKey || voiceSamplePreflightBusy) return;
    setVoiceSamplePreflightBusy(true);setVoiceSamplePreflightStatus('');setVoiceCloneJobId('');setVoiceCloneJobStatus('');
    try {
      const result=await customFetch<{status:string;estimatedCloneCostUsd:number}>('/api/music/voices/clone/sample/preflight',{
        method:'POST',headers:{'Content-Type':'application/json'},responseType:'json',
        body:JSON.stringify({characterId:me.id,storageKey:voiceSampleStorageKey,durationSeconds:voiceSample.duration,consentConfirmed:true})
      });
      if (result.status !== 'ready_for_confirmation') throw new Error('VOICE_SAMPLE_PREFLIGHT_FAILED');
      setVoiceSamplePreflightStatus(t('Muestra privada verificada y lista para la confirmación de clonación.') + ' · USD ' + result.estimatedCloneCostUsd.toFixed(2));
    } catch(error) {setVoiceSamplePreflightStatus(error instanceof Error?error.message:'VOICE_SAMPLE_PREFLIGHT_FAILED');}
    finally {setVoiceSamplePreflightBusy(false);}
  }
  async function stageVocalSample() {
    if (!me?.id || !voiceSample || !voiceCloneConsent || voiceSampleUploadBusy) return;
    setVoiceSampleUploadBusy(true);setVoiceSampleUploadError('');setVoiceSampleStorageKey('');
    try {
      const params = new URLSearchParams({characterId:me.id,durationSeconds:String(voiceSample.duration)});
      const result = await customFetch<{storageKey:string;status:string}>('/api/music/voices/clone/sample?' + params.toString(),{
        method:'POST',headers:{'Content-Type':voiceSample.file.type === 'audio/wav' ? 'audio/wav' : voiceSample.file.type === 'audio/mp4' || voiceSample.file.name.toLowerCase().endsWith('.m4a') ? 'audio/mp4' : 'audio/mpeg','x-voice-consent':'confirmed'},
        body:voiceSample.file,responseType:'json'
      });
      if (result.status !== 'stored_private') throw new Error('VOICE_SAMPLE_UPLOAD_FAILED');
      setVoiceSampleStorageKey(result.storageKey);
    } catch(error) {setVoiceSampleUploadError(error instanceof Error?error.message:'VOICE_SAMPLE_UPLOAD_FAILED');}
    finally {setVoiceSampleUploadBusy(false);}
  }
  async function prepareVocalSample(file?: File) {
    setVoiceSample(null); setVoiceSampleError('');setVoiceSampleStorageKey('');setVoiceSampleUploadError('');setVoiceSamplePreflightStatus('');
    if (!file) return;
    if (!/\.(mp3|m4a)$/i.test(file.name) || file.size >= 10 * 1024 * 1024) {
      setVoiceSampleError(t('Archivo incompatible o demasiado grande.')); return;
    }
    const url = URL.createObjectURL(file);
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const audio = document.createElement('audio');
        audio.preload = 'metadata'; audio.onloadedmetadata = () => resolve(audio.duration);
        audio.onerror = () => reject(new Error('AUDIO_METADATA_INVALID')); audio.src = url;
      });
      if (!Number.isFinite(duration) || duration < 15 || duration > 30) {
        setVoiceSampleError(t('Duración incompatible: usá entre 15 y 30 segundos.')); return;
      }
      setVoiceSample({name:file.name,duration,size:file.size,file});
    } catch { setVoiceSampleError(t('Archivo incompatible o demasiado grande.')); }
    finally { URL.revokeObjectURL(url); }
  }
  const [voiceLinkId, setVoiceLinkId] = useState('');
  const [voiceLinkConsent, setVoiceLinkConsent] = useState(false);
  const [voiceLinkBusy, setVoiceLinkBusy] = useState(false);
  const [voiceLinkError, setVoiceLinkError] = useState('');
  async function unlinkSingingVoice() {
    if (!me?.id || voiceLinkBusy || !window.confirm(interfaceLanguage==='es'?'¿Desvincular la voz cantada? No se borrará del proveedor.':'Unlink the singing voice? It will not be deleted from the provider.')) return;
    setVoiceLinkBusy(true); setVoiceLinkError('');
    try {
      await customFetch('/api/music/voices/' + encodeURIComponent(me.id), {method:'DELETE',responseType:'json'});
      setSingingVoiceId(null);
      setVoiceConsistency(voiceConsistency==='both_configured_unverified'?'speech_only':'unconfigured');
    } catch(error) {setVoiceLinkError(error instanceof Error?error.message:t('No se pudo vincular la voz'));}
    finally {setVoiceLinkBusy(false);}
  }
  async function linkExistingSingingVoice() {
    if (!me?.id || !voiceLinkConsent || !/^[a-zA-Z0-9_-]{1,128}$/.test(voiceLinkId) || voiceLinkBusy) return;
    // A character's established singer is not silently replaced.
    const replacing = Boolean(singingVoiceId && singingVoiceId !== voiceLinkId);
    if (replacing && !window.confirm(interfaceLanguage === 'es'
      ? 'Este personaje ya tiene una voz cantada. ¿Querés reemplazarla para las próximas canciones? Las canciones anteriores no cambiarán.'
      : 'This character already has a singing voice. Replace it for future songs? Existing songs will not change.')) return;
    setVoiceLinkBusy(true); setVoiceLinkError('');
    try {
      await customFetch('/api/music/voices', {method:'POST',headers:{'Content-Type':'application/json'},responseType:'json',
        body:JSON.stringify({characterId:me.id,vocalId:voiceLinkId,consentConfirmed:true,replaceExisting:replacing})});
      setSingingVoiceId(voiceLinkId); setVoiceConsistency(voiceConsistency==='speech_only'?'both_configured_unverified':'singing_only'); setVoiceLinkId(''); setVoiceLinkConsent(false);
    } catch (error) { setVoiceLinkError(error instanceof Error ? error.message : t('No se pudo vincular la voz')); }
    finally {setVoiceLinkBusy(false);}
  }
  useEffect(() => {
    let active = true;
    if (!me?.id) return;
    setSingingVoiceId(null);
    customFetch<{vocalId:string|null;consistencyStatus?:string}>('/api/music/voices/' + encodeURIComponent(me.id), {responseType:'json'})
      .then(data => {if(active) {setSingingVoiceId(data.vocalId ?? null);setVoiceConsistency(data.consistencyStatus ?? 'unconfigured');}}).catch(() => {});
    return () => {active = false;};
  }, [me?.id]);
  const [lyrics, setLyrics] = useState('');
  const [instruments, setInstruments] = useState('');
  const [language, setLanguage] = useState('en');
  const [durationSeconds, setDurationSeconds] = useState(120);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState('');
  const [preview, setPreview] = useState('');
  const field = 'w-full rounded-xl border border-border bg-card px-3 py-3 text-sm text-foreground outline-none focus:border-primary';
  async function prepare() {
    if (preparing) return;
    setPreparing(true);
    setPrepareError('');
    setPreview('');
    try {
      const result = await customFetch<{ status: string; charged: boolean; request: { prompt: string; music_length_ms: number; force_instrumental: boolean } }>('/api/music/generate/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationSeconds,
          title: title.trim(),
          description: description.trim(),
          genre: genre.trim(),
          mood: mood.trim(),
          instruments: instruments.split(',').map(s => s.trim()).filter(Boolean).slice(0, 12),
          language,
          vocalMode,
          lyrics: vocalMode === 'singing' ? lyrics : '',
        }),
        responseType: 'json',
      });
      if (result.charged || result.status !== 'dry_run') throw new Error(t("La preparación devolvió un estado inesperado."));
      setPreview(result.request.prompt);
      saveDraft({ id: crypto.randomUUID(), title: title.trim(), prompt: result.request.prompt, characterId: me.id, createdAt: new Date().toISOString(), durationSeconds, status: 'draft' });
      setElapsed(0);
      setPlaying(false);
      setPlayerOpen(false);
      setGenerationStatus(interfaceLanguage === 'es' ? 'Prompt preparado sin cargos. Para crear audio real, usá Generar canción de prueba.' : 'Prompt prepared at no cost. To create real audio, use Generate test track.');
    } catch (err) {
      setPrepareError(err instanceof Error ? err.message : t("No se pudo preparar la canción."));
    } finally {
      setPreparing(false);
    }
  }
  async function generatePaidTest() {
    if (generating || !paidTestEnabled) return;
    if (vocalMode === 'singing' && !singingVoiceId && !protectSingingVoice && !window.confirm(t('Todavía no hay voz cantada vinculada. ¿Querés generar con una voz nueva?'))) return;
    if (!window.confirm(interfaceLanguage === 'es'
      ? 'Esta prueba enviará una solicitud paga a fal.ai y consumirá una generación. ¿Continuar?'
      : 'This test submits a paid request to fal.ai and uses one generation. Continue?')) return;
    setGenerating(true); setGenerationStatus('');
    try {
      const result = await customFetch<{jobId:string}>('/api/music/generate', {
        method:'POST', headers:{'Content-Type':'application/json'}, responseType:'json',
        body:JSON.stringify({ characterId:me.id, requireConfiguredVoice: vocalMode === 'singing' && protectSingingVoice, durationSeconds, title:title.trim(),
          description:description.trim(), genre:genre.trim(), mood:mood.trim(),
          instruments:instruments.split(',').map(v => v.trim()).filter(Boolean).slice(0,12),
          language, vocalMode, lyrics:vocalMode === 'singing' ? lyrics : '' }),
      });
      setGenerationJob(result.jobId);
      setGenerationStatus(interfaceLanguage === 'es' ? 'Generación enviada. Revisá el estado abajo.' : 'Generation submitted. Check status below.');
    } catch (error) {
      setGenerationStatus(error instanceof Error ? error.message : 'Music generation failed');
    } finally { setGenerating(false); }
  }
  async function refreshGeneration() {
    if (!generationJob) return;
    try {
      const result = await customFetch<{status:string}>('/api/music/generation/' + encodeURIComponent(generationJob) + '/sync',
        {method:'POST',responseType:'json'});
      setGenerationStatus(result.status === 'COMPLETED'
        ? (interfaceLanguage === 'es' ? '¡Canción lista! Abrí Mi biblioteca para escucharla.' : 'Track ready! Open My library to listen.')
        : 'Estado: ' + result.status);
      if (result.status === 'COMPLETED') window.location.reload();
    } catch (error) { setGenerationStatus(error instanceof Error ? error.message : 'Could not update generation'); }
  }
  if (musicAccess === 'active' && playerOpen) return <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#100d12] px-6 pb-[calc(env(safe-area-inset-bottom,0px)+36px)] pt-[calc(env(safe-area-inset-top,0px)+22px)] text-white">
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {coverUrl && <div className="absolute -inset-16 bg-cover bg-center opacity-55 blur-[65px] scale-125" style={{ backgroundImage: `url("${coverUrl}")` }} />}
      <div className="absolute inset-0 bg-gradient-to-b from-[#100d12]/55 via-[#100d12]/75 to-[#100d12]/95" />
    </div>
    <header className="relative z-10 flex items-center justify-between">
      <button type="button" onClick={() => { audioRef.current?.pause(); setPlaying(false); setPlayerOpen(false); }} aria-label={t("Volver al estudio")} className="grid h-11 w-11 place-items-center"><ChevronDown className="h-7 w-7" /></button>
      <span className="text-center text-sm font-semibold">ECHO Music · {audioUrl ? t("Reproduciendo") : t("Preparada")}</span>
      <span className="w-11" />
    </header>
    <div className="relative z-10 mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-9 py-8">
      <div className="mx-auto flex aspect-square w-full max-w-[390px] items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-black/20 shadow-[0_25px_80px_rgba(0,0,0,0.55)]">
        {coverUrl ? <img src={coverUrl} alt={`${t("Portada de ")}${me.name}`} className="h-full w-full object-contain" /> : <Music2 className="h-24 w-24 text-white/60" />}
      </div>
      <div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-white/70">{me.name} · ECHO Music</p></div>
      {audioUrl && actualDuration > 0 && <section className="rounded-xl border border-white/20 bg-white/10 p-4 space-y-3">
        <p className="text-sm font-semibold">{t("Elegir fragmento para compartir")}</p>
        <div className="flex gap-2">{([15, 30] as const).map(seconds => <button key={seconds} type="button" onClick={() => { setClipLength(seconds); setClipStart(start => Math.min(start, Math.max(0, actualDuration - seconds))); }} className={`rounded-full px-4 py-2 text-sm ${clipLength === seconds ? 'bg-white text-black' : 'border border-white/30'}`}>{seconds} s</button>)}</div>
        <input type="range" aria-label={t("Inicio del fragmento")} min={0} max={Math.max(0, actualDuration - Math.min(clipLength, actualDuration))} step={1} value={clipStart} onChange={event => { const next = Number(event.target.value); setClipStart(next); if (audioRef.current) audioRef.current.currentTime = next; setElapsed(next); }} className="w-full accent-white" />
        <p className="text-xs text-white/70">{t("Fragmento: ")}{formatTime(clipStart)} – {formatTime(clipEnd)}. {t("Los fragmentos de canciones publicadas se pueden adjuntar desde Crear publicación o historia.")}</p>
        <button type="button" onClick={() => { if (audioRef.current) { audioRef.current.currentTime = clipStart; audioRef.current.dataset.clipPreview = 'true'; } setElapsed(clipStart); void audioRef.current?.play().catch(() => setPlaying(false)); }} className="rounded-lg border border-white/30 px-3 py-2 text-xs font-semibold">{t("Escuchar fragmento")}</button>
      </section>}
      <div>
        <input type="range" min={0} max={Math.max(actualDuration, 1)} step={0.1} value={Math.min(elapsed, Math.max(actualDuration, 1))} disabled={!audioUrl || !actualDuration} onChange={event => { const audio = audioRef.current; if (audio) { audio.currentTime = Number(event.target.value); setElapsed(audio.currentTime); } }} aria-label={t("Progreso de la canción")} className="w-full accent-white disabled:opacity-40" />
        <div className="mt-1 flex justify-between text-xs text-white/65"><span>{formatTime(elapsed)}</span><span>{audioUrl && actualDuration ? formatTime(actualDuration) : '--:--'}</span></div>
        <div className="mt-5 flex justify-center"><button type="button" disabled={!audioUrl} onClick={() => { const audio = audioRef.current; if (!audio) return; if (audio.paused) void audio.play().catch(() => setPlaying(false)); else audio.pause(); }} aria-label={playing ? t("Pausar") : t("Reproducir")} className="grid h-20 w-20 place-items-center rounded-full bg-white text-black disabled:opacity-40">{playing ? <Pause className="h-9 w-9 fill-current" /> : <Play className="ml-1 h-9 w-9 fill-current" />}</button></div>
      </div>
      {selectedAudioFile && !savedAudioPath && <button type="button" disabled={savingAudio} onClick={() => void saveCurrentAudio()} className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-black disabled:opacity-50">{savingAudio ? t("Guardando en almacenamiento privado…") : t("Guardar este audio en ECHO")}</button>}
      {savedAudioPath && <p className="text-center text-xs text-white/70">{t("Audio guardado en almacenamiento privado. Aparece en tu biblioteca de este dispositivo.")}</p>}
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/25 p-3 text-sm font-semibold"><Upload className="h-4 w-4" /> {t("Probar con un audio propio")}<input type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/webm" className="sr-only" onChange={event => { importAudio(event.target.files?.[0]); event.target.value = ''; }} /></label>
      {localAudioError && <p role="alert" className="text-sm text-red-200">{localAudioError}</p>}
      {audioUrl && !savedAudioPath && <p className="text-center text-xs text-white/60">{t("Audio local de prueba: no se guarda hasta que elijas guardarlo.")}</p>}
      {!audioUrl && <div className="rounded-xl border border-white/20 bg-white/10 p-4 text-center text-sm"><LockKeyhole className="mx-auto mb-2 h-5 w-5" />{t("Esto es una vista previa del prompt, no una canción generada. Volvé al estudio y tocá «Generar canción de prueba» para solicitar audio real mediante Mureka.")}</div>}
      <details className="rounded-xl bg-white/5 p-4 text-xs text-white/75"><summary className="cursor-pointer font-semibold">{t("Ver prompt preparado")}</summary><p className="mt-3 whitespace-pre-wrap">{preview}</p></details>
    </div>
    <audio ref={audioRef} src={audioUrl ?? undefined} preload="metadata" onLoadedMetadata={event => setActualDuration(event.currentTarget.duration)} onTimeUpdate={event => { const time = event.currentTarget.currentTime; setElapsed(time); if (event.currentTarget.dataset.clipPreview === 'true' && time >= clipEnd) { event.currentTarget.pause(); delete event.currentTarget.dataset.clipPreview; } }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
  </div>;
  if (musicAccess !== 'active') return <div>
    <TopBar title="ECHO Music" onBack={back} />
    <main className="mx-auto max-w-xl px-5 py-10">
      {musicAccess === 'loading' ? <p className="text-center text-muted-foreground">{interfaceLanguage === 'es' ? 'Comprobando tu suscripción…' : 'Checking your subscription…'}</p>
      : musicAccess === 'error' ? <div className="rounded-2xl border border-border p-6 text-center">
          <h2 className="text-lg font-bold">{interfaceLanguage === 'es' ? 'No pudimos comprobar tu acceso' : 'Could not verify your access'}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{interfaceLanguage === 'es' ? 'Probá nuevamente en unos minutos.' : 'Please try again shortly.'}</p>
          <button className="mt-4 rounded-xl bg-primary px-5 py-3 text-primary-foreground" onClick={() => window.location.reload()}>{interfaceLanguage === 'es' ? 'Reintentar' : 'Retry'}</button>
        </div>
      : <section className="rounded-3xl border border-border bg-card p-7 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"><Music2 className="h-8 w-8 text-primary" /></div>
          <h1 className="text-3xl font-bold tracking-tight">ECHO Music</h1>
          <p className="mt-3 text-muted-foreground">{interfaceLanguage === 'es'
            ? 'Convertí tus ideas en canciones originales con inteligencia artificial. Creá música para tus personajes, guardala en tu biblioteca y compartila en ECHO.'
            : 'Turn your ideas into original AI-generated songs. Create music for your characters, save it to your library and share it on ECHO.'}</p>
          <div className="mt-6 rounded-2xl bg-secondary/60 p-5 text-left text-sm">
            <p className="font-semibold">{interfaceLanguage === 'es' ? 'Incluye:' : 'Includes:'}</p>
            <ul className="mt-3 list-inside list-disc space-y-2 text-muted-foreground">
              <li>{interfaceLanguage === 'es' ? '10 canciones manuales por mes' : '10 manual songs per month'}</li>
              <li>{interfaceLanguage === 'es' ? '1 canción autónoma por mes' : '1 autonomous song per month'}</li>
              <li>{interfaceLanguage === 'es' ? 'Biblioteca privada y canciones compartidas' : 'Private library and shared songs'}</li>
              <li>{interfaceLanguage === 'es' ? 'Música en publicaciones, historias y chats' : 'Music in posts, stories and chats'}</li>
            </ul>
          </div>
          <p className="mt-6 text-3xl font-bold">US$9.99 <span className="text-sm font-normal text-muted-foreground">/ {interfaceLanguage === 'es' ? 'mes' : 'month'}</span></p>
          <button type="button" onClick={() => { window.location.href = '/settings/subscriptions'; }}
            className="mt-5 w-full rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground">
            {interfaceLanguage === 'es' ? 'Ver suscripción a ECHO Music' : 'View ECHO Music subscription'}
          </button>
          <p className="mt-3 text-xs text-muted-foreground">{interfaceLanguage === 'es'
            ? 'Los pagos de ECHO Music todavía no están habilitados. No se realizará ningún cobro.'
            : 'ECHO Music payments are not enabled yet. No charge will be made.'}</p>
        </section>}
    </main>
  </div>;
  return <div><TopBar title="ECHO Music Studio" onBack={back} /><main className="mx-auto max-w-2xl space-y-5 px-4 pb-20 pt-5">
    {paidTestEnabled && <section className="rounded-2xl border border-primary/40 bg-card p-4">
      <h2 className="text-base font-semibold">{interfaceLanguage === 'es' ? 'Prueba de generación Mureka' : 'Mureka generation test'}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{interfaceLanguage === 'es' ? 'Prueba única para la fundadora. Una solicitud paga, con confirmación antes de enviarla.' : 'One-time founder test. One paid request, with confirmation.'}</p>
      <button type="button" disabled={generating || !title.trim() || !description.trim()} onClick={() => void generatePaidTest()} className="mt-3 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {generating ? '…' : (interfaceLanguage === 'es' ? 'Generar canción de prueba' : 'Generate test track')}
      </button>
      {generationJob && <button type="button" onClick={() => void refreshGeneration()} className="ml-2 rounded-xl border border-border px-4 py-3 text-sm">{interfaceLanguage === 'es' ? 'Actualizar estado' : 'Refresh status'}</button>}
      {generationStatus && <p role="status" className="mt-2 text-sm">{generationStatus}</p>}
    </section>}
    <nav aria-label={t("Secciones de ECHO Music")} className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary/60 p-1">
      <button type="button" onClick={() => setStudioTab('create')} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold ${studioTab === 'create' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}><WandSparkles className="h-4 w-4" /> {t("Crear música")}</button>
      <button type="button" onClick={() => setStudioTab('library')} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold ${studioTab === 'library' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}><Library className="h-4 w-4" /> {t("Mi biblioteca")}</button>
    </nav>
    {studioTab === 'library' ? <section className="space-y-5">
      <div className="rounded-2xl border border-border bg-card/60 p-5">
        <div className="flex items-center gap-3"><Disc3 className="h-7 w-7 text-primary" /><div><h1 className="text-xl font-bold">{t("Mi biblioteca")}</h1><p className="text-xs text-muted-foreground">{library.filter(item => item.status === 'saved_audio').length} canciones guardadas · {library.filter(item => item.status === 'draft').length} borradores</p></div></div>
        <p className="mt-3 text-xs text-muted-foreground">{cloudLibraryAvailable ? t("Biblioteca conectada a tu cuenta de ECHO.") : t("Sincronización pendiente: también se muestran los registros locales.")}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setLibraryFilter('saved_audio')} className={`rounded-xl px-3 py-3 text-sm font-semibold ${libraryFilter === 'saved_audio' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>{t("Canciones guardadas")}</button>
        <button type="button" onClick={() => setLibraryFilter('draft')} className={`rounded-xl px-3 py-3 text-sm font-semibold ${libraryFilter === 'draft' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>{t("Borradores")}</button>
      </div>
      {libraryError && <p role="alert" className="text-sm text-destructive">{libraryError}</p>}
      {filteredLibrary.length === 0 ? <div className="rounded-2xl border border-dashed border-border p-8 text-center"><Music2 className="mx-auto h-10 w-10 text-muted-foreground" /><p className="mt-3 font-semibold">{libraryFilter === 'saved_audio' ? t("Todavía no guardaste canciones") : t("Todavía no tenés borradores")}</p><p className="mt-2 text-sm text-muted-foreground">{libraryFilter === 'saved_audio' ? t("Probá con un audio propio y guardalo en ECHO.") : t("Prepará una canción con un prompt para verla acá.")}</p><button type="button" onClick={() => setStudioTab('create')} className="mt-4 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">{t("Ir al estudio")}</button></div> : <div className="space-y-3">{filteredLibrary.map(item => <article key={item.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card/60 p-3">
        <button type="button" onClick={() => openLibraryItem(item)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-secondary">{coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-contain" /> : <Music2 className="h-7 w-7 text-primary" />}</div>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.status === 'saved_audio' ? t("Audio guardado") : t("Prompt preparado")} · {formatTime(item.durationSeconds)}</p><p className="mt-1 text-xs text-primary">{item.status === 'saved_audio' ? t("Escuchar canción") : t("Ver borrador")}</p></div>
        </button>
        {item.status === 'saved_audio' && item.audioPath?.startsWith('generated/') && <button type="button" onClick={() => { setVoiceSource(item); setVoiceStart(0); setVoiceLength(Math.min(20,item.durationSeconds)); setVoiceCloneConsent(false);setVoiceCloneQuote(''); }} className="rounded-lg border border-border px-2 py-2 text-xs font-semibold">{t("Guardar voz")}</button>}
        {item.status === 'saved_audio' && item.audioPath?.startsWith('generated/') && <button type="button" disabled={!!downloadingId} onClick={() => void downloadLibraryTrack(item)} className="flex items-center gap-1 rounded-lg border border-border px-2 py-2 text-xs font-semibold" aria-label={t("Descargar") + ' ' + item.title}><Download className="h-4 w-4" />{downloadingId === item.id ? t("Descargando…") : t("Descargar")}</button>}
        {item.status === 'saved_audio' && <button type="button" disabled={!!publishingId} onClick={() => void togglePublish(item)} className="rounded-lg border border-border px-2 py-2 text-xs font-semibold">{publishingId === item.id ? '…' : item.publishedAt ? t("Dejar privado") : t("Compartir")}</button>}
        {!item.audioPath?.startsWith('generated/') && <button type="button" onClick={() => deleteDraft(item.id)} aria-label={`Eliminar ${item.title} de la biblioteca`} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary"><Trash2 className="h-4 w-4" /></button>}
      </article>)}</div>}
      <section className="space-y-3 rounded-2xl border border-border bg-card/60 p-4"><h2 className="text-base font-semibold">{t("Canciones compartidas en ECHO")}</h2><p className="text-xs text-muted-foreground">{t("Solo se escuchan las canciones que sus propietarios publicaron expresamente.")}</p>{publishedTracks.length === 0 ? <p className="text-sm text-muted-foreground">{t("Todavía no hay canciones compartidas.")}</p> : publishedTracks.map(item => <button key={item.id} type="button" disabled={!!loadingSharedId} onClick={() => void playSharedTrack(item)} className="flex w-full items-center gap-3 rounded-xl bg-secondary p-3 text-left"><Play className="h-5 w-5 text-primary"/><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span><span className="text-xs text-muted-foreground">{loadingSharedId === item.id ? t("Cargando…") : formatTime(item.durationSeconds)}</span></button>)}</section>
      <p className="text-xs text-muted-foreground">{t("Eliminar un registro no borra todavía el archivo privado del almacenamiento.")}</p>
    </section> : <>
    <div className="rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex items-center gap-2 text-lg font-semibold"><Music2 className="h-5 w-5 text-primary" /> Create your sound</div>
      <p className="mt-2 text-xs text-muted-foreground">{t("Configurá una canción original para ECHO Music. La vista previa prepara tu solicitud sin generar audio ni consumir créditos.")}</p>
    </div>
    <div className="rounded-2xl border border-border bg-card/60 p-4 text-xs text-muted-foreground" data-testid="echo-music-allowances"><p className="font-semibold text-foreground">{t("ECHO Music · plan previsto")}</p><p className="mt-1">{t("USD 9.99/mes · 10 canciones manuales + 1 canción espontánea de tus personajes al mes.")}</p><p className="mt-2">{t("Los personajes podrán componer según sus conversaciones y relaciones, con límite de una generación autónoma cada 7 días y saldo independiente. Las canciones guardadas se podrán reutilizar sin pagar otra generación.")}</p><p className="mt-2">{t("La generación automática y las compras aún no están activadas. Este estudio sigue preparando borradores sin cargos.")}</p></div>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); prepare(); }}>
      <label className="block space-y-1 text-sm font-medium">{t("Título")}<input className={field} value={title} maxLength={120} required onChange={e=>setTitle(e.target.value)} placeholder={t("Nombre de tu canción")} /></label>
      <label className="block space-y-1 text-sm font-medium">{t("Describí tu canción")}<textarea className={field} value={description} maxLength={2000} required minLength={3} rows={4} onChange={e=>setDescription(e.target.value)} placeholder={t("Una canción de rock alternativo con batería potente...")} /></label>
      <div className="grid grid-cols-2 gap-3"><label className="block space-y-1 text-sm">{t("Género")}<input className={field} value={genre} maxLength={100} onChange={e=>setGenre(e.target.value)} placeholder="Rock, pop..." /></label><label className="block space-y-1 text-sm">{t("Ambiente")}<input className={field} value={mood} maxLength={100} onChange={e=>setMood(e.target.value)} placeholder={t("Oscuro, alegre...")} /></label></div>
      <label className="block space-y-1 text-sm font-medium">{t("Instrumentos (separados por comas)")}<input className={field} value={instruments} onChange={e => setInstruments(e.target.value.slice(0, 400))} placeholder={t("Batería, bajo, guitarra eléctrica")} /></label>
      <label className="block space-y-1 text-sm font-medium">{t("Idioma de la voz")}<select className={field} value={language} onChange={e => setLanguage(e.target.value)}><option value="en">{t("Inglés")}</option><option value="es">{t("Español")}</option><option value="ko">{t("Coreano")}</option><option value="pt">{t("Portugués")}</option><option value="ja">{t("Japonés")}</option><option value="fr">{t("Francés")}</option><option value="de">{t("Alemán")}</option></select></label>
      <label className="block space-y-1 text-sm font-medium">{t("Duración estimada")}<select className={field} value={durationSeconds} onChange={e => setDurationSeconds(Number(e.target.value))}>{[30,60,120,180,240,300].map(seconds => <option key={seconds} value={seconds}>{seconds < 60 ? `${seconds}${t(" segundos")}` : `${seconds/60}${t(seconds===60 ? " minuto" : " minutos")}`}</option>)}</select></label>
      <fieldset className="space-y-2"><legend className="text-sm font-medium">{t("Tipo de canción")}</legend><div className="flex gap-3">{(['instrumental','singing'] as const).map(mode=><label key={mode} className="flex items-center gap-2 text-sm"><input type="radio" checked={vocalMode===mode} onChange={()=>setVocalMode(mode)} />{mode==='instrumental'?t('Instrumental'):t('Con voz')}</label>)}</div></fieldset>
      {vocalMode==='singing' && <div className="rounded-xl border border-border p-3 space-y-2 text-sm">
        <p className="font-semibold">{t("Identidad vocal")}</p>
        <p className="text-xs text-muted-foreground">{t(voiceConsistency==='both_configured_unverified'?'Voz hablada y cantada configuradas; timbre aún sin verificar':voiceConsistency==='speech_only'?'Voz hablada configurada; falta vincular la cantada':voiceConsistency==='singing_only'?'Voz cantada configurada; falta configurar la hablada':'Sin identidad vocal configurada')}</p>
        <p className="font-semibold">{singingVoiceId ? t("Voz cantada vinculada") : t("Sin voz cantada configurada")}</p>
        {singingVoiceId&&<button type="button" disabled={voiceLinkBusy} className="text-xs underline text-muted-foreground" onClick={()=>void unlinkSingingVoice()}>{interfaceLanguage==='es'?'Desvincular voz cantada':'Unlink singing voice'}</button>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={protectSingingVoice} onChange={event => setProtectSingingVoice(event.target.checked)}/>{t("Proteger identidad vocal")}</label>
        <p className="text-xs text-muted-foreground">{t("Evita generar canciones cantadas con una voz diferente a la del personaje.")}</p>
        <p className="text-xs font-semibold">{t("Elegí cómo preparar la voz permanente")}</p>
        <details className="rounded-lg border border-border p-2">
          <summary className="cursor-pointer text-xs font-semibold">{t("Subir muestra vocal")}</summary>
          <p className="mt-2 text-xs font-semibold">{t("Desde un archivo de audio")}</p>
          <p className="mt-2 text-xs text-muted-foreground">{t("Seleccioná un MP3 o M4A de menos de 10 MB y entre 15 y 30 segundos.")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("El audio debe ser tuyo o contar con autorización para usar esa voz.")}</p>
          <input type="file" accept=".mp3,.m4a,audio/mpeg,audio/mp4" className="mt-2 block w-full text-xs" onChange={event => {void prepareVocalSample(event.target.files?.[0]);}} />
          {voiceSampleError && <p role="alert" className="mt-2 text-xs text-destructive">{voiceSampleError}</p>}
          {voiceSample && <div className="mt-2 space-y-1 text-xs"><p className="font-semibold">{t("Muestra vocal lista")}: {voiceSample.name} ({Math.round(voiceSample.duration)}s)</p><p className="text-muted-foreground">{t("La muestra está preparada. La clonación no se ejecutará sin confirmar el costo.")}</p></div>}
          <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" checked={voiceCloneConsent} onChange={event => {setVoiceCloneConsent(event.target.checked);setVoiceCloneQuote('');}}/>{t("Confirmo que tengo permiso para utilizar esta voz y crear una identidad vocal reutilizable")}</label>
          <button type="button" disabled={!voiceSample || !voiceCloneConsent || voiceCloneQuoteBusy} onClick={() => void previewVoiceClone('upload')} className="mt-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{voiceCloneQuoteBusy ? '…' : t("Consultar costo sin generar")}</button>
          {voiceCloneQuote && <p role="status" className="mt-2 text-xs text-primary">{voiceCloneQuote}</p>}
          <button type="button" disabled={!voiceSample || !voiceCloneConsent || voiceSampleUploadBusy} onClick={() => void stageVocalSample()} className="mt-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{voiceSampleUploadBusy ? '…' : t("Guardar muestra privada (sin generar)")}</button>
          {voiceSampleStorageKey && <p role="status" className="mt-2 text-xs text-primary">{t("Muestra guardada de forma privada. La clonación todavía no se ejecutó.")}</p>
          {voiceSampleStorageKey && <button type="button" disabled={voiceSamplePreflightBusy || !voiceCloneConsent} onClick={() => void verifyStoredVocalSample()} className="mt-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{voiceSamplePreflightBusy ? '…' : t("Verificar muestra privada")}</button>}
          {voiceSamplePreflightStatus && <p role="status" className="mt-2 text-xs text-primary">{voiceSamplePreflightStatus}</p>
          {voiceSampleStorageKey && <button type="button" disabled={separationBusy || !voiceCloneConsent} onClick={()=>void prepareVocalSeparationJob()} className="mt-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{separationBusy?'…':t("Preparar separación vocal (sin cargo)")}</button>}
          {separationJobId && !/processing|completed|submitting|uncertain/i.test(separationStatus) && <button type="button" disabled={separationBusy} onClick={()=>void confirmVocalSeparation()} className="mt-2 ml-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{t("Autorizar separación vocal (cargo adicional)")}</button>}
          {separationJobId && <button type="button" disabled={separationBusy} onClick={()=>void syncVocalSeparationResult()} className="mt-2 ml-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{t("Recuperar voz aislada")}</button>}
          {separationStatus && <p role="status" className="mt-2 text-xs text-primary">{separationStatus}</p>}
          {voiceSampleStorageKey && <button type="button" disabled={voiceCloneJobBusy || !voiceCloneConsent} onClick={() => void prepareVoiceCloneJob()} className="mt-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{voiceCloneJobBusy?'…':t("Preparar clonación (sin cargo)")}</button>}
          {voiceCloneJobId && <button type="button" disabled={voiceCloneJobBusy} onClick={() => void refreshVoiceCloneJob()} className="mt-2 ml-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{t("Consultar estado")}</button>}
          {voiceCloneJobId && !/processing|completed|submitting|uncertain/i.test(voiceCloneJobStatus) && <button type="button" disabled={voiceCloneJobBusy || !voiceCloneConsent} onClick={() => void confirmVoiceCloneCharge()} className="mt-2 ml-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{t("Confirmar clonación (aprox. USD 5)")}</button>}
          {voiceCloneJobId && <button type="button" disabled={voiceCloneJobBusy} onClick={() => void syncVoiceCloneResult()} className="mt-2 ml-2 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{t("Sincronizar resultado")}</button>
          {voiceCloneJobStatus && <p role="status" className="mt-2 text-xs text-primary">{voiceCloneJobStatus}</p>}
          {voiceSampleUploadError && <p role="alert" className="mt-2 text-xs text-destructive">{voiceSampleUploadError}</p>
        </details>
        <p className="text-xs text-muted-foreground">{t("Desde una canción de mi biblioteca")}: {t("Mi biblioteca")} → {t("Guardar voz")}</p>
        <details className="rounded-lg border border-border p-2">
          <summary className="cursor-pointer text-xs font-semibold">{t("Vincular voz existente")}</summary>
          <p className="mt-2 text-xs text-muted-foreground">{t("Solo ingresá un ID de voz de Mureka que hayas creado y tengas derecho a utilizar. Esto no clona voces ni consume créditos.")}</p>
          <input className={field} aria-label={t("ID de voz de Mureka")} placeholder={t("ID de voz de Mureka")} value={voiceLinkId} onChange={event=>setVoiceLinkId(event.target.value)} maxLength={128}/>
          <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={voiceLinkConsent} onChange={event=>setVoiceLinkConsent(event.target.checked)}/>{t("Confirmo que tengo permiso para utilizar esta voz")}</label>
          {voiceLinkError && <p role="alert" className="text-xs text-destructive">{voiceLinkError}</p>}
          <button type="button" className="mt-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50" disabled={!voiceLinkConsent || !/^[a-zA-Z0-9_-]{1,128}$/.test(voiceLinkId) || voiceLinkBusy} onClick={()=>void linkExistingSingingVoice()}>{t("Guardar vínculo")}</button>
        </details>
      </div>}
      {vocalMode==='singing' && <label className="block space-y-1 text-sm">{t("Letra original")}<textarea className={field} value={lyrics} maxLength={5000} rows={5} onChange={e=>setLyrics(e.target.value)} placeholder={t("Escribí tu letra acá...")} /></label>}
      <button type="submit" disabled={preparing} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground"><WandSparkles className="h-4 w-4"/> {preparing ? t("Preparando…") : t("Preparar canción · gratis")}</button>
    </form>
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-card/60 p-3 text-sm font-semibold"><Upload className="h-4 w-4" /> {t("Probar reproductor con audio propio")}<input type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/webm" className="sr-only" onChange={event => { importAudio(event.target.files?.[0]); event.target.value = ''; }} /></label>
    {localAudioError && <p role="alert" className="text-sm text-destructive">{localAudioError}</p>}
    {prepareError && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{prepareError}</p>}
    {preview && <section className="rounded-2xl border border-border bg-card/60 p-4" aria-live="polite"><h2 className="text-sm font-semibold">Solicitud preparada · {title} · {durationSeconds}s</h2><pre className="mt-3 whitespace-pre-wrap break-words font-sans text-xs text-muted-foreground">{preview}</pre><p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="h-4 w-4"/> {t("Generación no activada. Sin cargos.")}</p></section>}
    <section className="hidden rounded-2xl border border-border bg-card/60 p-4"><h2 className="text-sm font-semibold">{t("Mi biblioteca · borradores")}</h2><p className="mt-1 text-xs text-muted-foreground">Los audios se guardan en almacenamiento privado. {cloudLibraryAvailable ? t("Biblioteca conectada a tu cuenta.") : t("Biblioteca local; sincronización en la nube pendiente.")}</p>
      {libraryError && <p role="alert" className="mt-2 text-xs text-destructive">{libraryError}</p>}
      {library.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">{t("Todavía no preparaste canciones.")}</p> : <div className="mt-3 space-y-2">{library.map(item => <div key={item.id} className="flex items-center gap-2 rounded-xl border border-border p-3"><Music2 className="h-4 w-4 shrink-0 text-primary"/><button type="button" onClick={() => { setTitle(item.title); setPreview(item.prompt); setDurationSeconds(item.durationSeconds); setSavedAudioPath(item.audioPath ?? null); setLocalAudioUrl(null); setSelectedAudioFile(null); setElapsed(0); setActualDuration(0); setPlayerOpen(true); }} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{item.title}</span><span className="text-xs text-muted-foreground">{item.status === 'saved_audio' ? t("Audio privado guardado") : t("Borrador")} · {item.durationSeconds}s</span></button><button type="button" onClick={() => deleteDraft(item.id)} className="text-xs text-muted-foreground underline">{t("Eliminar")}</button></div>)}</div>}
    </section>
    <div className="rounded-2xl border border-border bg-card/60 p-4"><h2 className="text-sm font-semibold">{t("Música para historias y publicaciones")}</h2><p className="mt-2 text-xs text-muted-foreground">{t("Feed.fm Clips: integración preparada, sin activar ni contratar. La reproducción de fragmentos de 15 o 30 segundos se habilitará únicamente después de confirmar el contrato, los derechos para Argentina y el acceso oficial al catálogo. YouTube: búsqueda disponible, sin derechos de reproducción de audio sobre fotos.")}</p></div>
    </>}
    {voiceSource && <section className="rounded-2xl border border-primary/40 bg-card p-4 space-y-3" aria-label={t("Preparar voz de Nela")}>
      <h2 className="text-base font-semibold">{t("Preparar voz de Nela")} · {voiceSource.title}</h2>
      <p className="text-sm text-muted-foreground">{t("Elegí 15 a 30 segundos donde se escuche claramente la cantante.")}</p>
      <div className="flex gap-2">{[15,20,30].map(seconds => <button key={seconds} type="button" onClick={() => { setVoiceLength(seconds); setVoiceStart(Math.min(voiceStart, Math.max(0,voiceSource.durationSeconds-seconds))); }} className={`rounded-lg px-3 py-2 text-sm ${voiceLength === seconds ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>{seconds}s</button>)}</div>
      <input aria-label={t("Inicio del fragmento")} className="w-full" type="range" min={0} max={Math.max(0,voiceSource.durationSeconds-voiceLength)} step={1} value={voiceStart} onChange={event => setVoiceStart(Number(event.target.value))}/>
      <p className="text-sm">{formatTime(voiceStart)} – {formatTime(voiceStart+voiceLength)}</p>
      <p className="text-xs text-muted-foreground">{t("Crear la voz clonada cuesta aproximadamente USD 5 en fal.ai. Esta pantalla no realiza el cargo ni crea el clon.")}</p>
      <p className="text-xs text-muted-foreground">{t("La canción debe contener una voz clara y autorizada; el fragmento todavía no se extrae ni se envía al proveedor.")}</p>
      <p className="text-xs text-primary">{t("Referencia seleccionada. La creación de la voz requiere un paso de clonación confirmado.")}</p>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={voiceCloneConsent} onChange={event => {setVoiceCloneConsent(event.target.checked);setVoiceCloneQuote('');}}/>{t("Confirmo que tengo permiso para utilizar esta voz y crear una identidad vocal reutilizable")}</label>
      <button type="button" disabled={!voiceCloneConsent || voiceCloneQuoteBusy || voiceSource.durationSeconds < 15} onClick={() => void previewVoiceClone('library')} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{voiceCloneQuoteBusy ? '…' : t("Consultar costo sin generar")}</button>
      <p className="text-xs text-muted-foreground">{t("Este recorte conserva los instrumentos: elegí una sección donde predomine la voz. Para una clonación fiel todavía hace falta separar la pista vocal.")}</p>
      <button type="button" disabled={libraryClipBusy || !voiceCloneConsent || voiceSource.durationSeconds<15} onClick={()=>void prepareLibraryClip()} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-50">{libraryClipBusy?'…':t("Extraer fragmento local de 15–30 s")}</button>
      {libraryClipStatus && <p role="status" className="text-xs text-primary">{libraryClipStatus}</p>}
      {voiceCloneQuote && <p role="status" className="text-xs text-primary">{voiceCloneQuote}</p>}
      <button type="button" onClick={() => setVoiceSource(null)} className="rounded-xl border border-border px-4 py-2 text-sm">{t("Cerrar")}</button>
    </section>}
  </main></div>;
}
