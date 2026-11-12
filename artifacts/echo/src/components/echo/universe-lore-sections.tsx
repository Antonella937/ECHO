import { Field, inputCls } from './field';
import { useUniverseText } from '@/lib/universe-translations';

const sections = [
  { key: 'history', label: 'Historia y origen' },
  { key: 'setting', label: 'Ambientación y lugares' },
  { key: 'rules', label: 'Reglas del mundo' },
  { key: 'factions', label: 'Facciones y grupos' },
  { key: 'conflicts', label: 'Conflictos y situación actual' },
] as const;
type SectionKey = typeof sections[number]['key'];
type Lore = Record<SectionKey, string>;
const empty = (): Lore => ({ history: '', setting: '', rules: '', factions: '', conflicts: '' });
const header = (key: SectionKey) => `[[ECHO_LORE:${key}]]`;

export function parseUniverseLore(raw: string): Lore {
  const result = empty();
  const marker = /\[\[ECHO_LORE:(history|setting|rules|factions|conflicts)\]\]/g;
  const matches = Array.from(raw.matchAll(marker));
  if (!matches.length || matches[0].index !== 0) {
    result.history = matches.length ? raw.slice(0, matches[0].index).trimEnd() : raw;
  }
  matches.forEach((match, index) => {
    const key = match[1] as SectionKey;
    const end = index + 1 < matches.length ? matches[index + 1].index : raw.length;
    const content = raw.slice(match.index! + match[0].length, end).replace(/^\n/, '');
    // Remove only the separator before the NEXT section. Never trim what the user is typing.
    result[key] = index + 1 < matches.length && content.endsWith('\n\n') ? content.slice(0, -2) : content;
  });
  return result;
}

export function serializeUniverseLore(lore: Lore): string {
  return sections.filter(section => lore[section.key].length > 0)
    .map(section => `${header(section.key)}\n${lore[section.key]}`).join('\n\n');
}

export function UniverseLoreSections({ value, onChange, disabled, prefix }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  prefix: string;
}) {
  const t = useUniverseText();
  const lore = parseUniverseLore(value);
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">{t('Organizá el contexto por fichas. El límite total es de 8.000 caracteres.')}</p>
    {sections.map(section => <Field key={section.key} id={`${prefix}-${section.key}`} label={t(section.label)}>
      <textarea id={`${prefix}-${section.key}`} className={`${inputCls} min-h-24 py-3`}
        value={lore[section.key]} disabled={disabled}
        onChange={event => {
          const next = serializeUniverseLore({ ...lore, [section.key]: event.target.value });
          if (next.length <= 8000) {
            onChange(next);
          } else {
            // Let the user edit up to the remaining capacity rather than silently freezing the field.
            const other = serializeUniverseLore({ ...lore, [section.key]: '' });
            const allowance = Math.max(0, 8000 - other.length - header(section.key).length - 3);
            const limited = serializeUniverseLore({ ...lore, [section.key]: event.target.value.slice(0, allowance) });
            if (limited.length <= 8000) onChange(limited);
          }
        }} />
    </Field>)}
    <p className="text-xs text-muted-foreground">{value.length} / 8000</p>
  </div>;
}
