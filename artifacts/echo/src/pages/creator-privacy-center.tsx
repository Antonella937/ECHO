import { usePrivacyCenterText } from '@/lib/privacy-center-translations';
import { useLanguage } from '@/lib/i18n';
import React from 'react';
import { CharacterInitials } from '../components/echo/visual-defaults';
import { hasCharacterImage } from '../lib/visual-defaults';
import { resolveMedia } from '../lib/media';
import { useUser } from '@clerk/react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowLeft, LockKeyhole, Shield } from 'lucide-react';
import {
  getGetOwnerConsentQueryKey,
  getGetUniverseQueryKey,
  getListCreatorUniversesQueryKey,
  useGetOwnerConsent,
  useGetUniverse,
  useListCreatorUniverses,
} from '@workspace/api-client-react';
import { AlphaConsentBoundary } from '@/components/echo/alpha-consent';
import { PreviewHeading, PreviewShell } from './creator-product-previews';
import { ownerScopedPreviewKey } from '@/lib/visual-defaults';
import { getActiveUniverseId } from '@/store/persistence';
import './creator-product-previews.css';

type Visibility = 'public' | 'private';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin', cache: 'no-store', ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json() as Promise<T>;
}

const sharingUrl = (universeId: string) => `/api/universe/${encodeURIComponent(universeId)}/sharing`;
const visibilityUrl = (universeId: string, characterId: string) =>
  `/api/character-privacy/${encodeURIComponent(characterId)}/visibility?universeId=${encodeURIComponent(universeId)}`;

function StateCard({ title, body, onRetry, testId }: { title: string; body: string; onRetry?: () => void; testId: string }) {
  const t = usePrivacyCenterText();
  return (
    <section className="ep-complete" role={onRetry ? 'alert' : 'status'} data-testid={testId}>
      <span className="ep-eyebrow">{t("Privacidad")}</span>
      <h1>{title}</h1>
      <p>{body}</p>
      {onRetry && <button type="button" className="ep-button" onClick={onRetry} data-testid="button-retry-privacy">{t("Reintentar")}</button>}
    </section>
  );
}

