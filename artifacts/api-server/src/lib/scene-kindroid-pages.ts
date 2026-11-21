/** Read a bounded, complete Kindroid group history without writing to either service. */
export class KindroidSceneHistoryError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
export async function readKindroidScenePages(
  groupId: string, apiKey: string, request: typeof fetch = fetch,
): Promise<unknown[]> {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(groupId)) throw new KindroidSceneHistoryError("KINDROID_GROUP_ID_INVALID",400);
  const messages: unknown[] = [];
  let cursor: number | undefined;
  const seenCursors = new Set<number>();
  for (let page = 0; page < 5; page++) {
    const url = new URL("https://api.kindroid.ai/v1/get-chat-messages");
    url.searchParams.set("group_id",groupId);
    url.searchParams.set("limit","100");
    if (cursor !== undefined) url.searchParams.set("start_after_timestamp",String(cursor));
    const response = await request(url.toString(),{
      headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new KindroidSceneHistoryError(
      response.status===429?"KINDROID_RATE_LIMITED":"KINDROID_SCENE_HISTORY_UNAVAILABLE",
      response.status===429?429:502);
    const payload: unknown = await response.json();
    if (!payload || typeof payload!=="object" || !Array.isArray((payload as {messages?:unknown}).messages)) {
      throw new KindroidSceneHistoryError("KINDROID_SCENE_HISTORY_FORMAT_INVALID",502);
    }
    const batch=(payload as {messages:unknown[]}).messages;
    if (batch.length > 100) {
      throw new KindroidSceneHistoryError("KINDROID_SCENE_HISTORY_PAGE_TOO_LARGE",502);
    }
    messages.push(...batch);
    const pagination=(payload as {pagination?:unknown}).pagination;
    if (!pagination || typeof pagination!=="object" || typeof (pagination as {hasMore?:unknown}).hasMore!=="boolean") {
      throw new KindroidSceneHistoryError("KINDROID_SCENE_HISTORY_PAGINATION_UNKNOWN",502);
    }
    if ((pagination as {hasMore:boolean}).hasMore===false) return messages;
    const next=(pagination as {lastTimestamp?:unknown}).lastTimestamp;
    if (typeof next!=="number" || !Number.isFinite(next) || seenCursors.has(next) || next===cursor || batch.length===0) {
      throw new KindroidSceneHistoryError("KINDROID_SCENE_HISTORY_CURSOR_INVALID",502);
    }
    seenCursors.add(next);
    cursor=next;
  }
  throw new KindroidSceneHistoryError("KINDROID_SCENE_HISTORY_PAGE_LIMIT",409);
}
