import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button, Card, Pill, Skeleton } from "../components/ui";
import { timeAgo } from "../lib/format";

export function Landing({ navigate }: { navigate: (to: string) => void }) {
  const cases = useQuery(api.cases.listMine);

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24">
      {/* Hero */}
      <section className="relative grid items-center gap-10 pt-10 md:grid-cols-[1.1fr_.9fr] md:pt-16">
        <div className="animate-rise">
          <Pill tone="ember" className="mb-5">Always-on lost pet search</Pill>
          <h1 className="font-display text-5xl font-semibold leading-[1.02] tracking-tight md:text-7xl">
            When a pet goes missing, <span className="text-ember-600">every hour</span> counts.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-700">
            Beacon turns one report into a search that never sleeps: it crawls every local shelter page on a schedule,
            matches found listings to your pet with AI, emails every shelter and vet with the flyer, and puts every
            reply and sighting on a live map.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => navigate("/new")} className="animate-glow">
              <span className="text-lg">🐾</span> My pet is missing
            </Button>
            <Button size="lg" variant="secondary" onClick={() => document.getElementById("cases")?.scrollIntoView({ behavior: "smooth" })}>
              I found a pet
            </Button>
          </div>
          <p className="mt-4 text-xs text-ink-500">No sign-up. Start in 60 seconds. Free while it matters.</p>
        </div>

        <div className="relative animate-pop [animation-delay:.15s]">
          <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-ember-100 via-cream-100 to-sky-100 blur-2xl" />
          <Card className="overflow-hidden">
            <img src="/demo/milo.jpg" alt="Milo the beagle" className="aspect-[4/3] w-full object-cover" />
            <div className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-display text-2xl font-semibold">Milo</p>
                  <p className="text-sm text-ink-500">Beagle · Victoria Park, Kitchener</p>
                </div>
                <Pill tone="moss">87% match found</Pill>
              </div>
              <ul className="mt-4 space-y-2 text-sm">
                <li className="flex items-center gap-2 text-ink-700"><span className="size-2 rounded-full bg-ember-500" /> Scanned 3 shelter pages · 4 listings</li>
                <li className="flex items-center gap-2 text-ink-700"><span className="size-2 rounded-full bg-sky-600" /> Emailed 5 shelters & vets</li>
                <li className="flex items-center gap-2 text-ink-700"><span className="size-2 rounded-full bg-moss-500" /> 2 sightings pinned on the map</li>
              </ul>
            </div>
          </Card>
        </div>
      </section>

      {/* How it works */}
      <section className="mt-24 grid gap-4 md:grid-cols-4">
        {[
          ["1", "Report", "Photo, a few details, and a pin where you last saw them."],
          ["2", "Search", "Beacon finds every shelter and lost-and-found page nearby and re-scans them every 30 minutes."],
          ["3", "Match", "Each found listing is scored against your pet — with the reasons, not just a number."],
          ["4", "Reach", "Every shelter and vet gets the flyer by email. Their replies land on your live board."],
        ].map(([n, t, b], i) => (
          <Card key={n} className="animate-rise p-5" >
            <span className="font-display text-3xl font-semibold text-ember-600" style={{ animationDelay: `${i * 80}ms` }}>{n}</span>
            <p className="mt-2 font-semibold">{t}</p>
            <p className="mt-1 text-sm text-ink-500">{b}</p>
          </Card>
        ))}
      </section>

      {/* Cases */}
      <section id="cases" className="mt-20">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight">Active searches</h2>
            <p className="text-sm text-ink-500">Your cases, plus a shared demo case anyone can explore. Found a pet? Open a flyer to report a sighting.</p>
          </div>
        </div>
        {cases === undefined ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64" />)}
          </div>
        ) : cases.length === 0 ? (
          <Card className="p-10 text-center">
            <p className="font-semibold">No searches yet.</p>
            <Button className="mt-4" onClick={() => navigate("/new")}>Start one</Button>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {cases.map((c, i) => (
              <button
                key={c._id}
                onClick={() => navigate(`/case/${c._id}`)}
                className="group animate-rise text-left"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <Card className="overflow-hidden transition group-hover:-translate-y-0.5 group-hover:shadow-xl">
                  <div className="relative aspect-[4/3] bg-cream-100">
                    {c.photoUrls[0] ? (
                      <img src={c.photoUrls[0]} alt={c.petName} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center text-5xl">🐾</div>
                    )}
                    <div className="absolute left-3 top-3 flex gap-2">
                      {c.status === "found" ? <Pill tone="moss">Found</Pill> : <Pill tone="ember">Searching</Pill>}
                      {c.isDemo && <Pill tone="ink">Demo</Pill>}
                    </div>
                    {c.newMatches > 0 && c.status === "open" && (
                      <div className="absolute bottom-3 right-3 rounded-full bg-white/95 px-3 py-1 text-xs font-bold text-moss-700 shadow">
                        {c.newMatches} possible match{c.newMatches === 1 ? "" : "es"}
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="font-display text-xl font-semibold">{c.petName}</p>
                    <p className="text-sm text-ink-500">
                      {c.breed ?? c.species} · {c.lastSeenAddress}
                    </p>
                    <p className="mt-2 text-xs text-ink-300">Opened {timeAgo(c.createdAt)}</p>
                  </div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </section>

      <footer className="mt-24 flex flex-wrap items-center justify-between gap-3 border-t border-cream-200 pt-6 text-xs text-ink-500">
        <span>Built on Convex · crawling by Firecrawl · AI by OpenAI-compatible models · email by AgentMail</span>
        <button className="underline-offset-2 hover:underline" onClick={() => navigate("/admin")}>Usage</button>
      </footer>
    </div>
  );
}
