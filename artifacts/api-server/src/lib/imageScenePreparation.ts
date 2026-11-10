import { buildCharacterImagePrompt, buildMultiCharacterImagePrompt, imageStyleInstructions, resolveSceneCharacters } from './imagePromptBuilder';

const isPrivatePath = (value: unknown): value is string =>
  typeof value === 'string' && /^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(value);

export interface SceneCharacter {
  id: string;
  name: string;
  archived?: boolean;
  avatar?: string | null;
  identity?: {
    facialDescription?: unknown;
    bodyDescription?: unknown;
    appearance?: unknown;
    styleNotes?: unknown;
    referenceImages?: unknown;
  } | null;
}

export function prepareImageScene(
  scene: string,
  active: SceneCharacter,
  available: SceneCharacter[],
  style: keyof typeof imageStyleInstructions,
  selectedCharacterIds?: string[],
) {
  // Explicit selection is authoritative; never silently substitute another character.
  const people = selectedCharacterIds?.length
    ? [active, ...selectedCharacterIds.filter(id => id !== active.id).map(id => {
      const character = available.find(person => person.id === id && !person.archived);
      if (!character) throw Error('IMAGE_SCENE_CHARACTER_NOT_FOUND');
      return character;
    })]
    : resolveSceneCharacters(scene, active, available);
  if (people.length > 4 || new Set(people.map(person => person.id)).size !== people.length) {
    throw Error('INVALID_IMAGE_SCENE_CHARACTER_COUNT');
  }
  const perPerson = people.map(person => [
    ...new Set([person.avatar, ...(Array.isArray(person.identity?.referenceImages) ? person.identity.referenceImages : [])].filter(isPrivatePath)),
  ]);
  const referencePaths: string[] = [];
  const referenceAssignments: string[] = [];
  const add = (path: string, name: string) => {
    if (referencePaths.length < 4 && !referencePaths.includes(path)) {
      referencePaths.push(path);
      referenceAssignments.push(name);
    }
  };
  perPerson.forEach((refs, i) => { if (refs[0]) add(refs[0], people[i].name); });
  perPerson.forEach((refs, i) => refs.slice(1).forEach(path => add(path, people[i].name)));
  const preparedPrompt = (people.length === 1
    ? buildCharacterImagePrompt({ name: people[0].name, scene, style, identity: people[0].identity ?? {} })
    : buildMultiCharacterImagePrompt({
      characters: people.map(person => ({ name: person.name, identity: person.identity ?? {} })),
      scene, style,
    })) + (referenceAssignments.length ? '\nReference image order: ' +
      referenceAssignments.map((name, i) => `image ${i + 1} = ${name}`).join('; ') +
      '. Match each reference ONLY to its named person.' : '');
  return {
    people: people.map(person => ({ id: person.id, name: person.name })),
    referencePaths,
    referenceAssignments,
    preparedPrompt,
  };
}
