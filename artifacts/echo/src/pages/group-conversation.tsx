import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useParams } from 'wouter';
import { ChevronLeft, Send, Users, MoreHorizontal, Search, Pin, Paperclip, X, Mic, Square } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { getActiveUniverseId } from '@/store/persistence';
import { useSocial } from '@/store/social-store';
import { useUser } from '@clerk/react';
import { CharacterAvatar } from '@/components/echo/avatar';
import { AttachmentView } from '@/components/echo/dm-attachment-view';
import { MusicLibraryPicker } from '@/components/echo/music-library-picker';
import { uploadAttachment, validateAttachments, formatDuration } from '@/lib/dm-attachments';
import { useVoiceRecorder } from '@/lib/use-voice-recorder';
import { uploadPrivateFile, useMediaResolver } from '@/lib/media';
import type { MessageAttachment } from '@/domain/types';

type Group = { id: string; name: string; avatar?: string | null; participantIds: string[] };
type MusicAttachment = { id: string; type: 'music'; trackId: string; title: string; durationSeconds: number };
type GroupMessage = { id: string; senderId: string; text: string; attachments?: Array<MessageAttachment | MusicAttachment>; createdAt: string; pinnedAt?: string | null; pinnedBy?: string | null };

export default function GroupConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const { me, character, state } = useSocial();
  const resolveMedia = useMediaResolver();
  const [, navigate] = useLocation();
  const [group, setGroup] = useState<Group | null>(null);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [text, setText] = useState('');
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
    if (!settingsOpen || !id || !user?.id) return;
    let active = true;
    setAutonomyLoaded(false);
    setPreferencesLoaded(false);
    void customFetch<{ muted: boolean; archived: boolean }>(`/api/group-dms/${encodeURIComponent(id)}/preferences?${scope}`, { method: 'GET', responseType: 'json' })
      .then(value => { if (active) { setMuted(value.muted); setArchived(value.archived); setPreferencesLoaded(true); } })
      .catch(() => { if (active) setError('No se pudieron cargar las preferencias del grupo.'); });
    void customFetch<{ enabled: boolean; intervalMinutes: number }>(`/api/group-dms/${encodeURIComponent(id)}/autonomy?${scope}`, { method: 'GET', responseType: 'json' })
      .then(result => { if (active) { setAutonomyEnabled(result.enabled); setAutonomyInterval(result.intervalMinutes); setAutonomyLoaded(true); } })
      .catch(() => { if (active) { setAutonomyLoaded(false); setError('No se pudo cargar la configuración de autonomía.'); } });
    return () => { active = false; };
  }, [settingsOpen, id, user?.id, me.id]);
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
      {!!searchResults.length && <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">{searchResults.map(m => <div key={m.id} className="rounded-lg bg-secondary p-2 text-xs"><strong>{character(m.senderId)?.name ?? m.senderId}</strong><p className="break-words">{m.text}</p></div>)}</div>}
    </div>}
    {settingsOpen && <div className="border-b border-border bg-background p-4">
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
      <button onClick={() => void leave()} disabled={savingSettings} className="mt-3 text-sm font-medium text-destructive disabled:opacity-50">Salir del grupo</button>
    </div>}
    <main className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-5" data-testid="group-messages">
      {messages.length === 0 && <div className="mx-auto mt-12 max-w-xs text-center"><div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-secondary"><Users className="h-7 w-7 text-muted-foreground" /></div><p className="font-semibold">El grupo está listo 🖤</p><p className="mt-1 text-sm text-muted-foreground">Mandá el primer mensaje para empezar la conversación.</p></div>}
      {messages.filter(m => m.pinnedAt).length > 0 && <div className="mb-3 rounded-xl bg-secondary/70 px-3 py-2 text-xs"><Pin className="mr-1 inline h-3 w-3" /> {messages.filter(m => m.pinnedAt).length} mensaje(s) fijado(s)</div>}
      {messages.map(m => <div key={m.id} className={`flex items-end gap-2 ${m.senderId === me.id ? 'justify-end' : 'justify-start'}`}>
        {m.senderId !== me.id && <div className="shrink-0"><CharacterAvatar character={character(m.senderId) ?? me} size={30} /></div>}
        <div className={`max-w-[85%] rounded-2xl px-4 py-2 ${m.senderId === me.id ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`}>
          {m.senderId !== me.id && <p className="mb-1 text-xs font-semibold">{character(m.senderId)?.name ?? 'Participante'}</p>}
          {m.text && <p className="whitespace-pre-wrap break-words text-sm">{m.text}</p>}
          {!!m.attachments?.length && <div className="mt-2 flex flex-col gap-2">{m.attachments.map(a => a.type === 'music' ? <div key={a.id} className="rounded-xl border border-border bg-card p-3 text-foreground">
            <p className="mb-2 text-xs font-semibold">🎵 {a.title}</p>
            <audio controls preload="none" className="w-full max-w-64" src={`/api/music/published/${encodeURIComponent(a.trackId)}/audio`} />
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
        <MusicLibraryPicker onCancel={() => setShowMusicLibrary(false)} onSelect={async selection => {
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
    <form onSubmit={send} className="flex shrink-0 items-center gap-2 border-t border-border bg-background px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3">
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav" multiple className="hidden" onChange={e => { const files = Array.from(e.target.files ?? []); try { validateAttachments(files, pendingFiles.length); setPendingFiles(old => [...old, ...files]); setError(''); } catch (err) { setError((err as Error).message); } e.target.value = ''; }} />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={sending} aria-label="Adjuntar archivos" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary"><Paperclip className="h-5 w-5" /></button>
      <button type="button" onClick={() => void recorder.start()} disabled={recorder.status !== 'idle' || sending || pendingFiles.length >= 5} aria-label="Grabar nota de voz" className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary disabled:opacity-50"><Mic className="h-5 w-5" /></button>
      <input value={text} onChange={e => setText(e.target.value)} maxLength={10000} placeholder="Mensaje al grupo…" className="h-11 min-w-0 flex-1 rounded-full bg-secondary px-4 outline-none" aria-label="Mensaje al grupo" />
      <button disabled={(!text.trim() && !pendingFiles.length) || sending} aria-label="Enviar mensaje" className="grid h-11 w-11 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"><Send className="h-5 w-5" /></button>
    </form>
  </div>;
}
