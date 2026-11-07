import { useEffect } from 'react';
import { useSocial } from '@/store/social-store';

/** iOS Home Screen PWA badge: the OS chooses its color. */
export function AppIconBadge() {
  const { state, me } = useSocial();
  const unread = state.notifications.filter(n => n.recipientId === me.id && !n.read).length;
  useEffect(() => {
    const navigatorWithBadge = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    const update = async () => {
      try {
        if (unread > 0) await navigatorWithBadge.setAppBadge?.(unread);
        else if (navigatorWithBadge.clearAppBadge) await navigatorWithBadge.clearAppBadge();
        else await navigatorWithBadge.setAppBadge?.(0);
      } catch {
        // Unsupported or not yet permitted on this device.
      }
    };
    void update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [unread]);
  return null;
}
