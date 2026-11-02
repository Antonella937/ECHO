import { Area, ListInput, NumberInput, Text, type SectionProps } from './ui';

export function IdentitySection({ config, set }: SectionProps) {
  const b = config.basic;
  const up = (patch: Partial<typeof b>) => set((c) => ({ ...c, basic: { ...c.basic, ...patch } }));
  return (
    <div data-testid="section-character-identity">
      <Text id="character-legal-name" label="Nombre completo (interno)" value={b.name} onChange={(name) => up({ name })} max={100} hint="Cómo se llama de verdad; puede diferir del nombre visible." />
      <div className="grid grid-cols-2 gap-3">
        <NumberInput id="character-age" label="Edad" value={b.age} onChange={(age) => up({ age })} min={0} max={150} />
        <Text id="character-pronouns" label="Pronombres" value={b.pronouns} onChange={(pronouns) => up({ pronouns })} max={100} placeholder="ella / la" />
      </div>
      <ListInput id="character-interests" label="Intereses" value={b.interests} onChange={(interests) => up({ interests })} />
      <ListInput id="character-likes" label="Le gusta" value={b.likes} onChange={(likes) => up({ likes })} />
      <ListInput id="character-dislikes" label="No soporta" value={b.dislikes} onChange={(dislikes) => up({ dislikes })} />
      <Area id="character-notes" label="Notas libres" value={b.notes} onChange={(notes) => up({ notes })} max={8000} />
    </div>
  );
}
