import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Area, Note, NumberInput, Select, Toggle, freq, level, type SectionProps } from './ui';

export function SocialSection({ config, set }: SectionProps) {
  const s = config.social;
  const up = (patch: Partial<typeof s>) => set((c) => ({ ...c, social: { ...c.social, ...patch } }));
  const [adv, setAdv] = useState(s.postsPerWeek != null || s.storiesPerWeek != null || s.minReplyMinutes != null || s.maxReplyMinutes != null);
  return (
    <div data-testid="section-character-social">
      <Note>Tendencias, no obligaciones. Guían cómo participaría este personaje; nada se publica automáticamente.</Note>
      <div className="grid grid-cols-1 gap-x-3 min-[380px]:grid-cols-2">
        <Select id="social-activity" label="Actividad general" value={s.activity} onChange={(activity) => up({ activity })} options={level} />
        <Select id="social-sociability" label="Ganas de socializar" value={s.sociability} onChange={(sociability) => up({ sociability })} options={level} />
        <Select id="social-posts" label="Publica" value={s.postsFrequency} onChange={(postsFrequency) => up({ postsFrequency })} options={freq} />
        <Select id="social-stories" label="Sube historias" value={s.storiesFrequency} onChange={(storiesFrequency) => up({ storiesFrequency })} options={freq} />
        <Select id="social-likes" label="Da me gusta" value={s.likesFrequency} onChange={(likesFrequency) => up({ likesFrequency })} options={freq} />
        <Select id="social-comments" label="Comenta" value={s.commentsFrequency} onChange={(commentsFrequency) => up({ commentsFrequency })} options={freq} />
        <Select id="social-dms" label="Escribe primero por DM" value={s.initiatesDMs} onChange={(initiatesDMs) => up({ initiatesDMs })} options={freq} />
        <Select id="social-reply" label="Velocidad de respuesta" value={s.replySpeed} onChange={(replySpeed) => up({ replySpeed })} options={{ slow: 'Lenta', normal: 'Normal', quick: 'Rápida' }} />
        <Select id="social-spontaneity" label="Espontaneidad" value={s.spontaneity} onChange={(spontaneity) => up({ spontaneity })} options={level} />
      </div>
      <Toggle id="social-silence" label="Puede pasar períodos en silencio" checked={s.allowSilence} onChange={(allowSilence) => up({ allowSilence })} />
      {s.allowSilence && <Area id="social-silence-notes" label="Cuándo y por qué se silencia" value={s.silenceNotes} onChange={(silenceNotes) => up({ silenceNotes })} max={4000} rows={2} />}

      <button type="button" onClick={() => setAdv(!adv)} aria-expanded={adv} className="tap mt-5 flex h-12 w-full items-center justify-between rounded-2xl bg-secondary px-4 text-sm font-semibold" data-testid="button-toggle-social-advanced">
        Números opcionales <ChevronDown className={cn('h-4 w-4 transition-transform', adv && 'rotate-180')} />
      </button>
      {adv && (
        <div className="grid grid-cols-2 gap-x-3">
          <NumberInput id="social-posts-week" label="Posts por semana" value={s.postsPerWeek} onChange={(postsPerWeek) => up({ postsPerWeek })} min={0} max={100} />
          <NumberInput id="social-stories-week" label="Historias por semana" value={s.storiesPerWeek} onChange={(storiesPerWeek) => up({ storiesPerWeek })} min={0} max={300} />
          <NumberInput id="social-min-reply" label="Demora mín. (min)" value={s.minReplyMinutes} onChange={(minReplyMinutes) => up({ minReplyMinutes })} min={0} max={10080} />
          <NumberInput id="social-max-reply" label="Demora máx. (min)" value={s.maxReplyMinutes} onChange={(maxReplyMinutes) => up({ maxReplyMinutes })} min={0} max={10080} />
          {s.minReplyMinutes != null && s.maxReplyMinutes != null && s.minReplyMinutes > s.maxReplyMinutes && (
            <p role="alert" className="col-span-2 mt-2 text-xs text-destructive">La demora mínima supera a la máxima.</p>
          )}
        </div>
      )}
    </div>
  );
}
