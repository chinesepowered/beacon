/**
 * Small geo helpers. Pure math plus a light forward-geocoder over OpenStreetMap
 * Nominatim (fetch only, no SDK), used to pin emailed sightings on the map.
 * Nominatim asks for a descriptive User-Agent and at most one request per
 * second; attempts are spaced accordingly and capped per sighting.
 */

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type GeoHit = { lat: number; lng: number; label: string };

/** Words that join two places: "Iron Horse Trail *by* Queen Street South". */
const CONNECTOR =
  /\s+(?:by|near|nearby|between|off|beside|behind|opposite|across from|close to|around|at the corner of|corner of|just off|just past)\s+/i;

const MAX_ATTEMPTS = 5;
const NOMINATIM_GAP_MS = 1100;

/**
 * Progressively simpler forms of a free-text place, most specific first.
 * The model writes richer strings than a human would ("Iron Horse Trail by
 * Queen Street South, Kitchener"), and Nominatim returns nothing for those, so
 * fall back to the leading landmark rather than dropping the pin entirely.
 */
export function placeVariants(text: string, city?: string): string[] {
  const q = text.trim().replace(/\s+/g, " ");
  const forms: string[] = [];
  const push = (s: string | undefined) => {
    const v = s?.replace(/[,;.\s]+$/, "").trim();
    if (v && v.length >= 3 && !forms.includes(v)) forms.push(v);
  };

  push(q);
  const firstSegment = q.split(",")[0];
  push(firstSegment);
  push(q.split(CONNECTOR)[0]);
  push(firstSegment.split(CONNECTOR)[0]);

  // Each form is worth trying with the city appended (disambiguates a common
  // park name) and on its own (the form may already name a different town).
  const out: string[] = [];
  for (const f of forms) {
    const withCity = city && !f.toLowerCase().includes(city.split(",")[0].trim().toLowerCase()) ? `${f}, ${city}` : null;
    for (const v of [withCity, f]) if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, MAX_ATTEMPTS);
}

/**
 * Geocode free text, biased to a box around the last-seen point so "Victoria
 * Park" resolves to the one in the right city. Returns null on any failure —
 * callers keep the sighting as text-only rather than guessing a pin.
 */
export async function geocodeNear(
  text: string,
  near: { lat: number; lng: number; radiusKm: number },
  city?: string,
): Promise<GeoHit | null> {
  if (!text.trim()) return null;
  const dLat = near.radiusKm / 111;
  const dLng = near.radiusKm / (111 * Math.cos((near.lat * Math.PI) / 180));
  const viewbox = [near.lng - dLng, near.lat + dLat, near.lng + dLng, near.lat - dLat].join(",");

  const attempts = placeVariants(text, city);
  for (const [i, query] of attempts.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, NOMINATIM_GAP_MS));
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1` +
      `&viewbox=${encodeURIComponent(viewbox)}&q=${encodeURIComponent(query)}`;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Beacon lost-pet finder (hackathon demo)", Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const rows: any[] = await res.json();
      const r = rows?.[0];
      if (r?.lat && r?.lon) {
        return { lat: Number(r.lat), lng: Number(r.lon), label: String(r.display_name ?? query) };
      }
    } catch {
      // fall through to the next, simpler form
    }
  }
  return null;
}
