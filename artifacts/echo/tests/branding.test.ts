import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreatorSignature, EchoLoader, EchoSplash, NelaEasterEgg } from '../src/components/branding/echo-brand';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

for (const file of ['icon.svg', 'icon-maskable.svg', 'favicon.svg']) {
  test(`branding ${file}: lowercase serif, approved colors, no decorative motifs`, () => {
    const svg = read(`../public/${file}`);
    assert.match(svg, /#30233d/);
    assert.match(svg, /#e5c5f6/);
    assert.match(svg, /serif/);
    assert.match(svg, />e<\/text>/);
    assert.doesNotMatch(svg, /<circle|<path|>E<\/text>/);
  });
}

test('PWA keeps relative icon references, maskable purpose and coherent background', () => {
  const manifest = JSON.parse(read('../public/manifest.webmanifest'));
  assert.equal(manifest.background_color, '#30233d');
  assert.equal(manifest.theme_color, '#30233d');
  assert.ok(manifest.icons.some((icon: { src: string; purpose: string }) => icon.src === './icon-maskable.svg' && icon.purpose === 'maskable'));
  assert.match(read('../index.html'), /%BASE_URL%icon.svg/);
  assert.match(read('../public/sw.js'), /echo-shell-brand01-v2/);
});

test('loader has exact optical SVG geometry and one accessible status', () => {
  const html = renderToStaticMarkup(createElement(EchoLoader));
  assert.match(html, /viewBox="0 0 200 200"/);
  assert.match(html, /x="100" y="93" dominant-baseline="central" text-anchor="middle" font-size="76"/);
  assert.match(html, /aria-label="Cargando ECHO"/);
  assert.match(html, /aria-hidden="true" focusable="false"/);
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
});

test('splash is a status, exact tagline, uppercase serif brand and no nested announcements', () => {
  const html = renderToStaticMarkup(createElement(EchoSplash));
  assert.match(html, />ECHO<\/div>/);
  assert.match(html, /EVERY WORLD HAS A STORY/);
  assert.match(html, /echo-splash-rule/);
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
});

test('signature variants never contain both signatures', () => {
  const capital = renderToStaticMarkup(createElement(CreatorSignature, { variant: 'created' }));
  const script = renderToStaticMarkup(createElement(CreatorSignature, { variant: 'script' }));
  assert.match(capital, /CREATED BY NELA/);
  assert.doesNotMatch(capital, /nela\./);
  assert.match(script, /nela\./);
  assert.doesNotMatch(script, /CREATED BY NELA/);
});

test('credits start hidden behind a native accessible touch/keyboard button', () => {
  const html = renderToStaticMarkup(createElement(NelaEasterEgg));
  assert.match(html, /<button type="button"/);
  assert.match(html, /aria-label="Descubrir el origen de ECHO"/);
  assert.match(html, /aria-expanded="false" aria-controls=/);
  assert.match(html, /hidden=""/);
  assert.doesNotMatch(html, /ownerId|session|email|href=|nela\./);
});

test('brand styles honor reduced motion, touch size and focus without restyling titles', () => {
  const css = read('../src/components/branding/branding.css');
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none/);
  assert.match(css, /min-width: 44px; min-height: 44px/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(css, /(?:^|\n)(?:h1|h2|body|:root|\.font-display)\s*[{,]/);
});

test('startup uses actual auth loading, leaves skeleton content and never adds a timer', () => {
  assert.match(read('../src/App.tsx'), /if \(!isLoaded\) return <EchoSplash \/>/);
  assert.match(read('../src/components/echo/skeletons.tsx'), /<EchoLoader \/>/);
  assert.match(read('../src/components/echo/skeletons.tsx'), /aspect-\[4\/5\]/);
  assert.doesNotMatch(read('../src/components/branding/echo-brand.tsx'), /setTimeout|setInterval|fetch\(|localStorage|sessionStorage/);
});

test('signature sites are exclusive and credits exist only inside current Settings', () => {
  assert.match(read('../src/pages/landing.tsx'), /<PublicFooter previewMode=\{previewMode\} signature="created"/);
  assert.match(read('../src/pages/creator-product-previews.tsx'), /<PublicFooter previewMode signature="script"/);
  assert.match(read('../src/pages/settings.tsx'), /<NelaEasterEgg \/>/);
});
