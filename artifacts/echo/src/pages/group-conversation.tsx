import { GroupCanonReview } from '@/components/echo/group-canon-review';
import { FormattingToolbar } from '@/components/echo/formatting-toolbar';
import { SocialText } from '@/components/echo/social-text';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLanguage } from '@/lib/i18n';
const groupLabels: Record<string, Record<string,string>> = {"en":{"Salir del grupo":"Leave group","Eliminar grupo definitivamente":"Permanently delete group","Salir del modo espectadora":"Exit spectator mode","Estás viendo este grupo como espectadora. No sos participante.":"You're viewing this group as a spectator. You're not a participant."},"pt":{"Salir del grupo":"Sair do grupo","Eliminar grupo definitivamente":"Excluir grupo permanentemente","Salir del modo espectadora":"Sair do modo espectador","Estás viendo este grupo como espectadora. No sos participante.":"Você está vendo este grupo como espectadora. Não é participante."},"fr":{"Salir del grupo":"Quitter le groupe","Eliminar grupo definitivamente":"Supprimer définitivement le groupe","Salir del modo espectadora":"Quitter le mode spectateur","Estás viendo este grupo como espectadora. No sos participante.":"Vous regardez ce groupe en spectatrice. Vous ne participez pas."},"de":{"Salir del grupo":"Gruppe verlassen","Eliminar grupo definitivamente":"Gruppe endgültig löschen","Salir del modo espectadora":"Zuschauermodus verlassen","Estás viendo este grupo como espectadora. No sos participante.":"Du siehst diese Gruppe als Zuschauerin und bist kein Mitglied."},"it":{"Salir del grupo":"Esci dal gruppo","Eliminar grupo definitivamente":"Elimina definitivamente il gruppo","Salir del modo espectadora":"Esci dalla modalità spettatore","Estás viendo este grupo como espectadora. No sos participante.":"Stai osservando questo gruppo senza partecipare."},"ko":{"Salir del grupo":"그룹 나가기","Eliminar grupo definitivamente":"그룹 영구 삭제","Salir del modo espectadora":"관전자 모드 나가기","Estás viendo este grupo como espectadora. No sos participante.":"이 그룹을 관전 중이며 참여자가 아닙니다."},"ja":{"Salir del grupo":"グループを退出","Eliminar grupo definitivamente":"グループを完全に削除","Salir del modo espectadora":"観戦モードを終了","Estás viendo este grupo como espectadora. No sos participante.":"このグループを観覧中です。参加者ではありません。"},"zh":{"Salir del grupo":"退出群组","Eliminar grupo definitivamente":"永久删除群组","Salir del modo espectadora":"退出旁观模式","Estás viendo este grupo como espectadora. No sos participante.":"你正在旁观此群组，并非参与者。"}};
import { useLocation, useParams } from 'wouter';
import { ChevronLeft, Send, Users, MoreHorizontal, Search, Pin, Plus, X, Mic, Square, Copy, Check, Trash2 } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { getActiveUniverseId } from '@/store/persistence';
import { useSocial } from '@/store/social-store';
import { useUser } from '@clerk/react';
import { CharacterAvatar } from '@/components/echo/avatar';
import { AttachmentView } from '@/components/echo/dm-attachment-view';
import { MusicLibraryPicker } from '@/components/echo/music-library-picker';
import { SharedMusicPlayer } from '@/components/echo/shared-music-player';
import { uploadAttachment, validateAttachments, formatDuration } from '@/lib/dm-attachments';
import { useVoiceRecorder } from '@/lib/use-voice-recorder';
import { uploadPrivateFile, useMediaResolver } from '@/lib/media';
import type { MessageAttachment } from '@/domain/types';

type Group = { id: string; name: string; avatar?: string | null; wallpaperUrl?: string | null; createdBy: string; participantIds: string[] };
type MusicAttachment = { id: string; type: 'music'; trackId: string; title: string; durationSeconds: number };
type GroupMessage = { id: string; senderId: string; text: string; attachments?: Array<MessageAttachment | MusicAttachment>; createdAt: string; pinnedAt?: string | null; pinnedBy?: string | null };

function PendingGroupFile({file, onRemove, disabled}: {file: File; onRemove: () => void; disabled: boolean}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!file.type.startsWith('image/')) return;
    const preview = URL.createObjectURL(file);
    setUrl(preview);
    return () => URL.revokeObjectURL(preview);
  }, [file]);
  return <div className="relative shrink-0 rounded-xl border border-white/20 p-1">
    {url ? <img src={url} alt={file.name} className="h-20 w-20 rounded-lg object-cover" /> : <span className="block max-w-28 truncate p-2 text-xs">{file.name}</span>}
    <button type="button" disabled={disabled} onClick={onRemove} aria-label="Quitar archivo" className="absolute right-0 top-0 rounded-full bg-background p-1"><X className="h-4 w-4"/></button>
  </div>;
}

