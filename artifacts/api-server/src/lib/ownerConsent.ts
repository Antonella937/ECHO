import { db, echoOwnerConsentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export const ALPHA_CONSENT_VERSION = "alpha-draft-1";
/** No real accessible legal documents have been supplied. Do not enable via client input. */
export const LEGAL_DOCUMENTS_AVAILABLE = false;

export async function getOwnerConsent(ownerId: string) {
  const [row] = await db.select().from(echoOwnerConsentsTable).where(and(
    eq(echoOwnerConsentsTable.ownerId, ownerId),
    eq(echoOwnerConsentsTable.version, ALPHA_CONSENT_VERSION),
  )).limit(1);
  return {
    version: ALPHA_CONSENT_VERSION,
    adultDeclared: row?.adultDeclared ?? false,
    fictionAcknowledged: row?.fictionAcknowledged ?? false,
    legalDraftAcknowledged: row?.legalDraftAcknowledged ?? false,
    draftAcknowledged: Boolean(row?.adultDeclared && row.fictionAcknowledged && row.legalDraftAcknowledged),
    acknowledgedAt: row?.acknowledgedAt.toISOString() ?? null,
    legalDocumentsAvailable: LEGAL_DOCUMENTS_AVAILABLE,
    legalConsentValid: false,
    externalUseAllowed: false,
  };
}
