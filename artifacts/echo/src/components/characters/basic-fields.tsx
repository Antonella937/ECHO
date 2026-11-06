import { useCharacterDetailsText } from '@/lib/character-details-translations';
import { AvatarPicker } from '@/components/echo/avatar-picker';
import { Field, inputCls } from '@/components/echo/field';
import { cn } from '@/lib/utils';
import { Text } from './ui';

export interface BasicForm { name: string; handle: string; bio: string; avatar: string; occupation: string; location: string }

export function BasicFields({ form, setForm, onBusy }: { form: BasicForm; setForm(f: (p: BasicForm) => BasicForm): void; onBusy(b: boolean): void }) {
  const t = useCharacterDetailsText();
  const up = (patch: Partial<BasicForm>) => setForm((p) => ({ ...p, ...patch }));
  return (
    <div data-testid="section-character-basic">
      <AvatarPicker value={form.avatar} name={form.name} onChange={(avatar) => up({ avatar })} onBusy={onBusy} />
      <Text id="character-name" label={t("Nombre visible")} value={form.name} onChange={(name) => up({ name })} max={80} hint={`${form.name.length}/80`} />
      <Field id="character-handle" label="@username" hint={t("Minúsculas, números, puntos y guiones bajos. Máx. 30.")}>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">@</span>
          <input id="character-handle" value={form.handle} maxLength={31} autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(e) => up({ handle: e.target.value.toLowerCase().replace(/^@/, '') })} className={cn(inputCls, 'pl-8')} data-testid="input-character-handle" />
        </div>
      </Field>
      <Field id="character-bio" label={t("Bio")} hint={`${form.bio.length}/500`}>
        <textarea id="character-bio" value={form.bio} maxLength={500} rows={3} onChange={(e) => up({ bio: e.target.value })} className={cn(inputCls, 'h-auto resize-none py-3 leading-relaxed')} data-testid="input-character-bio" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Text id="character-occupation" label={t("Ocupación")} value={form.occupation} onChange={(occupation) => up({ occupation })} max={120} />
        <Text id="character-location" label={t("Ubicación")} value={form.location} onChange={(location) => up({ location })} max={120} />
      </div>
    </div>
  );
}
