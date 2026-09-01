/**
 * Small geo helpers. Pure math plus a light forward-geocoder over OpenStreetMap
 * Nominatim (fetch only, no SDK), used to pin emailed sightings on the map.
 * Nominatim asks for a descriptive User-Agent and at most one request per
 * second; we make at most one call per inbound email.
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
  const q = text.trim();
  if (!q) return null;
  const dLat = near.radiusKm / 111;
  const dLng = near.radiusKm / (111 * Math.cos((near.lat * Math.PI) / 180));
  const viewbox = [near.lng - dLng, near.lat + dLat, near.lng + dLng, near.lat - dLat].join(",");
  const attempts = city && !q.toLowerCase().includes(city.toLowerCase()) ? [`${q}, ${city}`, q] : [q];
  for (const query of attempts) {
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
      // fall through
    }
  }
  return null;
}
