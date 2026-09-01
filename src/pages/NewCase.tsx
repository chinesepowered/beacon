import { useMutation } from "convex/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MapView, type Pin } from "../components/Map";
import { Button, Card, Field, inputCls } from "../components/ui";
import { errorMessage } from "../lib/format";
import { useToast } from "../lib/toast";

const DEFAULT_CENTER = { lat: 43.4516, lng: -80.4925 }; // Kitchener, ON

type Photo = { file: File; preview: string; storageId?: Id<"_storage">; uploading: boolean; error?: string };

export function NewCase({ navigate }: { navigate: (to: string) => void }) {
  const toast = useToast();
  const generateUploadUrl = useMutation(api.cases.generateUploadUrl);
  const createCase = useMutation(api.cases.create);

  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [petName, setPetName] = useState("");
  const [species, setSpecies] = useState("dog");
  const [breed, setBreed] = useState("");
  const [colors, setColors] = useState("");
  const [marks, setMarks] = useState("");
  const [sizeKg, setSizeKg] = useState("");
  const [lastSeenAt, setLastSeenAt] = useState(() => {
    const d = new Date(Date.now() - 2 * 3600_000);
    d.setMinutes(0, 0, 0);
    return toLocalInput(d);
  });
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [radiusKm, setRadiusKm] = useState(8);
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const dropRef = useRef<HTMLLabelElement>(null);

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file || !file.type.startsWith("image/")) return;
      const preview = URL.createObjectURL(file);
      setPhoto({ file, preview, uploading: true });
      try {
        const url = await generateUploadUrl();
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type }, body: file });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        setPhoto((p) => (p ? { ...p, storageId, uploading: false } : p));
      } catch (e) {
        setPhoto((p) => (p ? { ...p, uploading: false, error: errorMessage(e) } : p));
      }
    },
    [generateUploadUrl],
  );

  const locate = () => {
    if (!navigator.geolocation) return toast("Location is not available in this browser", "warn");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCenter(p);
        setPin(p);
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast("Could not get your location — tap the map instead", "warn");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const pins = useMemo<Pin[]>(() => (pin ? [{ id: "pick", ...pin, kind: "lastseen", label: "Last seen here" }] : []), [pin]);

  const detailsValid = petName.trim().length > 0 && marks.trim().length > 0;
  const placeValid = Boolean(pin) && city.trim().length > 1 && address.trim().length > 1;

  const submit = async () => {
    if (!pin) return;
    setSubmitting(true);
    try {
      const { caseId } = await createCase({
        petName,
        species,
        breed: breed || undefined,
        colors: colors.split(/[,;/]+/).map((s) => s.trim()).filter(Boolean),
        distinguishingMarks: marks,
        sizeKg: sizeKg ? Number(sizeKg) : undefined,
        photoIds: photo?.storageId ? [photo.storageId] : [],
        lastSeenLat: pin.lat,
        lastSeenLng: pin.lng,
        lastSeenAddress: address,
        city,
        lastSeenAt: new Date(lastSeenAt).getTime() || Date.now(),
        radiusKm,
      });
      navigate(`/case/${caseId}`);
    } catch (e) {
      toast(errorMessage(e), "warn");
      setSubmitting(false);
    }
  };

  const steps = ["Photo", "Details", "Last seen"];

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-8">
      <button onClick={() => navigate("/")} className="mb-6 text-sm text-ink-500 hover:text-ink-900">← Back</button>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Let's find them.</h1>
      <p className="mt-2 text-ink-500">Three quick steps. The search starts the moment you finish.</p>

      <ol className="mt-8 flex items-center gap-2 text-sm">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`grid size-7 place-items-center rounded-full text-xs font-bold transition ${
                i < step ? "bg-moss-500 text-white" : i === step ? "bg-ember-600 text-white" : "bg-cream-200 text-ink-500"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span className={i === step ? "font-semibold" : "text-ink-500"}>{s}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-8 bg-cream-300" />}
          </li>
        ))}
      </ol>

      <Card className="mt-6 overflow-hidden">
        {step === 0 && (
          <div className="animate-rise p-6 md:p-8">
            <h2 className="font-display text-2xl font-semibold">A clear photo</h2>
            <p className="mt-1 text-sm text-ink-500">This goes on the flyer and is what shelters compare against. Side-on, good light, whole body if you have it.</p>
            <label
              ref={dropRef}
              onDragOver={(e) => {
                e.preventDefault();
                dropRef.current?.classList.add("ring-ember-500", "bg-ember-50");
              }}
              onDragLeave={() => dropRef.current?.classList.remove("ring-ember-500", "bg-ember-50")}
              onDrop={(e) => {
                e.preventDefault();
                dropRef.current?.classList.remove("ring-ember-500", "bg-ember-50");
                void onFile(e.dataTransfer.files?.[0]);
              }}
              className="mt-5 flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-2xl bg-cream-50 ring-2 ring-dashed ring-cream-300 transition hover:bg-cream-100"
            >
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
              {photo ? (
                <div className="relative w-full p-3">
                  <img src={photo.preview} alt="preview" className="mx-auto max-h-96 rounded-xl object-contain" />
                  <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1 text-xs font-semibold shadow">
                    {photo.uploading ? "Uploading…" : photo.error ? `Upload failed: ${photo.error}` : "Uploaded ✓ · click to replace"}
                  </div>
                </div>
              ) : (
                <>
                  <span className="text-5xl">📷</span>
                  <p className="mt-3 font-semibold">Drop a photo here or tap to choose</p>
                  <p className="text-xs text-ink-500">JPG, PNG, HEIC · you can skip this and add one later</p>
                </>
              )}
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>Skip for now</Button>
              <Button onClick={() => setStep(1)} disabled={!photo || photo.uploading || Boolean(photo.error)}>Next</Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="animate-rise p-6 md:p-8">
            <h2 className="font-display text-2xl font-semibold">About them</h2>
            <p className="mt-1 text-sm text-ink-500">The AI uses every detail here to score found listings, so mention anything that makes them unmistakable.</p>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <Field label="Name">
                <input className={inputCls} value={petName} onChange={(e) => setPetName(e.target.value)} placeholder="Milo" autoFocus />
              </Field>
              <Field label="Species">
                <div className="grid grid-cols-3 gap-1 rounded-xl bg-cream-100 p-1">
                  {[["dog", "🐕 Dog"], ["cat", "🐈 Cat"], ["other", "🐾 Other"]].map(([v, l]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setSpecies(v)}
                      className={`rounded-lg py-2 text-sm font-semibold transition ${species === v ? "bg-white shadow ring-1 ring-cream-300" : "text-ink-500 hover:text-ink-900"}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Breed" hint="Best guess is fine">
                <input className={inputCls} value={breed} onChange={(e) => setBreed(e.target.value)} placeholder="Beagle" />
              </Field>
              <Field label="Colours" hint="Comma-separated">
                <input className={inputCls} value={colors} onChange={(e) => setColors(e.target.value)} placeholder="tricolour, white, brown" />
              </Field>
              <div className="md:col-span-2">
                <Field label="Distinguishing marks & what they were wearing" hint="Collar colour, tags, scars, patches, a limp — this is what sets a real match apart">
                  <textarea className={`${inputCls} min-h-24`} value={marks} onChange={(e) => setMarks(e.target.value)} placeholder="White chest patch, small notch in left ear, red collar with a bone tag" />
                </Field>
              </div>
              <Field label="Approximate weight (kg)">
                <input className={inputCls} type="number" min={0} step={0.5} value={sizeKg} onChange={(e) => setSizeKg(e.target.value)} placeholder="11" />
              </Field>
              <Field label="Last seen">
                <input className={inputCls} type="datetime-local" value={lastSeenAt} onChange={(e) => setLastSeenAt(e.target.value)} />
              </Field>
            </div>
            <div className="mt-6 flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>Back</Button>
              <Button onClick={() => setStep(2)} disabled={!detailsValid}>Next</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="animate-rise">
            <div className="p-6 pb-3 md:p-8 md:pb-3">
              <h2 className="font-display text-2xl font-semibold">Where did you last see {petName || "them"}?</h2>
              <p className="mt-1 text-sm text-ink-500">Tap the map to drop the pin. Beacon searches shelters and lost-and-found pages inside the circle.</p>
            </div>
            <div className="relative h-80 md:h-96">
              <MapView center={center} zoom={13} pins={pins} radiusKm={pin ? radiusKm : undefined} radiusCenter={pin ?? undefined} onClick={(p) => setPin(p)} />
              <div className="absolute right-3 top-3 z-[500]">
                <Button size="sm" variant="secondary" onClick={locate} disabled={locating}>
                  {locating ? "Locating…" : "📍 Use my location"}
                </Button>
              </div>
              {!pin && (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[500] flex justify-center">
                  <span className="rounded-full bg-ink-900/90 px-3 py-1.5 text-xs font-semibold text-cream-50">Tap the map to place the pin</span>
                </div>
              )}
            </div>
            <div className="grid gap-5 p-6 md:grid-cols-2 md:p-8">
              <Field label="Place or address" hint="Shown on the flyer">
                <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Victoria Park, near the clock tower" />
              </Field>
              <Field label="City / region" hint="Used to find local shelters and vets">
                <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Kitchener, Ontario" />
              </Field>
              <div className="md:col-span-2">
                <Field label={`Search radius: ${radiusKm} km`}>
                  <input type="range" min={1} max={25} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} className="w-full accent-ember-600" />
                </Field>
              </div>
            </div>
            <div className="flex justify-between gap-2 px-6 pb-6 md:px-8 md:pb-8">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button size="lg" onClick={submit} disabled={!placeValid || submitting}>
                {submitting ? "Starting the search…" : "Start the search"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
