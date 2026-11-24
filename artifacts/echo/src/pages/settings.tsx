import { useClerk, useUser } from '@clerk/react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

// iOS Files sometimes supplies an empty or generic MIME type for a valid image.
// Infer only from a supported extension; the server still checks the actual bytes.
function recoveryImageType(file: File): string {
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
    : extension === 'png' ? 'image/png'
    : extension === 'webp' ? 'image/webp' : '';
}

export default function SettingsPage() {
  const { state, me, actions, storageError, syncConflictCount, lastSavedAt, universeId } = useSocial();
  const recoveryUniverseRef = useRef(universeId);
  recoveryUniverseRef.current = universeId;
  const [showRecovery, setShowRecovery] = useState(false);
  const { user } = useUser();
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMediaPath, setRecoveryMediaPath] = useState('');
  const [recoverySearch, setRecoverySearch] = useState('');
  const [recoveryContentFile, setRecoveryContentFile] = useState<File | null>(null);
  const [recoveryContentConfirmed, setRecoveryContentConfirmed] = useState(false);
  const [recoveryStatus, setRecoveryStatus] = useState('');
  const [legacyAvailability, setLegacyAvailability] = useState<Record<string, string>>({});
  const [legacyReasons, setLegacyReasons] = useState<Record<string, number>>({});
  const [checkingLegacy, setCheckingLegacy] = useState(false);
  const [autoCopyConfirmed, setAutoCopyConfirmed] = useState(false);
  const [recoveryBatchFiles, setRecoveryBatchFiles] = useState<File[]>([]);
  const [recoveryBatchConfirmed, setRecoveryBatchConfirmed] = useState(false);
  const [recoveryBatchAssignments, setRecoveryBatchAssignments] = useState<Record<number, string>>({});
  // Never carry file-to-account assignments across universe switches.
  useEffect(() => {
    setRecoveryMediaPath('');
    setRecoveryContentFile(null);
    setRecoveryContentConfirmed(false);
    setRecoverySearch('');
    setRecoveryBatchFiles([]);
    setRecoveryBatchAssignments({});
    setRecoveryBatchConfirmed(false);
    setRecoveryStatus('');
    setLegacyAvailability({});
    setAutoCopyConfirmed(false);
  }, [universeId]);
  const { signOut } = useClerk();
  const back = useBack();
  const t = useTranslation();
  const st = useSettingsText();
  const language = useLanguage();
  function assertRecoveryUniverse(expected: string) {
    if (recoveryUniverseRef.current !== expected)
      throw new Error('Cambiaste de universo durante la recuperación. Revisá el resultado antes de reintentar.');
  }
  async function verifyRecoveredMedia(expectedUniverse: string, check: (remote: typeof state) => boolean) {
    assertRecoveryUniverse(expectedUniverse);
    if (!user?.id) throw new Error('No se pudo identificar la sesión para verificar el guardado.');
    // The regular universe sync can wait on unrelated pending work. Bound the
    // UI wait without cancelling that sync or claiming that the upload failed.
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        actions.retrySync(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(
            'La foto se subió, pero la sincronización tardó demasiado. No vuelvas a subirla: revisá la publicación y el estado de sincronización antes de reintentar.'
          )), 30000);
        }),
      ]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
    assertRecoveryUniverse(expectedUniverse);
    const remote = await loadUniverse(expectedUniverse);
    assertRecoveryUniverse(expectedUniverse);
    if (!remote.state || !check(remote.state)) throw new Error('El servidor todavía no refleja la imagen recuperada. Comprobá el perfil antes de reintentar.');
  }
  const legacyMediaDetails = useMemo(() => {
    const byPath = new Map<string, { path: string; posts: typeof state.posts; stories: typeof state.stories; owners: string[] }>();
    const ensure = (path: string) => {
      // Require the UUID shape used by the storage API, not merely 36 arbitrary hex/hyphen characters.
      if (!/^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path)) return null;
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
  async function inspectRecoveryServerState() {
    if (!recoveryMediaPath) {
      setRecoveryStatus('Primero elegí una referencia antigua en el selector de publicaciones. No necesitás elegir un archivo ni confirmar una subida.');
      return;
    }
    setRecoveryStatus('Consultando el estado real de la publicación en el servidor…');
    try {
      const remote = await loadUniverse(universeId);
      if (!remote.state) throw new Error('El servidor no devolvió el estado del universo.');
      const oldPath = recoveryMediaPath;
      const localPosts = state.posts.filter(post =>
        post.image === oldPath || post.media?.some(item => item.type === 'image' && item.url === oldPath));
      const localStoryIds = new Set(state.stories.filter(story => story.image === oldPath).map(story => story.id));
      const ids = new Set(localPosts.map(post => post.id));
      const serverPosts = remote.state.posts.filter(post => ids.has(post.id));
      const serverStories = remote.state.stories.filter(story => localStoryIds.has(story.id));
      if (!ids.size && !localStoryIds.size) {
        setRecoveryStatus('Esta referencia ya no figura en la sesión local. Actualizá ECHO y volvé a revisar el perfil.');
        return;
      }
      // Compare only the original cover and carousel item IDs. Another image
      // in the same post may already be in R2 and must not count as recovered.
      const expected = localPosts.map(post => ({
        id: post.id,
        cover: post.image === oldPath,
        mediaIds: (post.media ?? []).filter(item => item.type === 'image' && item.url === oldPath).map(item => item.id),
      }));
      const inspected = expected.flatMap(item => {
        const post = serverPosts.find(candidate => candidate.id === item.id);
        if (!post) return ['missing'];
        return [
          ...(item.cover ? [post.image] : []),
          ...item.mediaIds.map(id => post.media?.find(media => media.id === id && media.type === 'image')?.url),
        ];
      });
      for (const storyId of localStoryIds) {
        inspected.push(serverStories.find(story => story.id === storyId)?.image ?? 'missing');
      }
      const oldCount = inspected.filter(path => path === oldPath).length;
      const r2Count = inspected.filter(path => typeof path === 'string' && path.startsWith('/objects/r2/') && /^[0-9a-f-]{36}$/i.test(path.slice('/objects/r2/'.length))).length;
      const missingCount = inspected.length - oldCount - r2Count;
      setRecoveryStatus(oldCount > 0
        ? `El servidor conserva ${oldCount} referencia(s) antigua(s) de esta foto. ${r2Count} ya apunta(n) a R2 y ${missingCount} requieren revisión. No vuelvas a subir la foto.`
        : r2Count > 0 && missingCount === 0
          ? 'Todas las ubicaciones originales de esta foto apuntan ahora a R2. Si no aparece, revisaremos la carga de imágenes del perfil.'
          : 'La referencia antigua ya no aparece, pero hay ubicaciones sin una referencia R2 verificable. No vuelvas a subirla hasta revisar el resultado.');
    } catch (error) {
      setRecoveryStatus(`No se pudo consultar el estado del servidor: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  async function recoverContentPhoto(file: File | null, batchPath?: string): Promise<boolean> {
    const targetPath = batchPath ?? recoveryMediaPath;
    if (!batchPath && (recoveryBusy || !recoveryContentConfirmed || !targetPath || !legacyMedia.includes(targetPath))) {
      setRecoveryStatus('No se inició la recuperación: revisá la referencia y la confirmación, o esperá a que termine la operación anterior.');
      return false;
    }
    if (!targetPath || !legacyMedia.includes(targetPath)) {
      setRecoveryStatus('La referencia seleccionada ya no está disponible en esta sesión. Actualizá ECHO antes de reintentar.');
      return false;
    }
    const recoveryUniverse = universeId;
    if (!batchPath) {
      setRecoveryBusy(true);
      setRecoveryStatus('Preparando recuperación… Comprobando que la publicación siga intacta en el servidor.');
    }
    try {
      if (syncConflictCount > 0) throw new Error('Hay cambios en conflicto pendientes de resolver. No se subió otra copia de la foto. Revisá la sincronización antes de continuar.');
      if (storageError) throw new Error(`La sincronización informa un problema: ${storageError}. No se subió otra copia de la foto.`);
      if (file && (!recoveryImageType(file) || !file.size || file.size > 15 * 1024 * 1024))
        throw new Error('Usá JPG, PNG o WebP de hasta 15 MB.');
      const oldPath = targetPath;
      // Check the current server snapshot before uploading: the photo may already have
      // been recovered in another session or the selected post/story may have changed.
      assertRecoveryUniverse(recoveryUniverse);
      const beforeUpload = await loadUniverse(recoveryUniverse);
      assertRecoveryUniverse(recoveryUniverse);
      const stillPending = beforeUpload.state && (
        beforeUpload.state.posts.some(post =>
          (post.image === oldPath && (!post.media?.length || post.media[0]?.type === 'image')) ||
          post.media?.some(item => item.type === 'image' && item.url === oldPath)) ||
        beforeUpload.state.stories.some(story => story.image === oldPath)
      );
      if (!stillPending)
        throw new Error('La referencia antigua ya no aparece en el servidor. Actualizá ECHO antes de subir esta foto.');
      // A stale local snapshot could otherwise replace only some references while
      // leaving other occurrences of this image broken on the server.
      const localPostRefs = state.posts.filter(post =>
        (post.image === oldPath && (!post.media?.length || post.media[0]?.type === 'image')) ||
        post.media?.some(item => item.type === 'image' && item.url === oldPath)).map(post => post.id).sort();
      const remotePostRefs = beforeUpload.state!.posts.filter(post =>
        (post.image === oldPath && (!post.media?.length || post.media[0]?.type === 'image')) ||
        post.media?.some(item => item.type === 'image' && item.url === oldPath)).map(post => post.id).sort();
      const localStoryRefs = state.stories.filter(story => story.image === oldPath).map(story => story.id).sort();
      const remoteStoryRefs = beforeUpload.state!.stories.filter(story => story.image === oldPath).map(story => story.id).sort();
      if (JSON.stringify(localPostRefs) !== JSON.stringify(remotePostRefs) ||
          JSON.stringify(localStoryRefs) !== JSON.stringify(remoteStoryRefs))
        throw new Error('Las publicaciones o historias cambiaron en el servidor. Actualizá ECHO antes de recuperar esta imagen.');
      // Matching post IDs alone is insufficient: a carousel may have gained or lost
      // an image entry while the local session was stale.
      const imageSlots = (posts: typeof state.posts) => posts.flatMap(post => [
        ...((post.image === oldPath && (!post.media?.length || post.media[0]?.type === 'image')) ? [`${post.id}:cover`] : []),
        ...(post.media ?? []).filter(item => item.type === 'image' && item.url === oldPath)
          .map(item => `${post.id}:media:${item.id}`),
      ]).sort();
      if (JSON.stringify(imageSlots(state.posts)) !== JSON.stringify(imageSlots(beforeUpload.state!.posts)))
        throw new Error('El carrusel o la portada cambió en el servidor. Actualizá ECHO antes de recuperar esta imagen.');
      let objectPath = '';
      if (file) {
        // Reuse a claimed R2 upload after a failed universe sync instead of
        // creating duplicate files. Scope the checkpoint to owner, universe and
        // original media path; never store signed upload URLs or credentials.
        const checkpointKey = `echo:media-recovery:${user!.id}:${recoveryUniverse}:${oldPath}`;
        const previous = window.localStorage.getItem(checkpointKey);
        const cachedPath = previous && previous.startsWith('/objects/r2/') && /^[0-9a-f-]{36}$/i.test(previous.slice('/objects/r2/'.length)) ? previous : null;
        if (cachedPath) {
          const existing = await customFetch<Blob>(`/api/storage/objects/r2/${cachedPath.split('/').pop()}`, {
            method: 'GET', responseType: 'blob',
          }).catch(() => null);
          if (existing && existing.size > 0) {
            objectPath = cachedPath;
            setRecoveryStatus('Reutilizando la foto ya subida a R2. Verificando su asociación con la publicación…');
          } else {
            window.localStorage.removeItem(checkpointKey);
          }
        }
        if (!objectPath) {
        setRecoveryStatus('Subiendo imagen original a R2…');
        const signed = await customFetch<{uploadURL: string; objectPath: string}>('/api/storage/uploads/request-url', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name || 'recovered-image', size: file.size, contentType: recoveryImageType(file) }), responseType: 'json',
        });
        objectPath = signed.objectPath;
        if (!/^\/objects\/r2\/[0-9a-f-]{36}$/i.test(objectPath)) throw new Error('La referencia de R2 no es válida.');
        const upload = await fetch(signed.uploadURL, { method: 'PUT', headers: { 'Content-Type': recoveryImageType(file) }, body: file });
        if (!upload.ok) throw new Error('No se pudo subir la foto.');
        await customFetch('/api/storage/uploads/claim', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ objectPath }), responseType: 'json' });
        window.localStorage.setItem(checkpointKey, objectPath);
        }
      } else {
        if (!autoCopyConfirmed || legacyAvailability[oldPath] !== 'available') throw new Error('Primero comprobá y confirmá la imagen disponible en Supabase.');
        setRecoveryStatus('Copiando imagen original desde Supabase a R2…');
        const copied = await customFetch<{oldPath: string; objectPath: string}>('/api/storage/recovery/copy-legacy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ oldPath }), responseType: 'json',
        });
        if (copied.oldPath !== oldPath) throw new Error('La copia no corresponde a la referencia solicitada.');
        objectPath = copied.objectPath;
      }
      if (!/^\/objects\/r2\/[0-9a-f-]{36}$/i.test(objectPath)) throw new Error('La referencia de R2 no es válida.');
      const expectedPosts = state.posts.map(post => ({
        id: post.id,
        cover: post.image === oldPath && (!post.media?.length || post.media[0]?.type === 'image'),
        mediaIds: (post.media ?? []).filter(item => item.type === 'image' && item.url === oldPath).map(item => item.id),
      })).filter(post => post.cover || post.mediaIds.length > 0);
      const expectedStoryIds = state.stories.filter(story => story.image === oldPath).map(story => story.id);
      // The upload may take several seconds. Recheck the exact references before
      // applying the new path so concurrent edits cannot leave a partial recovery.
      assertRecoveryUniverse(recoveryUniverse);
      const beforeApply = await loadUniverse(recoveryUniverse);
      assertRecoveryUniverse(recoveryUniverse);
      if (!beforeApply.state ||
          JSON.stringify(imageSlots(beforeApply.state.posts)) !== JSON.stringify(imageSlots(state.posts)) ||
          JSON.stringify(beforeApply.state.stories.filter(story => story.image === oldPath).map(story => story.id).sort()) !==
            JSON.stringify(expectedStoryIds.slice().sort()))
        throw new Error('Las referencias cambiaron mientras se subía la foto. Actualizá ECHO y revisá la publicación antes de reintentar.');
      actions.recoverLegacyMedia(oldPath, objectPath);
      setRecoveryStatus(file ? 'Foto subida. Verificando guardado en el servidor…' : 'Foto copiada desde Supabase. Verificando guardado en el servidor…');
      await verifyRecoveredMedia(recoveryUniverse, remote =>
        expectedPosts.every(expected => {
          const post = remote.posts.find(item => item.id === expected.id);
          return !!post && (!expected.cover || post.image === objectPath) &&
            expected.mediaIds.every(id => post.media?.some(item => item.id === id && item.type === 'image' && item.url === objectPath));
        }) &&
        expectedStoryIds.every(id => remote.stories.some(story => story.id === id && story.image === objectPath)) &&
        !remote.posts.some(post => (post.image === oldPath && (!post.media?.length || post.media[0]?.type === 'image')) ||
          post.media?.some(item => item.type === 'image' && item.url === oldPath)) &&
        !remote.stories.some(story => story.image === oldPath));
      if (file && user?.id) window.localStorage.removeItem(`echo:media-recovery:${user.id}:${recoveryUniverse}:${oldPath}`);
      setRecoveryStatus('Foto recuperada y sincronizada. Se conservaron captions, comentarios, likes y fechas.');
      if (!batchPath) {
        setRecoveryMediaPath('');
        setRecoveryContentFile(null);
        setRecoveryContentConfirmed(false);
      }
      return true;
    } catch (error) {
      setRecoveryStatus(`No se pudo confirmar la recuperación completa. Revisá primero la publicación o historia antes de reintentar para evitar duplicados. ${error instanceof Error ? error.message : ''}`);
      return false;
    } finally { if (!batchPath) setRecoveryBusy(false); }
  }
  async function checkLegacyAvailability() {
    if (checkingLegacy || recoveryBusy) return;
    setCheckingLegacy(true);
    setAutoCopyConfirmed(false);
    setLegacyAvailability({});
    setLegacyReasons({});
    try {
      // Use the server-owned inventory rather than arbitrary avatar/content references.
      // Legacy references can contain extensions or non-UUID identifiers, which the
      // check-legacy endpoint intentionally rejects with INVALID_RECOVERY_PATHS.
      const inventory = await customFetch<{ paths: Array<{ path: string }> }>('/api/storage/recovery/inventory', {
        method: 'GET', responseType: 'json',
      });
      const ownedPaths = new Set((inventory.paths ?? []).map(entry => entry.path));
      const paths = legacyMedia.filter(path => ownedPaths.has(path));
      if (!paths.length) {
        setRecoveryStatus('No se encontraron referencias comprobables de publicaciones o historias en esta sesión.');
        return;
      }
      const results: Record<string, string> = {};
      const reasons: Record<string, number> = {};
      for (let i = 0; i < paths.length; i += 30) {
        const response = await customFetch<{ results: Array<{ path: string; status: string; reason?: string }> }>('/api/storage/recovery/check-legacy', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: paths.slice(i, i + 30) }), responseType: 'json',
        });
        for (const result of response.results) {
          results[result.path] = result.status;
          if (result.status === 'unknown') reasons[result.reason ?? 'unspecified'] = (reasons[result.reason ?? 'unspecified'] ?? 0) + 1;
        }
        setRecoveryStatus(`Comprobadas ${Math.min(i + 30, paths.length)} de ${paths.length} imágenes…`);
      }
      setLegacyAvailability(results);
      setLegacyReasons(reasons);
      setRecoveryStatus(`Supabase: ${Object.values(results).filter(v => v === 'available').length} disponibles, ${Object.values(results).filter(v => v === 'missing').length} faltantes. No se modificaron imágenes.`);
    } catch (error) {
      setLegacyAvailability({});
      setAutoCopyConfirmed(false);
      setRecoveryStatus(`No se pudo comprobar Supabase: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
    finally { setCheckingLegacy(false); }
  }
  async function recoverAvailableContent() {
    if (recoveryBusy || checkingLegacy || !autoCopyConfirmed) return;
    const pending = legacyMedia.filter(path => legacyAvailability[path] === 'available');
    if (!pending.length) { setRecoveryStatus('No hay publicaciones disponibles para copiar.'); return; }
    setRecoveryBusy(true);
    try {
      // One verified copy at a time; stop after the first to refresh the local universe
      // before the next copy and avoid applying edits from a stale state snapshot.
      const ok = await recoverContentPhoto(null, pending[0]);
      if (ok) {
        setLegacyAvailability(previous => ({ ...previous, [pending[0]]: 'recovered' }));
        setRecoveryStatus('Imagen copiada y sincronizada. Actualizá el inventario antes de continuar con la siguiente.');
      }
      // On failure, preserve the specific diagnostic from recoverContentPhoto.
      // The copy may already exist in R2, so never retry silently.
    } finally { setRecoveryBusy(false); setAutoCopyConfirmed(false); }
  }
  async function recoverContentBatch() {
    if (recoveryBusy || !recoveryBatchConfirmed || recoveryBatchFiles.length === 0) return;
    const assignments = recoveryBatchFiles.map((file, index) => ({ file, path: recoveryBatchAssignments[index] ?? '' }));
    if (assignments.some(item => !item.path || !legacyMedia.includes(item.path) || !recoveryImageType(item.file) || !item.file.size || item.file.size > 15 * 1024 * 1024) ||
        new Set(assignments.map(item => item.path)).size !== assignments.length) {
      setRecoveryStatus('Asigná una referencia distinta y válida a cada imagen JPG, PNG o WebP de hasta 15 MB.');
      return;
    }
    // Process one item per confirmation: React's state snapshot may be stale after
    // coordinator sync, so continuing automatically risks overwriting a prior edit.
    const item = assignments[0];
    setRecoveryBusy(true);
    try {
      setRecoveryStatus(`Recuperando ${item.file.name} (1 de ${assignments.length})…`);
      const ok = await recoverContentPhoto(item.file, item.path);
      if (!ok) return;
      setRecoveryBatchFiles(previous => previous.slice(1));
      setRecoveryBatchAssignments(previous => Object.fromEntries(
        Object.entries(previous).filter(([index]) => Number(index) > 0)
          .map(([index, path]) => [Number(index) - 1, path])));
      setRecoveryBatchConfirmed(false);
      setRecoveryStatus(`Foto recuperada y verificada. Quedan ${assignments.length - 1} por revisar. Confirmá el siguiente lote después de actualizar ECHO.`);
    } catch (error) {
      setRecoveryStatus(`Se detuvo la recuperación: ${error instanceof Error ? error.message : 'Error desconocido'}`);
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
            {recoveryStatus && <p role="status" aria-live="polite" className="rounded-lg bg-secondary/40 p-3 text-xs">{recoveryStatus}</p>}
            <div className="space-y-3 rounded-xl border border-border p-3 text-xs">
              <p className="font-semibold">Recuperar publicaciones e historias en lote</p>
              <p className="text-muted-foreground">Elegí varias fotos juntas, revisá cada miniatura y asigná una referencia original diferente a cada una. Solo se subirán al confirmar.</p>
              <input type="search" aria-label="Filtrar referencias del lote" placeholder="Buscar por personaje, fecha o caption…" disabled={recoveryBusy} value={recoverySearch}
                onChange={event => setRecoverySearch(event.target.value)} className="w-full rounded-lg bg-background p-2" />
              <p className="text-muted-foreground">Mostrando {visibleLegacyMedia.length} de {filteredLegacyMedia.length} referencias filtradas. Buscá para acotar la lista.</p>
              <input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={recoveryBusy}
                aria-label="Seleccionar fotos de publicaciones e historias en lote"
                onChange={event => { setRecoveryBatchFiles(Array.from(event.currentTarget.files ?? [])); setRecoveryBatchAssignments({}); setRecoveryBatchConfirmed(false); }}
                className="block w-full text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2" />
              {recoveryBatchFiles.map((file, index) => <div key={index} className="flex items-center gap-2 rounded-lg bg-secondary/30 p-2">
                <RecoveryPreview file={file} />
                <div className="min-w-0 flex-1"><p className="truncate">{file.name}</p>
                  <select className="mt-1 w-full rounded-lg bg-background p-2" aria-label={`Referencia para ${file.name}`}
                    value={recoveryBatchAssignments[index] ?? ''} disabled={recoveryBusy}
                    onChange={event => { setRecoveryBatchConfirmed(false); setRecoveryBatchAssignments(previous => ({ ...previous, [index]: event.target.value })); }}>
                    <option value="">Sin asignar</option>
                    {(recoveryBatchAssignments[index] && !visibleLegacyMedia.some(item => item.path === recoveryBatchAssignments[index]) ? [legacyMediaDetails.find(item => item.path === recoveryBatchAssignments[index]), ...visibleLegacyMedia] : visibleLegacyMedia).filter((item): item is (typeof legacyMediaDetails)[number] => Boolean(item)).map(item => <option key={item.path} value={item.path}>
                      {item.owners.join(', ')} · {item.posts[0]?.caption?.slice(0, 45) || item.stories[0]?.caption?.slice(0, 45) || (item.posts[0]?.createdAt ? new Date(item.posts[0].createdAt).toLocaleDateString('es-AR') : '') || (item.stories[0]?.createdAt ? new Date(item.stories[0].createdAt).toLocaleDateString('es-AR') : '') || 'Sin texto'} · {item.path.slice(-8)}
                    </option>)}
                  </select>
                </div>
              </div>)}
              {recoveryBatchFiles.length > 0 && <p className="text-muted-foreground">Preparadas {Object.values(recoveryBatchAssignments).filter(Boolean).length} de {recoveryBatchFiles.length} fotos. Revisá las asociaciones antes de confirmar.</p>}
              <label className="flex items-start gap-2"><input type="checkbox" checked={recoveryBatchConfirmed} disabled={recoveryBusy || !recoveryBatchFiles.length}
                onChange={event => setRecoveryBatchConfirmed(event.target.checked)} className="mt-0.5" />
                Confirmo que cada foto corresponde a la publicación o historia indicada. Entiendo que un lote puede completarse parcialmente si hay un error.
              </label>
              <button type="button" disabled={!recoveryBatchConfirmed || recoveryBusy || !recoveryBatchFiles.length || recoveryBatchFiles.some((file, index) => !recoveryBatchAssignments[index] || !recoveryImageType(file) || !file.size || file.size > 15 * 1024 * 1024) || new Set(Object.values(recoveryBatchAssignments).filter(Boolean)).size !== recoveryBatchFiles.length}
                onClick={() => void recoverContentBatch()} className="rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                {recoveryBusy ? 'Recuperando…' : 'Confirmar y recuperar siguiente foto'}
              </button>
              <p className="text-muted-foreground">Por seguridad, se procesa una foto por confirmación. Revisá la sincronización y volvé a confirmar antes de la siguiente.</p>
            </div>
            <div className="space-y-2 rounded-xl border border-border p-3 text-xs">
              <p className="font-semibold">Recuperar fotos de publicaciones e historias</p>
            <button type="button" disabled={checkingLegacy || recoveryBusy} onClick={() => void checkLegacyAvailability()}
              className="rounded-xl border border-border px-3 py-2 text-xs font-semibold disabled:opacity-50">
              {checkingLegacy ? 'Comprobando Supabase…' : 'Buscar originales de publicaciones e historias en Supabase'}
            </button>
            {Object.keys(legacyAvailability).length > 0 && <p className="text-xs text-muted-foreground">Disponibles: {Object.values(legacyAvailability).filter(v => v === 'available').length} · Faltantes: {Object.values(legacyAvailability).filter(v => v === 'missing').length} · Sin confirmar: {Object.values(legacyAvailability).filter(v => v !== 'available' && v !== 'missing').length}</p>}
            {Object.keys(legacyReasons).length > 0 && <p className="text-xs text-muted-foreground" role="status">Motivos sin confirmar: {Object.entries(legacyReasons).map(([reason, count]) => `${({ access_denied: 'Acceso denegado por Supabase', storage_server_error: 'Error del servidor de almacenamiento', unexpected_storage_response: 'Respuesta inesperada', timeout: 'Tiempo de espera agotado', connection_error: 'Error de conexión', unspecified: 'Sin detalle' } as Record<string, string>)[reason] ?? (reason.startsWith('http_') ? `HTTP ${reason.slice(5)}` : 'Otro error')}: ${count}`).join(' · ')}. No se modificaron imágenes.</p>}
            {Object.values(legacyAvailability).some(v => v === 'available') && <div className="space-y-2 rounded-xl border border-border p-3 text-xs">
              <p className="font-semibold">Copiar directamente desde Supabase</p>
              <p>Se recuperará una imagen de publicación o historia por vez. El original permanece en Supabase; ECHO verificará el nuevo archivo y su sincronización.</p>
              <label className="flex items-start gap-2"><input type="checkbox" checked={autoCopyConfirmed} disabled={recoveryBusy || checkingLegacy} onChange={event => setAutoCopyConfirmed(event.target.checked)} /> Confirmo que quiero copiar una imagen disponible a R2 y actualizar sus referencias.</label>
              <button type="button" disabled={!autoCopyConfirmed || recoveryBusy || checkingLegacy || !legacyMedia.some(path => legacyAvailability[path] === 'available')}
                onClick={() => void recoverAvailableContent()} className="rounded-xl bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50">Copiar y verificar una imagen</button>
            </div>}
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
                className="rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50">
                {recoveryBusy ? 'Recuperando foto…' : 'Recuperar foto seleccionada'}
              </button>
              <button type="button"
                onClick={() => void inspectRecoveryServerState()}
                className="rounded-xl border border-border px-4 py-3 text-xs font-semibold disabled:opacity-50">
                Comprobar publicación en servidor (sin subir foto)
              </button>
              {recoveryStatus && <p role="status" aria-live="polite" aria-atomic="true" className="rounded-lg bg-secondary/40 p-3 text-xs break-words">{recoveryStatus}</p>}
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
