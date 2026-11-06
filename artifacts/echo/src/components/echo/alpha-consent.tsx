import { useAlphaConsentText } from '@/lib/alpha-consent-translations';
import React, { useState } from 'react';
import { Link } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetOwnerConsentQueryKey,
  useGetOwnerConsent,
  useRecordOwnerConsent,
  type OwnerConsentAcknowledgement,
} from '@workspace/api-client-react';
import { Checkbox } from '@/components/ui/checkbox';

export const ALPHA_CONSENT_TEXTS = {
  adultDeclared: 'Declaro que tengo 18 años o más y entiendo que ECHO es una plataforma destinada exclusivamente a personas adultas.',
  fictionAcknowledged: 'Entiendo que ECHO permite crear personajes, historias y universos ficticios que no representan necesariamente personas ni acontecimientos reales. Durante esta beta privada, las funciones de inteligencia artificial, autonomía y comunicación entre cuentas están deshabilitadas.',
  legalDraftAcknowledged: 'Leí la información preliminar de la beta privada. Entiendo que los Términos de uso y la Política de privacidad definitivos todavía no están disponibles, y que esta confirmación no constituye su aceptación.',
} as const;

type ConsentKey = keyof typeof ALPHA_CONSENT_TEXTS;

export interface AlphaConsentFormProps {
  /** Version string returned by the server; sent back unchanged. */
  version: string;
  pending?: boolean;
  error?: string | null;
  onSubmit: (input: OwnerConsentAcknowledgement) => void;
}

/** Pure, controlled-internally form. Safe for SSR (renderToString) and browser tests. */
export function AlphaConsentForm({ version, pending = false, error = null, onSubmit }: AlphaConsentFormProps) {
  const t = useAlphaConsentText();
  const [checked, setChecked] = useState<Record<ConsentKey, boolean>>({
    adultDeclared: false, fictionAcknowledged: false, legalDraftAcknowledged: false,
  });
  const all = checked.adultDeclared && checked.fictionAcknowledged && checked.legalDraftAcknowledged;
  const keys = Object.keys(ALPHA_CONSENT_TEXTS) as ConsentKey[];
  return (
    <form
      className="ep-onboarding-panel"
      data-testid="form-alpha-consent"
      onSubmit={event => {
        event.preventDefault();
        if (!all || pending) return;
        onSubmit({
          version: version as OwnerConsentAcknowledgement['version'],
          adultDeclared: true,
          fictionAcknowledged: true,
          legalDraftAcknowledged: true,
        });
      }}
    >
      <span className="ep-eyebrow">{t('Reconocimiento preliminar · versión ')}{version}</span>
      <h2 className="ep-step-title">{t("Antes de entrar")}</h2>
      <aside className="epc-notice" role="note" data-testid="note-alpha-draft">
        <p>
          <strong>{t("BETA PRIVADA EN PREPARACIÓN.")}</strong> {t('Estas confirmaciones son un reconocimiento preliminar de la fase alfa. No constituyen un consentimiento de los documentos definitivos ni una verificación de edad. Los Términos de uso y la Política de privacidad definitivos todavía no están disponibles. Registrar este reconocimiento no habilita las funciones externas ni compartir contenido.')}
        </p>
      </aside>
      <p className="ep-field-hint">{t('Antes de continuar, podés ')}<Link href="/beta-info" className="underline" >{t('leer qué datos usa esta beta privada y cómo contactar al soporte')}</Link>{t('. Esta información es preliminar y no reemplaza documentos legales definitivos.')}</p>
      {keys.map(key => (
        <label key={key} className="ep-field" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer' }}>
          <Checkbox
            checked={checked[key]}
            onCheckedChange={value => setChecked(current => ({ ...current, [key]: value === true }))}
            aria-required="true"
            data-testid={`checkbox-consent-${key}`}
            style={{ marginTop: 3 }}
          />
          <span>{t(ALPHA_CONSENT_TEXTS[key])}</span>
        </label>
      ))}
      {error && <p className="ep-form-error" role="alert" data-testid="status-consent-error">{error}</p>}
      <div className="ep-step-actions">
        <span className="ep-field-hint">{t("Las tres confirmaciones son obligatorias.")}</span>
        <button type="submit" className="ep-button" disabled={!all || pending} data-testid="button-record-alpha-draft">
          {pending ? t('Registrando…') : t('Confirmar y continuar')}
        </button>
      </div>
    </form>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return <main className="echo-public ep-onboarding"><section className="ep-onboarding-main">{children}</section></main>;
}

/** Renders children only once the signed-in owner has a recorded alpha draft acknowledgement. */
export function AlphaConsentBoundary({ children }: { children: React.ReactNode }) {
  const t = useAlphaConsentText();
  const { isLoaded, isSignedIn, user } = useUser();
  const ownerId = user?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = [...getGetOwnerConsentQueryKey(), ownerId] as const;
  const consent = useGetOwnerConsent({ query: { enabled: isLoaded && Boolean(isSignedIn && ownerId), queryKey, staleTime: 0 } });
  const record = useRecordOwnerConsent({
    mutation: { onSuccess: data => { queryClient.setQueryData(queryKey, data); } },
  });

  if (!isLoaded) return <Frame><div className="ep-complete" role="status" data-testid="status-consent-loading"><span className="ep-eyebrow">{t("Cargando…")}</span></div></Frame>;
  if (!isSignedIn || !ownerId) return <>{children}</>;
  if (consent.isError) {
    return <Frame><div className="ep-complete" role="alert" data-testid="status-consent-load-error">
      <span className="ep-eyebrow">{t("No se pudo comprobar")}</span>
      <h1>{t("Vuelve a intentarlo.")}</h1>
      <p>{t("No pudimos leer el estado del borrador alfa. No se registró nada.")}</p>
      <button type="button" className="ep-button" onClick={() => void consent.refetch()} data-testid="button-retry-consent">{t("Reintentar")}</button>
    </div></Frame>;
  }
  if (consent.isLoading || !consent.data) {
    return <Frame><div className="ep-complete" role="status" data-testid="status-consent-loading"><span className="ep-eyebrow">{t("Cargando ECHO…")}</span></div></Frame>;
  }
  if (consent.data.draftAcknowledged) return <>{children}</>;
  const errorMessage = record.isError ? t('No se pudo registrar el borrador. Inténtalo de nuevo.') : null;
  return (
    <Frame>
      <AlphaConsentForm
        key={ownerId}
        version={consent.data.version}
        pending={record.isPending}
        error={errorMessage}
        onSubmit={input => record.mutate({ data: input })}
      />
    </Frame>
  );
}
