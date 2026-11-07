import { useEffect, useState } from 'react';
import { useUser } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { useLanguage, type Language } from '@/lib/i18n';

export type CreatorHubDmNotice = {
  ownerId: string; displayName: string; username: string; createdAt: string;
  messageId: string; preview: string; kind: 'text' | 'voice'; unread: boolean;
};
export type CreatorHubDmStatus = { enabled: boolean; items: CreatorHubDmNotice[] };
export const creatorHubDmEvent = 'echo:creator-hub-dm-updated';
export const creatorHubDmCache = new Map<string, CreatorHubDmStatus>();
export async function refreshCreatorHubDmStatus(userId: string) {
  const status = await customFetch<CreatorHubDmStatus>('/api/creator-hub/social/dm-notifications', { responseType: 'json' });
  creatorHubDmCache.set(userId, status);
  window.dispatchEvent(new CustomEvent(creatorHubDmEvent, { detail: { userId } }));
  return status;
}
export async function markCreatorHubDmRead(userId: string, ownerId: string) {
  await customFetch('/api/creator-hub/social/dm-notifications/read', {
    method: 'PUT', responseType: 'json', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerId }),
  });
  await refreshCreatorHubDmStatus(userId);
}
export function useCreatorHubDmStatus() {
  const { user } = useUser();
  const [status, setStatus] = useState<CreatorHubDmStatus>({ enabled: true, items: [] });
  useEffect(() => {
    if (!user?.id) { setStatus({ enabled: true, items: [] }); return; }
    const id = user.id;
    setStatus(creatorHubDmCache.get(id) ?? { enabled: true, items: [] });
    const update = (event: Event) => {
      if ((event as CustomEvent<{ userId: string }>).detail?.userId === id)
        setStatus(creatorHubDmCache.get(id) ?? { enabled: true, items: [] });
    };
    window.addEventListener(creatorHubDmEvent, update);
    void refreshCreatorHubDmStatus(id).catch(() => {});
    return () => window.removeEventListener(creatorHubDmEvent, update);
  }, [user?.id]);
  return status;
}
const copy: Record<Language, { title: string; setting: string; description: string; voice: string; message: string }> = {
  es: { title: 'Creator Hub', setting: 'Notificaciones de Creator Hub', description: 'Avisarme cuando reciba mensajes de otras personas en Creator Hub.', voice: 'Te envió una nota de voz', message: 'Te envió un mensaje' },
  en: { title: 'Creator Hub', setting: 'Creator Hub notifications', description: 'Notify me when someone sends me a Creator Hub message.', voice: 'Sent you a voice message', message: 'Sent you a message' },
  pt: { title: 'Creator Hub', setting: 'Notificações do Creator Hub', description: 'Avisar quando alguém me enviar mensagens no Creator Hub.', voice: 'Enviou uma mensagem de voz', message: 'Enviou uma mensagem' },
  fr: { title: 'Creator Hub', setting: 'Notifications Creator Hub', description: 'Me prévenir quand je reçois un message dans Creator Hub.', voice: 'Vous a envoyé un vocal', message: 'Vous a envoyé un message' },
  de: { title: 'Creator Hub', setting: 'Creator-Hub-Benachrichtigungen', description: 'Benachrichtigen, wenn ich Nachrichten im Creator Hub erhalte.', voice: 'Hat dir eine Sprachnachricht gesendet', message: 'Hat dir eine Nachricht gesendet' },
  it: { title: 'Creator Hub', setting: 'Notifiche Creator Hub', description: 'Avvisami quando ricevo messaggi su Creator Hub.', voice: 'Ti ha inviato un messaggio vocale', message: 'Ti ha inviato un messaggio' },
  ko: { title: 'Creator Hub', setting: 'Creator Hub 알림', description: 'Creator Hub에서 메시지를 받으면 알려주세요.', voice: '음성 메시지를 보냈습니다', message: '메시지를 보냈습니다' },
  ja: { title: 'Creator Hub', setting: 'Creator Hubの通知', description: 'Creator Hubでメッセージを受信したら通知する。', voice: '音声メッセージが届きました', message: 'メッセージが届きました' },
  zh: { title: 'Creator Hub', setting: 'Creator Hub 通知', description: '收到 Creator Hub 消息时通知我。', voice: '向你发送了语音消息', message: '向你发送了消息' },
};
export function useCreatorHubDmCopy() { return copy[useLanguage()]; }
