export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function kmBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Convex errors carry `data` for ConvexError; fall back to the message. */
export function errorMessage(e: unknown): string {
  const anyE = e as { data?: unknown; message?: string };
  if (typeof anyE?.data === "string") return anyE.data;
  const m = anyE?.message ?? String(e);
  return m.replace(/^.*Uncaught (ConvexError|Error): /, "").replace(/\s+at .*$/s, "").slice(0, 200);
}

export const KIND_LABEL: Record<string, string> = {
  shelter: "Shelter",
  lostfound: "Lost & found",
  vet: "Vet",
};
