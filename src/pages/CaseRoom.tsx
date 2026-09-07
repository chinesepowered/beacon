import { useAction, useMutation, useQuery } from "convex/react";
import confetti from "canvas-confetti";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { MapView, type Pin } from "../components/Map";
import { Button, Card, Empty, Pill, ScoreRing, SectionTitle, Skeleton } from "../components/ui";
import { errorMessage, fmtDateTime, KIND_LABEL, kmBetween, timeAgo } from "../lib/format";
import { useToast } from "../lib/toast";

type Tab = "sources" | "contacts" | "sightings" | "emails";

export function CaseRoom({ caseId, navigate }: { caseId: Id<"cases">; navigate: (to: string) => void }) {
  const c = useQuery(api.cases.get, { caseId });
  const feed = useQuery(api.cases.feed, { caseId });
  const matches = useQuery(api.cases.matches, { caseId });
  const sightings = useQuery(api.cases.sightings, { caseId });
  const sources = useQuery(api.cases.sources, { caseId });
  const listings = useQuery(api.cases.listings, { caseId });
  const contacts = useQuery(api.cases.contacts, { caseId });
  const [focus, setFocus] = useState<{ lat: number; lng: number; key: number } | null>(null);
  const [tab, setTab] = useState<Tab>("sources");
  const toast = useToast();
  const markFound = useMutation(api.cases.markFound);
  const reopen = useMutation(api.cases.reopen);

  // Confetti when the case flips to found while we're watching.
  const prevStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!c) return;
    if (prevStatus.current === "open" && c.status === "found") celebrate();
    prevStatus.current = c.status;
  }, [c]);

  const pins = useMemo<Pin[]>(() => {
    if (!c) return [];
    const out: Pin[] = [{ id: "lastseen", lat: c.lastSeenLat, lng: c.lastSeenLng, kind: "lastseen", label: "Last seen", popup: `<b>Last seen</b><br/>${c.lastSeenAddress}<br/>${fmtDateTime(c.lastSeenAt)}` }];
    for (const s of sightings ?? []) {
      if (s.lat === undefined || s.lng === undefined) continue;
      out.push({
        id: `s-${s._id}`,
        lat: s.lat,
        lng: s.lng,
        kind: "sighting",
        photoUrl: s.photoUrl,
        label: "Sighting",
        popup: `<b>Sighting · ${timeAgo(s.reportedAt)}</b><br/>${escapeHtml(s.note)}${s.reporterName ? `<br/><i>${escapeHtml(s.reporterName)}</i>` : ""}`,
      });
    }
    for (const m of matches ?? []) {
      if (m.status === "dismissed" || m.listing.lat === undefined || m.listing.lng === undefined) continue;
      out.push({
        id: `m-${m._id}`,
        lat: m.listing.lat,
        lng: m.listing.lng,
        kind: "match",
        photoUrl: m.listing.imageUrl,
        label: `${m.score}% match`,
        popup: `<b>${m.score}% match</b><br/>${escapeHtml(m.listing.description)}<br/><i>${escapeHtml(m.listing.sourceName)}</i>`,
      });
    }
    return out;
  }, [c, sightings, matches]);

  if (c === null) {
    return (
      <div className="mx-auto max-w-xl px-5 py-24 text-center">
        <p className="font-display text-3xl font-semibold">Case not found</p>
        <p className="mt-2 text-ink-500">It may belong to a different browser session.</p>
        <Button className="mt-6" onClick={() => navigate("/")}>Home</Button>
      </div>
    );
  }

  const newMatches = (matches ?? []).filter((m) => m.status === "new");

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-24 pt-4 md:px-6">
      {/* Header */}
      {c === undefined ? (
        <Skeleton className="h-28 rounded-3xl" />
      ) : (
        <Card className="animate-rise overflow-hidden">
          <div className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:p-5">
            <div className="flex items-center gap-4">
              <div className="relative size-20 shrink-0 overflow-hidden rounded-2xl bg-cream-100 ring-1 ring-cream-200">
                {c.photoUrls[0] ? <img src={c.photoUrls[0]} alt={c.petName} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-3xl">🐾</div>}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-3xl font-semibold leading-none tracking-tight">{c.petName}</h1>
                  {c.status === "found" ? <Pill tone="moss">Found · home safe</Pill> : <Pill tone="ember"><Dot live /> Searching</Pill>}
                  {c.isDemo && <Pill tone="ink">Shared demo</Pill>}
                </div>
                <p className="mt-1.5 text-sm text-ink-500">
                  {c.breed ?? c.species} · {c.colors.join(", ")} · last seen {c.lastSeenAddress}, {timeAgo(c.lastSeenAt)} · {c.radiusKm} km radius
                </p>
                <p className="mt-1 text-xs text-ink-300">
                  <PipelineStatus status={c.pipelineStatus} note={c.pipelineNote} /> · Case code <code className="rounded bg-cream-100 px-1 font-mono text-ink-700">{c.caseCode}</code>
                  {c.inboxAddress && (
                    <>
                      {" "}· replies to <button className="font-mono text-ink-700 underline-offset-2 hover:underline" onClick={() => copy(c.inboxAddress!, toast)}>{c.inboxAddress}</button>
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 md:ml-auto">
              <Button variant="secondary" onClick={() => navigate(`/p/${c.slug}`)}>Flyer & QR</Button>
              {c.status === "open" ? (
                <Button variant="success" onClick={() => void markFound({ caseId })}>🎉 {c.petName} is home</Button>
              ) : (
                <Button variant="secondary" onClick={() => void reopen({ caseId })}>Reopen search</Button>
              )}
            </div>
          </div>
          {c.status === "found" && (
            <div className="border-t border-moss-500/20 bg-moss-100 px-5 py-2.5 text-sm font-semibold text-moss-700">
              {c.petName} is home. Every shelter and vet on the list has been told — thank you for looking.
            </div>
          )}
        </Card>
      )}

      {/* Row 1: map + feed */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="relative h-[380px] overflow-hidden md:h-[460px]">
          {c ? (
            <MapView center={{ lat: c.lastSeenLat, lng: c.lastSeenLng }} zoom={13} pins={pins} radiusKm={c.radiusKm} fit={pins.length > 1} focus={focus} />
          ) : (
            <Skeleton className="h-full rounded-none" />
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex gap-2">
            <Legend color="bg-ember-600" label="Last seen" />
            <Legend color="bg-sky-600" label={`${(sightings ?? []).length} sightings`} />
            <Legend color="bg-moss-500" label={`${newMatches.length} matches`} />
          </div>
        </Card>

        <Card className="flex h-[380px] flex-col md:h-[460px]">
          <div className="flex items-center justify-between border-b border-cream-200 px-4 py-3">
            <h2 className="font-display text-lg font-semibold">Live feed</h2>
            <span className="flex items-center gap-1.5 text-xs text-ink-500"><Dot live /> updating live</span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {feed === undefined ? (
              <div className="space-y-2 p-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : feed.length === 0 ? (
              <Empty icon="📡" title="Waiting for the first scan" body="Sources, emails and matches show up here as they happen." />
            ) : (
              <ul className="space-y-1">
                {feed.map((e) => <FeedRow key={e._id} e={e} />)}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {/* Row 2: matches */}
      <section className="mt-8">
        <SectionTitle hint={matches === undefined ? "" : `${newMatches.length} to review · scored against ${c?.petName ?? "your pet"}'s description${matches.some((m) => m.visionUsed) ? " and photo" : ""}`}>
          Possible matches
        </SectionTitle>
        {matches === undefined ? (
          <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-56" />)}</div>
        ) : newMatches.length === 0 ? (
          <Empty
            icon="🔍"
            title="No matches yet"
            body={
              (listings ?? []).length
                ? `${(listings ?? []).length} listings scanned so far — nothing scored 60% or higher. Beacon re-scans every few hours.`
                : "Once a shelter page lists a found animal that looks like yours, it appears here with the reasons."
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {newMatches.map((m, i) => (
              <MatchCard key={m._id} m={m} c={c} index={i} onLocate={() => m.listing.lat !== undefined && setFocus({ lat: m.listing.lat, lng: m.listing.lng!, key: Date.now() })} />
            ))}
          </div>
        )}
        {(matches ?? []).some((m) => m.status !== "new") && (
          <details className="mt-3 text-sm text-ink-500">
            <summary className="cursor-pointer">Reviewed matches ({(matches ?? []).filter((m) => m.status !== "new").length})</summary>
            <ul className="mt-2 space-y-1">
              {(matches ?? []).filter((m) => m.status !== "new").map((m) => (
                <li key={m._id} className="flex items-center gap-2">
                  <Pill tone={m.status === "confirmed" ? "moss" : "neutral"}>{m.status}</Pill>
                  <span>{m.score}% · {m.listing.description.slice(0, 90)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Row 3: tabs */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap gap-1 rounded-full bg-cream-100 p-1 md:inline-flex">
          {(
            [
              ["sources", `Sources${sources ? ` · ${sources.length}` : ""}`],
              ["contacts", `Emailed${contacts ? ` · ${contacts.filter((k) => k.emailStatus !== "queued" && k.emailStatus !== "skipped").length}` : ""}`],
              ["sightings", `Sightings${sightings ? ` · ${sightings.length}` : ""}`],
              ["emails", "Email thread"],
            ] as [Tab, string][]
          ).map(([t, l]) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${tab === t ? "bg-white shadow ring-1 ring-cream-300" : "text-ink-500 hover:text-ink-900"}`}>
              {l}
            </button>
          ))}
        </div>
        {tab === "sources" && <Sources caseId={caseId} sources={sources} listings={listings} open={c?.status === "open"} />}
        {tab === "contacts" && <Contacts contacts={contacts} />}
        {tab === "sightings" && <Sightings sightings={sightings} c={c} onLocate={(lat, lng) => setFocus({ lat, lng, key: Date.now() })} />}
        {tab === "emails" && <Emails caseId={caseId} />}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function Dot({ live }: { live?: boolean }) {
  return (
    <span className="relative inline-flex size-2">
      {live && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
      <span className="relative inline-flex size-2 rounded-full bg-current" />
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold shadow ring-1 ring-cream-200">
      <span className={`size-2 rounded-full ${color}`} /> {label}
    </span>
  );
}

function PipelineStatus({ status, note }: { status: string; note?: string }) {
  const map: Record<string, string> = {
    queued: "Starting search…",
    discovering: "Finding shelters & vets nearby…",
    emailing: "Emailing flyers…",
    scanning: "Scanning shelter pages…",
    ready: "Search running · re-scans every few hours",
    degraded: `Search running with issues${note ? `: ${note}` : ""}`,
  };
  const busy = ["queued", "discovering", "emailing", "scanning"].includes(status);
  return (
    <span className={busy ? "text-ember-600" : ""}>
      {busy && <span className="mr-1 inline-block size-2 animate-pulse rounded-full bg-ember-500 align-middle" />}
      {map[status] ?? status}
    </span>
  );
}

const KIND_ICON: Record<string, string> = {
  discover: "🧭",
  scan: "🔎",
  email: "✉️",
  reply: "💬",
  match: "✨",
  sighting: "📍",
  found: "🎉",
  quota: "⏳",
  system: "•",
};

function FeedRow({ e }: { e: Doc<"events"> }) {
  const meta = (e.meta ?? {}) as Record<string, unknown>;
  const sourcesList = Array.isArray(meta.sources) ? (meta.sources as { name: string; url: string; kind: string }[]) : null;
  const tone = e.kind === "match" || e.kind === "found" ? "bg-moss-100" : e.kind === "sighting" ? "bg-sky-100" : e.kind === "quota" ? "bg-amber-50" : "bg-cream-100";
  return (
    <li className="animate-rise flex gap-3 rounded-xl px-2 py-2 hover:bg-cream-50">
      <span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg text-sm ${tone}`}>{KIND_ICON[e.kind] ?? "•"}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-ink-900">{e.text}</p>
        {sourcesList && (
          <ul className="mt-1 flex flex-wrap gap-1">
            {sourcesList.slice(0, 8).map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" className="rounded-full bg-cream-100 px-2 py-0.5 text-[11px] font-medium text-ink-700 hover:bg-cream-200">
                  {s.name}
                </a>
              </li>
            ))}
          </ul>
        )}
        {typeof meta.url === "string" && !sourcesList && (
          <a href={meta.url} target="_blank" rel="noreferrer" className="text-[11px] text-ink-500 underline-offset-2 hover:underline">
            {shortUrl(meta.url)}
          </a>
        )}
        <p className="mt-0.5 text-[11px] text-ink-300">
          {timeAgo(e.at)}
          {meta.aiUnavailable === true && " · AI unavailable, used rules"}
        </p>
      </div>
    </li>
  );
}

type MatchRow = NonNullable<ReturnType<typeof useQuery<typeof api.cases.matches>>>[number];
type CaseRow = NonNullable<ReturnType<typeof useQuery<typeof api.cases.get>>>;

function MatchCard({ m, c, index, onLocate }: { m: MatchRow; c: CaseRow | undefined; index: number; onLocate: () => void }) {
  const setStatus = useMutation(api.matches.setStatus);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const dist = c && m.listing.lat !== undefined && m.listing.lng !== undefined ? kmBetween(c.lastSeenLat, c.lastSeenLng, m.listing.lat, m.listing.lng) : null;

  const act = async (status: "confirmed" | "dismissed") => {
    setBusy(true);
    try {
      if (status === "confirmed") celebrate();
      await setStatus({ matchId: m._id, status });
    } catch (e) {
      toast(errorMessage(e), "warn");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={`animate-pop overflow-hidden ${m.score >= 80 ? "ring-2 ring-moss-500/40" : ""}`} >
      <div style={{ animationDelay: `${index * 90}ms` }}>
        <div className="grid grid-cols-2 gap-px bg-cream-200">
          <figure className="relative aspect-[4/3] bg-cream-100">
            {c?.photoUrls[0] ? <img src={c.photoUrls[0]} alt={c.petName} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-4xl">🐾</div>}
            <figcaption className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-bold">{c?.petName ?? "Yours"}</figcaption>
          </figure>
          <figure className="relative aspect-[4/3] bg-cream-100">
            {m.listing.imageUrl ? <img src={m.listing.imageUrl} alt="found listing" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center px-4 text-center text-xs text-ink-500">No photo in the listing</div>}
            <figcaption className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-bold">Found listing</figcaption>
          </figure>
        </div>
        <div className="flex gap-4 p-4">
          <ScoreRing score={m.score} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug">{m.listing.description}</p>
            <ul className="mt-2 space-y-1">
              {m.reasons.map((r) => (
                <li key={r} className="flex items-start gap-1.5 text-sm text-ink-700"><span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-moss-500" />{r}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-300">
              <a href={m.listing.sourceUrl ?? m.listing.listingUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{m.listing.sourceName}</a>
              {m.listing.locationText && ` · ${m.listing.locationText}`}
              {dist !== null && ` · ${dist.toFixed(1)} km away`}
              {m.listing.foundAt && ` · found ${m.listing.foundAt}`}
              {` · ${m.visionUsed ? "text + vision" : "text"} · ${m.model}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2 border-t border-cream-200 p-3">
          <Button variant="success" className="flex-1" disabled={busy} onClick={() => void act("confirmed")}>This is them!</Button>
          <Button variant="secondary" disabled={busy} onClick={() => void act("dismissed")}>Not them</Button>
          {m.listing.lat !== undefined && <Button variant="ghost" onClick={onLocate} title="Show on map">📍</Button>}
        </div>
      </div>
    </Card>
  );
}

function Sources({ caseId, sources, listings, open }: { caseId: Id<"cases">; sources: Doc<"sources">[] | undefined; listings: (Doc<"listings"> & { sourceName: string })[] | undefined; open: boolean }) {
  const scanNow = useAction(api.crawl.scanNow);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  void caseId;

  const scan = async (id: Id<"sources">) => {
    setBusy(id);
    try {
      const r = await scanNow({ sourceId: id });
      if (!r.ok) toast(r.message ?? "Could not scan", "warn");
    } catch (e) {
      toast(errorMessage(e), "warn");
    } finally {
      setBusy(null);
    }
  };

  if (sources === undefined) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (sources.length === 0) return <Empty icon="🧭" title="Finding shelters near you" body="Beacon is searching for local shelters, lost-and-found boards and vets. They appear here with links as soon as they're found." />;

  const countFor = (id: Id<"sources">) => (listings ?? []).filter((l) => l.sourceId === id).length;

  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {sources.map((s, i) => {
        const n = countFor(s._id);
        const rows = (listings ?? []).filter((l) => l.sourceId === s._id);
        return (
          <li key={s._id} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
            <Card className="p-4">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${s.status === "ok" ? "bg-moss-500" : s.status === "scanning" ? "animate-pulse bg-ember-500" : s.status === "error" || s.status === "unsupported" ? "bg-ink-300" : "bg-cream-300"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <a href={s.url} target="_blank" rel="noreferrer" className="truncate font-semibold hover:underline">{s.name}</a>
                    <Pill>{KIND_LABEL[s.kind] ?? s.kind}</Pill>
                  </div>
                  <p className="truncate text-xs text-ink-500">{shortUrl(s.url)}</p>
                  <p className="mt-1 text-xs text-ink-300">
                    {s.status === "scanning" ? "Scanning now…" : s.lastScrapedAt ? `Scanned ${timeAgo(s.lastScrapedAt)}` : "Not scanned yet"} · {n} listing{n === 1 ? "" : "s"}
                    {s.orgEmail && " · has email"}
                    {s.status === "unsupported" && " · site can't be crawled"}
                    {s.status === "error" && s.lastError && ` · ${s.lastError.slice(0, 60)}`}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Button size="sm" variant="secondary" disabled={!open || busy === s._id || s.status === "scanning" || s.status === "unsupported"} onClick={() => void scan(s._id)}>
                    {busy === s._id || s.status === "scanning" ? "Scanning…" : "Scan now"}
                  </Button>
                  {(s.rawExcerpt || rows.length > 0) && (
                    <button className="text-[11px] text-ink-500 hover:underline" onClick={() => setOpenId(openId === s._id ? null : s._id)}>
                      {openId === s._id ? "Hide" : "Show"} source
                    </button>
                  )}
                </div>
              </div>
              {openId === s._id && (
                <div className="animate-rise mt-3 space-y-2 border-t border-cream-200 pt-3">
                  {rows.length > 0 && (
                    <ul className="space-y-1.5">
                      {rows.map((l) => (
                        <li key={l._id} className="flex items-start gap-2 text-sm">
                          {l.imageUrl ? <img src={l.imageUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" /> : <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-cream-100 text-lg">🐾</span>}
                          <div className="min-w-0">
                            <p className="leading-snug">{l.description}</p>
                            <p className="text-[11px] text-ink-300">{[l.species, l.locationText, l.foundAt].filter(Boolean).join(" · ")} · {l.scoreStatus === "pending" ? "scoring…" : l.scoreStatus}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.rawExcerpt && (
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-cream-50 p-3 font-mono text-[11px] leading-relaxed text-ink-700 ring-1 ring-cream-200">{s.rawExcerpt}</pre>
                  )}
                  <p className="text-[11px] text-ink-300">Crawled by Firecrawl{s.discoveredVia ? ` · found via search "${s.discoveredVia}"` : ""}</p>
                </div>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function Contacts({ contacts }: { contacts: Doc<"contacts">[] | undefined }) {
  if (contacts === undefined) return <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (contacts.length === 0) return <Empty icon="✉️" title="No contacts emailed yet" body="When a shelter or vet page lists an email address, Beacon sends them the flyer and shows the status here." />;
  const tone = (s: string) => (s === "replied" ? "moss" : s === "delivered" || s === "sent" ? "sky" : s === "bounced" ? "warn" : "neutral") as "moss" | "sky" | "warn" | "neutral";
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {contacts.map((k, i) => (
        <li key={k._id} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
          <Card className="flex items-center gap-3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-cream-100 text-lg">{k.kind === "vet" ? "🩺" : k.kind === "shelter" ? "🏠" : "📋"}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{k.orgName}</p>
              <p className="truncate text-xs text-ink-500">{redactEmail(k.email)}{k.sentAt ? ` · sent ${timeAgo(k.sentAt)}` : ""}</p>
              {k.note && <p className="truncate text-[11px] text-ink-300">{k.note}</p>}
            </div>
            <Pill tone={tone(k.emailStatus)}>{k.emailStatus}</Pill>
          </Card>
        </li>
      ))}
    </ul>
  );
}

type SightingRow = NonNullable<ReturnType<typeof useQuery<typeof api.cases.sightings>>>[number];

function Sightings({ sightings, c, onLocate }: { sightings: SightingRow[] | undefined; c: CaseRow | undefined; onLocate: (lat: number, lng: number) => void }) {
  if (sightings === undefined) return <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (sightings.length === 0) return <Empty icon="📍" title="No sightings yet" body="Sightings from the flyer page and from email replies land here and drop a pin on the map." />;
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {sightings.map((s, i) => {
        const dist = c && s.lat !== undefined && s.lng !== undefined ? kmBetween(c.lastSeenLat, c.lastSeenLng, s.lat, s.lng) : null;
        return (
          <li key={s._id} className="animate-rise" style={{ animationDelay: `${i * 40}ms` }}>
            <Card className="flex gap-3 p-4">
              {s.photoUrl ? <img src={s.photoUrl} alt="" className="size-16 shrink-0 rounded-xl object-cover" /> : <span className="grid size-16 shrink-0 place-items-center rounded-xl bg-sky-100 text-2xl">📍</span>}
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug">{s.note}</p>
                <p className="mt-1 text-xs text-ink-500">
                  {s.reporterName ?? (s.source === "email" ? "By email" : "Flyer form")} · {timeAgo(s.reportedAt)}
                  {s.locationText && ` · ${s.locationText}`}
                  {dist !== null && ` · ${dist.toFixed(1)} km from last seen`}
                </p>
                <div className="mt-1.5 flex gap-2">
                  <Pill tone={s.source === "email" ? "sky" : "neutral"}>{s.source === "email" ? "email reply" : "flyer form"}</Pill>
                  {s.lat !== undefined && s.lng !== undefined ? (
                    <button className="text-xs font-semibold text-sky-600 hover:underline" onClick={() => onLocate(s.lat!, s.lng!)}>Show on map</button>
                  ) : (
                    <span className="text-xs text-ink-300">no pin — location not recognised</span>
                  )}
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function Emails({ caseId }: { caseId: Id<"cases"> }) {
  const msgs = useQuery(api.cases.messages, { caseId });
  if (msgs === undefined) return <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}</div>;
  if (msgs.length === 0) return <Empty icon="📬" title="No emails yet" body="Flyers sent to shelters and every reply appear here as a thread." />;
  return (
    <ul className="space-y-2">
      {msgs.map((m, i) => (
        <li key={m._id} className={`animate-rise flex ${m.direction === "in" ? "justify-start" : "justify-end"}`} style={{ animationDelay: `${i * 40}ms` }}>
          <Card className={`max-w-2xl p-4 ${m.direction === "in" ? "bg-sky-100/40" : ""}`}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
              <Pill tone={m.direction === "in" ? "sky" : "neutral"}>{m.direction === "in" ? "reply" : "sent"}</Pill>
              <span>{m.direction === "in" ? `from ${m.from ?? "unknown"}` : `to ${m.to?.join(", ") ?? ""}`}</span>
              <span>· {timeAgo(m.at)}</span>
              {m.classification && <Pill tone={m.classification === "sighting" ? "moss" : "neutral"}>{m.classification.replace("_", " ")}</Pill>}
              {m.deliveryStatus && m.direction === "out" && <span>· {m.deliveryStatus}</span>}
            </div>
            <p className="mt-1.5 text-sm font-semibold">{m.subject}</p>
            {m.summary && <p className="mt-1 text-sm text-moss-700">AI summary: {m.summary}</p>}
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-700">{m.text}</pre>
          </Card>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ helpers

function celebrate() {
  const end = Date.now() + 1200;
  const colors = ["#c2410c", "#ea580c", "#4d7c0f", "#fbbf24", "#0284c7"];
  (function frame() {
    confetti({ particleCount: 5, angle: 60, spread: 60, origin: { x: 0 }, colors });
    confetti({ particleCount: 5, angle: 120, spread: 60, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

function copy(text: string, toast: (t: string, tone?: "info" | "warn" | "success") => void) {
  void navigator.clipboard?.writeText(text).then(() => toast("Copied", "success"));
}

function shortUrl(u: string) {
  try {
    const x = new URL(u);
    return x.hostname.replace(/^www\./, "") + (x.pathname !== "/" ? x.pathname : "");
  } catch {
    return u;
  }
}

function redactEmail(e: string) {
  const at = e.lastIndexOf("@");
  return at > 0 ? `${e.slice(0, Math.min(3, at))}…${e.slice(at)}` : e;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}
