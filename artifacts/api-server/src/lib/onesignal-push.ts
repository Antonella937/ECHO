/** Server-only OneSignal delivery. Never expose the REST API key to the browser. */
const APP_ID = "96bd4106-2422-40f1-a5dd-238b511758d8";
type PushCategory = "messages" | "likes" | "comments" | "mentions";
type SocialNotification = { id: string; recipientId: string; actorId: string; kind: string };
type SocialSnapshot = { currentCharacterId: string; notifications: SocialNotification[]; characters: Array<{ id: string; name: string }> };
const categoryFor = (kind: string): PushCategory =>
  kind === "message" ? "messages" : kind === "like" ? "likes" :
  kind === "comment" || kind === "reply" ? "comments" : "mentions";

/** Only new notifications addressed to the account's active human character are eligible. */
export async function sendNewOwnerPush(ownerId: string, previous: SocialSnapshot, next: SocialSnapshot): Promise<void> {
  const key = process.env.ECHO_ONESIGNAL_REST_API_KEY;
  if (!key || !ownerId) return;
  const seen = new Set(previous.notifications.map(n => n.id));
  const added = next.notifications.filter(n => !seen.has(n.id) &&
    n.recipientId === 'nela' && n.actorId !== 'nela');
  for (const notice of added.slice(0, 10)) {
    const category = categoryFor(notice.kind);
    const actor = next.characters.find(c => c.id === notice.actorId);
    const title = category === "messages" ? (actor?.name ?? "Nuevo mensaje") : "ECHO";
    const body = category === "messages" ? "Tenés un mensaje nuevo" :
      category === "likes" ? "Le dieron me gusta a tu publicación" :
      category === "comments" ? "Tenés un comentario o respuesta nueva" : "Te mencionaron o etiquetaron";
    try {
      const response = await fetch("https://api.onesignal.com/notifications", {
        method: "POST",
        headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: APP_ID,
          target_channel: "push",
          include_aliases: { external_id: [ownerId] },
          headings: { es: title, en: title },
          contents: { es: body, en: body },
          url: category === "messages" ? "https://echo-3o2.pages.dev/messages" : "https://echo-3o2.pages.dev/notifications",
          data: { event_id: notice.id, category },
        }),
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) console.warn("OneSignal push rejected", { status: response.status, category });
    } catch (error) {
      console.warn("OneSignal push transport failed", { category, reason: error instanceof Error ? error.name : "UNKNOWN" });
    }
  }
}

/** Deliver a Creator Hub human-to-human DM after its transaction commits.
 * This is a separate push category from fictional character messages.
 * Only accounts that opted in to Creator Hub notices are eligible.
 */
export async function sendCreatorHubDmPush(input: {
  recipientOwnerId: string; senderName: string; messageId: string; kind: "text" | "voice";
}): Promise<void> {
  const key = process.env.ECHO_ONESIGNAL_REST_API_KEY;
  if (!key || !input.recipientOwnerId) return;
  try {
    const { clerkClient } = await import("@clerk/express");
    const recipient = await clerkClient.users.getUser(input.recipientOwnerId);
    if (recipient.privateMetadata?.echoCreatorHubNotifications === false || recipient.privateMetadata?.echoCreatorHubPushEnabled !== true) return;
    const language = typeof recipient.privateMetadata?.echoInterfaceLanguage === "string"
      ? recipient.privateMetadata.echoInterfaceLanguage : "es";
    const translations: Record<string, { text: string; voice: string }> = {
      es: { text: "Te envió un mensaje en Creator Hub", voice: "Te envió una nota de voz en Creator Hub" },
      en: { text: "Sent you a message in Creator Hub", voice: "Sent you a voice message in Creator Hub" },
      pt: { text: "Enviou uma mensagem no Creator Hub", voice: "Enviou uma mensagem de voz no Creator Hub" },
      fr: { text: "Vous a envoyé un message sur Creator Hub", voice: "Vous a envoyé un message vocal sur Creator Hub" },
      de: { text: "Hat dir eine Nachricht im Creator Hub gesendet", voice: "Hat dir eine Sprachnachricht im Creator Hub gesendet" },
      it: { text: "Ti ha inviato un messaggio su Creator Hub", voice: "Ti ha inviato un messaggio vocale su Creator Hub" },
      ko: { text: "Creator Hub에서 메시지를 보냈습니다", voice: "Creator Hub에서 음성 메시지를 보냈습니다" },
      ja: { text: "Creator Hubでメッセージが届きました", voice: "Creator Hubで音声メッセージが届きました" },
      zh: { text: "在 Creator Hub 中向你发送了消息", voice: "在 Creator Hub 中向你发送了语音消息" },
    };
    const body = (translations[language] ?? translations.es)[input.kind];
    const response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: APP_ID,
        target_channel: "push",
        include_aliases: { external_id: [input.recipientOwnerId] },
        headings: { en: input.senderName },
        contents: { en: body },
        url: "https://echo-3o2.pages.dev/creator-hub",
        data: { event_id: input.messageId, category: "creatorHub" },
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) console.warn("Creator Hub push rejected", { status: response.status });
  } catch (error) {
    console.warn("Creator Hub push failed", { reason: error instanceof Error ? error.name : "UNKNOWN" });
  }
}
