import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { compressImage, uploadPrivateImage, useMediaResolver } from '@/lib/media';
import { BadgeCheck, Camera, Check, Pencil, X } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { useUser } from '@clerk/react';
import { ArrowLeft, ExternalLink, LockKeyhole, MessageCircle, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';

/**
 * Creator Hub is the real account owner's presentation, not a fictional identity.
 * Sharing and access requests intentionally remain disabled until the
 * recipient-scoped authorization API and legal consent are implemented.
 */
export default function CreatorHubPage() {
  const { user } = useUser();
  const customName = typeof user?.unsafeMetadata?.creatorHubDisplayName === 'string' ? user.unsafeMetadata.creatorHubDisplayName : '';
  const alias = customName || user?.fullName?.trim() || user?.firstName?.trim() || user?.username || 'Tu espacio Creator';
  const resolveImage = useMediaResolver();
  const avatarRef = typeof user?.unsafeMetadata?.creatorHubAvatar === 'string' ? user.unsafeMetadata.creatorHubAvatar : '';
  const bannerRef = typeof user?.unsafeMetadata?.creatorHubBanner === 'string' ? user.unsafeMetadata.creatorHubBanner : '';
  const avatarImage = avatarRef ? resolveImage(avatarRef) : '';
  const bannerImage = bannerRef ? resolveImage(bannerRef) : '';
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [adjustingAvatar, setAdjustingAvatar] = useState(false);
  const [avatarPosition, setAvatarPosition] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [savingPosition, setSavingPosition] = useState(false);
  const dragStart = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const storedAvatarPosition = user?.unsafeMetadata?.creatorHubAvatarPosition;
  const savedAvatarPosition = typeof storedAvatarPosition === 'object' && storedAvatarPosition !== null && 'x' in storedAvatarPosition && 'y' in storedAvatarPosition
    ? { x: Number(storedAvatarPosition.x) || 50, y: Number(storedAvatarPosition.y) || 50 }
    : { x: 50, y: 50 };
  function startAdjustingAvatar() {
    setAvatarPosition(savedAvatarPosition);
    setProfileError('');
    setAdjustingAvatar(true);
  }
  function moveAvatar(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const { x, y, originX, originY } = dragStart.current;
    const size = event.currentTarget.getBoundingClientRect().width;
    const scale = 100 / Math.max(size, 1);
    setAvatarPosition({
      x: Math.max(0, Math.min(100, originX - (event.clientX - x) * scale)),
      y: Math.max(0, Math.min(100, originY - (event.clientY - y) * scale)),
    });
  }
  async function saveAvatarPosition() {
    if (!user) return;
    setSavingPosition(true);
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubAvatarPosition: avatarPosition } });
      await user.reload();
      setAdjustingAvatar(false);
    } catch { setProfileError('No pudimos guardar el encuadre. Intentá nuevamente.'); }
    finally { setSavingPosition(false); }
  }
  const defaultBio = 'Tu espacio para presentar los mundos, personajes e historias que creás.';
  const savedBio = typeof user?.unsafeMetadata?.creatorHubBio === 'string' ? user.unsafeMetadata.creatorHubBio : '';
  const bio = savedBio || defaultBio;
  const [editingBio, setEditingBio] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const bioInputRef = useRef<HTMLTextAreaElement>(null);
  function formatBio(open: string, close: string) {
    const field = bioInputRef.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const selected = bioDraft.slice(start, end);
    const replacement = open + (selected || 'texto') + close;
    setBioDraft(bioDraft.slice(0, start) + replacement + bioDraft.slice(end));
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + open.length, start + replacement.length - close.length);
    });
  }
  function renderBio(value: string) {
    return value.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__)/g).map((part, index) => {
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('__') && part.endsWith('__')) return <u key={index}>{part.slice(2, -2)}</u>;
      if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
      return part;
    });
  }
  async function saveBio() {
    if (!user) return;
    const next = bioDraft.trim();
    if (next.length > 500) { setProfileError('La biografía puede tener hasta 500 caracteres.'); return; }
    setSavingBio(true); setProfileError('');
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubBio: next } });
      await user.reload();
      setEditingBio(false);
    } catch { setProfileError('No pudimos guardar la biografía. Intentá nuevamente.'); }
    finally { setSavingBio(false); }
  }
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [uploading, setUploading] = useState<'avatar' | 'banner' | null>(null);
  const [profileError, setProfileError] = useState('');
  const externalLink = typeof user?.unsafeMetadata?.creatorHubExternalLink === 'string' ? user.unsafeMetadata.creatorHubExternalLink : '';
  const [editingLink, setEditingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [savingLink, setSavingLink] = useState(false);
  async function saveLink() {
    if (!user) return;
    const raw = linkDraft.trim();
    let normalized = raw;
    if (raw && !/^https?:\/\//i.test(raw)) normalized = 'https://' + raw;
    if (normalized) {
      try {
        const parsed = new URL(normalized);
        if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.') || parsed.username || parsed.password || normalized.length > 500) throw new Error('invalid');
      } catch { setProfileError('Ingresá un enlace HTTPS válido, por ejemplo instagram.com/tuusuario.'); return; }
    }
    setSavingLink(true); setProfileError('');
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubExternalLink: normalized } });
      await user.reload();
      setEditingLink(false);
    } catch { setProfileError('No pudimos guardar el enlace. Probá de nuevo.'); }
    finally { setSavingLink(false); }
  }
  async function saveName() {
    const next = nameDraft.trim();
    if (next.length < 2 || next.length > 80) { setProfileError('El nombre debe tener entre 2 y 80 caracteres.'); return; }
    if (!user) return;
    setSaving(true); setProfileError('');
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubDisplayName: next } });
      await user.reload(); setEditingName(false);
    } catch { setProfileError('No pudimos guardar el nombre.'); }
    finally { setSaving(false); }
  }
  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>, kind: 'avatar' | 'banner') {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    event.target.value = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) { setProfileError('Elegí una imagen JPG, PNG o WebP de hasta 15 MB.'); return; }
    setUploading(kind); setProfileError('');
    try {
      const data = await compressImage(file, kind === 'avatar' ? 900 : 1920, 0.85);
      const ref = await uploadPrivateImage(data);
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, [kind === 'avatar' ? 'creatorHubAvatar' : 'creatorHubBanner']: ref, ...(kind === 'avatar' ? { creatorHubAvatarPosition: { x: 50, y: 50 } } : {}) } });
      await user.reload();
    } catch { setProfileError('No pudimos guardar la imagen. Probá nuevamente.'); }
    finally { setUploading(null); }
  }
  const defaultUsername = (user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'creator').toLowerCase().replace(/[^a-z0-9._]/g, '');
  const savedUsername = typeof user?.unsafeMetadata?.creatorHubUsername === 'string' ? user.unsafeMetadata.creatorHubUsername : '';
  const [registeredUsername, setRegisteredUsername] = useState('');
  const username = registeredUsername || savedUsername || defaultUsername;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [verificationRole, setVerificationRole] = useState<'owner_lifetime' | 'founder_lifetime' | null>(null);
  useEffect(() => {
    let active = true;
    void customFetch<{ lifetimeAccess?: string | null; billingExempt?: boolean }>('/api/account/entitlements', { responseType: 'json' })
      .then(data => { if (active) setVerificationRole(data.billingExempt === true && (data.lifetimeAccess === 'owner_lifetime' || data.lifetimeAccess === 'founder_lifetime') ? data.lifetimeAccess : null); })
      .catch(() => { if (active) setVerificationRole(null); });
    return () => { active = false; };
  }, [user?.id]);
  async function saveUsername() {
    const next = draft.trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9._]{3,30}$/.test(next)) { setError('Usá entre 3 y 30 caracteres: letras minúsculas, números, puntos o guiones bajos.'); return; }
    if (!user) return;
    setSaving(true); setError('');
    try {
      const registered = await customFetch<{ profile: { username: string } }>('/api/creator-hub/social/me', { method: 'PUT', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: alias, username: next, visibility: socialProfile?.visibility ?? 'private', messagePrivacy: socialProfile?.messagePrivacy ?? 'requests', bio: savedBio }) });
      setRegisteredUsername(registered.profile.username);
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubUsername: next } });
      await user.reload();
      setEditing(false);
    } catch (err) { setError(String(err).includes('409') || String(err).includes('USERNAME_ALREADY_IN_USE') ? 'Este @usuario ya está en uso. Elegí otro.' : 'No pudimos registrar el usuario. Intentá nuevamente.'); }
    finally { setSaving(false); }
  }
  // Social account preferences are stored server-side; Clerk metadata remains the
  // source for the existing visual profile until explicit profile synchronization.
  const [socialProfile, setSocialProfile] = useState<{ visibility: 'private' | 'public'; messagePrivacy: 'everyone' | 'requests' | 'nobody' } | null>(null);
  const [socialSaving, setSocialSaving] = useState(false);
  const [socialReady, setSocialReady] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    void customFetch<{ profile: { visibility: 'private' | 'public'; messagePrivacy: 'everyone' | 'requests' | 'nobody' } | null }>('/api/creator-hub/social/me', { responseType: 'json' })
      .then(data => { if (active) { setSocialProfile(data.profile); if (data.profile && 'username' in data.profile && typeof data.profile.username === 'string') setRegisteredUsername(data.profile.username); setSocialReady(true); } })
      .catch(() => { if (active) setSocialReady(false); });
    return () => { active = false; };
  }, [user?.id]);
  async function saveSocialPreferences(visibility: 'private' | 'public', messagePrivacy: 'everyone' | 'requests' | 'nobody') {
    if (!user || socialSaving) return;
    setSocialSaving(true); setProfileError('');
    try {
      const result = await customFetch<{ profile: { visibility: 'private' | 'public'; messagePrivacy: 'everyone' | 'requests' | 'nobody' } }>('/api/creator-hub/social/me', {
        method: 'PUT', responseType: 'json',
        body: JSON.stringify({ displayName: alias, username, visibility, messagePrivacy, bio: savedBio }),
        headers: { 'Content-Type': 'application/json' },
      });
      setSocialProfile(result.profile);
    } catch { setProfileError('No pudimos guardar la privacidad. Revisá que tu @usuario esté disponible y volvé a intentar.'); }
    finally { setSocialSaving(false); }
  }
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleResults, setPeopleResults] = useState<Array<{ ownerId: string; displayName: string; username: string; visibility: string; following: boolean; requested: boolean }>>([]);
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [peopleFeedback, setPeopleFeedback] = useState('');
  async function searchPeople() {
    if (peopleQuery.trim().length < 2) return;
    setPeopleBusy(true); setPeopleFeedback('');
    try {
      const data = await customFetch<{ profiles: typeof peopleResults }>('/api/creator-hub/social/search?q=' + encodeURIComponent(peopleQuery.trim()), { responseType: 'json' });
      setPeopleResults(data.profiles);
    } catch { setPeopleFeedback('No pudimos buscar personas.'); }
    finally { setPeopleBusy(false); }
  }
  async function requestMessage(ownerId: string) {
    setPeopleBusy(true); setPeopleFeedback('');
    try {
      const result = await customFetch<{ status: 'requested' | 'allowed' | 'accepted' }>('/api/creator-hub/social/message-requests', {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOwnerId: ownerId }),
      });
      if (result.status === 'requested') setPeopleFeedback('Solicitud enviada. Aparecerá en la bandeja de esa persona.');
      else { setPeopleFeedback('Podés escribirle.'); const person = peopleResults.find(item => item.ownerId === ownerId); await openHumanChat(ownerId, person?.displayName ?? 'esta persona'); }
    } catch { setPeopleFeedback('No se pudo enviar la solicitud. Puede que la persona no acepte mensajes.'); }
    finally { setPeopleBusy(false); }
  }
  const [activeChat, setActiveChat] = useState<{ ownerId: string; name: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; senderOwnerId: string; body: string; createdAt: string; reactions?: Array<{ emoji: string; ownerId: string }> }>>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [otherTyping, setOtherTyping] = useState(false);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reactingMessage, setReactingMessage] = useState<string | null>(null);
  async function refreshHumanChat(ownerId: string) {
    const [history, presence] = await Promise.all([
      customFetch<{ messages: typeof chatMessages }>('/api/creator-hub/social/messages/' + encodeURIComponent(ownerId), { responseType: 'json' }),
      customFetch<{ typing: boolean }>('/api/creator-hub/social/typing/' + encodeURIComponent(ownerId), { responseType: 'json' }),
    ]);
    setChatMessages(history.messages);
    setOtherTyping(presence.typing);
  }
  useEffect(() => {
    if (!activeChat) return;
    const ownerId = activeChat.ownerId;
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void refreshHumanChat(ownerId).catch(() => {}); }, 3000);
    return () => {
      clearInterval(interval);
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      void customFetch('/api/creator-hub/social/typing', { method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetOwnerId: ownerId, typing: false }) }).catch(() => {});
    };
  }, [activeChat?.ownerId]);
  function updateChatDraft(value: string) {
    setChatDraft(value);
    if (!activeChat) return;
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    void customFetch('/api/creator-hub/social/typing', { method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetOwnerId: activeChat.ownerId, typing: Boolean(value.trim()) }) }).catch(() => {});
    if (value.trim()) typingTimeout.current = setTimeout(() => {
      void customFetch('/api/creator-hub/social/typing', { method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetOwnerId: activeChat.ownerId, typing: false }) }).catch(() => {});
    }, 4500);
  }
  async function toggleReaction(messageId: string, emoji: string, alreadyReacted: boolean) {
    if (!activeChat) return;
    try {
      await customFetch('/api/creator-hub/social/reactions', { method: alreadyReacted ? 'DELETE' : 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messageId, emoji }) });
      await refreshHumanChat(activeChat.ownerId);
    } catch { setChatError('No pudimos guardar la reacción.'); }
  }

  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  async function openHumanChat(ownerId: string, name: string) {
    setActiveChat({ ownerId, name }); setChatError('');
    try {
      const result = await customFetch<{ messages: typeof chatMessages }>('/api/creator-hub/social/messages/' + encodeURIComponent(ownerId), { responseType: 'json' });
      setChatMessages(result.messages); setOtherTyping(false);
    } catch { setChatError('No pudimos abrir esta conversación.'); }
  }
  async function sendHumanMessage() {
    if (!activeChat || !chatDraft.trim() || chatBusy) return;
    setChatBusy(true); setChatError('');
    try {
      await customFetch('/api/creator-hub/social/messages', { method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetOwnerId: activeChat.ownerId, body: chatDraft.trim() }) });
      setChatDraft('');
      await openHumanChat(activeChat.ownerId, activeChat.name);
    } catch { setChatError('No se pudo enviar. Puede que necesites una solicitud aceptada.'); }
    finally { setChatBusy(false); }
  }
  const [followInbox, setFollowInbox] = useState<Array<{ id: string; displayName: string; username: string }>>([]);
  const [messageInbox, setMessageInbox] = useState<Array<{ id: string; displayName: string; username: string }>>([]);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [inboxError, setInboxError] = useState('');
  async function refreshInbox() {
    try {
      const [follows, messages] = await Promise.all([
        customFetch<{ requests: typeof followInbox }>('/api/creator-hub/social/requests', { responseType: 'json' }),
        customFetch<{ requests: typeof messageInbox }>('/api/creator-hub/social/message-requests', { responseType: 'json' }),
      ]);
      setFollowInbox(follows.requests); setMessageInbox(messages.requests); setInboxError('');
    } catch { setInboxError('No se pudieron cargar las solicitudes.'); }
  }
  useEffect(() => {
    if (socialReady && user?.id) void refreshInbox();
  }, [socialReady, user?.id]);
  async function decideInbox(kind: 'requests' | 'message-requests', id: string, action: 'accept' | 'reject') {
    setInboxBusy(true); setInboxError('');
    try {
      await customFetch('/api/creator-hub/social/' + kind + '/' + encodeURIComponent(id) + '/' + action, { method: 'POST', responseType: 'json' });
      await refreshInbox();
    } catch { setInboxError('No se pudo actualizar la solicitud.'); }
    finally { setInboxBusy(false); }
  }
  const nameParts = alias.split(/\s+/).filter(Boolean);
  const initials = nameParts.length > 1
    ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
    : (nameParts[0]?.slice(0, 2).toUpperCase() || 'EC');
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="relative z-20 flex min-h-[88px] shrink-0 items-center justify-between gap-2 px-4 pb-4 pt-[calc(env(safe-area-inset-top,0px)+24px)] text-foreground sm:min-h-[92px] lg:px-8 lg:pt-6">
        <Link href="/" aria-label="Volver al feed de ECHO" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-black/45 px-3 text-sm font-medium backdrop-blur-md hover:bg-black/65"><ArrowLeft size={19} /><span className="hidden sm:inline">Volver al feed de ECHO</span><span className="sm:hidden">Volver</span></Link>
        <Link href="/" aria-label="ECHO — ir al inicio" className="wordmark absolute left-1/2 -translate-x-1/2 text-[28px] leading-none text-foreground sm:text-[32px]">ECHO</Link>
        <h1 className="text-sm font-semibold text-muted-foreground sm:text-base">Creator Hub</h1>
      </header>
      <div className="flex w-full flex-1 flex-col justify-center px-0 pb-6 lg:py-8">
        <section className="w-full overflow-hidden bg-card lg:mx-auto lg:max-w-6xl lg:rounded-[28px] lg:border lg:border-border" aria-label="Perfil Creator Hub">
          <div className="relative flex h-48 flex-col items-center justify-center gap-2 sm:h-60 lg:h-64 bg-[linear-gradient(130deg,hsl(263_18%_19%),hsl(336_15%_16%))] text-muted-foreground">
            {bannerImage ? <img src={bannerImage} alt="Banner de Creator Hub" className="absolute inset-0 h-full w-full object-cover" /> : <span className="select-none text-[clamp(4rem,14vw,9rem)] font-black tracking-[-0.08em] text-white/20" aria-hidden="true">{initials}</span>}
            <input ref={bannerInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Seleccionar banner" onChange={e => void uploadPhoto(e, 'banner')} />
            <button type="button" disabled={uploading !== null} onClick={() => bannerInput.current?.click()} className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><Camera size={15}/>{uploading === 'banner' ? 'Subiendo…' : 'Editar banner'}</button>
          </div>
          <div className="mx-auto w-full max-w-5xl space-y-5 px-5 py-6 sm:px-10 lg:py-7">
            <div className="flex items-start gap-3 sm:items-center">
              <div className="relative shrink-0">
                <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-background bg-secondary text-2xl font-semibold leading-none sm:h-28 sm:w-28" aria-label={`Avatar de ${alias}`}>{avatarImage ? <img src={avatarImage} alt="" className="h-full w-full object-cover" style={{ objectPosition: `${savedAvatarPosition.x}% ${savedAvatarPosition.y}%` }} /> : <span className="block text-center leading-none">{initials}</span>}</span>
                <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label="Seleccionar foto de perfil" onChange={e => void uploadPhoto(e, 'avatar')} />
                <button type="button" disabled={uploading !== null} onClick={() => avatarImage ? startAdjustingAvatar() : avatarInput.current?.click()} aria-label={avatarImage ? "Ajustar foto de perfil" : "Subir foto de perfil"} className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-foreground disabled:opacity-50"><Camera size={15}/></button>
              </div>
              <div className="min-w-0 flex-1 pt-3 sm:pt-0">
                <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">{editingName ? <div className="flex min-w-0 items-center gap-1"><input aria-label="Nombre de creador" value={nameDraft} maxLength={80} onChange={e => setNameDraft(e.target.value)} className="min-w-0 rounded-lg border border-border bg-background px-2 py-1 text-sm" /><button type="button" disabled={saving} aria-label="Guardar nombre" onClick={() => void saveName()}><Check size={17}/></button><button type="button" aria-label="Cancelar edición de nombre" onClick={() => setEditingName(false)}><X size={17}/></button></div> : <div className="flex min-w-0 items-center gap-1"><h2 className="min-w-0 truncate text-lg font-semibold leading-tight sm:text-3xl">{alias}</h2><button type="button" aria-label="Editar nombre" onClick={() => {setNameDraft(alias);setProfileError('');setEditingName(true);}} className="shrink-0 p-1 text-muted-foreground"><Pencil size={15}/></button></div>}{verificationRole && <span title="Cuenta verificada de ECHO" aria-label="Cuenta verificada de ECHO"><BadgeCheck className="h-5 w-5 shrink-0 fill-primary text-primary-foreground sm:h-6 sm:w-6" /></span>}</div>
                {verificationRole && <p className="mt-1 text-xs font-semibold text-primary">{verificationRole === "owner_lifetime" ? "CEO & Founder of ECHO" : "First ECHO Tester"}</p>}
                {editing ? <div className="mt-2 space-y-2"><div className="flex items-center gap-2"><span className="text-muted-foreground">@</span><input aria-label="Nuevo nombre de usuario" value={draft} maxLength={30} onChange={e => setDraft(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" /><button type="button" aria-label="Guardar usuario" disabled={saving} onClick={() => void saveUsername()} className="rounded-full p-2 text-primary disabled:opacity-50"><Check size={18}/></button><button type="button" aria-label="Cancelar edición" onClick={() => {setEditing(false);setError('');}} className="rounded-full p-2"><X size={18}/></button></div>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<p className="text-xs text-muted-foreground">Este alias es independiente de tu email de inicio de sesión.</p></div> : <div className="mt-1 flex items-center gap-2"><p className="truncate text-sm text-muted-foreground">@{username}</p><button type="button" aria-label="Editar nombre de usuario" title="Editar nombre de usuario" onClick={() => {setDraft(username);setError('');setEditing(true);}} className="rounded-full p-1 text-muted-foreground hover:text-foreground"><Pencil size={15}/></button></div>}
              </div>
              <span className="hidden shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground sm:inline-flex">{socialProfile?.visibility === "public" ? "Perfil público" : "Perfil privado"}</span>
            </div>
            {profileError && <p role="alert" className="text-xs text-destructive">{profileError}</p>}
            {editingBio ? <div className="space-y-2"><div className="flex items-center gap-2" role="toolbar" aria-label="Formato de biografía"><button type="button" onClick={() => formatBio('**', '**')} aria-label="Negrita" title="Negrita" className="rounded-lg border border-border px-3 py-1.5 text-sm font-bold">B</button><button type="button" onClick={() => formatBio('*', '*')} aria-label="Cursiva" title="Cursiva" className="rounded-lg border border-border px-3 py-1.5 text-sm italic">I</button><button type="button" onClick={() => formatBio('__', '__')} aria-label="Subrayado" title="Subrayado" className="rounded-lg border border-border px-3 py-1.5 text-sm underline">U</button></div><textarea ref={bioInputRef} aria-label="Biografía de Creator Hub" value={bioDraft} maxLength={500} rows={3} onChange={e => setBioDraft(e.target.value)} placeholder="Contá algo sobre vos…" className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" /><div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{bioDraft.length}/500 caracteres</span><div className="flex gap-2"><button type="button" onClick={() => setEditingBio(false)} className="rounded-full border border-border px-3 py-2 text-xs">Cancelar</button><button type="button" disabled={savingBio} onClick={() => void saveBio()} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{savingBio ? 'Guardando…' : 'Guardar biografía'}</button></div></div></div> : <div className="flex items-start gap-2"><p className="min-w-0 max-w-fit whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{renderBio(bio)}</p><button type="button" aria-label="Editar biografía" title="Editar biografía" onClick={() => { setBioDraft(savedBio); setProfileError(''); setEditingBio(true); }} className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"><Pencil size={15}/></button></div>}
            <div className="space-y-2">
              {editingLink ? <div className="flex items-center gap-2"><ExternalLink size={16} className="shrink-0 text-muted-foreground" /><input aria-label="Enlace externo de Creator Hub" type="url" value={linkDraft} maxLength={500} onChange={e => setLinkDraft(e.target.value)} placeholder="https://instagram.com/tuusuario" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" /><button type="button" disabled={savingLink} onClick={() => void saveLink()} aria-label="Guardar enlace" className="p-2 text-primary disabled:opacity-50"><Check size={18}/></button><button type="button" onClick={() => setEditingLink(false)} aria-label="Cancelar enlace" className="p-2"><X size={18}/></button></div> : <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><ExternalLink size={16} className="shrink-0" />{externalLink ? <a href={externalLink} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate underline underline-offset-4 hover:text-foreground">{(() => { try { const url = new URL(externalLink); const handle = url.pathname.split('/').filter(Boolean)[0]; return /(^|\.)instagram\.com$/i.test(url.hostname) && handle ? `Instagram · @${handle}` : url.hostname.replace(/^www\./, ''); } catch { return 'Ver enlace'; } })()}</a> : <span>Enlace externo opcional</span>}<button type="button" aria-label="Editar enlace externo" onClick={() => {setLinkDraft(externalLink);setProfileError('');setEditingLink(true);}} className="shrink-0 rounded-full p-1 hover:text-foreground"><Pencil size={15}/></button></div>}
            </div>
            <div className="rounded-2xl border border-border p-4 space-y-4">
              <h3 className="font-semibold">Privacidad de Creator Hub</h3>
              {!socialReady ? <p className="text-sm text-muted-foreground">Los ajustes sociales estarán disponibles cuando se habilite el servidor de Creator Hub.</p> : <>
                <label className="block space-y-2 text-sm"><span>Visibilidad del perfil</span>
                  <select aria-label="Visibilidad del perfil" disabled={socialSaving} value={socialProfile?.visibility ?? 'private'} onChange={e => void saveSocialPreferences(e.target.value as 'private' | 'public', socialProfile?.messagePrivacy ?? 'requests')} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                    <option value="private">Privado · aprobar seguidores</option><option value="public">Público · cualquiera puede seguirte</option>
                  </select>
                </label>
                <label className="block space-y-2 text-sm"><span>Quién puede enviarte mensajes</span>
                  <select aria-label="Privacidad de mensajes" disabled={socialSaving} value={socialProfile?.messagePrivacy ?? 'requests'} onChange={e => void saveSocialPreferences(socialProfile?.visibility ?? 'private', e.target.value as 'everyone' | 'requests' | 'nobody')} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                    <option value="everyone">Todos</option><option value="requests">Solicitudes · revisar antes de aceptar</option><option value="nobody">Nadie puede iniciar un chat</option>
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">La privacidad de mensajes es independiente de la visibilidad del perfil. Los mensajes estarán disponibles cuando se habilite su sistema de moderación.</p>
              </>}
            </div>
            <div className="rounded-2xl border border-border p-4 space-y-3">
              <h3 className="font-semibold">Buscar personas</h3>
              <div className="flex gap-2"><input aria-label="Buscar por nombre o arroba" value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void searchPeople(); }} placeholder="Nombre o @usuario" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" /><button type="button" disabled={peopleBusy || peopleQuery.trim().length < 2} onClick={() => void searchPeople()} className="rounded-full bg-secondary px-4 py-2 text-sm disabled:opacity-50">Buscar</button></div>
              {peopleFeedback && <p role="status" className="text-xs text-muted-foreground">{peopleFeedback}</p>}
              {peopleResults.map(person => (
                <div key={person.ownerId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/50 px-3 py-3">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{person.displayName}</p><p className="truncate text-xs text-muted-foreground">@{person.username} · {person.visibility === 'private' ? 'Privado' : 'Público'}</p></div>
                  <button type="button" disabled={peopleBusy} onClick={() => void requestMessage(person.ownerId)} className="rounded-full border border-border px-3 py-2 text-xs disabled:opacity-50">Mensaje privado</button>
                </div>
              ))}
            </div>
            {activeChat && <div className="rounded-2xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between"><h3 className="font-semibold">Chat con {activeChat.name}</h3><button type="button" onClick={() => void openHumanChat(activeChat.ownerId, activeChat.name)} className="text-xs text-primary">Actualizar</button></div>
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl bg-secondary/30 p-3">
                {chatMessages.length === 0 && <p className="text-xs text-muted-foreground">Todavía no hay mensajes.</p>}
                {chatMessages.map(message => <div key={message.id} className={`flex flex-col ${message.senderOwnerId === user?.id ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words ${message.senderOwnerId === user?.id ? 'bg-primary text-primary-foreground' : 'bg-background'}`}>{message.body}</div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {message.reactions?.map((reaction, index) => <span key={index} className="text-xs">{reaction.emoji}</span>)}
                    <button type="button" onClick={() => setReactingMessage(reactingMessage === message.id ? null : message.id)} aria-label="Reaccionar" className="rounded-full px-2 text-xs text-muted-foreground hover:bg-secondary">☺ +</button>
                  </div>
                  {reactingMessage === message.id && <div className="flex flex-wrap gap-1 rounded-xl bg-background p-1">
                    {['❤️','😂','🥹','😍','👍','🔥','😮','😢'].map(emoji => <button type="button" key={emoji} onClick={() => { setReactingMessage(null); void toggleReaction(message.id, emoji, Boolean(message.reactions?.some(r => r.emoji === emoji && r.ownerId === user?.id))); }} className="rounded-lg p-1 hover:bg-secondary" aria-label={`Reaccionar con ${emoji}`}>{emoji}</button>)}
                  </div>}
                </div>)}
                {otherTyping && <div aria-live="polite" className="flex items-center gap-1 text-xs text-muted-foreground"><span>{activeChat.name} está escribiendo</span><span className="animate-pulse">● ● ●</span></div>}
              </div>
              {chatError && <p role="alert" className="text-xs text-destructive">{chatError}</p>}
              <div className="flex gap-2"><input aria-label="Escribir mensaje" value={chatDraft} maxLength={2000} onChange={e => updateChatDraft(e.target.value)} placeholder="Escribí un mensaje…" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"/><button type="button" disabled={chatBusy || !chatDraft.trim()} onClick={() => void sendHumanMessage()} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">Enviar</button></div>
            </div>}
            <div className="rounded-2xl border border-border p-4 space-y-4">
              <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Bandeja de solicitudes</h3><button type="button" onClick={() => void refreshInbox()} className="text-xs text-primary">Actualizar</button></div>
              {inboxError && <p role="alert" className="text-xs text-destructive">{inboxError}</p>}
              {([['Seguidores', followInbox, 'requests'], ['Mensajes', messageInbox, 'message-requests']] as const).map(([label, requests, kind]) => (
                <div key={kind} className="space-y-2">
                  <h4 className="text-sm font-medium">{label} · {requests.length}</h4>
                  {requests.length === 0 ? <p className="text-xs text-muted-foreground">No hay solicitudes pendientes.</p> : requests.map(request => (
                    <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/50 px-3 py-3">
                      <div className="min-w-0"><p className="truncate text-sm font-medium">{request.displayName}</p><p className="truncate text-xs text-muted-foreground">@{request.username}</p></div>
                      <div className="flex gap-2"><button type="button" disabled={inboxBusy} onClick={() => void decideInbox(kind, request.id, 'reject')} className="rounded-full border border-border px-3 py-2 text-xs disabled:opacity-50">Rechazar</button><button type="button" disabled={inboxBusy} onClick={() => void decideInbox(kind, request.id, 'accept')} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">Aceptar</button></div>
                    </div>
                  ))}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">La mensajería real se habilitará después de validar sus controles de privacidad.</p>
            </div>
            <div className="border-t border-border pt-5">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" disabled title="Las solicitudes de acceso todavía no están habilitadas" className="rounded-full bg-secondary px-3 py-3 text-sm font-semibold text-muted-foreground opacity-70">Solicitar acceso</button>
                <button type="button" disabled title="Los mensajes Creator Hub todavía no están habilitados" className="flex items-center justify-center gap-2 rounded-full border border-border px-3 py-3 text-sm text-muted-foreground opacity-60"><MessageCircle size={16} /> Mensaje privado</button>
              </div>
              <div className="mt-5 rounded-2xl bg-secondary/70 px-5 py-8 text-center sm:py-10">
                <LockKeyhole size={23} className="mx-auto mb-3 text-muted-foreground" />
                <h3 className="font-semibold">Contenido privado</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Los personajes y universos compartidos solo serán visibles después de que el creador autorice el acceso.</p>
              </div>
            </div>
          </div>
        </section>
        <p className="mx-auto mt-4 flex max-w-5xl items-start gap-2 px-6 pb-4 text-xs leading-relaxed text-muted-foreground"><ShieldCheck size={16} className="mt-0.5 shrink-0" /> Esta es la base visual de Creator Hub. Las solicitudes de acceso y el contenido compartido se habilitarán cuando existan controles de privacidad completos. Ningún universo se publica automáticamente.</p>
      </div>
      {adjustingAvatar && avatarImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 px-5 py-8" role="dialog" aria-modal="true" aria-label="Ajustar foto de perfil">
          <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-2xl">
            <h2 className="text-xl font-semibold">Ajustar foto de perfil</h2>
            <p className="mt-2 text-sm text-muted-foreground">Arrastrá la imagen para centrarla dentro del círculo.</p>
            <div
              className="relative mx-auto mt-6 h-64 w-64 max-w-full overflow-hidden rounded-full border-4 border-primary/40 bg-secondary touch-none cursor-grab active:cursor-grabbing"
              onPointerDown={event => {
                event.currentTarget.setPointerCapture(event.pointerId);
                dragStart.current = { x: event.clientX, y: event.clientY, originX: avatarPosition.x, originY: avatarPosition.y };
              }}
              onPointerMove={moveAvatar}
              onPointerUp={() => { dragStart.current = null; }}
              onPointerCancel={() => { dragStart.current = null; }}
            >
              <img src={avatarImage} alt="Vista previa del encuadre" draggable={false} className="h-full w-full select-none object-cover pointer-events-none" style={{ objectPosition: `${avatarPosition.x}% ${avatarPosition.y}%` }} />
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button type="button" className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => { setAdjustingAvatar(false); avatarInput.current?.click(); }}>Cambiar foto</button>
              <button type="button" className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => setAvatarPosition({ x: 50, y: 50 })}>Centrar</button>
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" disabled={savingPosition} className="flex-1 rounded-full border border-border px-4 py-3 text-sm" onClick={() => setAdjustingAvatar(false)}>Cancelar</button>
              <button type="button" disabled={savingPosition} className="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60" onClick={() => void saveAvatarPosition()}>{savingPosition ? 'Guardando…' : 'Guardar posición'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
