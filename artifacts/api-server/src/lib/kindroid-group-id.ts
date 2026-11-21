/** Parse only the Kindroid group URL shape verified from the app UI. */
export function parseKindroidGroupId(value: string): string | null {
  const raw = value.trim();
  if (/^[A-Za-z0-9_-]{8,160}$/.test(raw)) return raw;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.hostname !== "kindroid.ai" ||
      url.username || url.password || url.search || url.hash || url.port) return null;
  return /^\/v2\/chat\/group\/([A-Za-z0-9_-]{8,160})\/?$/.exec(url.pathname)?.[1] ?? null;
}
