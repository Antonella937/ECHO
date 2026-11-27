import { useEffect, useState, useRef } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { CallAvatar, type CallAvatarLook } from './call-avatar';

interface SceneStageProps {
  cast: Array<{ id: string; name: string; avatar: string }>;
  turn?: { eventId: string; actorId: string; text: string };
  es: boolean;
}

const hair: CallAvatarLook['hair'][] = ['long', 'swept', 'fringe'];
const clothes: CallAvatarLook['clothes'][] = ['black', 'cream', 'burgundy'];

export function SceneStage({ cast, turn, es }: SceneStageProps) {
  const [voice, setVoice] = useState(false);
  const [mouthCue, setMouthCue] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const speech = useRef<SpeechSynthesisUtterance | null>(null);
  const speakerId = turn?.actorId;
  const turnText = turn?.text ?? '';
  const actorOnStage = cast.some(person => person.id === speakerId);
  const canSpeak = typeof window.speechSynthesis?.speak === 'function' && typeof SpeechSynthesisUtterance === 'function';
  const actions = [...turnText.matchAll(/\*([^*]+)\*/g)].map(match => match[1]).join(' ');
  const expression = /\b(smiles?|grins?|laughs?|sonr[ií]e|r[ií]e)\b/i.test(actions) ? 'smile'
    : /\b(gasps?|surprised|sorprendid[oa])\b/i.test(actions) ? 'surprised' : 'neutral';

  useEffect(() => {
    setSpeaking(false);
    if (!voice || !canSpeak || !actorOnStage) return;
    const dialogue = turnText.replace(/\*{1,3}[^*]+\*{1,3}/g, '').trim();
    if (!dialogue) return;
    const line = new SpeechSynthesisUtterance(dialogue);
    line.lang = es ? 'es' : 'en';
    line.onstart = () => {
      if (speech.current !== line) return;
      setMouthCue(dialogue.split(/\s+/)[0] ?? '');
      setSpeaking(true);
    };
    line.onboundary = event => {
      if (speech.current === line) setMouthCue(dialogue.slice(event.charIndex).match(/^\S+/)?.[0] ?? '');
    };
    line.onend = line.onerror = () => {
      if (speech.current !== line) return;
      speech.current = null;
      setSpeaking(false);
    };
    speech.current = line;
    window.speechSynthesis.speak(line);
    return () => {
      if (speech.current !== line) return;
      speech.current = null;
      window.speechSynthesis.cancel();
    };
  }, [voice, canSpeak, actorOnStage, turn?.eventId, turnText, es]);

  return (
    <section aria-label={es ? 'Personajes en escena' : 'Characters on stage'} className="relative z-10 shrink-0">
      <div className="flex gap-3 overflow-x-auto overscroll-x-contain px-2 py-1">
        {cast.map((person, index) => {
          const active = speakerId === person.id;
          return (
            <figure key={person.id} className={`relative mx-auto h-[min(23dvh,14rem)] min-w-24 max-w-44 flex-1 overflow-hidden rounded-2xl border bg-neutral-900/75 text-white transition-[opacity,border-color] motion-reduce:transition-none ${active ? 'border-white shadow-lg' : 'border-white/20 opacity-75'}`}>
              <div className="absolute inset-0 grid place-items-center text-3xl font-semibold" aria-hidden="true">{person.name.slice(0, 1)}</div>
              {(index < 4 || active) ? (
                <CallAvatar look={{ hair: hair[index % hair.length], clothes: clothes[index % clothes.length], expression: active ? expression : 'neutral' }}
                  speaking={active && speaking} mouthCue={active ? mouthCue : ''} />
              ) : person.avatar && <img src={person.avatar} alt="" className="absolute inset-0 h-full w-full object-cover" />}
              <figcaption className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black via-black/75 to-transparent px-2 pb-2 pt-4">
                {person.avatar && <img src={person.avatar} alt="" className="size-6 shrink-0 rounded-full object-cover" />}
                <div className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{person.name}</span>
                  {active && <span className="block text-[10px]">{es ? 'Último turno' : 'Latest turn'}</span>}
                </div>
              </figcaption>
            </figure>
          );
        })}
      </div>
      {canSpeak && (
        <button type="button" aria-pressed={voice} onClick={() => setVoice(value => !value)}
          className="mx-auto mt-1 flex items-center gap-1.5 rounded-full border border-white/25 bg-black/65 px-3 py-1.5 text-xs text-white">
          {voice ? <Volume2 size={14} /> : <VolumeX size={14} />}
          {es ? 'Voces de la escena' : 'Scene voices'}
        </button>
      )}
    </section>
  );
}
