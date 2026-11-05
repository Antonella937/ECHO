import { useEffect, useRef } from 'react';
import { useUser } from '@clerk/react';
import { useSocial } from '@/store/social-store';
import { getActiveUniverseId } from '@/store/persistence';
import { playMessageSound, unlockMessageAudio } from '@/lib/message-sounds';

/** Watch newly synchronized messages, never play historical messages on mount. */
export function MessageSoundObserver() {
  const { state } = useSocial();
  const { user } = useUser();
  const previous = useRef<{ universe: string; identity: string; ids: Set<string>; notificationIds: Set<string> } | null>(null);
  const universe = user?.id ? getActiveUniverseId(user.id) : 'primary';
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
    const notificationIds = new Set(state.notifications.map(n => n.id));
    const old = previous.current;
    previous.current = { universe, identity, ids, notificationIds };
    if (!old || old.universe !== universe || old.identity !== identity) return;
    if (state.messages.some(m => !old.ids.has(m.id) && m.recipientId === identity && m.senderId !== identity))
      playMessageSound('incoming');
    else if (state.notifications.some(n => !old.notificationIds.has(n.id) && n.recipientId === identity))
      playMessageSound('notification');
  }, [state.messages, state.notifications, universe, identity]);
  return null;
}
