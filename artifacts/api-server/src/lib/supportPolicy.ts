export const supportCategories = ["technical", "safety", "billing", "privacy", "other"] as const;
export const supportStatuses = ["open", "investigating", "resolved", "closed"] as const;

export function isSupportCategory(value: unknown): value is typeof supportCategories[number] {
  return typeof value === "string" && supportCategories.some(kind => kind === value);
}
export function isSupportStatus(value: unknown): value is typeof supportStatuses[number] {
  return typeof value === "string" && supportStatuses.some(status => status === value);
}
export function validSupportSubmission(body: unknown): body is { category: typeof supportCategories[number]; area?: string; description: string } {
  if (!body || typeof body !== "object") return false;
  const data = body as Record<string, unknown>;
  return isSupportCategory(data.category) &&
    typeof data.description === "string" && data.description.trim().length > 0 && data.description.length <= 4000 &&
    (data.area === undefined || (typeof data.area === "string" && data.area.length <= 120));
}
export function validSupportUpdate(body: unknown): body is { status: typeof supportStatuses[number]; adminNote?: string } {
  if (!body || typeof body !== "object") return false;
  const data = body as Record<string, unknown>;
  return isSupportStatus(data.status) &&
    (data.adminNote === undefined || (typeof data.adminNote === "string" && data.adminNote.length <= 2000));
}
export function isSupportAdmin(userId: string | null | undefined, configuredIds: string | undefined): boolean {
  if (!userId || !/^user_[A-Za-z0-9]+$/.test(userId)) return false;
  return (configuredIds ?? "").split(",").map(id => id.trim()).filter(Boolean).includes(userId);
}
