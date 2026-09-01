import { useEffect, useRef } from "react";
import L from "leaflet";

export type Pin = {
  id: string;
  lat: number;
  lng: number;
  kind: "lastseen" | "sighting" | "match" | "pick";
  label?: string;
  photoUrl?: string;
  popup?: string;
};

type Props = {
  center: { lat: number; lng: number };
  zoom?: number;
  pins: Pin[];
  radiusKm?: number;
  radiusCenter?: { lat: number; lng: number };
  onClick?: (p: { lat: number; lng: number }) => void;
  fit?: boolean;
  focus?: { lat: number; lng: number; key: number } | null;
  className?: string;
  interactive?: boolean;
};

function iconFor(pin: Pin) {
  const photo = pin.photoUrl ? `<img class="photo" src="${pin.photoUrl}" alt="" />` : "";
  const html = `<div class="beacon-pin pin-${pin.kind}"><div class="halo"></div>${photo || '<div class="dot"></div>'}${
    pin.label ? `<div class="label">${pin.label}</div>` : ""
  }</div>`;
  return L.divIcon({ html, className: "", iconSize: [0, 0], iconAnchor: [0, 0] });
}

/** Leaflet map with OpenStreetMap tiles. Pins animate in when they first appear. */
export function MapView({ center, zoom = 13, pins, radiusKm, radiusCenter, onClick, fit, focus, className = "", interactive = true }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const circle = useRef<L.Circle | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, {
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      doubleClickZoom: interactive,
      touchZoom: interactive,
      attributionControl: true,
    }).setView([center.lat, center.lng], zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    m.on("click", (e) => clickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    // Container may have been sized after mount (grid/flex): re-measure.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      markers.current.clear();
      circle.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync pins.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const seen = new Set<string>();
    for (const p of pins) {
      seen.add(p.id);
      const existing = markers.current.get(p.id);
      if (existing) {
        existing.setLatLng([p.lat, p.lng]);
        continue;
      }
      const mk = L.marker([p.lat, p.lng], { icon: iconFor(p), zIndexOffset: p.kind === "lastseen" ? 100 : p.kind === "pick" ? 200 : 50 });
      if (p.popup) mk.bindPopup(p.popup);
      mk.addTo(m);
      markers.current.set(p.id, mk);
    }
    for (const [id, mk] of markers.current) {
      if (!seen.has(id)) {
        mk.remove();
        markers.current.delete(id);
      }
    }
    if (fit && pins.length > 1) {
      m.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])).pad(0.25), { animate: true, maxZoom: 15 });
    }
  }, [pins, fit]);

  // Radius circle.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const c = radiusCenter ?? center;
    if (!radiusKm) {
      circle.current?.remove();
      circle.current = null;
      return;
    }
    if (!circle.current) {
      circle.current = L.circle([c.lat, c.lng], {
        radius: radiusKm * 1000,
        color: "#c2410c",
        weight: 1.5,
        fillColor: "#ea580c",
        fillOpacity: 0.08,
        dashArray: "4 6",
      }).addTo(m);
    } else {
      circle.current.setLatLng([c.lat, c.lng]);
      circle.current.setRadius(radiusKm * 1000);
    }
  }, [radiusKm, radiusCenter, center]);

  // Recentre when asked.
  useEffect(() => {
    if (!map.current || !focus) return;
    map.current.flyTo([focus.lat, focus.lng], Math.max(map.current.getZoom(), 14), { duration: 0.8 });
  }, [focus]);

  useEffect(() => {
    if (!map.current || fit) return;
    map.current.setView([center.lat, center.lng], map.current.getZoom(), { animate: true });
  }, [center.lat, center.lng, fit]);

  return <div ref={el} className={`h-full w-full ${className}`} />;
}
