import { useEffect, useRef } from 'react';
import { customFetch } from '@workspace/api-client-react';
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
  const groupBaseline = useRef<{ key: string; ids: Map<string, Set<string>> } | null>(null);
  useEffect(() => {
    const onInteraction = () => unlockMessageAudio();
    window.addEventListener('pointerdown', onInteraction, { passive: true });
    // iOS Safari/PWA may unlock WebAudio on touchend rather than pointerdown.
    window.addEventListener('touchend', onInteraction, { passive: true });
    window.addEventListener('keydown', onInteraction);
    return () => {
      window.removeEventListener('pointerdown', onInteraction);
      window.removeEventListener('touchend', onInteraction);
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
    // Avoid two overlapping chimes when the same incoming DM also creates a notice.
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
      const category: PushCategory = notice.kind === 'like' ? 'likes' : notice.kind === 'comment' || notice.kind === 'reply' ? 'comments' : 'mentions';
      show(category, 'Nueva actividad en ECHO', 'Tenés una nueva notificación', 'echo-activity-' + notice.id);
    }
  }, [state.messages, state.notifications, state.characters, universe, identity, ownerId]);
  // Group messages live in a separate API table, not state.messages. Polling
  // keeps foreground sound notifications working without relying on page mounts.
  useEffect(() => {
    if (!ownerId || !identity) return;
    const key = ownerId + ':' + universe + ':' + identity;
    groupBaseline.current = { key, ids: new Map() };
    let disposed = false;
    let busy = false;
    const poll = async () => {
      if (disposed || busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const scope = new URLSearchParams({ universeId: universe, actorId: identity });
        const result = await customFetch<{ groups: Array<{ id: string; name: string; muted?: boolean }> }>(`/api/group-dms?${scope}`, { method: 'GET', responseType: 'json' });
        const baseline = groupBaseline.current;
        if (!baseline || baseline.key !== key || disposed) return;
        for (const group of result.groups.slice(0, 20)) {
          const thread = await customFetch<{ messages: Array<{ id: string; senderId: string }> }>(`/api/group-dms/${encodeURIComponent(group.id)}/messages?${scope}`, { method: 'GET', responseType: 'json' });
          if (disposed || groupBaseline.current?.key !== key) return;
          const ids = new Set(thread.messages.map(message => message.id));
          const old = baseline.ids.get(group.id);
          baseline.ids.set(group.id, ids);
          if (old && !group.muted && thread.messages.some(message => !old.has(message.id) && message.senderId !== identity)) {
            playMessageSound('group');
          }
        }
      } catch { /* Transient offline state must not interrupt the app. */ }
      finally { busy = false; }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') void poll(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [ownerId, universe, identity]);
  return null;
}
