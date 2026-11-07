import { usePostComposeText } from '@/lib/post-compose-translations';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useUser } from '@clerk/react';
import { Link, useLocation, useSearch } from 'wouter';
import { ChevronLeft, ChevronRight, ImagePlus, MapPin, Music2, Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import { AccountMultiPicker } from '@/components/echo/account-multi-picker';
import { MusicSelectorPreview } from '@/components/echo/music-selector-preview';
import { MentionSuggestions } from '@/components/echo/mention-suggestions';
import { MAX_POST_MEDIA, validatePostMedia } from '@/domain/post-media';
import type { PostMedia } from '@/domain/types';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { CharacterAvatar } from '@/components/echo/avatar';
import { Switch } from '@/components/ui/switch';
import { compressImage, useMediaResolver, uploadPrivateFile, uploadPrivateImage } from '@/lib/media';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { customFetch } from '@workspace/api-client-react';
import { getActiveUniverseId } from '@/store/persistence';

type Mode = 'post' | 'story';

export default function CreatePage() {
  const t = usePostComposeText();
  const resolveMedia = useMediaResolver();
  const search = useSearch();
  const initialMode: Mode = new URLSearchParams(search).get('mode') === 'story' ? 'story' : 'post';
  const { me, state, actions } = useSocial();
  const { user } = useUser();
  const [, navigate] = useLocation();
  const back = useBack();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [mediaSource, setMediaSource] = useState<'upload' | 'ai'>('upload');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPreview, setAiPreview] = useState(false);
  const [aiPrepared, setAiPrepared] = useState<{ preparedPrompt: string; referenceCount: number; style: string } | null>(null);
  const [aiPreparing, setAiPreparing] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiTransferAcknowledged, setAiTransferAcknowledged] = useState(false);
  const [aiGeneratedPath, setAiGeneratedPath] = useState<string | null>(null);
  const [aiEditSource, setAiEditSource] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<{ enabled: boolean; reason: string; prerequisites?: { openRouterKeyConfigured: boolean; privateStorageConfigured: boolean; providerValidated: boolean; budgetActivated: boolean } } | null>(null);
  const [items, setItems] = useState<PostMedia[]>([]);
  const [caption, setCaption] = useState('');
  const [location, setLocation] = useState('');
  const [alsoStory, setAlsoStory] = useState(false);
  const [closeFriendsOnly, setCloseFriendsOnly] = useState(false);
  const [tagged, setTagged] = useState<string[]>([]);
  const [mentioned, setMentioned] = useState<string[]>([]);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [musicTitle, setMusicTitle] = useState('');
  const [musicArtist, setMusicArtist] = useState('');
  const [selectedMusicTrack, setSelectedMusicTrack] = useState<{ id: string; title: string; characterId: string; durationSeconds: number; startSeconds: number; clipSeconds: 15 | 30 } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** null = append, number = replace that index */
  const replaceAt = useRef<number | null>(null);
  const image = items[0]?.url ?? null;
  const previewUrl = image ? resolveMedia(image) : '';
  const [loadedPreviewUrl, setLoadedPreviewUrl] = useState<string | null>(null);
  const previewLoaded = Boolean(previewUrl && loadedPreviewUrl === previewUrl);
  const firstIsVideo = items[0]?.type === 'video';
  const tooManyForStory = mode === 'story' && items.length > 1;
  const storyVideo = mode === 'story' && items.some((m) => m.type === 'video');
  const musicPartial = mode === 'story' && !!musicTitle.trim() !== !!musicArtist.trim();

  const pick = (replace: number | null) => {
    if (busy) return;
    replaceAt.current = replace;
    if (fileRef.current) {
      fileRef.current.multiple = replace === null && mode === 'post';
      fileRef.current.click();
    }
  };

  const onFiles = async (list: FileList | null) => {
    const files = list ? Array.from(list) : [];
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length || busy) return;
    const replace = replaceAt.current;
    setError(null);
    if (replace === null) {
      const limit = mode === 'story' ? 1 - items.length : MAX_POST_MEDIA - items.length;
      if (mode === 'story' && items.length) {
        // story: single photo, picking again replaces
      } else if (files.length > limit) {
        setError(`${t('Máximo')} ${MAX_POST_MEDIA} ${t('fotos. Te quedan')} ${Math.max(0, limit)}; ${t('elegiste')} ${files.length}. ${t('Elegí menos.')}`);
        return;
      }
    }
    setBusy(true);
    const failures: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(files.length > 1 ? `${t('Subiendo')} ${i + 1} ${t('de')} ${files.length}…` : t('Subiendo de forma privada…'));
        try {
          const mid = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
          let item: PostMedia;
          if (files[i].type.startsWith('video/')) {
            if (mode === 'story') throw new Error(t('Las historias admiten solo fotos.'));
            const att = await uploadPrivateFile(files[i]);
            item = { id: mid, type: 'video', url: att.url, ...(att.mimeType ? { mimeType: att.mimeType } : {}) };
          } else {
            const compressed = await compressImage(files[i], mode === 'story' ? 1280 : 1440);
            item = { id: mid, type: 'image', url: await uploadPrivateImage(compressed) };
          }
          setItems((cur) => {
            if (replace !== null && cur[replace]) return cur.map((c, j) => (j === replace ? item : c));
            if (mode === 'story') return [item];
            return cur.length >= MAX_POST_MEDIA ? cur : [...cur, item];
          });
        } catch (e) {
          failures.push(`${files[i].name || `${t('Foto')} ${i + 1}`}: ${(e as Error).message}`);
        }
      }
      if (failures.length) setError(`${t('No se pudieron subir')} ${failures.length} ${t('foto(s). Las demás se conservaron.')} ${failures.join(' ')}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const checkAiStatus = async () => {
    try {
      const status = await customFetch<{ enabled: boolean; reason: string; prerequisites?: { openRouterKeyConfigured: boolean; privateStorageConfigured: boolean; providerValidated: boolean; budgetActivated: boolean } }>('/api/ai-engine/images/status', { responseType: 'json' });
      setAiStatus(status);
    } catch {
      setAiStatus(null);
    }
  };

  useEffect(() => {
    if (mediaSource !== 'ai') return;
    let active = true;
    void customFetch<{ enabled: boolean; reason: string; prerequisites?: { openRouterKeyConfigured: boolean; privateStorageConfigured: boolean; providerValidated: boolean; budgetActivated: boolean } }>('/api/ai-engine/images/status', { responseType: 'json' })
      .then((status) => { if (active) setAiStatus(status); })
      .catch(() => { if (active) setAiStatus(null); });
    return () => { active = false; };
  }, [mediaSource]);

  const prepareAi = async () => {
    if (!aiPrompt.trim() || aiPreparing) return;
    setAiPreparing(true);
    setAiPrepared(null);
    setError(null);
    try {
      const result = await customFetch<{ preparedPrompt: string; referenceCount?: number; style: string; generationEnabled: boolean }>(aiEditSource ? '/api/ai-engine/images/prepare-edit' : '/api/ai-engine/images/prepare', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), characterId: me.id, prompt: aiPrompt.trim(), ...(aiEditSource ? { sourceObjectPath: aiEditSource } : {}) }), responseType: 'json',
      });
      if (result.generationEnabled) throw new Error(t('La preparación no debe generar imágenes.'));
      setAiPrepared({ preparedPrompt: result.preparedPrompt, referenceCount: result.referenceCount ?? (aiEditSource ? 1 : 0), style: result.style });
      setAiPreview(true);
      void checkAiStatus();
    } catch (err) { setError((err as Error).message || t('No se pudo preparar la imagen.')); }
    finally { setAiPreparing(false); }
  };

  const generateAi = async () => {
    if (!aiPrepared || !aiStatus?.enabled || !aiTransferAcknowledged || aiGenerating || !aiPrompt.trim()) return;
    setAiGenerating(true);
    setAiGeneratedPath(null);
    setError(null);
    try {
      const result = await customFetch<{ objectPath: string }>('/api/ai-engine/images/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId: getActiveUniverseId(user?.id ?? ''), characterId: me.id, prompt: aiPrompt.trim(), imageTransferAcknowledgement: 'image-transfer-preview-v1', ...(aiEditSource ? { sourceObjectPath: aiEditSource } : {}) }), responseType: 'json',
      });
      if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(result.objectPath)) throw Error(t('El generador devolvió una imagen inválida.'));
      setAiGeneratedPath(result.objectPath);
    } catch (err) { setError((err as Error).message || t('No se pudo generar la imagen.')); }
    finally { setAiGenerating(false); void checkAiStatus(); }
  };

  const acceptAi = () => {
    if (!aiGeneratedPath) return;
    const media: PostMedia = { id: `ai_${Date.now().toString(36)}`, type: 'image', url: aiGeneratedPath };
    setItems([media]);
    setMediaSource('upload');
    setAiGeneratedPath(null);
    setError(null);
  };

  const move = (i: number, d: -1 | 1) =>
    setItems((cur) => {
      const j = i + d;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => setItems((cur) => cur.filter((_, j) => j !== i));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mediaSource === 'ai') { setError(t("La generación IA está en modo preparación. Cambiá a Subir foto o video para publicar.")); return; }
    if (!image) {
      setError(t('Elige una foto para continuar.'));
      return;
    }
    try {
      if (mode === 'story') {
        if (tooManyForStory) {
          setError(t("Las historias admiten una sola foto. Quitá fotos hasta dejar una."));
          return;
        }
        if (storyVideo) { setError(t('Las historias admiten solo fotos.')); return; }
        if (musicPartial) { setError(t("Completá título y artista de la música, o dejá ambos vacíos.")); return; }
        actions.createStory({ image, caption, closeFriendsOnly, ...(mentioned.length ? { mentionedAccountIds: mentioned } : {}),
          ...(musicTitle.trim() ? { music: { title: musicTitle.trim().slice(0, 160), artist: musicArtist.trim().slice(0, 160) } } : {}) });
        toast({ title: t('Historia publicada'), description: `${t('Como')} ${me.name}` });
        navigate('/');
        return;
      }
      validatePostMedia(items);
      const id = actions.createPost({ image, media: items, caption, location, ...(tagged.length ? { taggedAccountIds: tagged } : {}), commentsEnabled });
      const cover = items.find((m) => m.type === 'image');
      if (alsoStory && cover) actions.createStory({ image: cover.url, caption: '' });
      toast({ title: t('Publicado'), description: `${t('Como')} ${me.name}` });
      navigate(`/p/${id}`);
    } catch (err) {
      setError((err as Error).message || t('No se pudo publicar.'));
    }
  };

  return (
    <div>
      <TopBar title={t(mode === 'story' ? 'Nueva historia' : 'Nueva publicación')} onBack={back} />
      <form onSubmit={submit} className="px-4 pb-6 pt-4">
        <div className="mb-5 grid grid-cols-2 rounded-2xl bg-card p-1" role="tablist" aria-label={t("Tipo de contenido")}>
          {(['post', 'story'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              disabled={busy}
              onClick={() => { setMode(m); setError(null); }}
              className={cn('h-11 rounded-xl text-sm font-semibold transition-colors', mode === m ? 'bg-secondary text-foreground' : 'text-muted-foreground')}
              data-testid={`tab-mode-${m}`}
            >
              {t(m === 'post' ? 'Publicación' : 'Historia')}
            </button>
          ))}
        </div>

        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-border p-3">
          <CharacterAvatar character={me} size={40} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t("Publicando como")}</div>
            <div className="truncate text-sm font-semibold" data-testid="text-posting-as">{me.name} · @{me.handle}</div>
          </div>
          <Link href="/settings" className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-secondary px-4 text-xs font-semibold" data-testid="link-create-switch">
            <RefreshCw className="h-3.5 w-3.5" /> {t("Cambiar")}
          </Link>
        </div>

        {mode === 'story' && <div className="mb-4 rounded-2xl border border-border bg-card/60 p-4" data-testid="story-audience">
          <p className="text-sm font-semibold">{t("¿Quién puede ver esta historia?")}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={!closeFriendsOnly} onClick={() => setCloseFriendsOnly(false)} className={cn('h-11 rounded-xl text-sm', !closeFriendsOnly ? 'bg-primary text-primary-foreground' : 'bg-secondary')} data-testid="button-story-audience-everyone">{t("Todos")}</button>
            <button type="button" aria-pressed={closeFriendsOnly} onClick={() => setCloseFriendsOnly(true)} className={cn('h-11 rounded-xl text-sm', closeFriendsOnly ? 'bg-primary text-primary-foreground' : 'bg-secondary')} data-testid="button-story-audience-close-friends">★ {t("Mejores amigos")}</button>
          </div>
          {closeFriendsOnly && <p className="mt-2 text-xs text-muted-foreground">{state.closeFriends?.[me.id]?.length ?? 0} {t('mejores amigos seleccionados. Podés editarlos en Ajustes.')}</p>}
        </div>}
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl bg-card p-1" role="tablist" aria-label={t("Origen de imagen")}>
          <button type="button" role="tab" aria-selected={mediaSource === 'upload'} onClick={() => setMediaSource('upload')}
            className={cn('flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-semibold', mediaSource === 'upload' ? 'bg-secondary text-foreground' : 'text-muted-foreground')}
            data-testid="tab-media-upload"><ImagePlus className="h-4 w-4" /> {t("Subir foto o video")}</button>
          <button type="button" role="tab" aria-selected={mediaSource === 'ai'} onClick={() => setMediaSource('ai')}
            className={cn('flex h-11 items-center justify-center gap-2 rounded-xl text-xs font-semibold', mediaSource === 'ai' ? 'bg-secondary text-foreground' : 'text-muted-foreground')}
            data-testid="tab-media-ai"><Sparkles className="h-4 w-4" /> {t("Generar con IA")}</button>
        </div>
        {mediaSource === 'ai' && <section className="mb-5 rounded-2xl border border-border bg-card/60 p-4" data-testid="section-ai-image-compose">
          <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> {t('Crear una imagen para')} {me.name}</div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t("Describí la escena. Cuando conectemos el modelo, usará las referencias visuales del personaje y el estilo de Ajustes.")}</p>
          {aiEditSource && <div className="mt-3 rounded-xl border border-border p-3 text-xs" data-testid="ai-edit-source"><p className="font-semibold">{t("Modo edición · vista previa gratuita")}</p><img src={resolveMedia(aiEditSource)} alt={t("Imagen original para editar")} className="mt-2 max-h-44 w-full rounded-lg object-contain" /><button type="button" className="mt-2 underline" onClick={() => { setAiEditSource(null); setAiPrepared(null); setAiPreview(false); setAiTransferAcknowledged(false); }}>{t("Volver a imagen nueva")}</button></div>}
          <textarea aria-label={t("Descripción de imagen IA")} value={aiPrompt} onChange={e => { setAiPrompt(e.target.value.slice(0, 2000)); setAiPreview(false); setAiPrepared(null); setAiGeneratedPath(null); setAiTransferAcknowledged(false); }}
            rows={4} maxLength={2000} placeholder={`${t('Ej.:')} ${me.name} ${t('sacándose una selfie en el backstage después de un concierto, luz tenue, expresión espontánea.')}`}
            className="mt-3 min-h-28 w-full resize-y rounded-xl border border-input bg-background px-3 py-3 text-sm focus:border-primary/60 focus:outline-none"
            data-testid="input-ai-image-prompt" />
          <div className="mt-3 rounded-xl border border-border bg-background/40 p-3 text-xs">
            <div className="font-semibold">{t("Estilo:")} {t(({ natural: 'Realismo natural', phone: 'Cámara de celular', analog: 'Analógica / 35 mm', editorial: 'Editorial', cinematic: 'Cinematográfica' } as const)[state.imageStyle ?? 'natural'])}</div>
            <div className="mt-1 text-muted-foreground">{t("Referencia facial:")} {t(me.avatar ? 'foto de perfil' : 'sin foto')} · {t('Referencias adicionales:')} {me.identity?.referenceImages?.length ?? 0}/5</div>
            <div className="mt-1 text-muted-foreground">{t("Descripciones:")} {t(me.identity?.facialDescription ? 'rostro ✓' : 'rostro pendiente')} · {t(me.identity?.bodyDescription ? 'cuerpo ✓' : 'cuerpo pendiente')}</div>
            <Link href={`/characters/${me.id}/edit`} className="mt-2 inline-block text-primary underline">{t("Editar identidad visual")}</Link>
          </div>
          {aiStatus && <div className="mt-3 rounded-xl border border-border bg-background/40 p-3 text-xs" data-testid="ai-provider-status">
            <div className="font-semibold">{t(aiStatus.enabled ? 'Generador disponible' : 'Generador pendiente de activación')}</div>
            {!aiStatus.enabled && <p className="mt-1 text-muted-foreground">{t("La vista previa es gratuita. Todavía no se envían solicitudes pagas.")}</p>}
            {aiStatus.prerequisites && <p className="mt-1 text-muted-foreground">
              {t('Clave API:')} {aiStatus.prerequisites.openRouterKeyConfigured ? t('configurada') : t('pendiente')} · {t('Almacenamiento:')} {aiStatus.prerequisites.privateStorageConfigured ? t('configurado') : t('pendiente')} · {t('Proveedor:')} {aiStatus.prerequisites.providerValidated ? t('validado') : t('pendiente')} · {t('Presupuesto:')} {aiStatus.prerequisites.budgetActivated ? t('habilitado') : t('bloqueado')}
            </p>}
          </div>}
          <button type="button" disabled={!aiPrompt.trim() || aiPreparing} onClick={() => void prepareAi()}
            className="mt-3 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40"
            data-testid="button-ai-image-preview">{t(aiPreparing ? 'Preparando…' : 'Preparar vista previa · gratis')}</button>
          <label className="mt-3 flex items-start gap-3 rounded-xl border border-border bg-background/40 p-3 text-xs leading-relaxed" data-testid="label-ai-transfer-acknowledgement">
            <input type="checkbox" className="mt-0.5" checked={aiTransferAcknowledged} onChange={e => setAiTransferAcknowledged(e.target.checked)} data-testid="checkbox-ai-transfer-acknowledgement" />
            <span>{t("Entiendo que, si activo una generación real, ECHO enviará mi descripción de la escena y hasta cuatro imágenes privadas de referencia del personaje a OpenRouter y al proveedor del modelo para crear la imagen. No debo incluir fotografías ajenas sin autorización ni datos sensibles. Esta confirmación es específica de la prueba de imágenes, no reemplaza los documentos legales definitivos ni habilita por sí sola el servicio.")}</span>
          </label>
          {aiPreview && aiPrepared && <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-3" data-testid="ai-image-preview">
            <div className="text-sm font-semibold">{t("Vista previa de la solicitud")}</div>
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{aiPrepared.preparedPrompt}</p><p className="mt-2 text-xs text-muted-foreground">{t("Referencias privadas seleccionadas:")} {aiPrepared.referenceCount ?? (aiEditSource ? 1 : 0)} · Estilo: {aiPrepared.style}</p>
            {aiGeneratedPath ? <div className="mt-3 space-y-3" data-testid="ai-generated-result">
              <img src={resolveMedia(aiGeneratedPath)} alt={t("Imagen generada para revisar")} className="mx-auto max-h-80 w-full rounded-xl object-contain" />
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={acceptAi} className="h-11 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground" data-testid="button-ai-accept">{t("Aprobar y continuar")}</button>
                <button type="button" onClick={() => { setAiEditSource(aiGeneratedPath); setAiGeneratedPath(null); setAiPrepared(null); setAiPreview(false); setAiTransferAcknowledged(false); }} className="h-11 rounded-xl border border-border px-3 text-xs font-semibold" data-testid="button-ai-edit">{t("Editar esta imagen")}</button>
                <button type="button" onClick={() => { setAiGeneratedPath(null); setAiPrepared(null); setAiPreview(false); setAiTransferAcknowledged(false); }} className="h-11 rounded-xl border border-border px-3 text-xs font-semibold" data-testid="button-ai-regenerate">{t("Otra versión")}</button>
              </div>
            </div> : <div className="mt-3 space-y-2">
              <button type="button" disabled={!aiStatus?.enabled || !aiTransferAcknowledged || aiGenerating} onClick={() => void generateAi()}
                className="h-11 w-full rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40" data-testid="button-ai-generate">
                {t(aiGenerating ? 'Generando…' : aiStatus?.enabled ? (aiEditSource ? 'Generar edición' : 'Generar imagen') : aiEditSource ? 'Edición pendiente de activación' : 'Generación pendiente de activación')}
              </button>
              <p className="text-xs text-muted-foreground">{t(aiStatus?.enabled ? 'Generar puede consumir créditos. Revisá el presupuesto antes de continuar.' : 'Todavía no se envían solicitudes pagas. Podés subir una foto desde la otra pestaña.')}</p>
            </div>}
          </div>}
        </section>}
        <input ref={fileRef} type="file" accept={mode === 'post' ? 'image/*,video/mp4,video/webm' : 'image/*'} multiple={mode === 'post'} className="hidden" disabled={busy} onChange={(e) => onFiles(e.target.files)} data-testid="input-file" />
        {mediaSource === 'upload' && (image ? (
          <div className="relative overflow-hidden rounded-[22px] bg-card py-0">
            {!previewLoaded && <div className="absolute inset-0 z-10 flex items-center justify-center bg-card" role="status" aria-label={t("Procesando vista previa")}><span className="text-sm text-muted-foreground">{t('Procesando…')}</span></div>}
            {firstIsVideo ? (
              <video src={previewUrl} onLoadedData={() => setLoadedPreviewUrl(previewUrl)} controls playsInline preload="metadata" className="mx-auto block h-[min(240px,34dvh)] w-full bg-black object-contain" data-testid="video-preview" />
            ) : (
              <img src={previewUrl} onLoad={() => setLoadedPreviewUrl(previewUrl)} alt={items.length > 1 ? `${t('Vista previa, elemento 1 de')} ${items.length}` : t('Vista previa')} className={cn('mx-auto block object-cover', mode === 'story' ? 'aspect-[9/16] h-[min(240px,34dvh)] rounded-[18px]' : 'h-[min(240px,34dvh)] w-full')} data-testid="img-preview" />
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => pick(0)}
              className="absolute bottom-3 right-3 z-20 h-11 rounded-full bg-[hsl(240_8%_3%/0.7)] px-4 text-xs font-semibold backdrop-blur disabled:opacity-50"
              data-testid="button-change-image"
            >
              {t(busy ? 'Procesando…' : 'Cambiar foto')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => pick(null)}
            className={cn('flex w-full flex-col items-center justify-center gap-3 rounded-[22px] border border-dashed border-[hsl(240_4%_24%)] bg-card/60 transition-colors hover:border-primary/50', 'h-[min(200px,30dvh)]')}
            data-testid="button-pick-image"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-accent text-accent-foreground">
              <ImagePlus className="h-6 w-6" strokeWidth={1.5} />
            </span>
            <span className="font-display text-lg font-light">{t(busy ? 'Procesando…' : mode === 'post' ? 'Elige fotos o videos' : 'Elige una foto')}</span>
            <span className="px-4 text-center text-xs text-muted-foreground">{busy ? progress ?? t('Subiendo de forma privada…') : mode === 'post' ? `${t('Fotos o videos, hasta')} ${MAX_POST_MEDIA}. ${t('Se guardan en privado.')}` : t('JPG, PNG o HEIC compatible. Se guardará en tu cuenta.')}</span>
          </button>
        ))}

        {mediaSource === 'upload' && (mode === 'post' || mode === 'story') && items.length === 0 && !busy && (
          <button
            type="button"
            onClick={() => {
              setItems([{ id: 'echo-beta-sample', type: 'image', url: 'asset:account-default' }]);
              setError(null);
            }}
            className="mt-3 w-full rounded-2xl border border-border bg-secondary px-4 py-3 text-sm font-medium"
            data-testid="button-use-sample-image"
          >
            Usar imagen de prueba · sin subir archivos
          </button>
        )}

        {mediaSource === 'upload' && items.length > 0 && (mode === 'post' || items.length > 1) && (
          <div className="mt-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span data-testid="text-media-count">{items.length}/{MAX_POST_MEDIA} · {t('fotos y videos MP4/WebM')}</span>
              {busy && <span aria-live="polite" data-testid="text-upload-progress">{progress}</span>}
            </div>
            <ol className="no-scrollbar flex gap-2 overflow-x-auto pb-1" aria-label={t("Orden de las fotos")}>
              {items.map((m, i) => (
                <li key={m.id} data-media-id={m.id} className="w-[132px] shrink-0 rounded-2xl border border-border bg-card p-1.5" data-testid={`item-media-${i}`}>
                  <div className="relative">
                    {m.type === 'video' ? (
                      <video src={resolveMedia(m.url)} muted playsInline preload="metadata" aria-label={`${t('Video')} ${i + 1} ${t('de')} ${items.length}`} className="aspect-[4/5] w-full rounded-xl bg-black object-cover" data-testid={`video-media-preview-${i}`} />
                    ) : (
                      <img src={resolveMedia(m.url)} alt={`${t('Foto')} ${i + 1} ${t('de')} ${items.length}`} className="aspect-[4/5] w-full rounded-xl object-cover" data-testid={`img-media-preview-${i}`} />
                    )}
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-[hsl(240_8%_3%/0.7)] px-2 py-0.5 text-[11px] font-semibold">{i + 1}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={`${t('Mover foto')} ${i + 1} ${t('a la izquierda')}`} className="grid h-11 w-11 place-items-center rounded-full hover:bg-secondary disabled:opacity-30" data-testid={`button-media-left-${i}`}><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" disabled={busy} onClick={() => remove(i)} aria-label={`${t('Quitar foto')} ${i + 1}`} className="grid h-11 w-11 place-items-center rounded-full text-destructive hover:bg-secondary disabled:opacity-30" data-testid={`button-media-remove-${i}`}><X className="h-4 w-4" /></button>
                    <button type="button" disabled={busy || i === items.length - 1} onClick={() => move(i, 1)} aria-label={`${t('Mover foto')} ${i + 1} ${t('a la derecha')}`} className="grid h-11 w-11 place-items-center rounded-full hover:bg-secondary disabled:opacity-30" data-testid={`button-media-right-${i}`}><ChevronRight className="h-4 w-4" /></button>
                  </div>
                </li>
              ))}
              {mode === 'post' && items.length < MAX_POST_MEDIA && (
                <li className="shrink-0">
                  <button type="button" disabled={busy} onClick={() => pick(null)} className="flex h-full min-h-[160px] w-[96px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[hsl(240_4%_24%)] text-xs text-muted-foreground hover:border-primary/50 disabled:opacity-40" data-testid="button-add-media">
                    <Plus className="h-5 w-5" /> Añadir
                  </button>
                </li>
              )}
            </ol>
            {tooManyForStory && (
              <p className="mt-2 text-xs text-primary" data-testid="text-story-too-many">{t("Las historias admiten una sola foto. Quitá fotos hasta dejar una o volvé a Publicación.")}</p>
            )}
          </div>
        )}

        <label className="mt-5 block">
          <span className="sr-only">{t("Pie de foto")}</span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 600))}
            rows={2}
            placeholder={t(mode === 'story' ? 'Texto sobre la historia (opcional)' : 'Escribe un pie de foto…')}
            className="min-h-[76px] w-full resize-none rounded-2xl border border-input bg-card px-4 py-3 text-[15px] leading-relaxed placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
            data-testid="input-caption"
          />
        </label>
        <MentionSuggestions text={caption} onPick={(t) => setCaption(t.slice(0, 600))} excludeId={me.id} className="mt-2" />

        {mode === 'story' && (
          <div className="mt-3 grid gap-3">
            <AccountMultiPicker value={mentioned} onChange={setMentioned} label={t("Mencionar cuentas")} excludeId={me.id} max={50} testId="picker-story-mentions" />
            <MusicSelectorPreview title={musicTitle} artist={musicArtist} onTitleChange={setMusicTitle} onArtistChange={setMusicArtist} story selectedTrack={selectedMusicTrack} onTrackChange={setSelectedMusicTrack} />
          </div>
        )}

        {mode === 'post' && <div className="mt-3"><MusicSelectorPreview title={musicTitle} artist={musicArtist} onTitleChange={setMusicTitle} onArtistChange={setMusicArtist} story={false} selectedTrack={selectedMusicTrack} onTrackChange={setSelectedMusicTrack} /></div>}

        {mode === 'post' && (
          <>
            <label className="mt-3 flex items-center gap-3 rounded-2xl border border-input bg-card px-4">
              <MapPin className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
              <input
                aria-label={t("Ubicación")}
                value={location}
                onChange={(e) => setLocation(e.target.value.slice(0, 80))}
                placeholder={t("Añadir ubicación")}
                className="h-12 flex-1 bg-transparent text-[15px] placeholder:text-muted-foreground focus:outline-none"
                data-testid="input-location"
              />
            </label>
            <div className="mt-3"><AccountMultiPicker value={tagged} onChange={setTagged} label={t("Etiquetar cuentas")} excludeId={me.id} testId="picker-post-tags" /></div>
            <label className="mt-3 flex items-center justify-between rounded-2xl border border-border px-4 py-3">
              <span className="block text-sm font-medium">{t("Permitir comentarios")}</span>
              <Switch checked={commentsEnabled} onCheckedChange={setCommentsEnabled} data-testid="switch-comments-enabled" />
            </label>
            <label className="mt-3 flex items-center justify-between rounded-2xl border border-border px-4 py-3">
              <span>
                <span className="block text-sm font-medium">{t("Compartir también en tu historia")}</span>
                <span className="text-xs text-muted-foreground">{t('Aparecerá en el círculo de')} {me.name.split(' ')[0]}{items.length > 1 ? t(' · se usa solo la primera foto') : ''}{items.length && !items.some((m) => m.type === 'image') ? t(' · requiere al menos una foto') : ''}</span>
              </span>
              <Switch checked={alsoStory} onCheckedChange={setAlsoStory} data-testid="switch-also-story" />
            </label>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-2xl bg-destructive/15 px-4 py-3 text-sm text-destructive" data-testid="text-create-error">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={mediaSource === 'ai' || !image || busy || tooManyForStory || storyVideo || musicPartial}
          className="tap mt-6 h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
          data-testid="button-publish"
        >
          {t(mode === 'story' ? 'Publicar historia' : 'Publicar')}
        </button>
      </form>
    </div>
  );
}
