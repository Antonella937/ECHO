import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { AlphaConsentForm, ALPHA_CONSENT_TEXTS } from "../src/components/echo/alpha-consent";

test("three exact independent unchecked draft declarations and no legal links", () => {
  assert.equal(ALPHA_CONSENT_TEXTS.adultDeclared, "Declaro que tengo 18 años o más y entiendo que ECHO es una plataforma destinada exclusivamente a personas adultas.");
  assert.equal(ALPHA_CONSENT_TEXTS.fictionAcknowledged, "Entiendo que ECHO permite crear e interactuar con personajes, historias y universos ficticios, incluidos contenidos generados o asistidos por inteligencia artificial. Reconozco que estas interacciones no representan necesariamente personas ni acontecimientos reales.");
  assert.equal(ALPHA_CONSENT_TEXTS.legalDraftAcknowledged, "He leído y acepto los Términos de uso y la Política de privacidad de ECHO, y entiendo cómo se gestionan mis datos y contenidos.");
  const html = renderToStaticMarkup(React.createElement(AlphaConsentForm, { version: "alpha-draft-1", onSubmit: () => assert.fail("SSR cannot submit") }));
  assert.equal((html.match(/role="checkbox"/g) ?? []).length, 3);
  assert.equal((html.match(/data-state="unchecked"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /href=/);
  assert.match(html, /disabled/);
  assert.match(html, /borrador/i);
});
test("draft error is accessible and pending cannot submit", () => {
  const html = renderToStaticMarkup(React.createElement(AlphaConsentForm, { version: "alpha-draft-1", pending: true,
    error: "Fallo sintético", onSubmit: () => assert.fail("SSR cannot submit") }));
  assert.match(html, /role="alert"/);
  assert.match(html, /Fallo sintético/);
  assert.match(html, /disabled/);
});
test("privacy caller scopes owner/universe/character, only enables disabling external sharing", () => {
  const source = readFileSync(new URL("../src/pages/creator-privacy-center.tsx", import.meta.url), "utf8");
  assert.match(source, /ownerId, universeId, 'character', character\.id/);
  assert.match(source, /sharingEnabled: false/);
  assert.doesNotMatch(source, /sharingEnabled: true/);
  assert.match(source, /encodeURIComponent/);
  assert.match(source, /character => !character\.archived/);
  assert.match(source, /AlphaConsentBoundary/);
});
test("main entry waits for acknowledgement while public pages and navigation remain existing", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /<AlphaConsentBoundary><AuthenticatedExperience \/><\/AlphaConsentBoundary>/);
  assert.match(app, /path="\/creator-preview\/privacy" component=\{CreatorPrivacyCenter\}/);
  assert.match(app, /path="\/pricing"/);
});
