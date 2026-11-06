import { BASIC_VOICES } from '@/lib/basic-voices';
import { Area, ListInput, Note, Select, SubHead, Text, level, type SectionProps } from './ui';

const STARTERS = ['curiosa', 'irónica', 'leal', 'impulsiva', 'reservada', 'cálida', 'perfeccionista', 'nocturna', 'competitiva', 'soñadora'];

export function PersonalitySection({ config, set }: SectionProps) {
  const p = config.personality, v = config.voice;
  const upP = (patch: Partial<typeof p>) => set((c) => ({ ...c, personality: { ...c.personality, ...patch } }));
  const upV = (patch: Partial<typeof v>) => set((c) => ({ ...c, voice: { ...c.voice, ...patch } }));
  const addTrait = (t: string) => { if (!p.traits.includes(t) && p.traits.length < 50) upP({ traits: [...p.traits, t] }); };
  return (
    <div data-testid="section-character-personality">
      <Area id="character-description" label="Descripción libre" value={p.description} onChange={(description) => upP({ description })} max={24000} rows={8}
        placeholder="Quién es, qué la mueve, contradicciones, historia…" />
      <div className="mt-4 rounded-2xl border border-border p-3">
        <div className="flex flex-wrap gap-1.5" data-testid="list-character-traits">
          {p.traits.length === 0 && <span className="text-xs text-muted-foreground">Sin rasgos todavía.</span>}
          {p.traits.map((t) => (
            <button type="button" key={t} onClick={() => upP({ traits: p.traits.filter((x) => x !== t) })} aria-label={`Quitar rasgo ${t}`}
              className="min-h-9 rounded-full bg-primary/15 px-3 text-xs text-primary" data-testid={`chip-trait-${t}`}>{t} ×</button>
          ))}
        </div>
        <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Sumar rasgo sugerido (no borra nada)</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {STARTERS.filter((t) => !p.traits.includes(t)).map((t) => (
            <button type="button" key={t} onClick={() => addTrait(t)} className="min-h-9 rounded-full border border-border px-3 text-xs text-muted-foreground hover:text-foreground" data-testid={`button-add-trait-${t}`}>+ {t}</button>
          ))}
        </div>
      </div>
      <ListInput key={p.traits.join('|')} id="character-traits" label="Rasgos (editar a mano)" value={p.traits} onChange={(traits) => upP({ traits })} />
      <Area id="character-temperament" label="Temperamento" value={p.temperament} onChange={(temperament) => upP({ temperament })} max={2000} rows={2} />
      <ListInput id="character-values" label="Valores" value={p.values} onChange={(values) => upP({ values })} />
      <Area id="character-humor" label="Humor" value={p.humor} onChange={(humor) => upP({ humor })} max={2000} rows={2} />
      <Select id="character-sociability" label="Sociabilidad" value={p.sociability} onChange={(sociability) => upP({ sociability })} options={level} />
      <Area id="character-expressiveness" label="Expresividad" value={p.expressiveness} onChange={(expressiveness) => upP({ expressiveness })} max={2000} rows={2} />
      <Area id="character-emotional" label="Estilo emocional" value={p.emotionalStyle} onChange={(emotionalStyle) => upP({ emotionalStyle })} max={4000} rows={3} />
      <ListInput id="character-topics" label="Temas recurrentes" value={p.commonTopics} onChange={(commonTopics) => upP({ commonTopics })} />
      <ListInput id="character-boundaries" label="Límites" value={p.boundaries} onChange={(boundaries) => upP({ boundaries })} comma={false} />

      <SubHead>Voz de audio · Catálogo gratuito</SubHead>
      <Note>Elegí una voz para futuras notas de voz. La generación de audio todavía no está conectada. Estas voces Kokoro son en inglés; la vista previa estará disponible cuando conectemos el motor.</Note>
      <div className="mb-3 rounded-xl bg-secondary/50 p-3 text-xs" data-testid="basic-voice-selection-status">
        {v.basicVoiceId && BASIC_VOICES.some(voice => voice.id === v.basicVoiceId)
          ? <>Voz elegida: <strong>{BASIC_VOICES.find(voice => voice.id === v.basicVoiceId)?.label}</strong>. Guardá el personaje para conservarla.</>
          : <>Todavía no elegiste una voz. Podés dejar esta configuración pendiente.</>}
      </div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Voz básica del personaje" data-testid="basic-voice-catalog">
        {BASIC_VOICES.map(voice => (
          <button key={voice.id} type="button" role="radio" aria-checked={v.basicVoiceId === voice.id}
            onClick={() => upV({ basicVoiceId: voice.id })}
            className={`min-h-16 rounded-xl border p-3 text-left text-sm ${v.basicVoiceId === voice.id ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card'}`}
            data-testid={`basic-voice-${voice.id}`}>
            <span className="block font-semibold">{voice.label}</span>
            <span className="text-xs text-muted-foreground">{voice.gender === 'female' ? 'Femenina' : 'Masculina'} · {voice.language}</span>
          </button>
        ))}
      </div>
      <button type="button" className="mt-2 text-xs text-muted-foreground underline" onClick={() => upV({ basicVoiceId: undefined })}>Sin voz seleccionada</button>
      <SubHead>Voz y conducta online</SubHead>
      <Note>Cómo escribe en posts, comentarios y mensajes. Sirve de guía, no de guion.</Note>
      <Area id="character-speaking" label="Forma de hablar" value={v.speakingStyle} onChange={(speakingStyle) => upV({ speakingStyle })} max={4000} rows={3} />
      <div className="grid grid-cols-2 gap-3">
        <Select id="character-msg-length" label="Largo de mensajes" value={v.messageLength} onChange={(messageLength) => upV({ messageLength })} options={{ short: 'Cortos', balanced: 'Medios', long: 'Largos' }} />
        <Select id="character-disclosure" label="Cuánto comparte" value={v.disclosure} onChange={(disclosure) => upV({ disclosure })} options={{ private: 'Reservada', balanced: 'Equilibrada', open: 'Abierta' }} />
      </div>
      <Area id="character-vocabulary" label="Vocabulario" value={v.vocabulary} onChange={(vocabulary) => upV({ vocabulary })} max={4000} rows={2} />
      <Text id="character-emoji" label="Uso de emojis" value={v.emojiStyle} onChange={(emojiStyle) => upV({ emojiStyle })} max={2000} />
      <Area id="character-captions" label="Estilo de captions" value={v.captionStyle} onChange={(captionStyle) => upV({ captionStyle })} max={4000} rows={2} />
      <Area id="character-comments" label="Estilo de comentarios" value={v.commentStyle} onChange={(commentStyle) => upV({ commentStyle })} max={4000} rows={2} />
      <ListInput id="character-posts-about" label="Publica sobre" value={v.postsAbout} onChange={(postsAbout) => upV({ postsAbout })} />
      <ListInput id="character-avoids" label="Evita publicar" value={v.avoidsPosting} onChange={(avoidsPosting) => upV({ avoidsPosting })} comma={false} />
    </div>
  );
}
