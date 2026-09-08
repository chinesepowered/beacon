# Beacon — build log

Event: Convex All Gas Hackathon
Frontend: Convex static hosting
Live app: https://moonlit-ferret-277.convex.site
Convex deployment: moonlit-ferret-277 (production; project `beacon`, team `clai74`)
Components: @convex-dev/static-hosting, @convex-dev/rate-limiter, @convex-dev/agent (registered in `convex/convex.config.ts`; static hosting and rate limiter are on the critical path)
Convex features: schema with 14 tables and 30 indexes · live queries · mutations · Node (`"use node"`) actions · HTTP actions (`convex/http.ts`) · scheduler (`ctx.scheduler.runAfter`) · cron (`crawl.sweep`, every 6 hours) · file storage (`ctx.storage.generateUploadUrl` / `getUrl`) · internal queries, mutations and actions · `ConvexError` for user-facing failures · env vars set on the deployment
Auth: Convex Auth (`@convex-dev/auth`) — Anonymous provider as the primary path, Password for returning users; `getAuthUserId` backs every ownership check
AI models: OpenAI, called through the official `openai` client in `convex/lib/llm.ts`; chat model and optional vision model are set per deployment via `LLM_MODEL` / `LLM_VISION_MODEL`

---

## 2026-09-01 — chassis, pipeline, UI

**`af2f552` Set up Beacon chassis on Convex**
First commit. Vite + React 19 + Tailwind v4 app, `convex/convex.config.ts` registering the static-hosting, agent and rate-limiter components, Convex Auth wired up in `convex/auth.ts` (Anonymous + Password) and `convex/auth.config.ts`, `convex/http.ts` with the auth routes and the static-hosting catch-all, and `convex/lib/` gateways for the three sponsor SDKs (`firecrawl.ts`, `agentmail.ts`, `llm.ts`) plus `limits.ts` for the rate limiter. `.env.example` lists env var names only; the Convex agent-skill set (`convex-*`) was vendored into the repo in the same commit.

**`7d0d3f8` Add Beacon schema, case API, crawl/AI/outreach pipelines, cron and demo seed**
The product, in one commit (~2,300 lines):
- `convex/schema.ts` — cases, sources, listings, matches, contacts, sightings, events on top of the shared mail/usage tables.
- `convex/cases.ts` — the owner-facing query/mutation API, with `accessibleCase` gating every read, and `publicBySlug` for the unauthenticated flyer page.
- `convex/crawl.ts` — Firecrawl search → source discovery → `scrapeJson` listing extraction.
- `convex/ai.ts` — `llmGuarded` (kill switch, rate limits, circuit breaker, usage metering), match scoring, reply classification, and deterministic `heuristicScore` / `heuristicClassify` fallbacks.
- `convex/outreach.ts` — HTML + text flyer rendering and AgentMail sending.
- `convex/inbound.ts` — scheduled classification of every inbound reply.
- `convex/crons.ts` — the re-scan sweep.
- `convex/seed.ts` — the shared `BCN-MILO` demo case (Milo, a beagle lost at Victoria Park, Kitchener) with real regional shelter pages as sources, so a cold visitor sees a live app.

**`98348c7` Harden crawl pipeline: rate-limit retry, skip unsupported sites, lift org emails from pages**
Firecrawl's free tier is ~10 requests/minute: a rate-limited scrape now reschedules itself instead of failing (`RATE_LIMIT_RETRY_MS`), sites Firecrawl cannot crawl are marked `unsupported` and skipped by the sweep, and a contact email found in scraped page text creates a contact and schedules the flyer.

**`04e19e8` Build the Beacon UI: landing, 3-step wizard, live war room, public flyer, usage page**
The whole frontend (~1,500 lines): `src/pages/Landing.tsx`, `NewCase.tsx` (photo upload straight to Convex file storage, map pin, radius), `CaseRoom.tsx` (map + live feed + match cards + sources/contacts/sightings/emails tabs), `Flyer.tsx` (public, printable, QR), `Admin.tsx` (per-provider free-tier burn), plus `components/Map.tsx` and a tiny hand-rolled router.

