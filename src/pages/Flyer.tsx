import { useMutation, useQuery } from "convex/react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MapView, type Pin } from "../components/Map";
import { Button, Card, Field, inputCls, Pill, Skeleton } from "../components/ui";
import { errorMessage, fmtDateTime, timeAgo } from "../lib/format";
import { useToast } from "../lib/toast";

export function Flyer({ slug, navigate }: { slug: string; navigate: (to: string) => void }) {
  const data = useQuery(api.cases.publicBySlug, { slug });
  const [qr, setQr] = useState<string>("");
  const url = `${window.location.origin}/p/${slug}`;

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 240, color: { dark: "#1c1410", light: "#ffffff" } }).then(setQr).catch(() => setQr(""));
  }, [url]);

  const pins = useMemo<Pin[]>(() => {
    if (!data) return [];
    const out: Pin[] = [{ id: "lastseen", lat: data.lastSeenLat, lng: data.lastSeenLng, kind: "lastseen", label: "Last seen" }];
    for (const s of data.sightings) if (s.lat !== undefined && s.lng !== undefined) out.push({ id: s._id, lat: s.lat, lng: s.lng, kind: "sighting" });
    return out;
  }, [data]);

  if (data === null) {
    return (
      <div className="mx-auto max-w-xl px-5 py-24 text-center">
        <p className="font-display text-3xl font-semibold">This flyer is no longer active</p>
        <Button className="mt-6" onClick={() => navigate("/")}>Home</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 pb-24 pt-6">
      <div className="no-print mb-4 flex items-center justify-between">
        <button onClick={() => navigate("/")} className="text-sm text-ink-500 hover:text-ink-900">← Beacon</button>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>🖨 Print flyer</Button>
      </div>

      {data === undefined ? (
        <Skeleton className="h-[600px] rounded-3xl" />
      ) : (
        <>
          <Card className="animate-rise overflow-hidden print:shadow-none print:ring-0">
            <div className={`px-6 py-3 text-center text-sm font-bold uppercase tracking-[.25em] text-white ${data.status === "found" ? "bg-moss-500" : "bg-ember-600"}`}>
              {data.status === "found" ? `${data.petName} is home — thank you` : `Lost ${data.species} — have you seen ${data.petName}?`}
            </div>
            <div className="grid md:grid-cols-[1.15fr_1fr]">
              <div className="relative bg-cream-100">
                {data.photoUrls[0] ? (
                  <img src={data.photoUrls[0]} alt={data.petName} className="h-full max-h-[560px] w-full object-cover" />
                ) : (
                  <div className="grid aspect-square place-items-center text-8xl">🐾</div>
                )}
              </div>
              <div className="flex flex-col p-6 md:p-8">
                <h1 className="font-display text-6xl font-bold leading-none tracking-tight">{data.petName}</h1>
                <p className="mt-2 text-lg text-ink-700">
                  {data.breed ?? data.species} · {data.colors.join(", ")}
                  {data.sizeKg ? ` · about ${data.sizeKg} kg` : ""}
                </p>
                <dl className="mt-6 space-y-3 text-sm">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Look for</dt>
                    <dd className="mt-0.5 text-base">{data.distinguishingMarks}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Last seen</dt>
                    <dd className="mt-0.5 text-base">{data.lastSeenAddress}<br /><span className="text-ink-500">{fmtDateTime(data.lastSeenAt)}</span></dd>
                  </div>
                </dl>
                <div className="mt-auto flex items-end gap-5 pt-8">
                  {qr && <img src={qr} alt="QR code to this flyer" className="size-28 rounded-xl ring-1 ring-cream-200" />}
                  <div className="text-sm">
                    <p className="font-semibold">Seen {data.petName}? Scan or visit</p>
                    <p className="break-all font-mono text-xs text-ink-500">{url.replace(/^https?:\/\//, "")}</p>
                    {data.inboxAddress && (
                      <p className="mt-2 text-xs text-ink-500">
                        or email <span className="font-mono text-ink-900">{data.inboxAddress}</span>
                        <br />with <span className="font-mono text-ink-900">[{data.caseCode}]</span> in the subject
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <div className="no-print mt-6 grid gap-6 md:grid-cols-[1fr_1fr]">
            {data.status === "open" ? <SightingForm slug={slug} petName={data.petName} center={{ lat: data.lastSeenLat, lng: data.lastSeenLng }} /> : (
              <Card className="p-6">
                <p className="font-display text-2xl font-semibold">Home safe 🎉</p>
                <p className="mt-2 text-ink-500">{data.petName} has been found. Thank you to everyone who kept an eye out.</p>
              </Card>
            )}
            <div className="space-y-4">
              <Card className="h-64 overflow-hidden">
                <MapView center={{ lat: data.lastSeenLat, lng: data.lastSeenLng }} zoom={13} pins={pins} radiusKm={data.radiusKm} fit={pins.length > 1} />
              </Card>
              <Card className="p-5">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold">Recent sightings</p>
                  <Pill tone="sky">{data.sightings.length}</Pill>
                </div>
                {data.sightings.length === 0 ? (
                  <p className="text-sm text-ink-500">None yet — yours could be the first.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.sightings.slice(0, 6).map((s) => (
                      <li key={s._id} className="animate-rise flex gap-2">
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-sky-600" />
                        <span>
                          {s.note}
                          <span className="text-ink-300"> · {timeAgo(s.reportedAt)}{s.locationText ? ` · ${s.locationText}` : ""}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SightingForm({ slug, petName, center }: { slug: string; petName: string; center: { lat: number; lng: number } }) {
  const report = useMutation(api.sightings.reportPublic);
  const uploadUrl = useMutation(api.sightings.generatePublicUploadUrl);
  const toast = useToast();
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [where, setWhere] = useState("");
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [photoId, setPhotoId] = useState<Id<"_storage"> | undefined>();
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadUrl({ slug });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      setPhotoId(storageId);
    } catch (e) {
      toast(errorMessage(e), "warn");
    } finally {
      setUploading(false);
    }
  };

  const locate = () => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => toast("Could not get your location — tap the map", "warn"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const submit = async () => {
    setBusy(true);
    try {
      await report({ slug, note, reporterName: name || undefined, locationText: where || undefined, lat: pin?.lat, lng: pin?.lng, photoId });
      setDone(true);
    } catch (e) {
      toast(errorMessage(e), "warn");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Card className="animate-pop p-6">
        <p className="text-4xl">🙏</p>
        <p className="mt-2 font-display text-2xl font-semibold">Thank you.</p>
        <p className="mt-1 text-ink-500">Your sighting is on {petName}'s owner's map right now.</p>
        <Button variant="secondary" className="mt-4" onClick={() => { setDone(false); setNote(""); setPin(null); setPhotoId(undefined); }}>Report another</Button>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <p className="font-display text-2xl font-semibold">I saw {petName}</p>
      <p className="mt-1 text-sm text-ink-500">Takes 20 seconds. The owner sees it instantly.</p>
      <div className="mt-4 space-y-4">
        <Field label="What did you see?">
          <textarea className={`${inputCls} min-h-24`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A beagle with a red collar trotting along Jubilee Dr around 7am, heading north" />
        </Field>
        <Field label="Where? (tap the map or use your location)">
          <div className="relative h-44 overflow-hidden rounded-xl ring-1 ring-cream-300">
            <MapView center={pin ?? center} zoom={14} pins={pin ? [{ id: "pick", ...pin, kind: "pick", label: "Seen here" }] : []} onClick={setPin} />
            <div className="absolute right-2 top-2 z-[500]">
              <Button size="sm" variant="secondary" onClick={locate}>📍 My location</Button>
            </div>
          </div>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Place name (optional)">
            <input className={inputCls} value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Jubilee Dr, Victoria Park" />
          </Field>
          <Field label="Your name (optional)">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya" />
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-cream-50 px-3 py-2 text-sm ring-1 ring-cream-300">
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
          <span className="text-lg">📷</span>
          <span className="text-ink-700">{uploading ? "Uploading photo…" : photoId ? "Photo attached ✓" : "Add a photo (optional)"}</span>
        </label>
        <Button size="lg" className="w-full" disabled={busy || uploading || note.trim().length < 4} onClick={submit}>
          {busy ? "Sending…" : "Send sighting"}
        </Button>
      </div>
    </Card>
  );
}
