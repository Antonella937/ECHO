import { useClerk, useUser } from '@clerk/react';
import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Cloud, Info, LogOut, Monitor, Moon, Palette, Search, Sun, Star, Music2, Film, Sparkles, Image as ImageIcon, Bell } from 'lucide-react';
import { Link } from 'wouter';
import { ACCENT_PRESETS, DEFAULT_APPEARANCE } from '@/components/echo/appearance-sync';
import type { Appearance, ImageStyle } from '@/domain/types';
import { useSocial } from '@/store/social-store';
import { loadUniverse } from '@/store/persistence';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { AccountManager } from '@/components/echo/account-manager';
import { UniverseSelector } from '@/components/echo/universe-selector';
import { AutonomySettingsSection } from '@/components/echo/autonomy-settings';
import { MessageSoundSettings } from '@/components/echo/message-sound-settings';
import { MusicConnectionsSection } from '@/components/echo/music-connections-section';
import { PushNotificationSettings } from '@/components/echo/push-notification-settings';
import { toast } from '@/hooks/use-toast';
import { customFetch } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { useSettingsText } from '@/lib/settings-translations';
import { LANGUAGES, setLanguage, useLanguage, useTranslation, type Language } from '@/lib/i18n';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

import { NelaEasterEgg } from '@/components/branding/echo-brand';

function CollapsibleSettings({ title, testId, icon: Icon, children }: { title: string; testId: string; icon: typeof Palette; children: React.ReactNode }) {
  return (
    <details className="group mb-4 overflow-hidden rounded-2xl border border-border bg-card/60" data-testid={testId}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-3"><Icon className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" />{title}</span>
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-3 pb-4 [&>section]:mt-4 [&>section>h2]:hidden [&>section>div]:mt-0">
        {children}
      </div>
    </details>
  );
}

function RecoveryPreview({ file }: { file: File }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return src ? <img src={src} alt={file.name} className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <div className="h-12 w-12 shrink-0 rounded-lg bg-secondary" />;
}