**`7eab807` Look up org contact emails from site contact pages**
Many shelters put no address on the page Firecrawl lands on. `findContactEmail` now maps the site, picks the contact/about page and scrapes it — capped at `MAX_CONTACT_LOOKUPS = 3` per case and skipped for aggregator hosts.

**`96d4f11` Widen the reply classifier's sighting vocabulary**
Testing against real shelter phrasing showed the heuristic fallback missing holds written as "surrendered to us", "turned in", "we may have your dog". The `SIGHTING` regex in `convex/ai.ts` was widened, with the `no_match` branch kept ahead of it so "we have not seen him" still classifies correctly.

**`a6372e0` Geocode sightings by falling back to the leading landmark**
The model writes richer place strings than Nominatim can resolve ("Iron Horse Trail by Queen Street South, Kitchener"), so sightings were arriving unpinned. `placeVariants` in `convex/lib/geo.ts` now tries progressively simpler forms, with and without the city, spaced to Nominatim's one-request-per-second rule.

**`3254725` Route replies back to the message that sent, not the first under the code**
A case code names the case, not one email, so every flyer under a case shares it. Reply routing in `mail.ingest` now matches the inbound subject back to the outbound message that started the thread (`normalizeSubject`), falling back to the most recent letter under that code.

**`f0a489f` Stop exposing unrouted mail to anonymous visitors**
Security fix found in review: the live demo signs every visitor in anonymously, so "signed in" proved nothing, and `mail.unrouted` was showing arbitrary inbound mail to anyone. It now requires an account with a real email (password sign-in), truncates bodies and redacts sender addresses.

## 2026-09-07 — free-tier survival

**`5c8fc3e` Sweep shelter pages every six hours, not every thirty minutes**
A 30-minute cron over every source of every open case would have burned the Firecrawl pool long before judging. `convex/crons.ts` now runs `crawl.sweep` every 6 hours.

**`5f68200` Cache every crawl and guard the pool in credits, not calls**
The biggest infrastructure change after launch. A rate limiter counts calls, but Firecrawl bills credits and one JSON-extraction scrape costs about ten plain ones. Added `convex/crawlCache.ts` (permanent result cache + `crawlBudget` row) and rebuilt `convex/lib/firecrawl.ts` around a single gateway: serve a stored result if we have one → refuse to spend below a reserve or over a daily cap, checked against Firecrawl's own credit-usage endpoint → only then call out, and record what it cost. A repeat of an earlier judge's search now costs nothing, and a source with no budget left shows its saved listings rather than an error.

**`73151f6` Correct crawl cost estimates and read the cache TTL per call**
Measured spend showed the guard was optimistic: a plain scrape bills ~2 credits where it was booked as 1, map likewise, and a JSON-extraction scrape 10 rather than 6 — under-counting is the unsafe direction. `convex/crawl.ts` also stopped counting cached results in `/admin`'s usage figure and started metering in credits, so the number on screen means what it says. `CACHE_TTL_MS` was a module constant while the reserve and daily cap were functions, so changing `FIRECRAWL_CACHE_TTL_HOURS` did nothing until the isolate restarted; it is now read per call.

**`6b2b037` Say what the schedule actually is, and stop reporting an empty scan as zeroes**
Follow-up to the cron change: UI copy still promised a 30-minute re-scan, and a scan that found nothing was logged as "0 listings, 0 new" rather than "nothing new posted".

## 2026-09-08 — polish

**`3f065a9` Serve map tiles from Esri, not the OSM community server**
`tile.openstreetmap.org` rate-limits and its usage policy discourages app traffic; the map went grey under repeated loads. `src/components/Map.tsx` now uses Esri's keyless light-grey basemap, which also suits the app's palette.

## 2026-09-09 — judge-facing documentation

Wrote `README.md` and this build log against the shipped code. Two stale claims found and fixed while verifying:
- `convex/pipeline.ts` told the user "the 30-minute sweep will retry discovery" — the cron has been 6-hourly since `5c8fc3e`, and the sweep re-scrapes existing sources, it never re-runs discovery. Replaced with what actually happened.
- The `MapView` docstring in `src/components/Map.tsx` still said OpenStreetMap tiles after `3f065a9` switched to Esri.

Six screenshots of the live deployment were added under `public/demo/`. `pnpm run build` passes.
