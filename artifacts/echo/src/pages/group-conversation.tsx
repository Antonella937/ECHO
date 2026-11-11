import { FormattingToolbar } from '@/components/echo/formatting-toolbar';
import { SocialText } from '@/components/echo/social-text';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLanguage } from '@/lib/i18n';
const groupLabels: Record<string, Record<string,string>> = {"en":{"Salir del grupo":"Leave group","Eliminar grupo definitivamente":"Permanently delete group","Salir del modo espectadora":"Exit spectator mode","Estás viendo este grupo como espectadora. No sos participante.":"You're viewing this group as a spectator. You're not a participant."},"pt":{"Salir del grupo":"Sair do grupo","Eliminar grupo definitivamente":"Excluir grupo permanentemente","Salir del modo espectadora":"Sair do modo espectador","Estás viendo este grupo como espectadora. No sos participante.":"Você está vendo este grupo como espectadora. Não é participante."},"fr":{"Salir del grupo":"Quitter le groupe","Eliminar grupo definitivamente":"Supprimer définitivement le groupe","Salir del modo espectadora":"Quitter le mode spectateur","Estás viendo este grupo como espectadora. No sos participante.":"Vous regardez ce groupe en spectatrice. Vous ne participez pas."},"de":{"Salir del grupo":"Gruppe verlassen","Eliminar grupo definitivamente":"Gruppe endgültig löschen","Salir del modo espectadora":"Zuschauermodus verlassen","Estás viendo este grupo como espectadora. No sos participante.":"Du siehst diese Gruppe als Zuschauerin und bist kein Mitglied."},"it":{"Salir del grupo":"Esci dal gruppo","Eliminar grupo definitivamente":"Elimina definitivamente il gruppo","Salir del modo espectadora":"Esci dalla modalità spettatore","Estás viendo este grupo como espectadora. No sos participante.":"Stai osservando questo gruppo senza partecipare."},"ko":{"Salir del grupo":"그룹 나가기","Eliminar grupo definitivamente":"그룹 영구 삭제","Salir del modo espectadora":"관전자 모드 나가기","Estás viendo este grupo como espectadora. No sos participante.":"이 그룹을 관전 중이며 참여자가 아닙니다."},"ja":{"Salir del grupo":"グループを退出","Eliminar grupo definitivamente":"グループを完全に削除","Salir del modo espectadora":"観戦モードを終了","Estás viendo este grupo como espectadora. No sos participante.":"このグループを観覧中です。参加者ではありません。"},"zh":{"Salir del grupo":"退出群组","Eliminar grupo definitivamente":"永久删除群组","Salir del modo espectadora":"退出旁观模式","Estás viendo este grupo como espectadora. No sos participante.":"你正在旁观此群组，并非参与者。"}};
import { useLocation, useParams } from 'wouter';
import { ChevronLeft, Send, Users, MoreHorizontal, Search, Pin, Paperclip, X, Mic, Square } from 'lucide-react';
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

