import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { validJournalAudience } from '../src/lib/worldJournalAudience';

const characters = ['ophelia', 'lucien', 'ezra'];
const base = { category: 'secret' as const, knowledgeScope: 'selected' as const,
  knownCharacterIds: ['ophelia'] };

test('a secret can be known by a specific active character', () => {
  assert.equal(validJournalAudience(base, characters), true);
});
test('secrets are never public, including when audience list is empty', () => {
  assert.equal(validJournalAudience({ ...base, knowledgeScope: 'everyone', knownCharacterIds: [] }, characters), false);
});
test('unknown and duplicate character IDs are rejected', () => {
  assert.equal(validJournalAudience({ ...base, knownCharacterIds: ['stranger'] }, characters), false);
  assert.equal(validJournalAudience({ ...base, knownCharacterIds: ['ophelia', 'ophelia'] }, characters), false);
});
test('selected scope requires an audience; nobody scope requires an empty list', () => {
  assert.equal(validJournalAudience({ ...base, knownCharacterIds: [] }, characters), false);
  assert.equal(validJournalAudience({ ...base, knowledgeScope: 'nobody', knownCharacterIds: [] }, characters), true);
  assert.equal(validJournalAudience({ ...base, knowledgeScope: 'nobody' }, characters), false);
});
test('ordinary world lore may be public without selected characters', () => {
  assert.equal(validJournalAudience({ category: 'world_knowledge', knowledgeScope: 'everyone', knownCharacterIds: [] }, characters), true);
});
