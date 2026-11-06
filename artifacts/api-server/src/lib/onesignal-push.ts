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
  if (!key || !ownerId || !next.currentCharacterId) return;
  const seen = new Set(previous.notifications.map(n => n.id));
  const added = next.notifications.filter(n => !seen.has(n.id) &&
    n.recipientId === next.currentCharacterId && n.actorId !== next.currentCharacterId);
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