export default function SettingsPage() {
  const { state, me, actions, storageError, lastSavedAt, universeId } = useSocial();
  const [recoveryFiles, setRecoveryFiles] = useState<File[]>([]);
  const [showRecovery, setShowRecovery] = useState(false);
  const { user } = useUser();
  const [recoveryAssignments, setRecoveryAssignments] = useState<Record<number, string>>({});
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [recoveryMediaPath, setRecoveryMediaPath] = useState('');
  const [recoverySearch, setRecoverySearch] = useState('');
  const [recoveryContentFile, setRecoveryContentFile] = useState<File | null>(null);
  const [recoveryContentConfirmed, setRecoveryContentConfirmed] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState('');
  // Never carry file-to-account assignments across universe switches.
  useEffect(() => {
    setRecoveryFiles([]);
    setRecoveryAssignments({});
    setRecoveryConfirmed(false);
    setRecoveryMediaPath('');
    setRecoveryContentFile(null);
    setRecoveryContentConfirmed(false);
    setRecoverySearch('');
    setRecoveryStatus('');
  }, [universeId]);
  const { signOut } = useClerk();
  const back = useBack();
  const t = useTranslation();
  const st = useSettingsText();
  const language = useLanguage();
  async function verifyRecoveredMedia(check: (remote: typeof state) => boolean) {
    if (!user?.id) throw new Error('No se pudo identificar la sesión para verificar el guardado.');
    await actions.retrySync();
    const remote = await loadUniverse(universeId);
    if (!remote.state || !check(remote.state)) throw new Error('El servidor todavía no refleja la imagen recuperada. Comprobá el perfil antes de reintentar.');
  }
  async function recoverSelectedAvatars() {
    const assignments = Object.entries(recoveryAssignments).filter(([, id]) => Boolean(id));
    if (!assignments.length || recoveryBusy || !recoveryConfirmed) return;
    if (new Set(assignments.map(([, id]) => id)).size !== assignments.length) {
      setRecoveryStatus('Elegí un solo archivo por personaje para evitar reemplazos accidentales.'); return;
    }
    const invalid = assignments.find(([index, id]) => {
      const file = recoveryFiles[Number(index)];
      const character = state.characters.find(item => item.id === id);
      return !character?.avatar || !/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(character.avatar) ||
        !file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        !file.size || file.size > 15 * 1024 * 1024;
    });
    if (invalid) {
      setRecoveryStatus('Una foto o un personaje seleccionado ya no es válido. Revisá las asignaciones: solo JPG, PNG o WebP de hasta 15 MB y avatares pendientes.');
      setRecoveryConfirmed(false);
      return;
    }
    setRecoveryBusy(true);
    let completed = 0;
    const updatedAvatars: Array<{ id: string; path: string }> = [];
    try {
      for (const [index, id] of assignments) {
        const file = recoveryFiles[Number(index)];
        const character = state.characters.find(item => item.id === id);
        if (!character || !character.avatar?.startsWith('/objects/uploads/')) continue;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024 || !file.size) {
          throw new Error('Solo JPG, PNG o WebP de hasta 15 MB. Convertí las fotos HEIC antes de recuperarlas.');
        }
        setRecoveryStatus(`Subiendo ${completed + 1} de ${assignments.length}: ${character.name}…`);
        const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>(
          '/api/storage/uploads/request-url', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contentType: file.type, size: file.size }), responseType: 'json' });
        if (!objectPath.startsWith('/objects/r2/')) throw new Error('El almacenamiento activo no es Cloudflare R2. No se modificó el perfil.');
        const uploaded = await fetch(uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!uploaded.ok) throw new Error('Cloudflare R2 rechazó la subida.');
        await customFetch('/api/storage/uploads/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectPath }), responseType: 'json' });
        // Persist only after upload and read-back verification. Preserve all other account fields.
        actions.updateAccount(id, { ...character, avatar: objectPath }, character);
        updatedAvatars.push({ id, path: objectPath });
        completed++;
      }
      if (completed > 0) {
        setRecoveryStatus(`Subidos ${completed} avatar(es). Verificando sincronización del universo…`);
        await verifyRecoveredMedia(remote => updatedAvatars.every(item => remote.characters.some(character => character.id === item.id && character.avatar === item.path)));
      }
      setRecoveryStatus(`Recuperados y sincronizados ${completed} avatar(es). Las imágenes anteriores no se borraron.`);
      if (completed > 0) {
        setRecoveryFiles([]);
        setRecoveryAssignments({});
        toast({ title: 'Avatares sincronizados', description: `${completed} foto(s) guardada(s) en Cloudflare R2.` });
      }
    } catch (error) {
      setRecoveryStatus(`${completed} avatar(es) procesado(s), pero no se pudo confirmar la sincronización completa. No vuelvas a subir las mismas fotos hasta comprobar los perfiles. ${error instanceof Error ? error.message : ''}`);
    } finally { setRecoveryBusy(false); setRecoveryConfirmed(false); }
  }
  const legacyMediaDetails = useMemo(() => {
    const byPath = new Map<string, { path: string; posts: typeof state.posts; stories: typeof state.stories; owners: string[] }>();
    const ensure = (path: string) => {
      // Match the storage API's UUID-based legacy object paths exactly.
      if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(path)) return null;
      let item = byPath.get(path);
      if (!item) {
        item = { path, posts: [], stories: [], owners: [] };
        byPath.set(path, item);
      }
      return item;
    };
    for (const post of state.posts) {
      const paths = new Set<string>();
      if ((!post.media?.length || post.media[0]?.type === 'image') && post.image) paths.add(post.image);
      for (const media of post.media ?? []) if (media.type === 'image') paths.add(media.url);
      for (const path of paths) ensure(path)?.posts.push(post);
    }
    for (const story of state.stories) if (story.image) ensure(story.image)?.stories.push(story);
    const names = new Map(state.characters.map(character => [character.id, character.name]));
    return Array.from(byPath.values()).map(item => {
      const ids = new Set([...item.posts.map(post => post.authorId), ...item.stories.map(story => story.authorId)]);
      return { ...item, owners: Array.from(ids, id => names.get(id) ?? 'Cuenta desconocida') };
    });
  }, [state.posts, state.stories, state.characters]);
  const legacyMedia = useMemo(() => legacyMediaDetails.map(item => item.path), [legacyMediaDetails]);
  const filteredLegacyMedia = useMemo(() => {
    const query = recoverySearch.trim().toLocaleLowerCase();
    if (!query) return legacyMediaDetails;
    return legacyMediaDetails.filter(item =>
      [item.path, ...item.owners, ...item.posts.map(post => post.caption),
        ...item.stories.map(story => story.caption),
        ...item.posts.map(post => new Date(post.createdAt).toLocaleDateString('es-AR')),
        ...item.stories.map(story => new Date(story.createdAt).toLocaleDateString('es-AR'))]
        .some(value => String(value ?? '').toLocaleLowerCase().includes(query)));
  }, [legacyMediaDetails, recoverySearch]);
  // Avoid rendering thousands of <option> elements on mobile; keep the selected value visible.
  const visibleLegacyMedia = useMemo(() => {
    const first = filteredLegacyMedia.slice(0, 100);
    const selected = legacyMediaDetails.find(item => item.path === recoveryMediaPath);
    return selected && !first.some(item => item.path === selected.path) ? [selected, ...first] : first;
  }, [filteredLegacyMedia, legacyMediaDetails, recoveryMediaPath]);
  const selectedMediaDetails = legacyMediaDetails.find(item => item.path === recoveryMediaPath);
  async function recoverContentPhoto(file: File) {
    if (!recoveryContentConfirmed || !recoveryMediaPath || recoveryBusy || !legacyMedia.includes(recoveryMediaPath)) return;
    setRecoveryBusy(true);
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 15 * 1024 * 1024)
        throw new Error('Usá JPG, PNG o WebP de hasta 15 MB.');
      setRecoveryStatus('Subiendo imagen original a R2…');
      const { uploadURL, objectPath } = await customFetch<{uploadURL: string; objectPath: string}>('/api/storage/uploads/request-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size: file.size, contentType: file.type }), responseType: 'json',
      });
      if (!objectPath.startsWith('/objects/r2/')) throw new Error('R2 no está habilitado. No se cambió el contenido.');
      const upload = await fetch(uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!upload.ok) throw new Error('No se pudo subir la foto.');
      await customFetch('/api/storage/uploads/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectPath }), responseType: 'json' });
      const oldPath = recoveryMediaPath;
      const expectedPosts = state.posts.map(post => ({
        id: post.id,
        cover: post.image === oldPath && (!post.media?.length || post.media[0]?.type === 'image'),
        mediaIds: (post.media ?? []).filter(item => item.type === 'image' && item.url === oldPath).map(item => item.id),
      })).filter(post => post.cover || post.mediaIds.length > 0);
      const expectedStoryIds = state.stories.filter(story => story.image === oldPath).map(story => story.id);
      actions.recoverLegacyMedia(oldPath, objectPath);
      setRecoveryStatus('Foto subida. Verificando guardado en el servidor…');
      await verifyRecoveredMedia(remote =>
        expectedPosts.every(expected => {
          const post = remote.posts.find(item => item.id === expected.id);
          return !!post && (!expected.cover || post.image === objectPath) &&
            expected.mediaIds.every(id => post.media?.some(item => item.id === id && item.type === 'image' && item.url === objectPath));
        }) &&
        expectedStoryIds.every(id => remote.stories.some(story => story.id === id && story.image === objectPath)) &&
        !remote.posts.some(post => (post.image === oldPath && (!post.media?.length || post.media[0]?.type === 'image')) ||
          post.media?.some(item => item.type === 'image' && item.url === oldPath)) &&
        !remote.stories.some(story => story.image === oldPath));
      setRecoveryStatus('Foto recuperada y sincronizada. Se conservaron captions, comentarios, likes y fechas.');
      setRecoveryMediaPath('');
      setRecoveryContentFile(null);
      setRecoveryContentConfirmed(false);
    } catch (error) {
      setRecoveryStatus(`No se pudo confirmar la recuperación completa. Revisá primero la publicación o historia antes de reintentar para evitar duplicados. ${error instanceof Error ? error.message : ''}`);
    } finally { setRecoveryBusy(false); }
  }
  const closeFriendContacts = state.characters.filter(c => c.id !== me.id && !c.archived && (state.follows[me.id] ?? []).includes(c.id) && (state.follows[c.id] ?? []).includes(me.id));

  return (
    <div>
      <TopBar title={t("settings")} onBack={back} />
      <div className="px-4 pb-12 pt-5">
        <section aria-labelledby="account-h">
          <h2 id="account-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Tu cuenta")}</h2>
          <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
            <div className="text-sm font-semibold">{user?.fullName || st('Cuenta ECHO')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{user?.primaryEmailAddress?.emailAddress || st('Sesión protegida')}</div>
            <button
              type="button"
              onClick={() => void signOut({ redirectUrl: basePath || '/' })}
              className="mt-4 flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
              data-testid="button-sign-out"
            >
              <LogOut className="h-4 w-4" /> {st("Cerrar sesión")}
            </button>
          </div>
        </section>

        <details className="group mt-4 mb-6 overflow-hidden rounded-2xl border border-border bg-card/60" data-testid="settings-ai-controls">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2.5"><Sparkles className="h-5 w-5 text-primary" strokeWidth={1.8} aria-hidden="true" />{language === 'es' ? 'IA y autonomía' : 'AI & autonomy'}</span>
            <ChevronDown className="h-5 w-5 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-2 border-t border-border px-3 pb-4">
            <AutonomySettingsSection />
          </div>
        </details>

        <Link href="/creator-hub" className="mt-4 flex min-h-14 items-center justify-between rounded-2xl border border-border bg-card/60 px-4 text-sm font-semibold lg:hidden" data-testid="link-creator-hub-mobile"><span className="flex items-center gap-3"><Palette className="h-5 w-5 text-primary" /> Creator Hub</span><span className="text-xs text-muted-foreground">{st("Tu perfil de creador ›")}</span></Link>

          <Link href="/music" className="mt-3 flex min-h-14 items-center justify-between rounded-2xl border border-border bg-card/60 px-4 text-sm font-semibold" data-testid="link-echo-music-studio">
            <span className="flex items-center gap-3"><Music2 className="h-5 w-5 text-primary" /> ECHO Music Studio</span>
            <span className="text-xs text-muted-foreground">{st("Crear canciones ›")}</span>
          </Link>

          <Link href="/video" className="mt-3 flex min-h-14 items-center justify-between rounded-2xl border border-border bg-card/60 px-4 text-sm font-semibold" data-testid="link-echo-video-studio">
            <span className="flex items-center gap-3"><Film className="h-5 w-5 text-primary" /> ECHO Video Studio</span>
            <span className="text-xs text-muted-foreground">{language === 'es' ? 'Crear videos y GIF ›' : 'Create videos & GIFs ›'}</span>
          </Link>

          <UniverseSelector />
          <Link href="/search" className="mt-3 flex min-h-12 items-center gap-3 rounded-2xl border border-border bg-card/60 p-4 text-sm font-semibold">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" /> {st("Buscar en este universo")}
          </Link>

        <Link href="/settings/subscriptions" className="mt-4 flex min-h-14 items-center justify-between rounded-2xl border border-border bg-card/60 px-4 text-sm font-semibold" data-testid="link-my-subscriptions">{st("Mi plan y suscripciones")} <span className="text-xs text-muted-foreground">{st("Ver planes y complementos ›")}</span></Link>

        <section className="mt-9" aria-labelledby="identity-h">
          <h2 id="identity-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Cuentas e identidad activa")}</h2>
          <p className="mt-1.5 px-1 text-[13px] leading-relaxed text-muted-foreground">
            {st('Todo lo que publiques, comentes o envíes saldrá con este perfil.')}
          </p>
          <details className="group mt-3 rounded-2xl border border-border bg-card/40" data-testid="details-account-manager"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden"><span>{st("Cuentas e identidad activa")} · {state.characters.filter(c=>!c.archived).length}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" /></summary><div className="border-t border-border px-3 pb-3"><AccountManager /></div></details>
        </section>

        <section className="mt-9" aria-labelledby="creator-h">
          <h2 id="creator-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Creator y privacidad")}</h2>
          <div className="mt-3 flex flex-col gap-2 text-sm font-semibold">
            <Link href="/creator-preview/universes" className="flex min-h-12 items-center rounded-2xl border border-border bg-card/60 px-4 hover:bg-secondary/50">{st("Mis universos y personajes")}</Link>
            <Link href="/creator-preview/privacy" className="flex min-h-12 items-center rounded-2xl border border-border bg-card/60 px-4 hover:bg-secondary/50">{st("Privacidad de personajes")}</Link>
          </div>
        </section>

        <section className="mt-9 mb-6" aria-labelledby="close-friends-h" data-testid="section-close-friends">
          <h2 id="close-friends-h" className="flex items-center gap-2 px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground"><Star className="h-4 w-4 text-primary" /> {st('Mejores amigos · ')}{me.name}</h2>
          <details className="group mt-3 rounded-2xl border border-border bg-card/40" data-testid="details-close-friends"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden"><span>{st('Mejores amigos · ')}{closeFriendContacts.filter(c => (state.closeFriends?.[me.id] ?? []).includes(c.id)).length}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" /></summary><div className="border-t border-border px-3 pb-3">
          <p className="mt-2 px-1 text-xs text-muted-foreground">{st("Solo los personajes seleccionados verán tus próximas historias para mejores amigos. Cada identidad tiene su propia lista.")}</p>
          <div className="mt-3 rounded-2xl border border-border bg-card/60 p-3">
            {closeFriendContacts.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">{({ es: 'Todavía no hay contactos que se sigan mutuamente con esta cuenta.', en: 'No mutual-follow contacts for this account yet.', pt: 'Ainda não há contatos que se sigam mutuamente nesta conta.', fr: 'Aucun contact avec un abonnement réciproque pour ce compte.', de: 'Für dieses Konto gibt es noch keine Kontakte, die sich gegenseitig folgen.', it: 'Non ci sono ancora contatti che si seguono a vicenda con questo account.', ko: '아직 이 계정과 서로 팔로우하는 연락처가 없습니다.', ja: 'このアカウントと相互フォローしている連絡先はまだありません。', zh: '此账号目前还没有互相关注的联系人。' } satisfies Record<Language, string>)[language]}</p>}
            {closeFriendContacts.map(c => {
              const selected = (state.closeFriends?.[me.id] ?? []).includes(c.id);
              return <button key={c.id} type="button" aria-pressed={selected} onClick={() => actions.toggleCloseFriend(c.id)} className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-border/50 px-2 text-left text-sm last:border-0" data-testid={`button-close-friend-${c.id}`}>
                <span className="truncate">{c.name} <span className="text-xs text-muted-foreground">@{c.handle}</span></span>
                <span className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-semibold', selected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground')}>{st(selected ? 'Agregado' : 'Agregar')}</span>
              </button>;
            })}
          </div>
          </div></details>
        </section>

        <CollapsibleSettings title={st("Apariencia")} testId="settings-appearance" icon={Palette}>
          <AppearanceSection />
        </CollapsibleSettings>

        <div id="echo-ai-style" className="scroll-mt-20">
          <CollapsibleSettings title={st("Generación de imágenes IA")} testId="settings-image-style" icon={ImageIcon}>
            <ImageGenerationStyleSection />
          </CollapsibleSettings>
        </div>

        <CollapsibleSettings title={st("Sonidos de mensajes")} testId="settings-message-sounds" icon={Music2}>
          <MessageSoundSettings />
        </CollapsibleSettings>

        <MusicConnectionsSection />

        <CollapsibleSettings title={st("Notificaciones del celular")} testId="settings-push-notifications" icon={Bell}>
          <PushNotificationSettings />
        </CollapsibleSettings>

        <section className="mt-9" aria-labelledby="support-h">
          <h2 id="support-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Ayuda y seguridad")}</h2>
          <div className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/60 text-sm font-semibold">
            <Link href="/help" className="flex min-h-12 items-center px-4 hover:bg-secondary/50">{st("Centro de ayuda · Reportar un problema")}</Link>
          </div>
        </section>

        <section className="mt-9" aria-labelledby="storage-h">
          <h2 id="storage-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Almacenamiento")}</h2>
          <div className="mt-3 rounded-2xl border border-border p-4 text-[13px]">
            <div className="flex items-center gap-2.5">
              <Cloud className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
              <span className="flex-1">{st("Nube privada ECHO")}</span>
              <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', storageError ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-muted-foreground')} data-testid="status-storage">
                {st(storageError ? 'Pendiente' : 'Sincronizado')}
              </span>
            </div>
            {storageError && <p role="alert" className="mt-3 text-destructive">{storageError}</p>}
            <p className="mt-3 text-muted-foreground">
              {state.posts.length} {st("publicaciones")} · {state.comments.length} {st("comentarios")} · {state.messages.length} {st("mensajes")}
            </p>
            {lastSavedAt && <p className="mt-1.5 text-xs text-muted-foreground">{st("Última sincronización:")} {new Date(lastSavedAt).toLocaleString(({ es: 'es-AR', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', ko: 'ko-KR', ja: 'ja-JP', zh: 'zh-CN' } as const)[language])}</p>}
            {storageError && (
              <button
                type="button"
                onClick={() => void actions.retrySync().then(() => toast({ title: st('Sincronizado') })).catch(() => undefined)}
                className="mt-3 h-10 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
                data-testid="button-retry-sync"
              >
                {st("Reintentar sincronización")}
              </button>
            )}
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-border bg-card/60 p-4" aria-label="Recuperar imágenes">
          <button type="button" onClick={() => setShowRecovery(value => !value)} className="flex w-full items-center justify-between text-left text-sm font-semibold" aria-expanded={showRecovery}>
            <span className="flex items-center gap-2"><ImageIcon className="h-4 w-4 text-primary" />Recuperar imágenes</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", showRecovery && "rotate-180")} />
          </button>
          {showRecovery && <div className="mt-4 space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">Seleccioná varias fotos desde tu iPhone y asigná cada una a un avatar. Solo se actualizarán los perfiles que confirmes; las fotos antiguas no se borran.</p>
            <input aria-label="Seleccionar imágenes para recuperar" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={recoveryBusy}
              onChange={event => { setRecoveryFiles(Array.from(event.currentTarget.files ?? [])); setRecoveryAssignments({}); setRecoveryConfirmed(false); setRecoveryStatus(''); }}
              className="block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-foreground" />
            {recoveryFiles.length > 0 && <div className="space-y-3">
              <p role="status" className="text-xs">{recoveryFiles.length} foto(s) seleccionada(s). Asigná cada foto a su personaje antes de subir.</p>
              {recoveryFiles.map((file, index) => <div key={index} className="flex items-center gap-2 rounded-lg bg-secondary/30 p-2">
                <RecoveryPreview file={file} />
                <div className="min-w-0 flex-1"><p className="truncate text-xs">{file.name}</p>
                  <select aria-label={`Personaje para ${file.name}`} className="mt-1 w-full rounded-lg bg-background p-2 text-xs disabled:opacity-50" disabled={recoveryBusy} value={recoveryAssignments[index] ?? ''}
                    onChange={event => { setRecoveryConfirmed(false); setRecoveryAssignments(previous => ({ ...previous, [index]: event.target.value })); }}>
                    <option value="">No asignar todavía</option>
                    {state.characters.filter(character => character.avatar?.startsWith('/objects/uploads/')).map(character =>
                      <option key={character.id} value={character.id}>{character.name}</option>)}
                  </select></div></div>)}
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" checked={recoveryConfirmed} disabled={recoveryBusy} onChange={event => setRecoveryConfirmed(event.target.checked)} className="mt-0.5" />
                Confirmo que asigné las fotos originales a los personajes correctos. Solo se reemplazarán sus avatares.
              </label>
              <button type="button" disabled={recoveryBusy || !recoveryConfirmed || !Object.values(recoveryAssignments).some(Boolean)}
                onClick={() => void recoverSelectedAvatars()} className="rounded-xl bg-primary px-4 py-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                {recoveryBusy ? 'Recuperando…' : 'Confirmar y recuperar avatares en R2'}
              </button>

            </div>}
            {recoveryStatus && <p role="status" aria-live="polite" className="rounded-lg bg-secondary/40 p-3 text-xs">{recoveryStatus}</p>}
            <div className="space-y-2">
              <p className="text-xs font-semibold">Avatares que necesitan recuperación</p>
              {state.characters.filter(character => character.avatar?.startsWith('/objects/uploads/')).map(character => (
                <div key={character.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs">
                  <span className="truncate">{character.name}</span><span className="shrink-0 text-muted-foreground">Copia antigua</span>
                </div>
              ))}
            </div>
            <div className="space-y-2 rounded-xl border border-border p-3 text-xs">
              <p className="font-semibold">Recuperar fotos de publicaciones e historias</p>
              <p className="text-muted-foreground">Seleccioná la referencia antigua exacta y después la foto original. Si una imagen se usa varias veces, se recuperan todas esas apariciones juntas.</p>
              <input type="search" aria-label="Buscar fotos antiguas" placeholder="Buscar por personaje, caption o fecha…" disabled={recoveryBusy} value={recoverySearch}
                onChange={event => setRecoverySearch(event.target.value)} className="w-full rounded-lg bg-background p-2" />
              <p className="text-muted-foreground">{filteredLegacyMedia.length} de {legacyMediaDetails.length} referencias encontradas{filteredLegacyMedia.length > 100 ? ' · Mostrando las primeras 100. Escribí una cuenta, fecha o caption para encontrar las demás.' : ''}</p>
              <select aria-label="Imagen antigua a recuperar" disabled={recoveryBusy} className="w-full rounded-lg bg-background p-2 disabled:opacity-50" value={recoveryMediaPath}
                onChange={event => { setRecoveryMediaPath(event.target.value); setRecoveryContentFile(null); setRecoveryContentConfirmed(false); setRecoveryStatus(''); }}>
                <option value="">Elegir referencia antigua</option>
                {visibleLegacyMedia.map((item, index) => <option key={item.path} value={item.path}>Imagen {index + 1} · {item.owners.join(', ').slice(0, 35)} · {item.posts.length && item.stories.length ? 'Publicación e historia' : item.posts.length ? 'Publicación' : 'Historia'} · {item.path.slice(-8)}</option>)}
              </select>
              {selectedMediaDetails && <div className="space-y-2 rounded-lg bg-secondary/30 p-3">
                <p className="font-semibold">Cuenta: {selectedMediaDetails.owners.join(', ')}</p>
                {selectedMediaDetails.posts.map(post => <div key={post.id} className="space-y-1 border-t border-border pt-2">
                  <p>Publicación · {new Date(post.createdAt).toLocaleDateString('es-AR')}</p>
                  <p className="line-clamp-3 whitespace-pre-wrap">{post.caption || 'Sin caption'}</p>
                  {post.media?.length ? <p className="text-muted-foreground">Carrusel de {post.media.length} elementos · {post.media.some(item => item.type === 'image' && item.url === recoveryMediaPath) ? `posición ${post.media.findIndex(item => item.type === 'image' && item.url === recoveryMediaPath) + 1}` : 'portada antigua'}</p> : null}
                </div>)}
                {selectedMediaDetails.stories.map(story => <div key={story.id} className="space-y-1 border-t border-border pt-2">
                  <p>Historia · {new Date(story.createdAt).toLocaleDateString('es-AR')}</p>
                  <p className="line-clamp-3 whitespace-pre-wrap">{story.caption || 'Sin texto'}</p>
                </div>)}
                <p className="break-all text-muted-foreground">Referencia: {recoveryMediaPath}</p>
              </div>}
              <input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Foto original para publicación o historia" disabled={!recoveryMediaPath || recoveryBusy}
                onChange={event => { setRecoveryContentFile(event.currentTarget.files?.[0] ?? null); setRecoveryContentConfirmed(false); setRecoveryStatus(''); }}
                className="block w-full text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2" />
              {recoveryContentFile && <div className="flex items-center gap-3"><RecoveryPreview file={recoveryContentFile} /><p className="min-w-0 break-all text-muted-foreground">Archivo elegido: {recoveryContentFile.name}</p></div>}
              <label className="flex items-start gap-2"><input type="checkbox" checked={recoveryContentConfirmed} disabled={!recoveryMediaPath || !recoveryContentFile || recoveryBusy}
                onChange={event => setRecoveryContentConfirmed(event.target.checked)} />
                Confirmo que esta foto corresponde a la referencia antigua seleccionada.</label>
              <button type="button" disabled={!recoveryContentFile || !recoveryMediaPath || !recoveryContentConfirmed || recoveryBusy}
                onClick={() => { if (recoveryContentFile) void recoverContentPhoto(recoveryContentFile); }}
                className="rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">Recuperar foto seleccionada</button>
              <p className="text-muted-foreground">No se sube nada hasta que confirmes y toques el botón. No se eliminan originales.</p>
            </div>
            <div className="rounded-xl border border-border p-3 text-xs">
              <p className="font-semibold">Inventario de imágenes antiguas</p>
              <p className="mt-2 text-muted-foreground">
                {state.characters.filter(character => character.avatar?.startsWith('/objects/uploads/')).length} avatares ·{' '}
                {state.posts.filter(post => post.image?.startsWith('/objects/uploads/') || post.media?.some(item => JSON.stringify(item).includes('/objects/uploads/'))).length} publicaciones ·{' '}
                {state.stories.filter(story => story.image?.startsWith('/objects/uploads/')).length} historias
              </p>
              <p className="mt-2 text-muted-foreground">Podés recuperar avatares, publicaciones e historias por separado. Elegí cada referencia con cuidado: la recuperación de publicaciones e historias requiere una foto original que corresponda exactamente.</p>
            </div>
          </div>}
        </section>

        <NelaEasterEgg />
      </div>

    </div>
  );
}

function AppearanceSection() {
  const language = useLanguage();
  const t = useTranslation();
  const st = useSettingsText();
  const { state, actions } = useSocial();
  const current = state.appearance ?? DEFAULT_APPEARANCE;
  const [custom, setCustom] = useState(current.accent);
  const set = (next: Appearance) => {
    try { actions.setAppearance(next); } catch (e) { toast({ title: st('No se pudo aplicar'), description: (e as Error).message }); }
  };
  const themes = [['dark', 'Oscuro', Moon], ['light', 'Claro', Sun], ['system', 'Sistema', Monitor]] as const;
  return (
    <section className="mt-9" aria-labelledby="appearance-h">
      <h2 id="appearance-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Apariencia")}</h2>
      <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-secondary p-1" role="radiogroup" aria-label={st("Tema")}>
          {themes.map(([k, label, Icon]) => (
            <button key={k} type="button" role="radio" aria-checked={current.theme === k} onClick={() => set({ ...current, theme: k })}
              className={cn('flex h-10 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold', current.theme === k ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}
              data-testid={`button-theme-${k}`}>
              <Icon className="h-4 w-4" strokeWidth={1.8} /> {st(label)}
            </button>
          ))}
        </div>
        <div className="mt-4 text-xs text-muted-foreground">{st("Color de acento")}</div>
        <div className="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label={st("Color de acento")}>
          {ACCENT_PRESETS.map((hex) => {
            const on = current.accent.toLowerCase() === hex;
            return (
              <button key={hex} type="button" role="radio" aria-checked={on} aria-label={`${st("Acento ")}${hex}`} onClick={() => { setCustom(hex); set({ ...current, accent: hex }); }}
                className={cn('grid h-11 w-11 place-items-center rounded-full ring-offset-2 ring-offset-card', on && 'ring-2 ring-foreground/70')} style={{ backgroundColor: hex }}
                data-testid={`button-accent-${hex.slice(1)}`}>
                {on && <Check className="h-4 w-4 text-[#1a1418]" strokeWidth={2.4} />}
              </button>
            );
          })}
          <label className="flex h-11 items-center gap-2 rounded-full border border-border pl-1.5 pr-3 text-xs" data-testid="label-accent-custom">
            <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} onBlur={() => custom !== current.accent && set({ ...current, accent: custom })}
              aria-label={st("Acento personalizado")} className="h-8 w-8 cursor-pointer rounded-full border-0 bg-transparent p-0" data-testid="input-accent-custom" />
            {st("Personalizado")}
          </label>
          {custom.toLowerCase() !== current.accent.toLowerCase() && (
            <button type="button" onClick={() => set({ ...current, accent: custom })} className="h-11 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground" data-testid="button-accent-apply">{st("Aplicar")}</button>
          )}
        </div>
        <button type="button" onClick={() => { setCustom(DEFAULT_APPEARANCE.accent); set(DEFAULT_APPEARANCE); }} className="mt-4 text-xs font-semibold text-muted-foreground hover:text-foreground" data-testid="button-appearance-reset">
          {st('Restablecer (oscuro · rosa)')}
        </button>
        <p className="mt-2 text-xs text-muted-foreground">{st("Se sincroniza con tu universo en todos tus dispositivos.")}</p>
        <div className="mt-5 border-t border-border pt-5">
          <label htmlFor="echo-language" className="mb-2 block text-sm font-semibold text-primary">🌐 {t("language")}</label>
          <p className="mb-3 text-xs text-muted-foreground">{t("languageDescription")}</p>
          <div className="relative w-full">
          <select id="echo-language" value={language} onChange={event=>setLanguage(event.target.value as Language)} className="h-11 w-full appearance-none rounded-xl border border-border bg-background pl-3 pr-11 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary" style={{ WebkitAppearance: "none", MozAppearance: "none" }}>
            {LANGUAGES.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      </div>
    </section>
  );
}

function ImageGenerationStyleSection() {
  const st = useSettingsText();
  const { state, actions } = useSocial();
  const selected = state.imageStyle ?? 'natural';
  const styles: { id: ImageStyle; label: string; detail: string }[] = [
    { id: 'natural', label: st('Realismo natural'), detail: st("Fotos cotidianas, piel con textura, luz real y rasgos naturales.") },
    { id: 'phone', label: st('Cámara de celular'), detail: st("Selfies espontáneas, flash, encuadres casuales y ruido digital.") },
    { id: 'analog', label: st('Analógica / 35 mm'), detail: st("Grano de película, colores orgánicos y sensación nostálgica.") },
    { id: 'editorial', label: st('Editorial'), detail: st("Fotografía profesional de moda, iluminación cuidada y detalle realista.") },
    { id: 'cinematic', label: st('Cinematográfica'), detail: st("Sombras, luz dramática y composición de película.") },
  ];
  return <section className="mt-9" aria-labelledby="image-style-h" data-testid="section-ai-image-settings">
    <h2 id="image-style-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{st("Generación de imágenes IA")}</h2>
    <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
      <h3 className="text-sm font-semibold">{st("Estilo fotográfico predeterminado")}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{st("Elegí cómo querés que se vean las imágenes generadas. Las referencias visuales y rasgos de cada personaje se mantienen independientemente del estilo.")}</p>
      <div className="mt-4 space-y-2" role="radiogroup" aria-label="Estilo de imágenes IA">
        {styles.map(({ id, label, detail }) => <button key={id} type="button" role="radio" aria-checked={selected === id}
          onClick={() => { actions.setImageStyle(id); toast({ title: st('Estilo de imagen guardado'), description: label }); }}
          data-testid={`button-image-style-${id}`}
          className={cn('flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors', selected === id ? 'border-primary bg-primary/10' : 'border-border bg-background/30')}>
          <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border', selected === id ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50')}>
            {selected === id && <Check className="h-3 w-3" />}
          </span>
          <span><span className="block text-sm font-semibold">{label}{id === 'natural' && <span className="ml-1 text-[11px] font-normal text-muted-foreground">· {st("recomendado")}</span>}</span>
            <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{detail}</span></span>
        </button>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{st("La preferencia se sincroniza con este universo y se usa al generar imágenes. Cambiar el estilo no genera imágenes ni consume créditos.")}</p>
    </div>
  </section>;
}
