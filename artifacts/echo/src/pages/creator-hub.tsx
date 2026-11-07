import { useCreatorHubDmStatus, useCreatorHubDmCopy, markCreatorHubDmRead, refreshCreatorHubDmStatus } from '@/lib/creator-hub-notifications';
import { HumanVoicePlayback, HumanVoiceRecorder } from '@/components/echo/human-voice-note';
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { compressImage, uploadPrivateImage, uploadPublicationImage, useMediaResolver } from '@/lib/media';
import { BadgeCheck, Camera, Check, Pencil, X, Compass, Settings2, MessagesSquare, UserRound, ChevronDown } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { useUser } from '@clerk/react';
import { ArrowLeft, ExternalLink, LockKeyhole, MessageCircle, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { useCreatorTranslation } from '@/lib/i18n';
import { useCreatorHubText } from '@/lib/creator-hub-translations';

/**
 * Creator Hub is the real account owner's presentation, not a fictional identity.
 * Sharing and access requests intentionally remain disabled until the
 * recipient-scoped authorization API and legal consent are implemented.
 */
/** Safe, text-only inline formatting. No HTML interpretation or injection. */
function RichPublicationText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|__([^_\n]+)__)/g;
  let last = 0; let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const key = match.index;
    parts.push(match[2] ? <strong key={key}>{match[2]}</strong> : match[3] ? <em key={key}>{match[3]}</em> : <u key={key}>{match[4]}</u>);
    last = pattern.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export default function CreatorHubPage() {
  const { user } = useUser();
  const ct = useCreatorTranslation();
  const ht = useCreatorHubText();
  const dmStatus = useCreatorHubDmStatus();
  const dmCopy = useCreatorHubDmCopy();
  const unreadDmPeers = new Set(dmStatus.items.filter(item => item.unread).map(item => item.ownerId));
  const [dmPreferenceSaving, setDmPreferenceSaving] = useState(false);
  const [hubTab, setHubTab] = useState<'perfil' | 'explorar' | 'mensajes' | 'ajustes'>('perfil');
  type Publication = {id:string;kind:'character'|'world'|'update'|'post';title:string;body:string;visibility:'public'|'followers'|'private';pinned:boolean;coverPath?:string|null;createdAt:string};
  const [publications,setPublications] = useState<Publication[]>([]);
  const canPostOfficialUpdates = user?.id === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ';
  const resolvePublicationMedia = useMediaResolver();
  const [publicationFile,setPublicationFile] = useState<File|null>(null);
  const [publicationPreview,setPublicationPreview] = useState<string|null>(null);
  useEffect(()=>{if (!publicationFile) {setPublicationPreview(null);return;} const url=URL.createObjectURL(publicationFile);setPublicationPreview(url);return ()=>URL.revokeObjectURL(url);},[publicationFile]);
  const [publicationKind,setPublicationKind] = useState<Publication['kind']>('post');
  const [publicationTitle,setPublicationTitle] = useState('');
  const [publicationBody,setPublicationBody] = useState('');
  const [editingPublicationId,setEditingPublicationId] = useState<string|null>(null);
  const [editingCoverPath,setEditingCoverPath] = useState<string|null>(null);
  const publicationTitleRef = useRef<HTMLInputElement>(null);
  const publicationBodyRef = useRef<HTMLTextAreaElement>(null);
  const formatPublication = (field: 'title' | 'body', style: 'bold' | 'italic' | 'underline') => {
    const el = field === 'title' ? publicationTitleRef.current : publicationBodyRef.current;
    if (!el) return;
    const value = field === 'title' ? publicationTitle : publicationBody;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? start;
    const marker = style === 'bold' ? '**' : style === 'italic' ? '*' : '__';
    const selection = value.slice(start, end) || (style === 'bold' ? 'texto' : style === 'italic' ? 'texto' : 'texto');
    const next = value.slice(0, start) + marker + selection + marker + value.slice(end);
    if (next.length > (field === 'title' ? 180 : 5000)) return;
    if (field === 'title') setPublicationTitle(next); else setPublicationBody(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + marker.length, start + marker.length + selection.length); });
  };
  const publicationFormatButtons = (field: 'title' | 'body') => <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={field === 'title' ? 'Formato del título' : 'Formato del texto'}>
    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => formatPublication(field, 'bold')} className="rounded-lg border border-border px-3 py-1.5 text-sm font-bold" aria-label="Negrita" title="Negrita">B</button>
    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => formatPublication(field, 'italic')} className="rounded-lg border border-border px-3 py-1.5 text-sm italic" aria-label="Cursiva" title="Cursiva">I</button>
    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => formatPublication(field, 'underline')} className="rounded-lg border border-border px-3 py-1.5 text-sm underline" aria-label="Subrayado" title="Subrayado">U</button>
  </div>;

  const [publicationVisibility,setPublicationVisibility] = useState<Publication['visibility']>('public');
  const [publicationPinned,setPublicationPinned] = useState(false);
  const [publicationComposer,setPublicationComposer] = useState(false);
  const [publicationBusy,setPublicationBusy] = useState(false);
  const [publicationError,setPublicationError] = useState('');
  const [publicationLoadError,setPublicationLoadError] = useState(false);
  const [publicationFilter,setPublicationFilter] = useState<'all'|Publication['kind']>('all');
  async function refreshPublications() {
    try {
      const result=await customFetch<{publications:Publication[]}>('/api/creator-hub/social/publications/me',{responseType:'json'});
      setPublications(result.publications);
      setPublicationLoadError(false);
    } catch { setPublicationLoadError(true); }
  }
  function editPublication(item:Publication) {
    setEditingPublicationId(item.id);setEditingCoverPath(item.coverPath??null);
    setPublicationKind(item.kind);setPublicationTitle(item.title);setPublicationBody(item.body);
    setPublicationVisibility(item.visibility);setPublicationPinned(item.pinned);
    setPublicationFile(null);setPublicationError('');setPublicationComposer(true);
    requestAnimationFrame(()=>document.getElementById('echo-publication-composer')?.scrollIntoView({behavior:'smooth',block:'start'}));
  }
  function closePublicationComposer() {
    setPublicationComposer(false);setEditingPublicationId(null);setEditingCoverPath(null);setPublicationFile(null);setPublicationError('');
  }
  async function publishCreatorContent() {
    if (!publicationTitle.trim() || publicationBusy) return;
    setPublicationBusy(true);setPublicationError('');
    try {
      const coverPath=publicationFile ? await uploadPublicationImage(publicationFile) : editingPublicationId ? editingCoverPath : null;
      await customFetch(editingPublicationId ? '/api/creator-hub/social/publications/'+encodeURIComponent(editingPublicationId) : '/api/creator-hub/social/publications',{method:editingPublicationId?'PATCH':'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:publicationKind,title:publicationTitle.trim(),body:publicationBody,visibility:publicationVisibility,pinned:publicationPinned,coverPath})});
      closePublicationComposer();setPublicationTitle('');setPublicationBody('');setPublicationPinned(false);
      await refreshPublications();
    } catch {setPublicationError(ht("No se pudo publicar. Revisá tu perfil y volvé a intentar."));}
    finally {setPublicationBusy(false);}
  }
  useEffect(()=>{if(user?.id)void refreshPublications();},[user?.id]);

  const customName = typeof user?.unsafeMetadata?.creatorHubDisplayName === 'string' ? user.unsafeMetadata.creatorHubDisplayName : '';
  const alias = customName || user?.fullName?.trim() || user?.firstName?.trim() || user?.username || ht('Tu espacio Creator');
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
    } catch { setProfileError(ht("No pudimos guardar el encuadre. Intentá nuevamente.")); }
    finally { setSavingPosition(false); }
  }
  const defaultBio = ht('Tu espacio para presentar los mundos, personajes e historias que creás.');
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
    if (next.length > 500) { setProfileError(ht("La biografía puede tener hasta 500 caracteres.")); return; }
    setSavingBio(true); setProfileError('');
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubBio: next } });
      await user.reload();
      setEditingBio(false);
    } catch { setProfileError(ht("No pudimos guardar la biografía. Intentá nuevamente.")); }
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
      } catch { setProfileError(ht("Ingresá un enlace HTTPS válido, por ejemplo instagram.com/tuusuario.")); return; }
    }
    setSavingLink(true); setProfileError('');
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubExternalLink: normalized } });
      await user.reload();
      setEditingLink(false);
    } catch { setProfileError(ht("No pudimos guardar el enlace. Probá de nuevo.")); }
    finally { setSavingLink(false); }
  }
  async function saveName() {
    const next = nameDraft.trim();
    if (next.length < 2 || next.length > 80) { setProfileError(ht("El nombre debe tener entre 2 y 80 caracteres.")); return; }
    if (!user) return;
    setSaving(true); setProfileError('');
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubDisplayName: next } });
      await user.reload(); setEditingName(false);
    } catch { setProfileError(ht("No pudimos guardar el nombre.")); }
    finally { setSaving(false); }
  }
  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>, kind: 'avatar' | 'banner') {
    const file = event.target.files?.[0];
    if (!file || !user) return;
    event.target.value = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) { setProfileError(ht("Elegí una imagen JPG, PNG o WebP de hasta 15 MB.")); return; }
    setUploading(kind); setProfileError('');
    try {
      const data = await compressImage(file, kind === 'avatar' ? 900 : 1920, 0.85);
      const ref = await uploadPrivateImage(data);
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, [kind === 'avatar' ? 'creatorHubAvatar' : 'creatorHubBanner']: ref, ...(kind === 'avatar' ? { creatorHubAvatarPosition: { x: 50, y: 50 } } : {}) } });
      await user.reload();
    } catch { setProfileError(ht("No pudimos guardar la imagen. Probá nuevamente.")); }
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
    if (!/^[a-z0-9._]{3,30}$/.test(next)) { setError(ht("Usá entre 3 y 30 caracteres: letras minúsculas, números, puntos o guiones bajos.")); return; }
    if (!user) return;
    setSaving(true); setError('');
    try {
      const registered = await customFetch<{ profile: { username: string } }>('/api/creator-hub/social/me', { method: 'PUT', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: alias, username: next, visibility: socialProfile?.visibility ?? 'private', messagePrivacy: socialProfile?.messagePrivacy ?? 'requests', bio: savedBio }) });
      setRegisteredUsername(registered.profile.username);
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, creatorHubUsername: next } });
      await user.reload();
      setEditing(false);
    } catch (err) { setError(String(err).includes('409') || String(err).includes('USERNAME_ALREADY_IN_USE') ? ht("Este @usuario ya está en uso. Elegí otro.") : ht("No pudimos registrar el usuario. Intentá nuevamente.")); }
    finally { setSaving(false); }
  }
  // Social account preferences are stored server-side; Clerk metadata remains the
  // source for the existing visual profile until explicit profile synchronization.
  const [socialProfile, setSocialProfile] = useState<{ visibility: 'private' | 'public'; messagePrivacy: 'everyone' | 'requests' | 'nobody' } | null>(null);
  const [followCounts, setFollowCounts] = useState<{ followers: number; following: number } | null>(null);
  useEffect(() => {
    if (!user?.id) { setFollowCounts(null); return; }
    let active = true;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void customFetch<{ followers: number; following: number }>('/api/creator-hub/social/follow-counts', { responseType: 'json' })
        .then(data => { if (active) setFollowCounts(data); })
        .catch(() => {});
    };
    refresh();
    const interval = setInterval(refresh, 15000);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [user?.id]);
  const [followListKind, setFollowListKind] = useState<'followers' | 'following' | null>(null);
  const [followListRows, setFollowListRows] = useState<Array<{ ownerId: string; displayName: string; username: string; visibility: string; following: boolean; requested: boolean }>>([]);
  const [followListLoading, setFollowListLoading] = useState(false);
  const [followListError, setFollowListError] = useState('');
  useEffect(() => {
    if (!followListKind) return;
    let active = true;
    setFollowListLoading(true);
    setFollowListError('');
    void customFetch<{ profiles: typeof followListRows }>('/api/creator-hub/social/follow-list/' + followListKind, { responseType: 'json' })
      .then(data => { if (active) setFollowListRows(data.profiles); })
      .catch(() => { if (active) setFollowListError(ht("No se pudo cargar la lista.")); })
      .finally(() => { if (active) setFollowListLoading(false); });
    return () => { active = false; };
  }, [followListKind]);
  const [socialSaving, setSocialSaving] = useState(false);
  const [socialReady, setSocialReady] = useState(false);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    void customFetch<{ profile: { visibility: 'private' | 'public'; messagePrivacy: 'everyone' | 'requests' | 'nobody' } | null }>('/api/creator-hub/social/me', { responseType: 'json' })
      .then(async data => {
        if (!active) return;
        if (data.profile) {
          setSocialProfile(data.profile);
          if ('username' in data.profile && typeof data.profile.username === 'string') setRegisteredUsername(data.profile.username);
          setSocialReady(true);
          return;
        }
        // An existing ECHO account must be discoverable without manually saving
        // Creator Hub settings. Keep new profiles private by default.
        const base = (savedUsername || user.username || defaultUsername)
          .toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30);
        const candidate = /^[a-z0-9._]{3,30}$/.test(base) ? base : 'creator';
        const suffix = user.id.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase();
        const candidates = [...new Set([candidate, (candidate.slice(0, 21) + '_' + suffix).slice(0, 30), ('creator_' + suffix).slice(0, 30)])];
        for (const next of candidates) {
          try {
            const registered = await customFetch<{ profile: { username: string; visibility: 'private' | 'public'; messagePrivacy: 'everyone' | 'requests' | 'nobody' } }>('/api/creator-hub/social/me', {
              method: 'PUT', responseType: 'json',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ displayName: alias, username: next, visibility: 'private', messagePrivacy: 'requests', bio: savedBio }),
            });
            if (active) {
              setSocialProfile(registered.profile);
              setRegisteredUsername(registered.profile.username);
              setSocialReady(true);
            }
            return;
          } catch (cause) {
            if (!String(cause).includes('409') && !String(cause).includes('USERNAME_ALREADY_IN_USE')) throw cause;
          }
        }
        throw new Error('Unable to register a unique Creator Hub username');
      })
      .catch(() => { if (active) { setSocialReady(false); setProfileError(ht('No pudimos registrar el perfil para que aparezca en las búsquedas. Intentá recargar Creator Hub.')); } });
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
    } catch { setProfileError(ht("No pudimos guardar la privacidad. Revisá que tu @usuario esté disponible y volvé a intentar.")); }
    finally { setSocialSaving(false); }
  }
  const [peopleQuery, setPeopleQuery] = useState('');
  const [peopleResults, setPeopleResults] = useState<Array<{ ownerId: string; displayName: string; username: string; visibility: string; following: boolean; requested: boolean }>>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const profileReturnScroll = useRef(0);
  const openPersonProfile = (ownerId: string) => {
    profileReturnScroll.current = window.scrollY;
    setProfileMessageFeedback('');
    setRequestComposerOpen(false);
    setRequestDraft('');
    setSelectedPersonId(ownerId);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const closePersonProfile = () => {
    setSelectedPersonId(null);
    setProfileMessageFeedback('');
    requestAnimationFrame(() => window.scrollTo({ top: profileReturnScroll.current, behavior: 'instant' }));
  };
  const selectedPerson = peopleResults.find(person => person.ownerId === selectedPersonId);
  const [viewedProfile, setViewedProfile] = useState<{ displayName: string; username: string; visibility: string; bio: string | null; following: boolean; requested: boolean; avatarRef?: string | null; bannerRef?: string | null; avatarPosition?: { x: number; y: number } | null; verificationRole?: 'owner_lifetime' | 'founder_lifetime' | null; roleLabel?: string | null } | null>(null);
  const [viewedPosts, setViewedPosts] = useState<Publication[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  useEffect(() => {
    if (!selectedPersonId) { setViewedProfile(null); setViewedPosts([]); return; }
    let cancelled = false;
    setProfileLoading(true);
    Promise.all([
      customFetch<{ profile: NonNullable<typeof viewedProfile> }>('/api/creator-hub/social/profile/' + encodeURIComponent(selectedPersonId), { responseType: 'json' }),
      customFetch<{ publications: Publication[] }>('/api/creator-hub/social/publications/' + encodeURIComponent(selectedPersonId), { responseType: 'json' }),
    ]).then(([detail, posts]) => {
      if (!cancelled) { setViewedProfile(detail.profile); setViewedPosts(posts.publications); }
    }).catch(() => { if (!cancelled) setViewedProfile(null); })
      .finally(() => { if (!cancelled) setProfileLoading(false); });
    return () => { cancelled = true; };
  }, [selectedPersonId]);

  const [conversations, setConversations] = useState<Array<{ownerId:string;displayName:string;username:string}>>([]);
  async function refreshConversations() {
    try {
      const data = await customFetch<{conversations: typeof conversations}>('/api/creator-hub/social/conversations', {responseType:'json'});
      setConversations(data.conversations);
    } catch { setInboxError(ht("No pudimos cargar las conversaciones.")); }
  }
  async function followPerson(ownerId: string) {
    setPeopleBusy(true); setPeopleFeedback('');
    try {
      const result = await customFetch<{status:string}>('/api/creator-hub/social/follow', {method:'POST',responseType:'json',headers:{'Content-Type':'application/json'},body:JSON.stringify({targetOwnerId:ownerId})});
      setPeopleFeedback(result.status === 'following' ? ht("¡Ahora seguís a esta persona!") : ht("Solicitud para seguir enviada."));
      setPeopleResults(previous => previous.map(person => person.ownerId === ownerId ? {...person, following: result.status === 'following',requested:result.status !== 'following'} : person));
      setViewedProfile(previous => selectedPersonId === ownerId && previous ? {...previous, following: result.status === 'following', requested: result.status !== 'following'} : previous);
    } catch { setPeopleFeedback(ht("No pudimos enviar la solicitud para seguir.")); }
    finally { setPeopleBusy(false); }
  }
  const [peopleBusy, setPeopleBusy] = useState(false);
  const [peopleFeedback, setPeopleFeedback] = useState('');
  const [profileMessageFeedback, setProfileMessageFeedback] = useState('');
  const [requestComposerOpen, setRequestComposerOpen] = useState(false);
  const [requestDraft, setRequestDraft] = useState('');
  async function searchPeople() {
    if (peopleQuery.trim().length < 2) return;
    setPeopleBusy(true); setPeopleFeedback(''); setPeopleResults([]); setSelectedPersonId(null);
    try {
      const normalizedQuery = peopleQuery.trim().replace(/^@+/, '');
      const data = await customFetch<{ profiles: typeof peopleResults }>('/api/creator-hub/social/search?q=' + encodeURIComponent(normalizedQuery), { responseType: 'json' });
      setPeopleResults(data.profiles);
      if (data.profiles.length === 0) setPeopleFeedback(ht("No encontramos perfiles con ese nombre. La otra persona debe abrir Creator Hub al menos una vez."));
    } catch { setPeopleFeedback(ht("No pudimos buscar personas.")); }
    finally { setPeopleBusy(false); }
  }
  async function requestMessage(ownerId: string) {
    if (!requestDraft.trim()) return;
    setPeopleBusy(true); setPeopleFeedback(''); setProfileMessageFeedback(ht('Enviando solicitud…'));
    try {
      const result = await customFetch<{ status: 'requested' | 'allowed' | 'accepted' }>('/api/creator-hub/social/message-requests', {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOwnerId: ownerId, body: requestDraft.trim() }),
      });
      if (result.status === 'requested') { const notice = ht("Solicitud enviada. Aparecerá en la bandeja de esa persona."); setPeopleFeedback(notice); setProfileMessageFeedback(notice); setRequestComposerOpen(false); setRequestDraft(''); }
      else { setRequestComposerOpen(false); setRequestDraft(''); setSelectedPersonId(null); setHubTab('mensajes'); setPeopleFeedback(ht("Mensaje enviado.")); const person = peopleResults.find(item => item.ownerId === ownerId); await refreshConversations(); await openHumanChat(ownerId, person?.displayName ?? ht("esta persona")); }
    } catch { const notice = ht("No se pudo enviar la solicitud. Puede que la persona no acepte mensajes."); setPeopleFeedback(notice); setProfileMessageFeedback(notice); }
    finally { setPeopleBusy(false); }
  }
  const [activeChat, setActiveChat] = useState<{ ownerId: string; name: string } | null>(null);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; senderOwnerId: string; body: string; createdAt: string; kind?: "text" | "voice"; objectPath?: string; durationSeconds?: number; reactions?: Array<{ emoji: string; ownerId: string }> }>>([]);
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
    if (user?.id && history.messages.some(item => item.senderOwnerId === ownerId)) void markCreatorHubDmRead(user.id, ownerId).catch(() => {});
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
    } catch { setChatError(ht("No pudimos guardar la reacción.")); }
  }

  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');
  async function openHumanChat(ownerId: string, name: string) {
    setActiveChat({ ownerId, name }); setChatMessages([]); setChatError('');
    if (user?.id) void markCreatorHubDmRead(user.id, ownerId).catch(() => {});
    try {
      const result = await customFetch<{ messages: typeof chatMessages }>('/api/creator-hub/social/messages/' + encodeURIComponent(ownerId), { responseType: 'json' });
      setChatMessages(result.messages); setOtherTyping(false);
    } catch { setChatError(ht("No pudimos abrir esta conversación.")); }
  }
  async function sendHumanMessage() {
    if (!activeChat || !chatDraft.trim() || chatBusy) return;
    setChatBusy(true); setChatError('');
    try {
      await customFetch('/api/creator-hub/social/messages', { method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetOwnerId: activeChat.ownerId, body: chatDraft.trim() }) });
      setChatDraft('');
      await openHumanChat(activeChat.ownerId, activeChat.name);
    } catch { setChatError(ht("No se pudo enviar. Puede que necesites una solicitud aceptada.")); }
    finally { setChatBusy(false); }
  }
  const [followInbox, setFollowInbox] = useState<Array<{ id: string; displayName: string; username: string }>>([]);
  const [messageInbox, setMessageInbox] = useState<Array<{ id: string; senderOwnerId: string; displayName: string; username: string; previewBody?: string }>>([]);
  const [inboxBusy, setInboxBusy] = useState(false);
  const [inboxError, setInboxError] = useState('');
  async function refreshInbox() {
    try {
      const [follows, messages] = await Promise.all([
        customFetch<{ requests: typeof followInbox }>('/api/creator-hub/social/requests', { responseType: 'json' }),
        customFetch<{ requests: typeof messageInbox }>('/api/creator-hub/social/message-requests', { responseType: 'json' }),
      ]);
      setFollowInbox(follows.requests); setMessageInbox(messages.requests); setInboxError('');
    } catch { setInboxError(ht("No se pudieron cargar las solicitudes.")); }
  }
  useEffect(() => {
    if (socialReady && user?.id) { void refreshInbox(); void refreshConversations(); }
  }, [socialReady, user?.id]);
  async function decideInbox(kind: 'requests' | 'message-requests', id: string, action: 'accept' | 'reject') {
    setInboxBusy(true); setInboxError('');
    try {
      await customFetch('/api/creator-hub/social/' + kind + '/' + encodeURIComponent(id) + '/' + action, { method: 'POST', responseType: 'json' });
      await refreshInbox();
      if (kind === 'message-requests' && action === 'accept') {
        const accepted = messageInbox.find(request => request.id === id);
        await refreshConversations();
        if (accepted?.senderOwnerId) { setHubTab('mensajes'); await openHumanChat(accepted.senderOwnerId, accepted.displayName); }
      }
    } catch { setInboxError(ht("No se pudo actualizar la solicitud.")); }
    finally { setInboxBusy(false); }
  }
  const nameParts = alias.split(/\s+/).filter(Boolean);
  const initials = nameParts.length > 1
    ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
    : (nameParts[0]?.slice(0, 2).toUpperCase() || 'EC');
  if (activeChat) {
    return <div className="flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-background text-foreground" data-testid="creator-hub-fullscreen-chat">
      <header className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-background px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+12px)]">
        <button type="button" onClick={() => { setActiveChat(null); setChatMessages([]); setChatDraft(''); setReactingMessage(null); void refreshConversations(); }} className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary" aria-label={ct("back")} data-testid="button-creator-chat-back"><ArrowLeft size={23}/></button>
        <div className="min-w-0 flex-1"><h2 className="truncate text-base font-semibold">{activeChat.name}</h2><p className="text-xs text-muted-foreground">Creator Hub</p></div>
        <button type="button" onClick={() => void openHumanChat(activeChat.ownerId, activeChat.name)} className="rounded-full px-3 py-2 text-xs text-primary">{ct("refresh")}</button>
      </header>
            <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-4 sm:px-6">
              <div className="flex items-center justify-between"><h3 className="font-semibold">{ht("Chat con")} {activeChat.name}</h3><button type="button" onClick={() => void openHumanChat(activeChat.ownerId, activeChat.name)} className="text-xs text-primary">{ct("refresh")}</button></div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl bg-secondary/30 p-4" data-testid="creator-hub-chat-messages">
                {chatError ? <p role="alert" className="text-xs text-destructive">{chatError}</p> : chatMessages.length === 0 && <p className="text-xs text-muted-foreground">{ct("noMessages")}</p>}
                {chatMessages.map(message => <div key={message.id} className={`flex flex-col ${message.senderOwnerId === user?.id ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words ${message.senderOwnerId === user?.id ? 'bg-primary text-primary-foreground' : 'bg-background'}`}>{message.kind === "voice" && message.objectPath ? <HumanVoicePlayback objectPath={message.objectPath} durationSeconds={message.durationSeconds ?? 0} /> : message.body}</div>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {message.reactions?.map((reaction, index) => <span key={index} className="text-xs">{reaction.emoji}</span>)}
                    <button type="button" onClick={() => setReactingMessage(reactingMessage === message.id ? null : message.id)} aria-label={ct("send")} className="rounded-full px-2 text-xs text-muted-foreground hover:bg-secondary">☺ +</button>
                  </div>
                  {reactingMessage === message.id && <div className="flex flex-wrap gap-1 rounded-xl bg-background p-1">
                    {['❤️','😂','🥹','😍','👍','🔥','😮','😢'].map(emoji => <button type="button" key={emoji} onClick={() => { setReactingMessage(null); void toggleReaction(message.id, emoji, Boolean(message.reactions?.some(r => r.emoji === emoji && r.ownerId === user?.id))); }} className="rounded-lg p-1 hover:bg-secondary" aria-label={`Reaccionar con ${emoji}`}>{emoji}</button>)}
                  </div>}
                </div>)}
                {otherTyping && <div aria-live="polite" className="flex items-center gap-1 text-xs text-muted-foreground"><span>{activeChat.name} {ht("está escribiendo")}</span><span className="animate-pulse">● ● ●</span></div>}
              </div>
              {chatError && <p role="alert" className="text-xs text-destructive">{chatError}</p>}
              <div className="shrink-0"><HumanVoiceRecorder key={activeChat.ownerId} targetOwnerId={activeChat.ownerId} onSent={() => refreshHumanChat(activeChat.ownerId)} /></div>
              <div className="flex shrink-0 gap-2 pb-[env(safe-area-inset-bottom,0px)]"><input aria-label={ht("Escribí un mensaje…")} value={chatDraft} maxLength={2000} onChange={e => updateChatDraft(e.target.value)} placeholder={ht("Escribí un mensaje…")} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-base sm:text-sm"/><button type="button" disabled={chatBusy || !chatDraft.trim()} onClick={() => void sendHumanMessage()} className="rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{ct("send")}</button></div>
            </div>

    </div>;
  }
  if (selectedPersonId) {
    const person = viewedProfile ?? selectedPerson;
    return <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-background text-foreground" style={{ WebkitTextSizeAdjust: '100%', touchAction: 'pan-y' }}>
      <header className="flex items-center gap-4 border-b border-border px-5 pb-4 pt-[calc(env(safe-area-inset-top,0px)+20px)]">
        <button type="button" onClick={closePersonProfile} aria-label={ct("back")} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-secondary"><ArrowLeft size={22}/></button>
        <span className="text-lg font-semibold">{ht("Perfil")}</span>
      </header>
      <main className="mx-auto w-full max-w-2xl min-w-0 px-5 py-8">
        {profileLoading && <p className="text-muted-foreground">{ht("Cargando…")}</p>}
        {!profileLoading && !person && <p className="text-muted-foreground">{ht("No encontramos perfiles con ese nombre. La otra persona debe abrir Creator Hub al menos una vez.")}</p>}
        {person && <div className="min-w-0 space-y-7">
          <div className="relative h-40 overflow-hidden rounded-3xl bg-[linear-gradient(125deg,hsl(263_18%_19%),hsl(336_15%_16%))] sm:h-52">
            {'bannerRef' in person && person.bannerRef && <img src={resolveImage(person.bannerRef)} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-background bg-secondary text-2xl font-semibold">
              {'avatarRef' in person && person.avatarRef ? <img src={resolveImage(person.avatarRef)} alt="" className="h-full w-full object-cover" style={{ objectPosition: person.avatarPosition ? `${person.avatarPosition.x}% ${person.avatarPosition.y}%` : 'center' }} /> : person.displayName.split(/\\s+/).filter(Boolean).map(n=>n[0]).slice(0,2).join('').toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2"><h1 className="min-w-0 truncate text-2xl font-semibold">{person.displayName}</h1>{'verificationRole' in person && person.verificationRole && <span title={ht("Cuenta verificada de ECHO")} aria-label={ht("Cuenta verificada de ECHO")}><BadgeCheck className="h-6 w-6 shrink-0 fill-primary text-primary-foreground" /></span>}</div>
              {'roleLabel' in person && person.roleLabel && <p className="text-sm font-semibold text-primary">{person.roleLabel}</p>}
              <p className="break-all text-muted-foreground">@{person.username}</p>
            </div>
          </div>
          {'bio' in person && person.bio && <p className="whitespace-pre-wrap text-sm leading-relaxed">{person.bio}</p>}
          <div className="flex min-w-0 flex-wrap gap-3">
            <button type="button" disabled={peopleBusy || person.following || person.requested} onClick={() => void followPerson(selectedPersonId)} className="rounded-full bg-primary px-6 py-3 font-semibold text-primary-foreground disabled:opacity-60">{ht(person.following ? 'Siguiendo' : person.requested ? 'Solicitado' : person.visibility === 'private' ? 'Solicitar seguir' : 'Seguir')}</button>
            <button type="button" disabled={peopleBusy} onClick={() => { setRequestComposerOpen(true); setProfileMessageFeedback(''); }} className="flex min-h-11 items-center gap-2 rounded-full border border-primary/40 px-5 py-3 text-primary active:opacity-70"><MessageCircle size={18}/>{ht("Mensaje privado")}</button>
          </div>
          {requestComposerOpen && <div className="space-y-3 rounded-2xl border border-primary/30 bg-card p-4">
            <h2 className="font-semibold">{ht("Mensaje privado")} · {person.displayName}</h2>
            <p className="text-sm text-muted-foreground">{ht("Escribí tu primer mensaje. La otra persona podrá aceptarlo o rechazarlo antes de abrir el chat.")}</p>
            <textarea rows={4} maxLength={2000} value={requestDraft} onChange={event => setRequestDraft(event.target.value)} placeholder={ht("Escribí un mensaje…")} aria-label={ht("Escribí un mensaje…")} className="w-full resize-none rounded-xl border border-border bg-background p-3 text-base text-foreground"/>
            <div className="flex flex-wrap gap-3"><button type="button" disabled={peopleBusy || !requestDraft.trim()} onClick={() => void requestMessage(selectedPersonId)} className="rounded-full bg-primary px-5 py-3 font-semibold text-primary-foreground disabled:opacity-50">{ht(peopleBusy ? "Enviando…" : "Enviar solicitud")}</button><button type="button" disabled={peopleBusy} onClick={() => setRequestComposerOpen(false)} className="rounded-full border border-border px-5 py-3">{ct("cancel")}</button></div>
          </div>}
          {profileMessageFeedback && <p role="status" aria-live="polite" className="rounded-xl border border-primary/30 p-3 text-sm text-primary">{profileMessageFeedback}</p>}
          {person.visibility === 'private' && !person.following && <div className="rounded-2xl border border-border px-5 py-8 text-center"><LockKeyhole className="mx-auto mb-3 text-muted-foreground"/><p className="font-semibold">{ht("Perfil privado")}</p><p className="mt-2 text-sm text-muted-foreground">{ht("Este perfil es privado. El contenido requiere autorización de su creador.")}</p></div>}
          {(person.visibility === 'public' || person.following) && <section className="space-y-3"><h2 className="text-lg font-semibold">{ht("Publicaciones")}</h2>{viewedPosts.map(post=><article key={post.id} className="overflow-hidden rounded-2xl border border-border bg-card">{post.coverPath && <img src={resolvePublicationMedia(post.coverPath)} alt="" className="max-h-80 w-full object-cover" />}<div className="p-5"><h3 className="font-semibold"><RichPublicationText text={post.title}/></h3><p className="mt-2 whitespace-pre-wrap text-sm font-normal leading-relaxed text-muted-foreground"><RichPublicationText text={post.body}/></p></div></article>)}{viewedPosts.length===0 && <p className="text-sm text-muted-foreground">{ht("Todavía no hay publicaciones.")}</p>}</section>}
        </div>}
      </main>
    </div>;
  }
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="relative z-20 flex min-h-[88px] shrink-0 items-center justify-between gap-2 px-4 pb-4 pt-[calc(env(safe-area-inset-top,0px)+24px)] text-foreground sm:min-h-[92px] lg:px-8 lg:pt-6">
        <Link href="/" aria-label={ht("Volver al feed de ECHO")} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 bg-black/45 px-3 text-sm font-medium backdrop-blur-md hover:bg-black/65"><ArrowLeft size={19} /><span className="hidden sm:inline">{ht("Volver al feed de ECHO")}</span><span className="sm:hidden">{ct("back")}</span></Link>
        <Link href="/" aria-label="ECHO" className="wordmark absolute left-1/2 -translate-x-1/2 text-[28px] leading-none text-foreground sm:text-[32px]">ECHO</Link>
        <h1 className="text-sm font-semibold text-muted-foreground sm:text-base">Creator Hub</h1>
      </header>
      <div className="flex w-full flex-1 flex-col justify-center px-0 pb-6 lg:py-8">
        <section className="w-full overflow-hidden bg-card lg:mx-auto lg:max-w-6xl lg:rounded-[28px] lg:border lg:border-border" aria-label={ht("Perfil")}>
          <div className="relative flex h-48 flex-col items-center justify-center gap-2 sm:h-60 lg:h-64 bg-[linear-gradient(130deg,hsl(263_18%_19%),hsl(336_15%_16%))] text-muted-foreground">
            {bannerImage ? <img src={bannerImage} alt="Creator Hub" className="absolute inset-0 h-full w-full object-cover" /> : <span className="select-none text-[clamp(4rem,14vw,9rem)] font-black tracking-[-0.08em] text-white/20" aria-hidden="true">{initials}</span>}
            <input ref={bannerInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label={ht("Seleccionar banner")} onChange={e => void uploadPhoto(e, 'banner')} />
            <button type="button" disabled={uploading !== null} onClick={() => bannerInput.current?.click()} className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"><Camera size={15}/>{ht(uploading === 'banner' ? 'Subiendo…' : 'Editar banner')}</button>
          </div>
          <div className="mx-auto w-full max-w-5xl space-y-5 px-5 py-6 sm:px-10 lg:py-7">
            <div className="flex items-start gap-3 sm:items-center">
              <div className="relative shrink-0">
                <span className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-background bg-secondary text-2xl font-semibold leading-none sm:h-28 sm:w-28" aria-label={`Avatar de ${alias}`}>{avatarImage ? <img src={avatarImage} alt="" className="h-full w-full object-cover" style={{ objectPosition: `${savedAvatarPosition.x}% ${savedAvatarPosition.y}%` }} /> : <span className="block text-center leading-none">{initials}</span>}</span>
                <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" aria-label={ht("Seleccionar foto de perfil")} onChange={e => void uploadPhoto(e, 'avatar')} />
                <button type="button" disabled={uploading !== null} onClick={() => avatarImage ? startAdjustingAvatar() : avatarInput.current?.click()} aria-label={ht(avatarImage ? "Ajustar foto de perfil" : "Subir foto de perfil")} className="absolute bottom-0 right-0 grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-foreground disabled:opacity-50"><Camera size={15}/></button>
              </div>
              <div className="min-w-0 flex-1 pt-3 sm:pt-0">
                <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">{editingName ? <div className="flex min-w-0 items-center gap-1"><input aria-label={ht("Nombre de creador")} value={nameDraft} maxLength={80} onChange={e => setNameDraft(e.target.value)} className="min-w-0 rounded-lg border border-border bg-background px-2 py-1 text-base sm:text-sm" /><button type="button" disabled={saving} aria-label={ht("Guardar nombre")} onClick={() => void saveName()}><Check size={17}/></button><button type="button" aria-label={ht("Cancelar edición de nombre")} onClick={() => setEditingName(false)}><X size={17}/></button></div> : <div className="flex min-w-0 items-center gap-1"><h2 className="min-w-0 truncate text-lg font-semibold leading-tight sm:text-3xl">{alias}</h2><button type="button" aria-label={ht("Editar nombre")} onClick={() => {setNameDraft(alias);setProfileError('');setEditingName(true);}} className="shrink-0 p-1 text-muted-foreground"><Pencil size={15}/></button></div>}{verificationRole && <span title={ht("Cuenta verificada de ECHO")} aria-label={ht("Cuenta verificada de ECHO")}><BadgeCheck className="h-5 w-5 shrink-0 fill-primary text-primary-foreground sm:h-6 sm:w-6" /></span>}</div>
                {verificationRole && <p className="mt-1 text-xs font-semibold text-primary">{verificationRole === "owner_lifetime" ? "CEO & Founder of ECHO" : "First ECHO Tester"}</p>}
                {editing ? <div className="mt-2 space-y-2"><div className="flex items-center gap-2"><span className="text-muted-foreground">@</span><input aria-label={ht("Nuevo nombre de usuario")} value={draft} maxLength={30} onChange={e => setDraft(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-base sm:text-sm" /><button type="button" aria-label={ht("Guardar usuario")} disabled={saving} onClick={() => void saveUsername()} className="rounded-full p-2 text-primary disabled:opacity-50"><Check size={18}/></button><button type="button" aria-label={ht("Cancelar edición")} onClick={() => {setEditing(false);setError('');}} className="rounded-full p-2"><X size={18}/></button></div>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}<p className="text-xs text-muted-foreground">{ht("Este alias es independiente de tu email de inicio de sesión.")}</p></div> : <div className="mt-1 flex items-center gap-2"><p className="truncate text-sm text-muted-foreground">@{username}</p><button type="button" aria-label={ht("Editar nombre de usuario")} title={ht("Editar nombre de usuario")} onClick={() => {setDraft(username);setError('');setEditing(true);}} className="rounded-full p-1 text-muted-foreground hover:text-foreground"><Pencil size={15}/></button></div>}
              </div>
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-secondary/70 text-foreground sm:hidden" role="img" aria-label={ht(socialProfile?.visibility === "public" ? "Perfil público" : "Perfil privado")} title={ht(socialProfile?.visibility === "public" ? "Perfil público" : "Perfil privado")}>{socialProfile?.visibility === "public" ? <ShieldCheck size={16} /> : <LockKeyhole size={16} />}</span>
               <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-secondary/70 px-3 py-1 text-xs font-semibold text-foreground sm:inline-flex">{socialProfile?.visibility === "private" && <LockKeyhole size={13} />}{ht(socialProfile?.visibility === "public" ? "Perfil público" : "Perfil privado")}</span>
            </div>
            <div className="flex items-center gap-6 px-1 text-sm" aria-label={ht("Estadísticas de seguimiento")}>
              <button type="button" onClick={() => setFollowListKind('followers')} className="flex items-baseline gap-1.5 rounded-md hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><strong className="font-semibold tabular-nums text-foreground">{followCounts?.followers ?? '—'}</strong><span className="text-muted-foreground">{ct("followers")}</span></button>
              <button type="button" onClick={() => setFollowListKind('following')} className="flex items-baseline gap-1.5 rounded-md hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><strong className="font-semibold tabular-nums text-foreground">{followCounts?.following ?? '—'}</strong><span className="text-muted-foreground">{ht("Seguidos")}</span></button>
            </div>
            {followListKind && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setFollowListKind(null); }}>
              <div role="dialog" aria-modal="true" aria-label={followListKind === 'followers' ? ct("followers") : ht("Seguidos")} className="w-full max-w-md rounded-2xl border border-border bg-card p-5 text-foreground shadow-2xl">
                <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">{followListKind === 'followers' ? ct("followers") : ht("Seguidos")}</h2><button type="button" aria-label={ct("close")} onClick={() => setFollowListKind(null)} className="rounded-full p-2 hover:bg-secondary"><X size={20}/></button></div>
                <div className="max-h-[60dvh] space-y-2 overflow-y-auto">
                  {followListLoading ? <p className="py-6 text-center text-sm text-muted-foreground">{ht("Cargando…")}</p> : followListError ? <p role="alert" className="py-5 text-sm text-destructive">{followListError}</p> : followListRows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{ht("Todavía no hay perfiles.")}</p> : followListRows.map(person => <button type="button" key={person.ownerId} onClick={() => { setPeopleResults(previous => [...previous.filter(item => item.ownerId !== person.ownerId), person]); setFollowListKind(null); setSelectedPersonId(person.ownerId); }} className="flex w-full items-center gap-3 rounded-xl border border-border/60 p-3 text-left hover:bg-secondary"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary font-semibold">{person.displayName.slice(0,1).toUpperCase()}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold">{person.displayName}</span><span className="block truncate text-xs text-muted-foreground">@{person.username}</span></span></button>)}
                </div>
              </div>
            </div>}
            {profileError && <p role="alert" className="text-xs text-destructive">{profileError}</p>}
            {editingBio ? <div className="space-y-2"><div className="flex items-center gap-2" role="toolbar" aria-label={ht("Formato de biografía")}><button type="button" onClick={() => formatBio('**', '**')} aria-label={ht("Negrita")} title={ht("Negrita")} className="rounded-lg border border-border px-3 py-1.5 text-sm font-bold">B</button><button type="button" onClick={() => formatBio('*', '*')} aria-label={ht("Cursiva")} title={ht("Cursiva")} className="rounded-lg border border-border px-3 py-1.5 text-sm italic">I</button><button type="button" onClick={() => formatBio('__', '__')} aria-label={ht("Subrayado")} title={ht("Subrayado")} className="rounded-lg border border-border px-3 py-1.5 text-sm underline">U</button></div><textarea ref={bioInputRef} aria-label={ht("Biografía de Creator Hub")} value={bioDraft} maxLength={500} rows={3} onChange={e => setBioDraft(e.target.value)} placeholder={ht("Contá algo sobre vos…")} className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" /><div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{bioDraft.length}/500 {ht("caracteres")}</span><div className="flex gap-2"><button type="button" onClick={() => setEditingBio(false)} className="rounded-full border border-border px-3 py-2 text-xs">{ct("cancel")}</button><button type="button" disabled={savingBio} onClick={() => void saveBio()} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{ht(savingBio ? 'Guardando…' : 'Guardar biografía')}</button></div></div></div> : <div className="flex items-start gap-2"><p className="min-w-0 max-w-fit whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{renderBio(bio)}</p><button type="button" aria-label={ht("Editar biografía")} title={ht("Editar biografía")} onClick={() => { setBioDraft(savedBio); setProfileError(''); setEditingBio(true); }} className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"><Pencil size={15}/></button></div>}
            <div className="space-y-2">
              {editingLink ? <div className="flex items-center gap-2"><ExternalLink size={16} className="shrink-0 text-muted-foreground" /><input aria-label={ht("Enlace externo de Creator Hub")} type="url" value={linkDraft} maxLength={500} onChange={e => setLinkDraft(e.target.value)} placeholder="https://instagram.com/tuusuario" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm" /><button type="button" disabled={savingLink} onClick={() => void saveLink()} aria-label={ht("Guardar enlace")} className="p-2 text-primary disabled:opacity-50"><Check size={18}/></button><button type="button" onClick={() => setEditingLink(false)} aria-label={ht("Cancelar enlace")} className="p-2"><X size={18}/></button></div> : <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground"><ExternalLink size={16} className="shrink-0" />{externalLink ? <a href={externalLink} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate font-medium text-primary underline decoration-primary/60 underline-offset-4 transition-colors hover:text-primary/80">{(() => { try { const url = new URL(externalLink); const handle = url.pathname.split('/').filter(Boolean)[0]; return /(^|\.)instagram\.com$/i.test(url.hostname) && handle ? `Instagram · @${handle}` : url.hostname.replace(/^www\./, ''); } catch { return 'Ver enlace'; } })()}</a> : <span>{ht("Enlace externo opcional")}</span>}<button type="button" aria-label={ht("Editar enlace externo")} onClick={() => {setLinkDraft(externalLink);setProfileError('');setEditingLink(true);}} className="shrink-0 rounded-full p-1 hover:text-foreground"><Pencil size={15}/></button></div>}
            </div>
            <nav aria-label={ht("Secciones de Creator Hub")} className="grid grid-cols-4 gap-1 rounded-2xl border border-border bg-secondary/30 p-1.5">
              {([{id:'perfil',label:'Perfil',Icon:UserRound},{id:'explorar',label:'Explorar',Icon:Compass},{id:'mensajes',label:'Mensajes',Icon:MessagesSquare},{id:'ajustes',label:'Ajustes',Icon:Settings2}] as const).map(tab => <button key={tab.id} type="button" aria-current={hubTab === tab.id ? 'page' : undefined} onClick={() => setHubTab(tab.id)} className={`flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] sm:flex-row sm:gap-2 sm:text-sm ${hubTab === tab.id ? 'bg-primary/15 font-semibold text-primary' : 'text-muted-foreground hover:bg-secondary'}`}><tab.Icon size={17}/><span>{ht(tab.label)}</span>{tab.id === 'mensajes' && dmStatus.items.some(item => item.unread) && <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground" aria-label="Unread Creator Hub messages">{dmStatus.items.filter(item => item.unread).length}</span>}</button>)}
            </nav>
            {hubTab === 'ajustes' && <div className="space-y-4">
            <div className="rounded-2xl border border-border p-4">
              <label className="flex items-center justify-between gap-3">
                <span><span className="block text-sm font-semibold">{dmCopy.setting}</span><span className="mt-1 block text-xs text-muted-foreground">{dmCopy.description}</span></span>
                <input type="checkbox" className="h-5 w-5 accent-primary" checked={dmStatus.enabled} disabled={dmPreferenceSaving}
                  onChange={async event => {
                    setDmPreferenceSaving(true);
                    try {
                      await customFetch('/api/creator-hub/social/dm-notifications/preferences', { method: 'PUT', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: event.target.checked }) });
                      if (user?.id) await refreshCreatorHubDmStatus(user.id);
                    } catch { setInboxError(ht("No se pudieron guardar los ajustes.")); }
                    finally { setDmPreferenceSaving(false); }
                  }} />
              </label>
            </div>
            <div className="rounded-2xl border border-border p-4 space-y-4">
              <h3 className="font-semibold">{ht("Privacidad de Creator Hub")}</h3>
              {!socialReady ? <p className="text-sm text-muted-foreground">{ht("Los ajustes sociales estarán disponibles cuando se habilite el servidor de Creator Hub.")}</p> : <>
                <label className="block space-y-2 text-sm"><span>{ht("Visibilidad del perfil")}</span>
                  <select aria-label={ht("Visibilidad del perfil")} disabled={socialSaving} value={socialProfile?.visibility ?? 'private'} onChange={e => void saveSocialPreferences(e.target.value as 'private' | 'public', socialProfile?.messagePrivacy ?? 'requests')} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                    <option value="private">{ht("Privado · aprobar seguidores")}</option><option value="public">{ht("Público · cualquiera puede seguirte")}</option>
                  </select>
                </label>
                <label className="block space-y-2 text-sm"><span>{ht("Quién puede enviarte mensajes")}</span>
                  <select aria-label={ht("Quién puede enviarte mensajes")} disabled={socialSaving} value={socialProfile?.messagePrivacy ?? 'requests'} onChange={e => void saveSocialPreferences(socialProfile?.visibility ?? 'private', e.target.value as 'everyone' | 'requests' | 'nobody')} className="w-full rounded-lg border border-border bg-background px-3 py-2">
                    <option value="everyone">{ht("Todos")}</option><option value="requests">{ht("Solicitudes · revisar antes de aceptar")}</option><option value="nobody">{ht("Nadie puede iniciar un chat")}</option>
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">{ht("La privacidad de mensajes es independiente de la visibilidad del perfil.")}</p>
              </>}
            </div>
            </div>}
            {hubTab === 'explorar' && <div className="space-y-4">
            <div className="rounded-2xl border border-border p-4 space-y-3">
              <h3 className="font-semibold">{ct("findPeople")}</h3>
              <div className="flex gap-2"><input aria-label={ct("findPeople")} value={peopleQuery} onChange={e => { setPeopleQuery(e.target.value); setPeopleFeedback(""); }} onKeyDown={e => { if (e.key === 'Enter') void searchPeople(); }} placeholder={ht("Nombre o @usuario")} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-base sm:text-sm" /><button type="button" disabled={peopleBusy || peopleQuery.trim().length < 2} onClick={() => void searchPeople()} className="rounded-full bg-secondary px-4 py-2 text-sm disabled:opacity-50">{ct("search")}</button></div>
              {peopleBusy && <p role="status" className="text-xs text-muted-foreground">{ht("Buscando personas…")}</p>}
              {peopleFeedback && <p role="status" className="text-xs text-muted-foreground">{peopleFeedback}</p>}
              {peopleResults.map(person => (
                <div key={person.ownerId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/50 px-3 py-3">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{person.displayName}</p><p className="truncate text-xs text-muted-foreground">@{person.username} · {ht(person.visibility === 'private' ? 'Privado' : 'Público')}</p></div>
                  <button type="button" onClick={() => openPersonProfile(person.ownerId)} className="rounded-full border border-primary/40 px-3 py-2 text-xs font-medium text-primary">{ht("Ver perfil")}</button>
                </div>
              ))}
            </div>
            </div>}
            {hubTab === 'mensajes' && <div className="space-y-4">
              <div className="flex items-center justify-between gap-2"><h3 className="text-lg font-semibold">{ct("yourMessages")}</h3><button type="button" className="text-xs text-primary" onClick={() => setHubTab('explorar')}>{ct("findPeople")}</button></div>
            <div className="rounded-2xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between"><h4 className="font-semibold">{ct("conversations")}</h4><button type="button" className="text-xs text-primary" onClick={() => void refreshConversations()}>{ct("refresh")}</button></div>
              {conversations.length === 0 && <p className="text-sm text-muted-foreground">{ht("Todavía no tenés conversaciones. Buscá una persona en Explorar para empezar.")}</p>}
              {conversations.map(person => <button key={person.ownerId} type="button" onClick={() => void openHumanChat(person.ownerId,person.displayName)} className="flex w-full items-center justify-between rounded-xl bg-secondary/50 px-4 py-3 text-left text-sm hover:bg-secondary"><span>{person.displayName} <span className="text-muted-foreground">@{person.username}</span></span><span className="flex items-center gap-2">{unreadDmPeers.has(person.ownerId) && <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-label="Unread message" />}<MessageCircle size={17} className="text-primary"/></span></button>)}
            </div>
            <div className="rounded-2xl border border-border p-4 space-y-4">
              <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">{ht("Bandeja de solicitudes")}</h3><button type="button" onClick={() => void refreshInbox()} className="text-xs text-primary">{ct("refresh")}</button></div>
              {inboxError && <p role="alert" className="text-xs text-destructive">{inboxError}</p>}
              {([['Seguidores', followInbox, 'requests'], ['Mensajes', messageInbox, 'message-requests']] as const).map(([label, requests, kind]) => (
                <div key={kind} className="space-y-2">
                  <h4 className="text-sm font-medium">{ht(label)} · {requests.length}</h4>
                  {requests.length === 0 ? <p className="text-xs text-muted-foreground">{ct("noRequests")}</p> : requests.map(request => (
                    <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/50 px-3 py-3">
                      <div className="min-w-0"><p className="truncate text-sm font-medium">{request.displayName}</p><p className="truncate text-xs text-muted-foreground">@{request.username}</p>{kind === "message-requests" && "previewBody" in request && request.previewBody && <p className="mt-2 whitespace-pre-wrap break-words text-sm">{request.previewBody}</p>}</div>
                      <div className="flex gap-2"><button type="button" disabled={inboxBusy} onClick={() => void decideInbox(kind, request.id, 'reject')} className="rounded-full border border-border px-3 py-2 text-xs disabled:opacity-50">{ct("decline")}</button><button type="button" disabled={inboxBusy} onClick={() => void decideInbox(kind, request.id, 'accept')} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">{ct("accept")}</button></div>
                    </div>
                  ))}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">{ht("Las solicitudes nuevas aparecen aquí.")}</p>
            </div>
            </div>}
            {hubTab === 'perfil' && <>
            <section className="space-y-5">
              <button type="button" onClick={()=>setPublicationComposer(value=>!value)} className="flex w-full items-center justify-center gap-2 rounded-full border border-primary/70 bg-primary/10 px-4 py-3 font-semibold text-primary hover:bg-primary/20"><span className="text-xl">＋</span> {ht("Crear publicación")}</button>
              {publicationComposer && <div id="echo-publication-composer" className="space-y-3 rounded-2xl border border-primary/30 bg-secondary/30 p-4">
                <h3 className="font-semibold">{editingPublicationId ? ht("Editar publicación") : ht("Compartir en ECHO")}</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{([{id:'character',label:'♙ Personaje'},{id:'world',label:'⬡ Mundo'},{id:'post',label:'▧ Publicación'},...(canPostOfficialUpdates ? [{id:'update' as const,label:'📣 ECHO Update',translationKey:'Actualización de ECHO'}] : [])] as const).map(option=><button key={option.id} type="button" onClick={()=>setPublicationKind(option.id)} className={`rounded-xl border px-2 py-3 text-xs ${publicationKind===option.id?'border-primary bg-primary/15 text-primary':'border-border'}`}>{`${option.label.split(" ")[0]} ${ht("translationKey" in option ? option.translationKey : option.label.replace(/^[♙⬡▧📣]\s*/, ""))}`}</button>)}</div>
                <input aria-label={ht("Título de publicación")} maxLength={120} ref={publicationTitleRef} value={publicationTitle} onChange={event=>setPublicationTitle(event.target.value)} placeholder={ht("Título")} className="w-full rounded-xl border border-border bg-background p-3 text-sm"/>
                {publicationFormatButtons("title")}

                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary/5 px-4 py-4 text-sm text-primary"><Camera size={18}/> {ht(publicationFile ? 'Cambiar foto o GIF' : 'Agregar foto o GIF')}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={event=>{const file=event.target.files?.[0]??null;if(file&&(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||file.size>15*1024*1024)){setPublicationError(ht('Elegí JPG, PNG, WebP o GIF de hasta 15 MB.'));return;}setPublicationError('');setPublicationFile(file);}}/></label>
                {!publicationPreview&&editingCoverPath&&<div className="space-y-2"><img src={resolvePublicationMedia(editingCoverPath)} alt={ht("Vista previa de la publicación")} className="max-h-80 w-full rounded-xl object-contain"/><button type="button" onClick={()=>setEditingCoverPath(null)} className="text-xs text-muted-foreground underline">{ht("Quitar imagen")}</button></div>}
                {publicationPreview&&<div className="space-y-2"><img src={publicationPreview} alt={ht("Vista previa de la publicación")} className="max-h-80 w-full rounded-xl object-contain"/><button type="button" onClick={()=>setPublicationFile(null)} className="text-xs text-muted-foreground underline">{ht("Quitar imagen")}</button></div>}
                <textarea aria-label={ht("Descripción de publicación")} maxLength={5000} ref={publicationBodyRef} value={publicationBody} onChange={event=>setPublicationBody(event.target.value)} placeholder={ht("Contá la historia, describí tu personaje o compartí novedades…")} rows={5} className="w-full resize-y rounded-xl border border-border bg-background p-3 text-sm"/>
                {publicationFormatButtons("body")}

                <div className="flex flex-wrap items-center justify-between gap-3"><div className="relative inline-flex max-w-full items-center"><select aria-label={ht("Privacidad de publicación")} value={publicationVisibility} onChange={event=>setPublicationVisibility(event.target.value as Publication['visibility'])} className="max-w-full appearance-none rounded-full border border-border bg-background py-2 pl-3 pr-8 text-sm"><option value="public">🌐 {ht("Público")}</option><option value="followers">{ct("followers")}</option><option value="private">{ct("onlyMe")}</option></select><ChevronDown aria-hidden="true" size={14} className="pointer-events-none absolute right-2.5 text-muted-foreground"/></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={publicationPinned} onChange={event=>setPublicationPinned(event.target.checked)}/> {ct("pinProfile")}</label></div>
                <div className="flex justify-end gap-2"><button type="button" onClick={closePublicationComposer} className="rounded-full border border-border px-4 py-2 text-sm">{ct("cancel")}</button><button type="button" disabled={publicationBusy||!publicationTitle.trim()} onClick={()=>void publishCreatorContent()} className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{ht(publicationBusy?'Publicando…':'Publicar')}</button></div>
              </div>}
              {publicationError && <p role="alert" className="text-sm text-destructive">{publicationError}</p>}
              {publicationLoadError && <button type="button" onClick={()=>void refreshPublications()} className="text-xs text-muted-foreground underline underline-offset-4">{ht("No se pudo actualizar el contenido. Reintentar")}</button>}
              {publications.some(item=>item.pinned)&&<div className="space-y-2"><h3 className="font-semibold text-primary">📌 {ht("Destacados")}</h3><div className="grid grid-cols-3 gap-2">{publications.filter(item=>item.pinned).slice(0,3).map(item=><div key={item.id} className="flex min-w-0 flex-col items-center gap-2 rounded-xl border border-border bg-secondary/40 p-3 text-center"><span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary text-xs font-semibold" aria-hidden="true">{item.coverPath ? <img src={resolvePublicationMedia(item.coverPath)} alt="" className="h-full w-full object-cover"/> : <span className="text-lg text-muted-foreground">✦</span>}</span><p className="w-full break-words text-sm font-medium italic leading-snug">{item.title.replace(/\*\*|__|\*/g, "")}</p></div>)}</div></div>}
              <div className="flex flex-wrap gap-2">{([{id:'all',label:'Todo'},{id:'update',label:'Actualizaciones'},{id:'character',label:'Personajes'},{id:'world',label:'Mundos'},{id:'post',label:'Publicaciones'}] as const).map(option=><button key={option.id} type="button" onClick={()=>setPublicationFilter(option.id)} className={`rounded-full px-3 py-2 text-xs ${publicationFilter===option.id?'bg-primary text-primary-foreground':'bg-secondary text-muted-foreground'}`}>{ht(option.label)}</button>)}</div>
              {publications.filter(item=>publicationFilter==='all'||item.kind===publicationFilter).map(item=><article key={item.id} className="space-y-3 rounded-2xl border border-border bg-secondary/20 p-4"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-primary">{ht(item.kind==='character'?'Personaje':item.kind==='world'?'Mundo':item.kind==='update'?'Actualización de ECHO':'Publicación')} {item.pinned?'· 📌':''}</span><span className="text-xs text-muted-foreground">{item.visibility==='public'?ht('Público'):item.visibility==='followers'?ht('Seguidores'):ct('onlyMe')}</span></div><div className="flex items-start justify-between gap-2"><h3 className="text-lg font-semibold"><RichPublicationText text={item.title}/></h3><button type="button" onClick={()=>editPublication(item)} className="shrink-0 rounded-full border border-primary/40 px-3 py-1.5 text-xs text-primary hover:bg-primary/10">{ht("Editar")}</button></div>{item.coverPath&&<img src={resolvePublicationMedia(item.coverPath)} alt={`Portada de ${item.title}`} className="max-h-[440px] w-full rounded-xl bg-secondary object-contain" loading="lazy"/>}{item.body&&<p className="whitespace-pre-wrap break-words text-sm font-normal leading-relaxed text-muted-foreground"><RichPublicationText text={item.body}/></p>}<p className="text-xs text-muted-foreground">{new Date(item.createdAt).toLocaleDateString(undefined)}</p></article>)}
              {publications.length===0&&!publicationLoadError&&<div className="rounded-2xl border border-dashed border-border bg-secondary/20 px-5 py-10 text-center"><p className="font-semibold">{ht("Tu historia empieza acá")}</p><p className="mt-2 text-sm text-muted-foreground">{ht('Publicá un personaje, un mundo o')} {ht(canPostOfficialUpdates?'una actualización de ECHO':'una publicación')}.</p><p className="mx-auto mt-5 max-w-sm border-t border-border/60 pt-4 text-xs leading-relaxed text-muted-foreground"><LockKeyhole size={14} className="mr-1 inline-block align-text-bottom"/> {ht("Vos decidís quién puede ver cada publicación. El contenido para seguidores respeta las solicitudes de acceso.")}</p></div>}
            </section>
            </>}
          </div>
        </section>
      </div>
      {adjustingAvatar && avatarImage && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 px-5 py-8" role="dialog" aria-modal="true" aria-label={ht("Ajustar foto de perfil")}>
          <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-2xl">
            <h2 className="text-xl font-semibold">{ht("Ajustar foto de perfil")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{ht("Arrastrá la imagen para centrarla dentro del círculo.")}</p>
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
              <img src={avatarImage} alt={ht("Vista previa del encuadre")} draggable={false} className="h-full w-full select-none object-cover pointer-events-none" style={{ objectPosition: `${avatarPosition.x}% ${avatarPosition.y}%` }} />
            </div>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button type="button" className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => { setAdjustingAvatar(false); avatarInput.current?.click(); }}>{ht("Cambiar foto")}</button>
              <button type="button" className="rounded-full border border-border px-4 py-2 text-sm" onClick={() => setAvatarPosition({ x: 50, y: 50 })}>{ht("Centrar")}</button>
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" disabled={savingPosition} className="flex-1 rounded-full border border-border px-4 py-3 text-sm" onClick={() => setAdjustingAvatar(false)}>{ct("cancel")}</button>
              <button type="button" disabled={savingPosition} className="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60" onClick={() => void saveAvatarPosition()}>{ht(savingPosition ? 'Guardando…' : 'Guardar posición')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