type Group = { id: string; name: string; avatar?: string | null; createdBy: string; participantIds: string[] };
type MusicAttachment = { id: string; type: 'music'; trackId: string; title: string; durationSeconds: number };
type GroupMessage = { id: string; senderId: string; text: string; attachments?: Array<MessageAttachment | MusicAttachment>; createdAt: string; pinnedAt?: string | null; pinnedBy?: string | null };

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
  const [musicDraftStatus, setMusicDraftStatus] = useState('');
  const [savingMusicDraft, setSavingMusicDraft] = useState(false);
  const [savingTrackId, setSavingTrackId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GroupMessage[]>([]);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
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
  const [avatarUrl, setAvatarUrl] = useState('');
  const [addMemberIds, setAddMemberIds] = useState<string[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sceneContext, setSceneContext] = useState('');
  const [sceneTurnMode, setSceneTurnMode] = useState<'automatic' | 'round_robin' | 'manual'>('automatic');
  const [sceneResponseSpeed, setSceneResponseSpeed] = useState<'immediate' | 'normal' | 'slow'>('normal');
  const [sceneObserverEnabled, setSceneObserverEnabled] = useState(false);
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
          if (found) setGroup(found);
        }
        if (threadResult.status === 'fulfilled') setMessages(threadResult.value.messages);
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
  const advanceScene = async (count: number) => {
    if (!id || sceneRunning || (count > 1 && sceneTurnMode === 'manual')) return;
    stopSceneRef.current = false;
    setSceneRunning(true);
    try {
      for (let turn = 0; turn < count && !stopSceneRef.current; turn++) {
        const result = await customFetch<{ status: string; reason?: string }>(`/api/group-dms/${encodeURIComponent(id)}/scene/next`, {
          method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id }),
        });
        if (result.status !== 'sent') {
          if (turn === 0) setError(`No se generó el turno: ${result.reason ?? 'revisá la autonomía de los personajes'}`);
          break;
        }
        const refreshed = await customFetch<{ messages: GroupMessage[] }>(`/api/group-dms/${encodeURIComponent(id)}/messages?${scope}`, { method: 'GET', responseType: 'json', cache: 'no-store' });
        setMessages(refreshed.messages);
        if (turn + 1 < count && !stopSceneRef.current) {
          await new Promise(resolve => window.setTimeout(resolve, sceneResponseSpeed === 'immediate' ? 2500 : sceneResponseSpeed === 'slow' ? 12000 : 6000));
        }
      }
    } catch { setError('No se pudo continuar la escena. Comprobá que esté habilitada la autonomía grupal.'); }
    finally { setSceneRunning(false); }
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
    if (!id || !preferencesLoaded || savingSettings) return false;
    setSavingSettings(true);
    try {
      const value = await customFetch<{ muted: boolean; archived: boolean }>(`/api/group-dms/${encodeURIComponent(id)}/preferences`, {
        method: 'PATCH', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id, ...patch }),
      });
      setMuted(value.muted); setArchived(value.archived); setError('');
      return true;
    } catch { setError('No se pudieron guardar las preferencias del grupo.'); return false; }
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
      setGroup({ ...group, avatar }); setAvatarUrl(avatar ?? ''); setError('');
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
      setGroup({ ...group, avatar: uploaded.url }); setAvatarUrl(uploaded.url); setError('');
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
    if ((!message && !pendingFiles.length) || !id || sending || uploading) return;
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
  return <div className="flex h-[100dvh] min-h-0 min-w-0 flex-col overflow-hidden bg-background">
    <header className="z-30 shrink-0 border-b border-border/60 bg-background/95 pt-safe backdrop-blur-xl"><div className="flex h-16 min-w-0 items-center gap-3 px-2">
      <button onClick={() => navigate('/messages')} aria-label="Volver" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary"><ChevronLeft className="h-6 w-6" /></button>
      <div className="relative grid h-11 w-11 shrink-0 place-items-center overflow-visible rounded-full bg-secondary">{group?.avatar ? <img src={resolveMedia(group.avatar)} alt="" className="h-11 w-11 rounded-full object-cover" /> : <Users className="h-5 w-5" />}<span className="absolute -bottom-1 -right-1 rounded-full border-2 border-background bg-primary px-1 text-[10px] text-primary-foreground">{group?.participantIds.length ?? 0}</span></div>
      <div className="min-w-0 flex-1"><h1 className="truncate text-[15px] font-semibold">{group?.name ?? 'Grupo'}</h1><p className="truncate text-xs text-muted-foreground">{group?.participantIds.map(x => character(x)?.name ?? x).join(', ')}</p></div>
      <button onClick={() => { setSearchOpen(old => !old); setSearchResults([]); }} aria-label="Buscar mensajes" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary"><Search className="h-5 w-5" /></button>
      <button onClick={() => { setGroupName(group?.name ?? ''); setAvatarUrl(group?.avatar ?? ''); setSettingsOpen(true); }} aria-label="Opciones del grupo" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary"><MoreHorizontal className="h-6 w-6" /></button>
    </div></header>
    {searchOpen && <div className="shrink-0 border-b border-border bg-background p-3">
      <form onSubmit={searchMessages} className="flex gap-2"><input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar en esta conversación" className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3 text-sm" /><button type="submit" className="rounded-xl bg-secondary px-3 text-sm">Buscar</button></form>
      {!!searchResults.length && <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">{searchResults.map(m => <div key={m.id} className="rounded-lg bg-secondary p-2 text-xs"><strong>{character(m.senderId)?.name ?? m.senderId}</strong><p className="break-words"><SocialText text={m.text} /></p></div>)}</div>}
    </div>}
    {settingsOpen && <div role="region" aria-label="Configuración del grupo" className="min-h-0 max-h-[min(75dvh,720px)] shrink-0 overflow-y-auto overscroll-contain border-b border-border bg-background p-4 pb-8 [-webkit-overflow-scrolling:touch]">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Información del grupo</h2><button onClick={() => setSettingsOpen(false)} className="text-sm text-muted-foreground">Cerrar</button></div>
      <label className="mb-1 block text-xs text-muted-foreground">Nombre</label>
      <div className="flex gap-2"><input value={groupName} maxLength={80} onChange={e => setGroupName(e.target.value)} className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3" /><button onClick={() => void editGroup()} disabled={savingSettings || !groupName.trim()} className="rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">Guardar</button></div>
      <label className="mb-1 mt-4 block text-xs text-muted-foreground">Foto del grupo</label>
      <input ref={avatarFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) void uploadGroupAvatar(file); e.target.value = ''; }} />
      <button type="button" onClick={() => avatarFileRef.current?.click()} disabled={savingSettings} className="mb-2 rounded-xl bg-secondary px-3 py-2 text-sm disabled:opacity-50">Elegir foto de la galería</button>
      <label className="mb-1 block text-xs text-muted-foreground">O usar un enlace HTTPS</label>
      <div className="flex gap-2"><input type="url" value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} placeholder="https://..." className="h-10 min-w-0 flex-1 rounded-xl border border-input bg-background px-3" /><button onClick={() => void saveAvatar(avatarUrl.trim() || null)} disabled={savingSettings || (!!avatarUrl.trim() && !avatarUrl.trim().startsWith('https://'))} className="rounded-xl bg-secondary px-3 text-sm disabled:opacity-50">Aplicar</button></div>
      {group?.avatar && <button onClick={() => void saveAvatar(null)} className="mt-1 text-xs text-muted-foreground">Quitar foto</button>}
      <p className="mt-4 text-xs font-medium">{group?.participantIds.length ?? 0} participantes</p>
      <div className="mt-2 max-h-28 overflow-y-auto text-sm">{group?.participantIds.map(memberId => <div key={memberId} className="py-1">{character(memberId)?.name ?? memberId}</div>)}</div>
      <p className="mt-3 text-xs font-medium">Agregar participantes</p>
      <div className="mt-2 max-h-32 overflow-y-auto">{state.characters.filter(c => !c.archived && c.id !== me.id && !group?.participantIds.includes(c.id)).map(c => <label key={c.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" checked={addMemberIds.includes(c.id)} onChange={e => setAddMemberIds(old => e.target.checked ? [...old, c.id] : old.filter(x => x !== c.id))} />{c.name}</label>)}</div>
      <button onClick={() => void addMembers()} disabled={savingSettings || !addMemberIds.length} className="mt-2 rounded-xl bg-secondary px-3 py-2 text-sm disabled:opacity-50">Agregar al grupo</button>
      <div className="mt-4 border-t border-border pt-3">
        <p className="font-semibold">Escena del grupo</p>
        <p className="mt-1 text-xs text-muted-foreground">Definí el contexto y cómo querés que conversen los personajes.</p>
        <label className="mt-3 block text-xs text-muted-foreground">Contexto de la escena · {sceneContext.length}/10.000</label>
        <textarea value={sceneContext} maxLength={10000} rows={8} disabled={!sceneLoaded || sceneSaving}
          onChange={e => setSceneContext(e.target.value)} placeholder="Dónde están, qué pasó antes, qué sabe cada personaje..."
          className="mt-1 min-h-48 w-full resize-y rounded-xl border border-input bg-background p-3 text-sm" />
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
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <p className="font-semibold">Autonomía del grupo</p>
        <p className="mt-1 text-xs text-muted-foreground">Los personajes autorizados pueden intervenir automáticamente según el intervalo seleccionado.</p>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={autonomyEnabled} disabled={!autonomyLoaded || savingSettings} onChange={e => void saveAutonomy(e.target.checked, autonomyInterval)} /> Permitir autonomía grupal</label>
        <label className="mt-3 block text-xs text-muted-foreground">Intervalo mínimo entre intervenciones</label>
        <select value={autonomyInterval} disabled={!autonomyLoaded || savingSettings} onChange={e => void saveAutonomy(autonomyEnabled, Number(e.target.value))} className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-sm">
          <option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={60}>1 hora</option><option value={180}>3 horas</option><option value={360}>6 horas</option>
        </select>
      </div>
      <div className="mt-4 border-t border-border pt-3">
        <p className="font-semibold">Preferencias de conversación</p>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={muted} disabled={!preferencesLoaded || savingSettings} onChange={e => void savePreferences({ muted: e.target.checked })} /> Silenciar este grupo</label>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={archived} disabled={!preferencesLoaded || savingSettings} onChange={e => void savePreferences({ archived: e.target.checked })} /> Archivar este grupo</label>
        <p className="mt-2 text-xs text-muted-foreground">Estas preferencias son individuales. Archivar no elimina los mensajes.</p>
      </div>
      {group && group.createdBy !== me.id && !group.participantIds.includes(me.id) && <button type="button" disabled={savingSettings || !preferencesLoaded} onClick={async () => {
        if (!window.confirm('¿Quitar esta escena de tus conversaciones? Se archivará solo para esta identidad; no se borrarán mensajes de los participantes.')) return;
        if (await savePreferences({ archived: true })) navigate('/messages');
      }} className="mt-3 text-sm font-medium text-destructive disabled:opacity-50">Quitar de mis conversaciones (espectador)</button>}
      {group && group.createdBy !== me.id && <button type="button" disabled={savingSettings} onClick={async () => {
        if (!window.confirm('¿Eliminar esta conversación de tu cuenta? No se borrarán los mensajes de los demás participantes.')) return;
        setSavingSettings(true);
        try {
          await customFetch(`/api/group-dms/${encodeURIComponent(group.id)}/for-me?${new URLSearchParams({ universeId: getActiveUniverseId(user?.id ?? ''), actorId: me.id })}`, { method: 'DELETE', responseType: 'json' });
          navigate('/messages');
        } catch { setError('No se pudo eliminar esta conversación de tu cuenta.'); }
        finally { setSavingSettings(false); }
      }} className="mt-3 ml-4 text-sm font-medium text-destructive disabled:opacity-50">Eliminar de mis conversaciones</button>}
      {group?.participantIds.includes(me.id) && <button onClick={() => void leave()} disabled={savingSettings} className="mt-3 text-sm font-medium text-destructive disabled:opacity-50">{gl("Salir del grupo")}</button>}
      {group?.createdBy === me.id && <button onClick={() => void deleteGroup()} disabled={savingSettings} className="mt-3 ml-4 text-sm font-medium text-destructive disabled:opacity-50">{gl("Eliminar grupo definitivamente")}</button>}
      {!group?.participantIds.includes(me.id) && <div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">{gl("Estás viendo este grupo como espectadora. No sos participante.")}</p><button type="button" onClick={() => navigate('/messages')} className="rounded-lg border border-border px-3 py-2 text-sm">{gl("Salir del modo espectadora")}</button></div>}
    </div>}
    {sceneObserverEnabled && <div className="shrink-0 border-b border-border bg-background px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">Modo espectadora · escena grupal</span>
        {sceneRunning ? <button onClick={() => { stopSceneRef.current = true; }} className="rounded-lg bg-secondary px-3 py-2 text-xs">Detener después del turno</button> : <>
          <button onClick={() => void advanceScene(1)} disabled={!autonomyEnabled} className="rounded-lg bg-secondary px-3 py-2 text-xs disabled:opacity-50">Siguiente turno</button>
          <button onClick={() => void advanceScene(12)} disabled={!autonomyEnabled || sceneTurnMode === 'manual'} className="rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50">Reproducir hasta 12 turnos</button>
        </>}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Cada intervención utiliza IA y puede consumir presupuesto. La reproducción se detiene tras 12 turnos o al pulsar detener.</p>
    </div>}
    <main className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-5" data-testid="group-messages">
      {messages.length === 0 && <div className="mx-auto mt-12 max-w-xs text-center"><div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-secondary"><Users className="h-7 w-7 text-muted-foreground" /></div><p className="font-semibold">El grupo está listo 🖤</p><p className="mt-1 text-sm text-muted-foreground">Podés iniciar la escena desde el modo espectadora, sin mandar un mensaje.</p></div>}
      {messages.filter(m => m.pinnedAt).length > 0 && <div className="mb-3 rounded-xl bg-secondary/70 px-3 py-2 text-xs"><Pin className="mr-1 inline h-3 w-3" /> {messages.filter(m => m.pinnedAt).length} mensaje(s) fijado(s)</div>}
      {messages.map(m => <div key={m.id} className={`flex items-end gap-2 ${m.senderId === me.id ? 'justify-end' : 'justify-start'}`}>
        {m.senderId !== me.id && <div className="shrink-0"><CharacterAvatar character={character(m.senderId) ?? me} size={30} /></div>}
        <div className={`max-w-[85%] rounded-2xl px-4 py-2 ${m.senderId === me.id ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>
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
          <button type="button" onClick={() => void togglePin(m)} className="mt-1 flex items-center gap-1 text-[10px] opacity-70 hover:opacity-100"><Pin className="h-3 w-3" />{m.pinnedAt ? 'Desfijar' : 'Fijar'}</button>
          <p className={`mt-1 text-right text-[10px] ${m.senderId === me.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{new Date(m.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      </div>)}
      <div ref={bottomRef} />
    </main>
    {error && <p role="alert" className="px-4 text-sm text-destructive">{error}</p>}
    {!!pendingFiles.length && <div className="flex shrink-0 flex-wrap gap-2 border-t border-border px-3 py-2">{pendingFiles.map((file, index) => <span key={index} className="inline-flex max-w-full items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs"><span className="max-w-36 truncate">{file.name}</span><button type="button" aria-label="Quitar archivo" onClick={() => setPendingFiles(files => files.filter((_, i) => i !== index))}><X className="h-3 w-3" /></button></span>)}</div>}
    {recorder.status !== 'idle' && <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm"><span>{recorder.status === 'requesting' ? 'Solicitando micrófono…' : `Grabando · ${formatDuration(recorder.elapsed)}`}</span><div className="flex gap-3"><button type="button" onClick={recorder.cancel} className="text-muted-foreground">Cancelar</button><button type="button" onClick={recorder.stop} className="font-semibold text-primary">Terminar</button></div></div>}
    <div className="shrink-0 border-t border-border px-3 py-2">
      <button type="button" onClick={() => { setShowMusicLibrary(value => !value); setMusicDraftStatus(''); }}
        className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold">
        {showMusicLibrary ? 'Cerrar música' : '🎵 ECHO Music'}
      </button>
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
    <form onSubmit={send} className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3"><FormattingToolbar inputRef={composerRef} value={text} onChange={setText} maxLength={10000} className="w-full" />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav" multiple className="hidden" onChange={e => { const files = Array.from(e.target.files ?? []); try { validateAttachments(files, pendingFiles.length); setPendingFiles(old => [...old, ...files]); setError(''); } catch (err) { setError((err as Error).message); } e.target.value = ''; }} />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={sending} aria-label="Adjuntar archivos" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary"><Paperclip className="h-5 w-5" /></button>
      <button type="button" onClick={() => void recorder.start()} disabled={recorder.status !== 'idle' || sending || pendingFiles.length >= 5} aria-label="Grabar nota de voz" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary disabled:opacity-50"><Mic className="h-5 w-5" /></button>
      <textarea ref={composerRef} value={text} onChange={e => setText(e.target.value)} maxLength={10000} rows={1} placeholder="Mensaje al grupo…" className="max-h-36 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl bg-secondary px-4 py-3 outline-none whitespace-pre-wrap" aria-label="Mensaje al grupo" />
      <button disabled={(!text.trim() && !pendingFiles.length) || sending} aria-label="Enviar mensaje" className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"><Send className="h-5 w-5" /></button>
    </form>
  </div>;
}