function PrivacyCenterContent({ ownerId }: { ownerId: string }) {
  const t = usePrivacyCenterText();
  const language = useLanguage();
  const queryClient = useQueryClient();
  const universeId = getActiveUniverseId(ownerId);
  const universesQuery = useListCreatorUniverses({ universeId }, {
    query: { queryKey: ownerScopedPreviewKey(getListCreatorUniversesQueryKey({ universeId }), ownerId) },
  });
  const universeQuery = useGetUniverse({ universeId }, {
    query: { queryKey: ownerScopedPreviewKey(getGetUniverseQueryKey({ universeId }), ownerId) },
  });
  const consentQuery = useGetOwnerConsent({ query: { queryKey: [...getGetOwnerConsentQueryKey(), ownerId] } });
  const metadata = universesQuery.data?.find(item => item.universeId === universeId);
  const archived = Boolean(metadata?.archived);
  const characters = (universeQuery.data?.state?.characters ?? []).filter(character => !character.archived);
  const sharingKey = ['privacy-center', ownerId, universeId, 'sharing'] as const;
  const sharingQuery = useQuery({
    queryKey: sharingKey,
    queryFn: () => requestJson<{ sharingEnabled: boolean }>(sharingUrl(universeId)),
    enabled: Boolean(metadata) && !archived,
  });
  const visibilityQueries = useQueries({
    queries: characters.map(character => ({
      queryKey: ['privacy-center', ownerId, universeId, 'character', character.id] as const,
      queryFn: () => requestJson<{ visibility: Visibility }>(visibilityUrl(universeId, character.id)),
      enabled: Boolean(metadata) && !archived,
    })),
  });
  const disableSharing = useMutation({
    mutationFn: (enabled: boolean) => requestJson<{ sharingEnabled: boolean }>(sharingUrl(universeId), {
      method: 'PUT', body: JSON.stringify({ sharingEnabled: enabled }),
    }),
    onSuccess: data => queryClient.setQueryData(sharingKey, data),
  });
  const setVisibility = useMutation({
    mutationFn: ({ characterId, visibility }: { characterId: string; visibility: Visibility }) =>
      requestJson<{ visibility: Visibility }>(visibilityUrl(universeId, characterId), {
        method: 'PUT', body: JSON.stringify({ visibility }),
      }),
    onSuccess: (data, vars) => queryClient.setQueryData(['privacy-center', ownerId, universeId, 'character', vars.characterId], data),
  });

  if (universesQuery.isError || universeQuery.isError) {
    return <StateCard testId="status-privacy-error" title={t("No se pudo cargar.")} body={t("Tus ajustes no se modificaron.")}
      onRetry={() => { void universesQuery.refetch(); void universeQuery.refetch(); }} />;
  }
  if (universesQuery.isLoading || universeQuery.isLoading) {
    return <StateCard testId="status-privacy-loading" title={t("Cargando tu universo…")} body={t("Leyendo los ajustes reales de tu cuenta.")} />;
  }
  if (!metadata || archived || !universeQuery.data?.state) {
    return <StateCard testId="status-privacy-unavailable" title={t("Universo no disponible.")}
      body={t("El universo activo está archivado o no existe. Los universos archivados no se pueden configurar aquí.")} />;
  }
  const sharing = sharingQuery.data?.sharingEnabled;
  const consent = consentQuery.data;

  return (
    <>
      <aside className="epc-notice" role="note" data-testid="note-privacy-limits">
        <Shield size={15} aria-hidden="true" />
        <p>{t('No existe aceptación legal válida, ni enlaces privados, ni compartir público habilitado. Activar el compartir está bloqueado hasta que existan documentos legales reales y autorización de enlaces por destinatario.')}</p>
      </aside>
      <section className="epc-privacy-layout" aria-label={t("Centro de privacidad")}>
        <div className="epc-privacy-rail">
          <div className="epc-privacy-rail-top"><Shield size={17} /><span>{t("UNIVERSO")}</span></div>
          <h2 data-testid="text-universe-name">{metadata.name}</h2>
          <div className="epc-setting-line">
            <span><LockKeyhole size={15} /> {t("Compartir universo")}</span>
            {sharingQuery.isError
              ? <button type="button" className="epc-text-control" onClick={() => void sharingQuery.refetch()} data-testid="button-retry-sharing">{t("Reintentar")}</button>
              : sharing === undefined ? <span className="epc-state-pill">{t("Cargando…")}</span>
              : <button type="button" className={`epc-toggle ${sharing ? 'is-on' : ''}`} role="switch" aria-checked={sharing}
                  aria-label={sharing ? 'Desactivar compartir' : 'Activar compartir'}
                  disabled={disableSharing.isPending}
                  onClick={() => disableSharing.mutate(!sharing)} data-testid="toggle-universe-sharing"><i /></button>}
          </div>
          <p>{sharing ? 'Compartir está habilitado. Solo quien tenga un enlace autorizado podrá ver una vista limitada.' : 'Privado. Activá compartir para generar enlaces de vista previa.'}</p>
          {disableSharing.isError && <p className="ep-form-error" role="alert">{t("No se pudo desactivar. Inténtalo de nuevo.")}</p>}
          {consent?.draftAcknowledged && <small className="epc-caption" data-testid="text-consent-record">
            {t('Borrador alfa registrado')}{consent.acknowledgedAt ? ` ${t('el')} ${new Date(consent.acknowledgedAt).toLocaleDateString(language)}` : ''} · {t('versión')} {consent.version}. {t('No es consentimiento legal.')}
          </small>}
        </div>
        <div className="epc-privacy-content">
          <div className="epc-privacy-toolbar"><div><span className="ep-overline">{t("VISIBILIDAD POR PERSONAJE")}</span><h2>{t("Tus personajes")}</h2></div></div>
          {characters.length === 0 && <p className="epc-subtle-note" data-testid="status-privacy-empty">{t("Este universo todavía no tiene personajes activos.")}</p>}
          {characters.map((character, index) => {
            const query = visibilityQueries[index];
            const isPublic = query?.data?.visibility === 'public';
            return (
              <article className="epc-privacy-card" key={character.id} data-testid={`card-privacy-${character.id}`}>
                <div className="epc-privacy-character">
                  {hasCharacterImage(character.avatar)
                    ? <img className="h-9 w-9 shrink-0 rounded-full object-cover" alt={character.name}
                        src={resolveMedia(character.avatar, { sourceUniverseId: universeId, sourceCharacterId: character.id,
                          sourceType: 'avatar', sourceContentId: character.id })} />
                    : <CharacterInitials name={character.name} size={36} />}
                  <div><strong>{character.name}</strong><small>
                    {t(query?.isError ? 'No se pudo cargar' : query?.data ? (isPublic ? 'Perfil público' : 'Perfil privado') : 'Cargando…')}
                  </small></div>
                  {query?.isError
                    ? <button type="button" className="epc-text-control" onClick={() => void query.refetch()} data-testid={`button-retry-visibility-${character.id}`}>{t("Reintentar")}</button>
                    : <button type="button" className={`epc-toggle ${isPublic ? 'is-on' : ''}`} role="switch" aria-checked={isPublic}
                        aria-label={`${t("Visibilidad pública de")} ${character.name}`}
                        disabled={!query?.data || setVisibility.isPending}
                        onClick={() => setVisibility.mutate({ characterId: character.id, visibility: isPublic ? 'private' : 'public' })}
                        data-testid={`toggle-visibility-${character.id}`}><i /></button>}
                </div>
              </article>
            );
          })}
          {setVisibility.isError && <p className="ep-form-error" role="alert">{t("No se pudo guardar la visibilidad.")}</p>}
          <div className="epc-privacy-foot">{t("La visibilidad del personaje es independiente del compartir del universo.")}</div>
        </div>
      </section>
    </>
  );
}

export default function CreatorPrivacyCenter() {
  const t = usePrivacyCenterText();
  const { isLoaded, isSignedIn, user } = useUser();
  return (
    <PreviewShell>
      <PreviewHeading eyebrow={t("Privacidad · controles")} title={t("Cada personaje,")} accent={t("sus propios límites.")}
        description={t("Ajustes reales de tu universo activo y sus personajes.")} />
      {!isLoaded ? <StateCard testId="status-privacy-loading" title={t("Cargando…")} body={t("Comprobando tu sesión.")} />
        : !isSignedIn || !user ? (
          <section className="ep-complete" data-testid="status-privacy-signed-out">
            <span className="ep-eyebrow">{t("Privacidad")}</span>
            <h1>{t("Inicia sesión.")}</h1>
            <p>{t("El centro de privacidad solo muestra los ajustes de tu propia cuenta.")}</p>
            <Link href="/sign-in" className="ep-button" data-testid="link-privacy-sign-in">{t("Iniciar sesión")}</Link>
          </section>
        ) : (
          <AlphaConsentBoundary>
            <PrivacyCenterContent key={`${user.id}:${getActiveUniverseId(user.id)}`} ownerId={user.id} />
          </AlphaConsentBoundary>
        )}
      <div className="epc-back-row"><Link href="/creator-preview/account" className="ep-text-link"><ArrowLeft size={15} /> {t("Cuenta")}</Link></div>
    </PreviewShell>
  );
}
