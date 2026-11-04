import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup as render } from 'react-dom/server';
import { characterInitials, hasCharacterImage, ownerScopedPreviewKey } from '../src/lib/visual-defaults';
import { UniverseCover, CharacterInitials } from '../src/components/echo/visual-defaults';
import { PrivateShareCards } from '../src/components/echo/private-share-cards';

test('initials use first and last names, normalize accents and support one word', () => {
  assert.equal(characterInitials('  María del Carmen Núñez '), 'MN');
  assert.equal(characterInitials('A\u0301lvaro Sa\u0301enz'), 'ÁS');
  assert.equal(characterInitials('Mora'), 'M');
  assert.equal(characterInitials('李 小龍'), '李小');
  assert.equal(characterInitials('   '), '?');
});
test('grapheme-aware initial does not split emoji or combining marks', () => {
  assert.equal(characterInitials('👩‍🎨 Luna'), '👩‍🎨L');
});
test('only absent images and explicit legacy placeholder use initials', () => {
  for (const ref of ['', ' ', null, undefined, 'asset:account-default']) assert.equal(hasCharacterImage(ref), false);
  for (const ref of ['asset:nela-avatar', '/objects/private/upload.png', 'data:image/png;base64,abc', 'https://example.test/a.png']) {
    assert.equal(hasCharacterImage(ref), true);
  }
});
test('default cover is solid plum, keeps entire long name, and never truncates it', () => {
  const name = 'El universo de los personajes de una historia extraordinariamente larga '.repeat(3);
  const html = render(h(UniverseCover, { name }));
  assert.ok(html.includes(name.trim()));
  assert.match(html, /background:#412c40/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.doesNotMatch(html, /gradient|line-clamp|text-overflow|<img/);
});
test('uploaded cover is rendered unchanged rather than replaced by fallback', () => {
  const html = render(h(UniverseCover, { name: 'Studio', imageSrc: '/authorized-cover?sourceUniverseId=studio' }));
  assert.match(html, /<img/);
  assert.match(html, /sourceUniverseId=studio/);
  assert.doesNotMatch(html, /universe-cover-fallback/);
});
test('initials portrait has accessible name, correct color and no account image', () => {
  const html = render(h(CharacterInitials, { name: 'Alanís Luna', size: 56 }));
  assert.match(html, /aria-label="Alanís Luna"/);
  assert.match(html, /#62435b/);
  assert.match(html, />AL<\/text>/);
  assert.doesNotMatch(html, /<img|account-default/);
  assert.match(render(h(CharacterInitials, { name: '' })), /aria-label="Personaje sin nombre"/);
});
test('fallback foreground contrast exceeds WCAG normal-text minimum', () => {
  const lum = (hex: string) => {
    const c = hex.match(/../g)!.map(n => parseInt(n, 16) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
  };
  assert.ok((lum('fbf1f6') + .05) / (lum('62435b') + .05) >= 4.5);
  assert.ok((lum('f3e4ec') + .05) / (lum('412c40') + .05) >= 4.5);
});
const props = {
  universeName: 'Studio',
  description: 'Descripción real',
  creatorName: 'Creadora',
  characters: [{ id: 'same-id', name: 'Sasha Mar' }, { id: 'other', name: 'Mora' }],
};
test('private cards show supplied real fields and distinct universe/character previews', () => {
  const html = render(h(PrivateShareCards, props));
  for (const text of ['Studio', 'Descripción real', 'Creadora', 'Sasha Mar', 'card-share-universe', 'card-share-character']) assert.ok(html.includes(text));
  assert.match(html, /vista es privada/);
});
test('sharing is inert even if caller supplies unknown URL/consent properties', () => {
  const html = render(h(PrivateShareCards, { ...props, ...{ url: 'https://example.test/private', sharingEnabled: true } }));
  assert.equal((html.match(/disabled=""/g) ?? []).length, 4);
  assert.doesNotMatch(html, /https:|href=|<a\b|example.test|ownerId=/);
  assert.match(html, /No disponible/);
});
test('missing creator/quote are omitted instead of being invented', () => {
  const html = render(h(PrivateShareCards, { universeName: 'Studio', characters: [] }));
  assert.match(html, /aún no tiene personajes/);
  assert.doesNotMatch(html, /Por |blockquote|@|Creadora/);
});
test('selected character stays within supplied universe even with repeated IDs elsewhere', () => {
  const a = render(h(PrivateShareCards, { ...props, characters: [{ id: 'same-id', name: 'SOLO PRIMARY' }] }));
  const b = render(h(PrivateShareCards, { ...props, characters: [{ id: 'same-id', name: 'SOLO STUDIO' }] }));
  assert.ok(a.includes('SOLO PRIMARY') && !a.includes('SOLO STUDIO'));
  assert.ok(b.includes('SOLO STUDIO') && !b.includes('SOLO PRIMARY'));
});
test('initial selection uses matching character only, otherwise first local character', () => {
  const html = render(h(PrivateShareCards, { ...props, initialCharacterId: 'other' }));
  assert.match(html, /value="other" selected=""/);
  const missing = render(h(PrivateShareCards, { ...props, initialCharacterId: 'foreign' }));
  assert.match(missing, /initials-share-character-same-id/);
});
test('cache identity separates owners and universes without adding an ownerId request parameter', () => {
  const base = ['/api/universe', { universeId: 'studio' }];
  assert.notDeepEqual(ownerScopedPreviewKey(base, 'owner-a'), ownerScopedPreviewKey(base, 'owner-b'));
  assert.notDeepEqual(ownerScopedPreviewKey(base, 'owner-a'), ownerScopedPreviewKey(['/api/universe', { universeId: 'primary' }], 'owner-a'));
  assert.deepEqual(base, ['/api/universe', { universeId: 'studio' }]);
});
test('private integration is signed-in, owner-keyed, archive-gated and remounted on scope change', () => {
  const source = readFileSync(new URL('../src/pages/creator-product-previews.tsx', import.meta.url), 'utf8');
  assert.match(source, /isLoaded && isSignedIn && user && activeUniverse && universeMetadata && !universeMetadata\.archived/);
  assert.match(source, /key=\{`\$\{user\.id\}:\$\{activeUniverseId\}`\}/);
  assert.match(source, /ownerScopedPreviewKey\(getGetUniverseQueryKey/);
  assert.match(source, /sourceUniverseId: activeUniverseId, sourceCharacterId: character\.id/);
  assert.match(source, /sourceType: 'avatar', sourceContentId: character\.id/);
  const cards = readFileSync(new URL('../src/components/echo/private-share-cards.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(cards, /navigator\.share|clipboard|fetch\(|https?:\/\//);
  const avatar = readFileSync(new URL('../src/components/echo/avatar.tsx', import.meta.url), 'utf8');
  assert.match(avatar, /hasCharacterImage\(character\.avatar\)/);
  assert.match(avatar, /src=\{resolveMedia\(character\.avatar\)\}/);
  const picker = readFileSync(new URL('../src/components/echo/avatar-picker.tsx', import.meta.url), 'utf8');
  assert.match(picker, /hasCharacterImage\(value\)/);
  assert.match(picker, /hasCharacterImage\(ref\)/);
  assert.match(picker, /CharacterInitials name=\{name\}/);
  const editor = readFileSync(new URL('../src/components/echo/account-editor.tsx', import.meta.url), 'utf8');
  assert.match(editor, /<AvatarPicker value=\{avatar\} name=\{name\}/);
});