export default function GroupConversationPage() {
  const language = useLanguage();
  const gl = (label:string) => language === 'es' ? label : (groupLabels[language]?.[label] ?? groupLabels.en[label] ?? label);
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const { me, character, state } = useSocial();
  const resolveMedia = useMediaResolver();
  const [, navigate] = useLocation();
  const [group, setGroup] = useState<Group | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [text, setText] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [showMusicLibrary, setShowMusicLibrary] = useState(false);
  const [toolsOpen,setToolsOpen] = useState(false);
  const [wallpaperOpen,setWallpaperOpen] = useState(false);
  const [eventsOpen,setEventsOpen] = useState(false);
  const cameraRef=useRef<HTMLInputElement>(null);
  const [wallpaper,setWallpaper] = useState('');
  const wallpaperKey=user?.id&&id?`echo:group-wallpaper:${user.id}:${getActiveUniverseId(user.id)}:${id}`:'';
  // Keep the wallpaper independent of the currently selected identity. Recover the
  // previous per-identity key without deleting it, so existing choices survive upgrades.
  useEffect(()=>{
    if(!wallpaperKey){setWallpaper('');return;}
    try {
      let saved=localStorage.getItem(wallpaperKey)??'';
      if(!saved){
        const prefix=`echo:group-wallpaper:${user!.id}:${getActiveUniverseId(user!.id)}:`;
        const suffix=`:${id}`;
        const previousKey=Array.from({length:localStorage.length},(_,index)=>localStorage.key(index))
          .find(key=>key?.startsWith(prefix)&&key.endsWith(suffix)&&key!==wallpaperKey);
        if(previousKey){saved=localStorage.getItem(previousKey)??'';if(saved)localStorage.setItem(wallpaperKey,saved);}
      }
      setWallpaper(saved);
    }catch{setWallpaper('');}
  },[wallpaperKey,id,user?.id]);
  const [wallpaperUploading,setWallpaperUploading] = useState(false);
  const changeWallpaper=async (file?:File)=>{
    if(!wallpaperKey)return;
    if(!file){try{await customFetch(`/api/group-dms/${encodeURIComponent(id!)}/wallpaper`,{method:"PUT",body:JSON.stringify({universeId:getActiveUniverseId(user!.id),actorId:me.id,wallpaperUrl:null}),headers:{"Content-Type":"application/json"},responseType:"json"});localStorage.removeItem(wallpaperKey);setWallpaper("");setError("");}catch{setError("No se pudo quitar el fondo en todos los dispositivos.");}return;}
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10_000_000){setError('Elegí una imagen JPG, PNG o WebP de hasta 10 MB.');return;}
    setWallpaperUploading(true);
    try {
      const uploaded=await uploadPrivateFile(file);
      await customFetch(`/api/group-dms/${encodeURIComponent(id!)}/wallpaper`,{method:"PUT",body:JSON.stringify({universeId:getActiveUniverseId(user!.id),actorId:me.id,wallpaperUrl:uploaded.url}),headers:{"Content-Type":"application/json"},responseType:"json"});
      localStorage.setItem(wallpaperKey,uploaded.url);
      setWallpaper(uploaded.url);
      setError('');
    } catch {setError('No se pudo subir el fondo. Intentá nuevamente.');}
    finally {setWallpaperUploading(false);}
  };
  const [musicDraftStatus, setMusicDraftStatus] = useState('');
  const [savingMusicDraft, setSavingMusicDraft] = useState(false);
  const [savingTrackId, setSavingTrackId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GroupMessage[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarFileRef = useRef<HTMLInputElement>(null);
  const recorder = useVoiceRecorder((blob, seconds) => {
    const file = new File([blob], `nota-de-voz-${Date.now()}.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`, { type: blob.type });
    try { validateAttachments([file], pendingFiles.length); setPendingFiles(old => [...old, file]); setError(''); }
    catch (err) { setError((err as Error).message); }
  }, setError);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [addMemberIds, setAddMemberIds] = useState<string[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sceneContext, setSceneContext] = useState('');
  const [firstSpeakerId, setFirstSpeakerId] = useState('');
  const [sceneTurnMode, setSceneTurnMode] = useState<'automatic' | 'round_robin' | 'manual'>('automatic');
  const [sceneResponseSpeed, setSceneResponseSpeed] = useState<'immediate' | 'normal' | 'slow'>('normal');
  const [sceneObserverEnabled, setSceneObserverEnabled] = useState(false);
  const isGroupMember = group?.participantIds.includes(me.id) ?? false;
  const observerProfileId = state.primaryCharacterId ?? group?.createdBy;
  const isWatchingScene = sceneObserverEnabled && (!isGroupMember || me.id === observerProfileId);
  const canWriteToGroup = isGroupMember && !isWatchingScene;
  const [sceneLoaded, setSceneLoaded] = useState(false);
  const [sceneSaving, setSceneSaving] = useState(false);
  const [sceneRunning, setSceneRunning] = useState(false);
  const stopSceneRef = useRef(false);
  const [autonomyEnabled, setAutonomyEnabled] = useState(false);
  const [autonomyInterval, setAutonomyInterval] = useState(60);
  const [autonomyLoaded, setAutonomyLoaded] = useState(false);
  const [muted, setMuted] = useState(false);
  const [archived, setArchived] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages.length]);
  const scope = new URLSearchParams({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id });
  useEffect(() => {
    if (!user?.id || !id) return;
    let active = true;
    const load = async () => {
      try {
        // Group metadata and messages must load independently: a temporary failure
        // in one endpoint must not blank the whole conversation.
        const [groupResult, threadResult] = await Promise.allSettled([
          customFetch<{ groups: Group[] }>(`/api/group-dms?${scope}`, { method: 'GET', responseType: 'json', cache: 'no-store' }),
          customFetch<{ messages: GroupMessage[] }>(`/api/group-dms/${encodeURIComponent(id)}/messages?${scope}`, { method: 'GET', responseType: 'json', cache: 'no-store' }),
        ]);
        if (!active) return;
        if (groupResult.status === 'fulfilled') {
          const found = groupResult.value.groups.find(g => g.id === id);
          if (found) {
              setGroup(found);
              if (found.wallpaperUrl) setWallpaper(found.wallpaperUrl);
              else if (wallpaperKey) {
                // Migrate the old device-local wallpaper once to shared group storage.
                const local = localStorage.getItem(wallpaperKey);
                if (local && /^https:\/\//.test(local)) {
                  void customFetch(`/api/group-dms/${encodeURIComponent(id)}/wallpaper`, {
                    method: "PUT", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ universeId: getActiveUniverseId(user.id), actorId: me.id, wallpaperUrl: local }),
                    responseType: "json",
                  }).catch(() => {});
                }
              }
            }
        }
        if (threadResult.status === 'fulfilled') { setMessages(threadResult.value.messages); void customFetch(`/api/group-dms/${encodeURIComponent(id)}/read`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({universeId:getActiveUniverseId(user.id),actorId:me.id}),responseType:"json"}).catch(()=>{}); }
        setError(groupResult.status === 'rejected' && threadResult.status === 'rejected'
          ? 'No se pudo conectar con el grupo. Reintentando automáticamente…'
          : threadResult.status === 'rejected' ? 'No se pudieron actualizar los mensajes. Reintentando…'
          : groupResult.status === 'rejected' ? 'No se pudieron actualizar los datos del grupo. Reintentando…' : '');
      } catch { if (active) setError('No se pudo cargar el grupo. Reintentando…'); }
    };
    void load();
    const interval = window.setInterval(() => void load(), 10000);
    return () => { active = false; window.clearInterval(interval); };
  }, [id, user?.id, me.id]);
  useEffect(() => {
    if (!id || !user?.id) return;
    let active = true;
    setAutonomyLoaded(false);
    setPreferencesLoaded(false);
    setSceneLoaded(false);
    void customFetch<{ context: string; turnMode: 'automatic' | 'round_robin' | 'manual'; responseSpeed: 'immediate' | 'normal' | 'slow'; observerEnabled: boolean }>(`/api/group-dms/${encodeURIComponent(id)}/scene?${scope}`, { method: 'GET', responseType: 'json' })
      .then(value => { if (active) { setSceneContext(value.context); setSceneTurnMode(value.turnMode); setSceneResponseSpeed(value.responseSpeed); setSceneObserverEnabled(value.observerEnabled); setSceneLoaded(true); } })
      .catch(() => { if (active) setError('No se pudo cargar el contexto de la escena.'); });

    void customFetch<{ muted: boolean; archived: boolean }>(`/api/group-dms/${encodeURIComponent(id)}/preferences?${scope}`, { method: 'GET', responseType: 'json' })
      .then(value => { if (active) { setMuted(value.muted); setArchived(value.archived); setPreferencesLoaded(true); } })
      .catch(() => { if (active) setError('No se pudieron cargar las preferencias del grupo.'); });
    void customFetch<{ enabled: boolean; intervalMinutes: number }>(`/api/group-dms/${encodeURIComponent(id)}/autonomy?${scope}`, { method: 'GET', responseType: 'json' })
      .then(result => { if (active) { setAutonomyEnabled(result.enabled); setAutonomyInterval(result.intervalMinutes); setAutonomyLoaded(true); } })
      .catch(() => { if (active) { setAutonomyLoaded(false); setError('No se pudo cargar la configuración de autonomía.'); } });
    return () => { active = false; };
  }, [id, user?.id, me.id]);
  const [sceneStatus, setSceneStatus] = useState('');
  const advanceScene = async (count: number, preferredSpeakerOverride?: string) => {
    if (!id || sceneRunning) return;
    stopSceneRef.current = false;
    setSceneRunning(true);
    setSceneStatus(preferredSpeakerOverride ? `Generando mensaje de ${character(preferredSpeakerOverride)?.name ?? 'personaje'}…` : 'Generando siguiente turno…');
    setError('');
    try {
      for (let turn = 0; turn < count && !stopSceneRef.current; turn++) {
        const result = await customFetch<{ status: string; reason?: string }>(`/api/group-dms/${encodeURIComponent(id)}/scene/next`, {
          method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, ...(turn === 0 && (preferredSpeakerOverride || firstSpeakerId) ? { preferredSpeakerId: preferredSpeakerOverride || firstSpeakerId } : {}) }),
        });
        if (result.status !== 'sent') {
          if (turn === 0) setError(`No se generó el turno (${result.status}): ${result.reason ?? 'el servidor no indicó el motivo'}`);
          break;
        }
        const refreshed = await customFetch<{ messages: GroupMessage[] }>(`/api/group-dms/${encodeURIComponent(id)}/messages?${scope}`, { method: 'GET', responseType: 'json', cache: 'no-store' });
        setMessages(refreshed.messages);
        if (turn + 1 < count && !stopSceneRef.current) {
          await new Promise(resolve => window.setTimeout(resolve, sceneResponseSpeed === 'immediate' ? 2500 : sceneResponseSpeed === 'slow' ? 12000 : 6000));
        }
      }
    } catch (err) { setError(`No se pudo continuar la escena: ${err instanceof Error ? err.message : 'error de conexión o del servidor'}`); }
    finally { setSceneRunning(false); setSceneStatus(''); }
  };
  const saveScene = async () => {
    if (!id || !sceneLoaded || sceneSaving) return;
    setSceneSaving(true);
    try {
      await customFetch(`/api/group-dms/${encodeURIComponent(id)}/scene`, {
        method: 'PATCH', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id,
          context: sceneContext, turnMode: sceneTurnMode, responseSpeed: sceneResponseSpeed, observerEnabled: sceneObserverEnabled }),
      });
      setError('');
    } catch { setError('No se pudo guardar la escena.'); }
    finally { setSceneSaving(false); }
  };
  const savePreferences = async (patch: { muted?: boolean; archived?: boolean }) => {
    if (!id || !preferencesLoaded || savingSettings) return;
    setSavingSettings(true);
    try {
      const value = await customFetch<{ muted: boolean; archived: boolean }>(`/api/group-dms/${encodeURIComponent(id)}/preferences`, {
        method: 'PATCH', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, ...patch }),
      });
      setMuted(value.muted); setArchived(value.archived); setError('');
    } catch { setError('No se pudieron guardar las preferencias del grupo.'); }
    finally { setSavingSettings(false); }
  };
  const saveAutonomy = async (enabled: boolean, intervalMinutes: number) => {
    if (!group || savingSettings || !autonomyLoaded) return;
    setSavingSettings(true);
    try {
      const result = await customFetch<{ enabled: boolean; intervalMinutes: number }>(`/api/group-dms/${encodeURIComponent(group.id)}/autonomy`, {
        method: 'PATCH', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, enabled, intervalMinutes }),
      });
      setAutonomyEnabled(result.enabled); setAutonomyInterval(result.intervalMinutes); setError('');
    } catch { setError('No se pudo guardar la configuración de autonomía.'); }
    finally { setSavingSettings(false); }
  };
  const deleteMessage = async (message: GroupMessage) => {
    if (!id || message.senderId !== me.id || !window.confirm('¿Eliminar este mensaje de ECHO?')) return;
    try {
      const params = new URLSearchParams({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id });
      await customFetch(`/api/group-dms/${encodeURIComponent(id)}/messages/${encodeURIComponent(message.id)}?${params}`, { method: 'DELETE', responseType: 'json' });
      setMessages(old => old.filter(m => m.id !== message.id));
      setSearchResults(old => old.filter(m => m.id !== message.id));
      setError('');
    } catch { setError('No se pudo eliminar el mensaje.'); }
  };
  const togglePin = async (message: GroupMessage) => {
    if (!id) return;
    try {
      await customFetch(`/api/group-dms/${encodeURIComponent(id)}/messages/${encodeURIComponent(message.id)}/pin`, {
        method: 'PATCH', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, pinned: !message.pinnedAt }),
      });
      setMessages(old => old.map(m => m.id === message.id ? { ...m, pinnedAt: message.pinnedAt ? null : new Date().toISOString() } : m));
      setError('');
    } catch { setError('No se pudo actualizar el mensaje fijado.'); }
  };
  const searchMessages = async (event: FormEvent) => {
    event.preventDefault();
    if (!id || !searchQuery.trim()) { setSearchResults([]); return; }
    try {
      const params = new URLSearchParams({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, q: searchQuery.trim() });
      const result = await customFetch<{ messages: GroupMessage[] }>(`/api/group-dms/${encodeURIComponent(id)}/search?${params}`, { method: 'GET', responseType: 'json' });
      setSearchResults(result.messages); setError('');
    } catch { setError('No se pudo buscar en la conversación.'); }
  };
  const saveAvatar = async (avatar: string | null) => {
    if (!group || savingSettings) return;
    setSavingSettings(true);
    try {
      await customFetch(`/api/group-dms/${encodeURIComponent(group.id)}/avatar`, {
        method: 'PATCH', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, avatar }),
      });
      setGroup({ ...group, avatar }); setError('');
    } catch { setError('No se pudo actualizar la foto. Usá un enlace HTTPS válido.'); }
    finally { setSavingSettings(false); }
  };
  const uploadGroupAvatar = async (file: File) => {
    if (!group || savingSettings) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError('Elegí una imagen JPG, PNG o WebP de hasta 10 MB.'); return;
    }
    setSavingSettings(true);
    try {
      const uploaded = await uploadPrivateFile(file);
      await customFetch(`/api/group-dms/${encodeURIComponent(group.id)}/avatar`, {
        method: 'PATCH', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, avatar: uploaded.url }),
      });
      setGroup({ ...group, avatar: uploaded.url }); setError('');
    } catch { setError('No se pudo subir la foto del grupo.'); }
    finally { setSavingSettings(false); }
  };
  const addMembers = async () => {
    if (!group || !addMemberIds.length || savingSettings) return;
    setSavingSettings(true);
    try {
      const result = await customFetch<{ participantIds: string[] }>(`/api/group-dms/${encodeURIComponent(group.id)}/participants`, {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, participantIds: addMemberIds }),
      });
      setGroup({ ...group, participantIds: result.participantIds }); setAddMemberIds([]); setError('');
    } catch { setError('No se pudieron agregar participantes.'); }
    finally { setSavingSettings(false); }
  };
  const editGroup = async () => {
    if (!group || !groupName.trim() || savingSettings) return;
    setSavingSettings(true);
    try {
      await customFetch(`/api/group-dms/${encodeURIComponent(group.id)}`, {
        method: 'PATCH', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, name: groupName.trim() }),
      });
      setGroup({ ...group, name: groupName.trim() }); setSettingsOpen(false); setError('');
    } catch { setError('No se pudo cambiar el nombre del grupo.'); }
    finally { setSavingSettings(false); }
  };
  const deleteGroup = async () => {
    if (!group || group.createdBy !== me.id || savingSettings || !window.confirm(
      '¿Eliminar este grupo definitivamente? Se borrarán los mensajes para todos los participantes. Esta acción no se puede deshacer.'
    )) return;
    setSavingSettings(true);
    try {
      await customFetch(`/api/group-dms/${encodeURIComponent(group.id)}?${new URLSearchParams({
        universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id,
      })}`, { method: 'DELETE', responseType: 'json' });
      navigate('/messages');
    } catch { setError('No se pudo eliminar el grupo.'); }
    finally { setSavingSettings(false); }
  };
  const leave = async () => {
    if (!group || savingSettings || !window.confirm('¿Querés salir de este grupo?')) return;
    setSavingSettings(true);
    try {
      await customFetch(`/api/group-dms/${encodeURIComponent(group.id)}/leave`, {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id }),
      });
      navigate('/messages');
    } catch { setError('No se pudo salir del grupo.'); }
    finally { setSavingSettings(false); }
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    if ((!message && !pendingFiles.length) || !id || sending || uploading || !canWriteToGroup) return;
    setSending(true);
    try {
      setUploading(pendingFiles.length > 0);
      const attachments = await Promise.all(pendingFiles.map(file => uploadAttachment(file)));
      await customFetch(`/api/group-dms/${encodeURIComponent(id)}/messages`, {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, text: message, attachments }),
      });
      setText(''); setPendingFiles([]);
      const result = await customFetch<{ messages: GroupMessage[] }>(`/api/group-dms/${encodeURIComponent(id)}/messages?${scope}`, { method: 'GET', responseType: 'json' });
      setMessages(result.messages); setError('');
    } catch { setError('No se pudo enviar el mensaje.'); }
    finally { setSending(false); setUploading(false); }
  };
  return <div className="relative isolate flex h-[100dvh] min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    {wallpaper&&<div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 bg-cover bg-center bg-no-repeat" style={{backgroundImage:`linear-gradient(rgba(0,0,0,.3),rgba(0,0,0,.45)),url("${wallpaper.startsWith("data:") ? wallpaper : resolveMedia(wallpaper)}")`}} />}
    <header className="relative z-30 shrink-0 bg-transparent pt-safe">
      <div className="relative flex min-h-[104px] items-center justify-center px-16 py-2 text-white">
        <button type="button" onClick={()=>{const from=new URLSearchParams(window.location.search).get('from');navigate(from==='observer-dms'?'/messages?view=observer-dms':from==='observer-groups'?'/messages?view=observer-groups':from==='groups'?'/messages?view=groups':from==='dm'||from==='messages'?'/messages':group && !group.participantIds.includes(me.id)?'/messages?view=observer-groups':'/messages');}} aria-label="Volver" className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-background/35 backdrop-blur-xl"><ChevronLeft className="h-6 w-6"/></button>
        <div className="flex min-w-0 max-w-full flex-col items-center gap-1 text-center">
          <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-full border border-white/15 bg-background/35 backdrop-blur-xl">{group?.avatar?<img src={resolveMedia(group.avatar)} alt="" className="h-full w-full object-cover"/>:<Users className="h-6 w-6"/>}</div>
          <h1 className="max-w-full truncate text-sm font-semibold">{group?.name??'Grupo'}</h1>
        </div>
        <button type="button" onClick={()=>{setGroupName(group?.name??'');setSettingsOpen(true);}} aria-label="Opciones del grupo" className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-background/35 backdrop-blur-xl"><MoreHorizontal className="h-5 w-5"/></button>
      </div>
    </header>
    {searchOpen && <div className="shrink-0 border-b border-border bg-background p-3">
      <form onSubmit={searchMessages} className="flex gap-2"><input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar en esta conversación" className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm" /><button type="submit" className="rounded-xl bg-secondary px-3 text-sm">Buscar</button></form>
      {!!searchResults.length && <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">{searchResults.map(m => <div key={m.id} className="rounded-lg bg-secondary p-2 text-xs"><strong>{character(m.senderId)?.name ?? m.senderId}</strong><p className="break-words"><SocialText text={m.text} /></p></div>)}</div>}
    </div>}
    {settingsOpen && <div role="region" aria-label="Configuración del grupo" className="relative z-40 mx-3 min-h-0 max-h-[min(75dvh,720px)] shrink-0 overflow-y-auto overscroll-contain rounded-2xl border border-white/20 bg-background/90 p-4 pb-8 shadow-xl backdrop-blur-xl [-webkit-overflow-scrolling:touch]">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Información del grupo</h2><button onClick={() => setSettingsOpen(false)} className="text-sm text-muted-foreground">Cerrar</button></div>
      <details className="group mb-3 rounded-xl border border-border/70 bg-background/40"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">Información y participantes <span className="text-muted-foreground group-open:rotate-180">⌄</span></summary><div className="border-t border-border/70 p-3">
      <button type="button" onClick={()=>{setSettingsOpen(false);setWallpaperOpen(true);}} className="mb-4 flex w-full items-center justify-between rounded-xl border border-white/20 bg-white/5 px-3 py-3 text-left text-sm">Cambiar fondo del chat <span aria-hidden="true">›</span></button>
      <label className="mb-1 block text-xs text-muted-foreground">Nombre</label>
      <div className="flex gap-2"><input value={groupName} maxLength={80} onChange={e => setGroupName(e.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3" /><button onClick={() => void editGroup()} disabled={savingSettings || !groupName.trim()} className="rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">Guardar</button></div>
      <label className="mb-1 mt-4 block text-xs text-muted-foreground">Foto del grupo</label>
      <input ref={avatarFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) void uploadGroupAvatar(file); e.target.value = ''; }} />
      <button type="button" onClick={() => avatarFileRef.current?.click()} disabled={savingSettings} className="mb-2 rounded-xl bg-secondary px-3 py-2 text-sm disabled:opacity-50">Elegir foto de la galería</button>
      {group?.avatar && <button onClick={() => void saveAvatar(null)} className="mt-1 text-xs text-muted-foreground">Quitar foto</button>}
      <p className="mt-4 text-xs font-medium">{group?.participantIds.length ?? 0} participantes</p>
      <div className="mt-2 max-h-28 overflow-y-auto text-sm">{group?.participantIds.map(memberId => <div key={memberId} className="py-1">{character(memberId)?.name ?? memberId}</div>)}</div>
      <p className="mt-3 text-xs font-medium">Agregar participantes</p>
      <div className="mt-2 max-h-32 overflow-y-auto">{state.characters.filter(c => !c.archived && c.id !== me.id && !group?.participantIds.includes(c.id)).map(c => <label key={c.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={addMemberIds.includes(c.id)} onChange={e => setAddMemberIds(old => e.target.checked ? [...old, c.id] : old.filter(x => x !== c.id))} />{c.name}</label>)}</div>
      <button onClick={() => void addMembers()} disabled={savingSettings || !addMemberIds.length} className="mt-2 rounded-xl bg-secondary px-3 py-2 text-sm disabled:opacity-50">Agregar al grupo</button>
      </div></details>
      <details className="group mb-3 rounded-xl border border-border/70 bg-background/40"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">Escena del grupo <span className="text-muted-foreground group-open:rotate-180">⌄</span></summary><div className="border-t border-border/70 p-3">
        <p className="mt-1 text-xs text-muted-foreground">Definí el contexto y cómo querés que conversen los personajes.</p>
        <label className="mt-3 block text-xs text-muted-foreground">Contexto de la escena · {sceneContext.length}/10.000</label>
        <textarea value={sceneContext} maxLength={10000} rows={8} disabled={!sceneLoaded || sceneSaving}
          onChange={e => setSceneContext(e.target.value)} placeholder="Dónde están, qué pasó antes, qué sabe cada personaje..."
          className="mt-1 min-h-48 w-full resize-y rounded-xl border border-input bg-background p-3 text-sm" />
        <label className="mt-3 block text-xs text-muted-foreground">Quién habla en el próximo primer turno</label>
        <select value={firstSpeakerId} onChange={e => setFirstSpeakerId(e.target.value)} className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm">
          <option value="">Elegir automáticamente</option>
          {group?.participantIds.filter(pid => pid !== me.id).map(pid => { const c = state.characters.find(c => c.id === pid); return c ? <option key={pid} value={pid}>{c.name}</option> : null; })}
        </select>
        <label className="mt-3 block text-xs text-muted-foreground">Turnos para hablar</label>
        <select value={sceneTurnMode} onChange={e => setSceneTurnMode(e.target.value as typeof sceneTurnMode)} disabled={!sceneLoaded || sceneSaving} className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm">
          <option value="automatic">Automático</option><option value="round_robin">Por turnos</option><option value="manual">Manual</option>
        </select>
        <label className="mt-3 block text-xs text-muted-foreground">Velocidad de respuesta</label>
        <select value={sceneResponseSpeed} onChange={e => setSceneResponseSpeed(e.target.value as typeof sceneResponseSpeed)} disabled={!sceneLoaded || sceneSaving} className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm">
          <option value="immediate">Inmediata</option><option value="normal">Normal</option><option value="slow">Pausada</option>
        </select>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={sceneObserverEnabled} onChange={e => setSceneObserverEnabled(e.target.checked)} disabled={!sceneLoaded || sceneSaving} /> Modo espectadora (sin participar)</label>
        <button type="button" onClick={() => void saveScene()} disabled={!sceneLoaded || sceneSaving} className="mt-3 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{sceneSaving ? 'Guardando…' : 'Guardar escena'}</button>
        <p className="mt-2 text-xs text-muted-foreground">La configuración se guarda en este grupo y se aplica a los próximos turnos.</p>
      </div></details>
      <details className="group mb-3 rounded-xl border border-border/70 bg-background/40"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">Autonomía del grupo <span className="text-muted-foreground group-open:rotate-180">⌄</span></summary><div className="border-t border-border/70 p-3">
        <p className="mt-1 text-xs text-muted-foreground">Los personajes autorizados pueden intervenir automáticamente según el intervalo seleccionado.</p>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={autonomyEnabled} disabled={!autonomyLoaded || savingSettings} onChange={e => void saveAutonomy(e.target.checked, autonomyInterval)} /> Permitir autonomía grupal</label>
        <label className="mt-3 block text-xs text-muted-foreground">Intervalo mínimo entre intervenciones</label>
        <select value={autonomyInterval} disabled={!autonomyLoaded || savingSettings} onChange={e => void saveAutonomy(autonomyEnabled, Number(e.target.value))} className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm">
          <option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={60}>1 hora</option><option value={180}>3 horas</option><option value={360}>6 horas</option>
        </select>
      </div></details>
      <details className="group mb-3 rounded-xl border border-border/70 bg-background/40"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">Preferencias de conversación <span className="text-muted-foreground group-open:rotate-180">⌄</span></summary><div className="border-t border-border/70 p-3">
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={muted} disabled={!preferencesLoaded || savingSettings} onChange={e => void savePreferences({ muted: e.target.checked })} /> Silenciar este grupo</label>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} disabled={!preferencesLoaded || savingSettings} onChange={e => void savePreferences({ archived: e.target.checked })} /> Archivar este grupo</label>
        <p className="mt-2 text-xs text-muted-foreground">Estas preferencias son individuales. Archivar no elimina los mensajes.</p>
      </div></details>
      {group?.participantIds.includes(me.id) && <button onClick={() => void leave()} disabled={savingSettings} className="mt-3 text-sm font-medium text-destructive disabled:opacity-50">{gl("Salir del grupo")}</button>}
      {group?.createdBy === me.id && <button onClick={() => void deleteGroup()} disabled={savingSettings} className="mt-3 ml-4 text-sm font-medium text-destructive disabled:opacity-50">{gl("Eliminar grupo definitivamente")}</button>}
      {!group?.participantIds.includes(me.id) && <div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">{gl("Estás viendo este grupo como espectadora. No sos participante.")}</p><button type="button" onClick={() => navigate('/messages')} className="rounded-lg border border-border px-3 py-2 text-sm">{gl("Salir del modo espectadora")}</button></div>}
    </div>}
    <main className="relative z-10 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-transparent px-4 py-5" data-testid="group-messages">
      {sceneLoaded && messages.length === 0 && <div className="mx-auto mt-12 max-w-xs text-center"><div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-secondary"><Users className="h-7 w-7 text-muted-foreground" /></div><p className="font-semibold">El grupo está listo 🖤</p><p className="mt-1 text-sm text-muted-foreground">{isWatchingScene ? 'Tocá la foto de un personaje para empezar la conversación.' : 'Podés iniciar la conversación enviando un mensaje.'}</p></div>}
      {messages.filter(m => m.pinnedAt).length > 0 && <div className="mb-3 rounded-xl bg-secondary/70 px-3 py-2 text-xs"><Pin className="mr-1 inline h-3 w-3" /> {messages.filter(m => m.pinnedAt).length} mensaje(s) fijado(s)</div>}
      {messages.map(m => <div key={m.id} className={`flex items-end gap-2 ${m.senderId === me.id ? 'justify-end' : 'justify-start'}`}>
        {m.senderId !== me.id && <div className="shrink-0"><CharacterAvatar character={character(m.senderId) ?? me} size={30} /></div>}
        <div className={`max-w-[85%] rounded-2xl border border-white/15 bg-black/30 px-4 py-2 text-white shadow-sm backdrop-blur-md`}>
          {m.senderId !== me.id && <p className="mb-1 text-xs font-semibold">{character(m.senderId)?.name ?? 'Participante'}</p>}
          {m.text && <p className="whitespace-pre-wrap break-words text-sm"><SocialText text={m.text} /></p>}
          {!!m.attachments?.length && <div className="mt-2 flex flex-col gap-2">{m.attachments.map(a => a.type === 'music' ? <div key={a.id} className="rounded-xl border border-border bg-card p-3 text-foreground">
            <p className="mb-2 text-xs font-semibold">🎵 {a.title}</p>
            <SharedMusicPlayer trackId={a.trackId} />
            <button type="button" disabled={savingTrackId === a.trackId} className="mt-2 rounded-lg bg-secondary px-3 py-2 text-xs font-semibold"
              onClick={async () => { if (!id) return; setSavingTrackId(a.trackId); try {
                await customFetch('/api/group-dms/' + encodeURIComponent(id) + '/music/' + encodeURIComponent(a.trackId) + '/save', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id }), responseType: 'json',
                });
                setMusicDraftStatus('Canción guardada en tu biblioteca.'); 
              } catch { setError('No se pudo guardar esta canción.'); } finally { setSavingTrackId(null); } }}>
              Guardar en mi biblioteca
            </button>
          </div> : <AttachmentView key={a.id} a={a} mine={m.senderId === me.id} />)}</div>}
          <div className="mt-1 flex items-center gap-3">
          {m.text && <button type="button" aria-label="Copiar mensaje" title="Copiar mensaje" className="flex items-center gap-1 text-[10px] opacity-70 hover:opacity-100" onClick={async () => { try { await navigator.clipboard.writeText(m.text); setCopiedMessageId(m.id); window.setTimeout(() => setCopiedMessageId(current => current === m.id ? null : current), 1800); } catch { setError('No se pudo copiar el mensaje.'); } }}>{copiedMessageId === m.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}</button>}
          <button type="button" onClick={() => void togglePin(m)} className="flex items-center gap-1 text-[10px] opacity-70 hover:opacity-100"><Pin className="h-3 w-3" />{m.pinnedAt ? 'Desfijar' : 'Fijar'}</button>
          {m.senderId === me.id && group?.participantIds.includes(me.id) && <button type="button" aria-label="Eliminar mensaje" title="Eliminar mensaje" onClick={() => void deleteMessage(m)} className="opacity-70 hover:opacity-100"><Trash2 className="h-3 w-3" /></button>}
          </div>
          <p className={`mt-1 text-right text-[10px] ${m.senderId === me.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{new Date(m.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      </div>)}
      <div ref={bottomRef} />
    </main>
    {sceneLoaded && isWatchingScene && group && <div className="relative z-30 shrink-0 bg-background/15 px-3 py-2 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur-sm">
      <div className="flex items-center justify-around gap-2 overflow-x-auto" aria-label="Tocá un personaje para hacerlo hablar">
        {group.participantIds.filter(pid => pid !== observerProfileId).map(pid => {
          const participant = character(pid);
          if (!participant) return null;
          return <button key={pid} type="button" disabled={sceneRunning} onClick={() => { setFirstSpeakerId(pid); setError(''); void advanceScene(1, pid); }} aria-label={`Hacer hablar a ${participant.name}`} title={participant.name} className="flex min-w-0 shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-1 text-foreground transition-transform active:scale-95 disabled:opacity-50">
            <span className="block h-14 w-14 overflow-hidden rounded-full [&_img]:h-full [&_img]:w-full [&_img]:object-cover [&_img]:border-0 [&_img]:ring-0"><CharacterAvatar character={participant} size={56} /></span>
            <span className="max-w-16 truncate text-[11px] drop-shadow-md">{participant.name.split(' ')[0]}</span>
          </button>;
        })}
      </div>
    </div>}
    {sceneStatus && <p role="status" className="px-4 text-xs text-muted-foreground">{sceneStatus}</p>}
    {error && <p role="alert" className="px-4 text-sm text-destructive">{error}</p>}
    {!!pendingFiles.length && <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-3 py-2">{pendingFiles.map((file, index) => <span key={index} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs"><span className="max-w-36 truncate">{file.name}</span><button type="button" aria-label="Quitar archivo" onClick={() => setPendingFiles(files => files.filter((_, i) => i !== index))}><X className="h-3 w-3" /></button></span>)}</div>}
    {recorder.status !== 'idle' && <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm"><span>{recorder.status === 'requesting' ? 'Solicitando micrófono…' : `Grabando · ${formatDuration(recorder.elapsed)}`}</span><div className="flex gap-3"><button type="button" onClick={recorder.cancel} className="text-muted-foreground">Cancelar</button><button type="button" onClick={recorder.stop} className="font-semibold text-primary">Terminar</button></div></div>}
    <div className="relative z-30 shrink-0 border-0 bg-transparent px-3 py-2">
      {musicDraftStatus && <p role="status" className="mt-2 text-xs text-muted-foreground">{musicDraftStatus}</p>}
      {showMusicLibrary && <div className="mt-2">
        <MusicLibraryPicker characterId={me.id} onCancel={() => setShowMusicLibrary(false)} onSelect={async selection => {
          if (!id || !group || savingMusicDraft) return;
          setSavingMusicDraft(true); setMusicDraftStatus('');
          try {
            await customFetch('/api/group-dms/' + encodeURIComponent(id) + '/music', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, trackId: selection.id }),
              responseType: 'json',
            });
            const result = await customFetch<{ messages: GroupMessage[] }>(`/api/group-dms/${encodeURIComponent(id)}/messages?${scope}`, { method: 'GET', responseType: 'json' });
            setMessages(result.messages);
            setMusicDraftStatus('Canción enviada al grupo. No se gastaron créditos.');
            setShowMusicLibrary(false);
          } catch {
            setMusicDraftStatus('No se pudo preparar esta canción para el grupo.');
          } finally { setSavingMusicDraft(false); }
        }} />
      </div>}
    </div>
    {wallpaperOpen&&<div className="relative z-40 mx-3 rounded-2xl border border-white/20 bg-background/90 p-3 backdrop-blur-xl"><div className="mb-2 flex justify-between text-sm"><strong>Apariencia del chat</strong><button type="button" onClick={()=>setWallpaperOpen(false)}>✕</button></div><label className="relative block cursor-pointer overflow-hidden rounded-xl border border-white/20 p-3 text-sm">{wallpaperUploading ? "Subiendo fondo..." : "Elegir foto de fondo"}<input type="file" accept="image/*" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" onChange={e=>{void changeWallpaper(e.target.files?.[0]);e.target.value='';}}/></label>{wallpaper&&<button type="button" onClick={()=>void changeWallpaper()} className="mt-2 text-xs">Quitar fondo</button>}</div>}
    {eventsOpen && group && id && group.participantIds.includes(me.id) && <div className="relative z-40 mx-3 max-h-[45dvh] overflow-y-auto rounded-2xl border border-white/20 bg-background/90 p-3 backdrop-blur-xl"><button type="button" onClick={()=>setEventsOpen(false)} className="mb-2 text-sm">✕ Cerrar acontecimientos</button><GroupCanonReview key={id} groupId={id} universeId={getActiveUniverseId(user?.id ?? '')} actorId={me.id} /></div>}
    {canWriteToGroup && <form onSubmit={send} className="relative z-30 flex shrink-0 flex-wrap items-center gap-2 border-0 bg-transparent px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3"><FormattingToolbar inputRef={composerRef} value={text} onChange={setText} maxLength={10000} className="w-full" />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav" multiple className="hidden" onChange={e => { const files = Array.from(e.target.files ?? []); try { validateAttachments(files, pendingFiles.length); setPendingFiles(old => [...old, ...files]); setError(''); } catch (err) { setError((err as Error).message); } e.target.value = ''; }} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e=>{const files=Array.from(e.target.files??[]);try{validateAttachments(files,pendingFiles.length);setPendingFiles(old=>[...old,...files]);setError('');}catch(err){setError((err as Error).message);}e.target.value='';}} />
      {!!pendingFiles.length && <div className="w-full min-w-0">
        <div className="mb-1 text-xs text-muted-foreground">{uploading ? 'Subiendo archivos…' : `${pendingFiles.length} archivo(s) listo(s) para enviar`}</div>
        <div className="flex gap-2 overflow-x-auto">{pendingFiles.map((file,index) => <PendingGroupFile key={`${file.name}-${file.lastModified}-${index}`} file={file} disabled={sending} onRemove={() => setPendingFiles(old => old.filter((_,i) => i !== index))}/>)}</div>
      </div>}
      <div className="relative shrink-0">
        {toolsOpen&&<div role="menu" aria-label="Opciones del grupo" className="absolute bottom-full left-0 z-50 mb-3 w-[min(19rem,calc(100vw-2rem))] rounded-3xl border border-white/20 bg-background/90 p-2 shadow-2xl backdrop-blur-2xl">
          <button type="button" role="menuitem" onClick={()=>{setToolsOpen(false);setEventsOpen(true);}} className="block w-full rounded-2xl p-3 text-left text-sm hover:bg-white/10">♧ Acontecimientos del grupo</button>
          <button type="button" role="menuitem" onClick={()=>{setToolsOpen(false);setWallpaperOpen(true);}} className="block w-full rounded-2xl p-3 text-left text-sm hover:bg-white/10">◉ Apariencia del chat</button>
          <button type="button" role="menuitem" onClick={()=>{setToolsOpen(false);fileRef.current?.click();}} className="block w-full rounded-2xl p-3 text-left text-sm hover:bg-white/10">＋ Adjuntar fotos o archivos</button>
          <button type="button" role="menuitem" onClick={()=>{setToolsOpen(false);cameraRef.current?.click();}} className="block w-full rounded-2xl p-3 text-left text-sm hover:bg-white/10">◎ Sacar foto</button>
          <button type="button" role="menuitem" onClick={()=>{setToolsOpen(false);setShowMusicLibrary(true);setMusicDraftStatus('');}} className="block w-full rounded-2xl p-3 text-left text-sm hover:bg-white/10">♫ ECHO Music</button>
        </div>}
        <button type="button" onClick={()=>setToolsOpen(v=>!v)} aria-label="Más opciones" aria-expanded={toolsOpen} className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-background/40 backdrop-blur-xl"><Plus className={toolsOpen?'h-6 w-6 rotate-45':'h-6 w-6'}/></button>
      </div>
      <button type="button" onClick={() => void recorder.start()} disabled={recorder.status !== 'idle' || sending || pendingFiles.length >= 5} aria-label="Grabar nota de voz" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary disabled:opacity-50"><Mic className="h-5 w-5" /></button>
      <textarea ref={composerRef} value={text} onChange={e => setText(e.target.value)} maxLength={10000} rows={1} placeholder="Mensaje al grupo…" className="max-h-36 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto rounded-full border border-white/20 bg-background/40 px-4 py-3 outline-none backdrop-blur-xl whitespace-pre-wrap" aria-label="Mensaje al grupo" />
      <button disabled={(!text.trim() && !pendingFiles.length) || sending} aria-label="Enviar mensaje" className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"><Send className="h-5 w-5" /></button>
    </form>}
  </div>;
}
