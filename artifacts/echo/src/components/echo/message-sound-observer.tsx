import { useEffect, useRef } from 'react';
import { useSocial } from '@/store/social-store';
import { playMessageSound, unlockMessageAudio } from '@/lib/message-sounds';

/** Watch newly synchronized messages, never play historical messages on mount. */
export function MessageSoundObserver() {
  const { state } = useSocial();
  const previous = useRef<{ universe: string; identity: string; ids: Set<string> } | null>(null);
  const universe = state.id;
  const identity = state.currentCharacterId;
  useEffect(() => {
    const onInteraction = () => unlockMessageAudio();
    window.addEventListener('pointerdown', onInteraction, { passive: true });
    window.addEventListener('keydown', onInteraction);
    return () => {
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('keydown', onInteraction);
    };
  }, []);
  useEffect(() => {
    const ids = new Set(state.messages.map(m => m.id));
    const old = previous.current;
    previous.current = { universe, identity, ids };
    if (!old || old.universe !== universe || old.identity !== identity) return;
    if (state.messages.some(m => !old.ids.has(m.id) && m.recipientId === identity && m.senderId !== identity))
      playMessageSound('incoming');
  }, [state.messages, universe, identity]);
  return null;
}
