import { useEffect, useRef } from 'react';
import { useUser } from '@clerk/react';
import { useSocial } from '@/store/social-store';
import { getActiveUniverseId } from '@/store/persistence';
import { playMessageSound, unlockMessageAudio } from '@/lib/message-sounds';
import { readPushPreferences, type PushCategory } from './push-notification-settings';

/** Watch newly synchronized messages, never play historical messages on mount. */
export function MessageSoundObserver() {
  const { state } = useSocial();
  const { user } = useUser();
  const previous = useRef<{ universe: string; identity: string; ids: Set<string>; notificationIds: Set<string> } | null>(null);
  const universe = user?.id ? getActiveUniverseId(user.id) : 'primary';
  const identity = state.currentCharacterId;
  const ownerId = user?.id ?? '';
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
    const newMessages = state.messages.filter(m => !old.ids.has(m.id) && m.recipientId === identity && m.senderId !== identity);
    const newNotices = state.notifications.filter(n => !old.notificationIds.has(n.id) && n.recipientId === identity);
    if (newMessages.length) playMessageSound('incoming');
    else if (newNotices.length) playMessageSound('notification');
    const prefs = ownerId ? readPushPreferences(ownerId) : null;
    if (!prefs?.enabled || !('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    const show = (category: PushCategory, title: string, body: string, tag: string) => {
      if (!prefs.categories[category]) return;
      try { new Notification(title, { body, tag }); } catch { /* Unsupported browser notification context. */ }
    };
    for (const message of newMessages) {
      const sender = state.characters.find(c => c.id === message.senderId);
      show('messages', sender?.name ?? 'Nuevo mensaje', 'Te envió un mensaje en ECHO', 'echo-dm-' + message.id);
    }
    for (const notice of newNotices) {
      const category: PushCategory = notice.type === 'like' ? 'likes' : notice.type === 'comment' || notice.type === 'reply' ? 'comments' : 'mentions';
      show(category, 'Nueva actividad en ECHO', 'Tenés una nueva notificación', 'echo-activity-' + notice.id);
    }
  }, [state.messages, state.notifications, state.characters, universe, identity, ownerId]);
  return null;
}
