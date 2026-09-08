# Hackathon log

- **Project:** Beacon
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns one lost-pet report into an always-on search that crawls local shelter pages, scores found-animal listings against the pet, emails nearby shelters and vets the flyer, and routes their replies onto a live case map.
- **Live app:** https://moonlit-ferret-277.convex.site
- **Repo:** https://github.com/chinesepowered/beacon
- **Frontend:** Convex static hosting
- **Convex deployment:** https://moonlit-ferret-277.convex.cloud
- **Components:** @convex-dev/static-hosting, @convex-dev/agent, @convex-dev/rate-limiter
- **Convex features:** schema, tables, indexes, queries, mutations, actions, HTTP actions, crons, scheduled functions, file storage, realtime queries
- **Auth:** Convex Auth
- **AI models:** none checked in; the model id is read from `LLM_MODEL` and `LLM_VISION_MODEL` on the deployment and calls go through the OpenAI client in `convex/lib/llm.ts`
- **Started:** 2026-09-01T17:25:48Z
- **Last updated:** 2026-09-08T18:40:42Z

## Log

### 2026-09-01 - af2f552
Stood up the chassis: a Vite + React frontend served from Convex static hosting, anonymous-first sign-in so the live URL never shows a login wall, and app-owned HTTP routing where the auth routes and the AgentMail webhook are exact routes and the SPA is the catch-all. Signed webhook verification is written against Web Crypto so it runs in the default runtime. Convex features: HTTP actions, registered components, Convex Auth (`convex/http.ts`, `convex/auth.ts`, `convex/convex.config.ts`, `convex/lib/svix.ts`).

### 2026-09-01 - 7d0d3f8
Added the product in one pass: lost-pet cases, crawled sources, extracted listings, scored matches, contacted organisations, sightings and a live event feed. Discovery searches the web for local shelters and vets, outreach emails them the flyer, inbound replies are classified off the webhook path, and a cron re-scans open cases. Every model call has a deterministic fallback. Convex features: schema, tables, indexes, queries, mutations, actions, crons, scheduled functions (`convex/schema.ts`, `convex/cases.ts`, `convex/crawl.ts`, `convex/ai.ts`, `convex/outreach.ts`, `convex/inbound.ts`, `convex/crons.ts`, `convex/seed.ts`).

### 2026-09-01 - 98348c7
Hardened the crawl pipeline against a free tier that allows about ten requests a minute: a rate-limited scrape now reschedules itself instead of failing, sites the crawler cannot handle are marked unsupported and skipped by the sweep, and an organisation email found in scraped page text creates a contact and schedules the flyer. Convex features: scheduled functions, mutations (`convex/crawl.ts`, `convex/store.ts`).

### 2026-09-01 - 04e19e8
Built the whole frontend: landing page, a three-step report wizard with photo upload straight to Convex file storage and a map pin, the live case room (map, feed, match cards, sources/contacts/sightings/emails tabs), the public printable flyer with a QR code, and a usage page showing per-provider burn. Convex features: realtime queries, mutations, file storage (`src/pages/*.tsx`, `src/components/Map.tsx`).

### 2026-09-01 - 7eab807
Many shelters publish no address on the page the crawler lands on, so discovery now maps the site, picks the contact or about page and scrapes that. Capped at three lookups per case and skipped for aggregator hosts so it cannot run away with the crawl budget (`convex/crawl.ts`).

### 2026-09-01 - 96d4f11
Widened the fallback reply classifier after testing it against real shelter phrasing: holds written as "surrendered to us", "turned in" or "we may have your dog" were being missed. The no-match branch still runs first, so "we have not seen him" classifies correctly (`convex/ai.ts`).

### 2026-09-01 - a6372e0
Emailed sightings were arriving unpinned because the model writes richer place strings than the geocoder can resolve. Sightings now retry progressively simpler forms of the place, with and without the city, spaced to the geocoder's one-request-per-second rule, falling back to the leading landmark rather than dropping the pin (`convex/lib/geo.ts`).

### 2026-09-01 - 3254725
Fixed reply routing. A case code names the case, not one message, so every flyer under a case shares it and replies were landing on the wrong row. Inbound mail is now matched back to the outbound message that started the thread, falling back to the most recent message under that code (`convex/mail.ts`, `convex/lib/mailUtil.ts`).

### 2026-09-01 - f0a489f
Security fix found in review: the live demo signs every visitor in anonymously, so "signed in" proved nothing, and the unrouted-mail view was showing arbitrary inbound mail to anyone. It now requires an account with a real email, truncates bodies and redacts sender addresses (`convex/mail.ts`).

### 2026-09-07 - 5c8fc3e
Moved the re-scan cron from every thirty minutes to every six hours. Sweeping every source of every open case twice an hour would have drained the crawl pool long before judging (`convex/crons.ts`).

### 2026-09-07 - 5f68200
Rebuilt crawl spending around one gateway: serve a stored result when we have one, refuse to spend below a reserve or over a daily cap checked against the crawl provider's own credit-usage endpoint, and only then call out and record the cost. A rate limiter counts calls, but the provider bills credits and a JSON-extraction scrape costs about ten plain ones. A repeat of an earlier visitor's search now costs nothing, and a source with no budget left shows its saved listings instead of an error. Convex features: tables, indexes, internal queries and mutations (`convex/crawlCache.ts`, `convex/lib/firecrawl.ts`, `convex/schema.ts`).

### 2026-09-07 - 73151f6
Measured spend showed the guard was optimistic: a plain scrape bills about two credits where it was booked as one, and a JSON-extraction scrape ten rather than six. Cached results no longer count toward the usage figure on the admin page, which now meters credits rather than calls, and the cache TTL is read per call instead of at module load (`convex/lib/firecrawl.ts`, `convex/crawl.ts`).

### 2026-09-07 - 6b2b037
Follow-up to the schedule change: three places in the UI still promised a re-scan every thirty minutes. Also stopped rendering a scan that found nothing as "0 listings, 0 new", which read like a failure when it is the normal case for a shelter page (`convex/crons.ts`, `convex/crawl.ts`, `src/pages/CaseRoom.tsx`, `src/pages/Landing.tsx`).

### 2026-09-08 - 3f065a9
Switched the map basemap to a keyless light-grey tile service after the community tile server rate-limited repeated loads and left the map grey (`src/components/Map.tsx`).

### 2026-09-08 - 44dcdf4
Corrected two claims in the code that the schedule change had left behind: the feed told the owner that "the 30-minute sweep will retry discovery" when a case found no sources, but the cron has been six-hourly since 5c8fc3e and the sweep only re-scrapes existing sources, and the map component's docstring still named the old tile provider (`convex/pipeline.ts`, `src/components/Map.tsx`).

### 2026-09-08 - 93aa6cf
Wrote the judge-facing `README.md` against the shipped code: what the app is, the problem, the product in the order a user meets it, a per-sponsor breakdown with the Convex surface named file by file, a diagram of the request paths, the core loop function by function, and environment variable names only. Added six screenshots of the live deployment under `public/demo/` and a first draft of this log.

### 2026-09-08 - working tree
Rewrote this log against `references/log-format.md` after the build-log skill was installed: the header is now the prescribed bulleted field list in the prescribed order, with `Project`, `What it does`, `Repo`, `Started` and `Last updated` added, `Convex deployment` given as the `.convex.cloud` URL rather than the deployment name, and every entry moved to the `### date - sha` form. `Repo` is `none` because the repository has no configured remote yet. Committed the skill itself under `.claude/skills/convex-hackathon-skill/`, which was previously untracked.
