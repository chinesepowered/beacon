"use node";

import { v } from "convex/values";
import { z } from "zod";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { search, scrapeJson, scrape, excerpt, type SearchHit } from "./lib/firecrawl";
import { extract } from "./lib/llm";
import { rateLimiter, isRateLimitError, assertNotPaused, QUOTA_MESSAGE } from "./lib/limits";
import { llmGuarded } from "./ai";

/**
 * Firecrawl pipeline.
 *   discover(): search for shelters / lost-and-found pages / vets near the
 *               case, pick the relevant ones (LLM, heuristic fallback), store
 *               them as `sources` and their emails as `contacts`.
 *   scrapeSource: scrape one source with Firecrawl JSON extraction, upsert
 *               `listings`, schedule AI scoring for each new one.
 *   sweep:      cron entry point, re-scrapes stale sources of open cases.
 *   scanNow:    the "Scan now" button.
 * Every Firecrawl call: assertNotPaused, a global rate-limit token, a usage
 * bump. maxAge caching in lib/firecrawl.ts keeps repeat scrapes free.
 */

type Kind = "shelter" | "lostfound" | "vet";
const KIND_QUERIES: { kind: Kind; q: (city: string) => string }[] = [
  { kind: "shelter", q: (city) => `${city} animal shelter found animals stray intake` },
  { kind: "lostfound", q: (city) => `${city} lost and found pets` },
  { kind: "vet", q: (city) => `${city} veterinary clinic` },
];
const MAX_SOURCES = 8;
const MAX_CONTACTS = 8;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const UNSUPPORTED_HOSTS = ["facebook.com", "instagram.com", "tiktok.com", "x.com", "twitter.com", "youtube.com", "linkedin.com", "reddit.com", "nextdoor.com"];
const SCRAPE_STAGGER_MS = 8000; // Firecrawl free tier: ~10 requests / minute
const RATE_LIMIT_RETRY_MS = 70_000;

class QuotaError extends Error {}

async function takeCrawlToken(ctx: ActionCtx) {
  assertNotPaused();
  try {
    await rateLimiter.limit(ctx, "globalCrawl", { throws: true });
    await rateLimiter.limit(ctx, "globalBurst", { throws: true });
  } catch (e) {
    if (isRateLimitError(e)) throw new QuotaError(QUOTA_MESSAGE);
    throw e;
  }
  await ctx.runMutation(internal.usage.bump, { provider: "firecrawl" });
}

function firstEmail(markdown: string | undefined): string | undefined {
  if (!markdown) return undefined;
  const all = markdown.match(EMAIL_RE) ?? [];
  return all
    .map((e) => e.toLowerCase())
    .find((e) => !/noreply|no-reply|example\.|sentry|wixpress|\.png|\.jpg|\.gif|@\d/.test(e));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function cleanTitle(t: string | undefined, url: string): string {
  const base = (t ?? "").split(/[|\-–—:]/)[0].trim();
  return base.length >= 3 ? base.slice(0, 80) : hostOf(url);
}

const PickSchema = z.object({
  picks: z
    .array(
      z.object({
        url: z.string(),
        name: z.string(),
        kind: z.enum(["shelter", "lostfound", "vet"]),
        email: z.string().optional(),
        relevant: z.boolean(),
      }),
    )
    .max(20),
});

/** Discover sources + contacts for a case. Returns counts for the feed. */
export async function discover(
  ctx: ActionCtx,
  c: Doc<"cases">,
): Promise<{ sourcesCreated: number; contactsCreated: number; quotaHit: boolean }> {
  const hits: (SearchHit & { kind: Kind })[] = [];
  let quotaHit = false;
  for (const { kind, q } of KIND_QUERIES) {
    try {
      await takeCrawlToken(ctx);
    } catch (e) {
      if (e instanceof QuotaError) {
        quotaHit = true;
        break;
      }
      throw e;
    }
    try {
      const res = await search(q(c.city), 5);
      for (const h of res) if (h.url) hits.push({ ...h, kind });
    } catch (e) {
      await ctx.runMutation(internal.store.logEvent, {
        caseId: c._id,
        kind: "system",
        text: `Search "${q(c.city)}" failed: ${String(e).slice(0, 120)}`,
      });
    }
  }

  // Dedupe by host so one big site does not crowd out the others, and drop
  // social networks (Firecrawl cannot scrape them and they have no inbox).
  const byHost = new Map<string, SearchHit & { kind: Kind }>();
  for (const h of hits) {
    const host = hostOf(h.url);
    if (UNSUPPORTED_HOSTS.some((u) => host === u || host.endsWith(`.${u}`))) continue;
    if (!byHost.has(host)) byHost.set(host, h);
  }
  const unique = [...byHost.values()].slice(0, 12);

  // LLM picks the relevant pages and lifts the org email off the page text.
  let picks: { url: string; name: string; kind: Kind; email?: string }[] = [];
  let aiUnavailable = false;
  if (unique.length) {
    const prompt = [
      `A pet (${c.species}) went missing near ${c.lastSeenAddress}, ${c.city}.`,
      `Below are web search results. Pick the ones that are a local animal shelter, humane society, animal control, a lost-and-found pets board, or a veterinary clinic that could plausibly receive a found ${c.species}.`,
      `Mark national aggregators, news articles and unrelated pages as relevant=false. Keep the given kind unless clearly wrong.`,
      `For each, give a short organisation name and, if an email address appears in the page text, copy it exactly.`,
      ``,
      ...unique.map(
        (h, i) =>
          `#${i + 1} [${h.kind}] ${h.url}\nTitle: ${h.title ?? ""}\nSnippet: ${h.description ?? ""}\nPage text: ${(h.markdown ?? "").replace(/\s+/g, " ").slice(0, 700)}\n`,
      ),
    ].join("\n");
    const res = await llmGuarded(ctx, String(c.ownerId), () =>
      extract(PickSchema, prompt, { system: "You curate local animal-welfare contacts for a lost-pet search.", maxTokens: 1500 }),
    );
    if (res.ok) {
      picks = res.value.picks.filter((p) => p.relevant).map((p) => ({ ...p, email: p.email?.toLowerCase() }));
    } else {
      aiUnavailable = true;
    }
  }
  if (!picks.length) {
    picks = unique.map((h) => ({
      url: h.url,
      name: cleanTitle(h.title, h.url),
      kind: h.kind,
      email: firstEmail(h.markdown),
    }));
  }

  // Backfill emails from the raw page text when the model left them out.
  const rawByUrl = new Map(unique.map((h) => [h.url, h]));
  let sourcesCreated = 0;
  let contactsCreated = 0;
  for (const p of picks.slice(0, MAX_SOURCES)) {
    const raw = rawByUrl.get(p.url);
    const email = p.email ?? firstEmail(raw?.markdown);
    const { created } = await ctx.runMutation(internal.store.upsertSource, {
      caseId: c._id,
      url: p.url,
      kind: p.kind,
      name: p.name,
      orgEmail: email,
      discoveredVia: raw ? KIND_QUERIES.find((k) => k.kind === raw.kind)?.q(c.city) : undefined,
      rawExcerpt: raw?.markdown ? excerpt(raw.markdown, 1500) : undefined,
    });
    if (created) sourcesCreated++;
    if (email && contactsCreated < MAX_CONTACTS) {
      const r = await ctx.runMutation(internal.store.upsertContact, {
        caseId: c._id,
        orgName: p.name,
        email,
        kind: p.kind,
        sourceUrl: p.url,
      });
      if (r.created) contactsCreated++;
    }
  }

  const list = picks.slice(0, MAX_SOURCES).map((p) => ({ name: p.name, url: p.url, kind: p.kind }));
  await ctx.runMutation(internal.store.logEvent, {
    caseId: c._id,
    kind: "discover",
    text: sourcesCreated
      ? `Found ${sourcesCreated} shelter${sourcesCreated === 1 ? "" : "s"} and lost-and-found pages near ${c.city}${contactsCreated ? `, ${contactsCreated} with a contact email` : ""}.`
      : `No new local sources found near ${c.city}.`,
    meta: { sources: list, aiUnavailable, quotaHit },
  });
  if (quotaHit) {
    await ctx.runMutation(internal.store.logEvent, {
      caseId: c._id,
      kind: "quota",
      text: `Crawl quota reached while discovering sources. ${QUOTA_MESSAGE}`,
    });
  }
  return { sourcesCreated, contactsCreated, quotaHit };
}

// ------------------------------------------------------------------ scraping

const LISTINGS_JSON_SCHEMA = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          species: { type: "string", description: "dog, cat, or other" },
          description: { type: "string", description: "one or two sentences: breed, sex, age, collar, markings" },
          colors: { type: "array", items: { type: "string" } },
          location: { type: "string", description: "where the animal was found" },
          foundDate: { type: "string" },
          imageUrl: { type: "string" },
          url: { type: "string", description: "the listing's own page, if any" },
        },
        required: ["description"],
      },
    },
  },
  required: ["listings"],
};
const LISTINGS_PROMPT =
  "Extract every FOUND or STRAY animal listing on this page: animals that were found and are being held or reported, " +
  "not adoptable pets and not lost-pet reports. If the page has no found-animal listings, return an empty listings array.";

const LlmListings = z.object({
  listings: z.array(
    z.object({
      species: z.string().optional(),
      description: z.string(),
      colors: z.array(z.string()).optional(),
      location: z.string().optional(),
      foundDate: z.string().optional(),
      imageUrl: z.string().optional(),
      url: z.string().optional(),
    }),
  ),
});
type RawListing = z.infer<typeof LlmListings>["listings"][number];

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

function absolute(url: string | undefined, base: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, base).toString();
  } catch {
    return undefined;
  }
}

export async function scrapeOne(ctx: ActionCtx, sourceId: Id<"sources">, attempt = 0): Promise<void> {
  const data: { source: Doc<"sources">; case: Doc<"cases"> | null } | null = await ctx.runQuery(internal.store.getSource, { sourceId });
  if (!data || !data.case) return;
  const { source, case: c } = data;
  if (c.status !== "open") return;

  await ctx.runMutation(internal.store.setSourceStatus, { sourceId, status: "scanning" });
  try {
    await takeCrawlToken(ctx);
  } catch (e) {
    const quota = e instanceof QuotaError;
    await ctx.runMutation(internal.store.setSourceStatus, {
      sourceId,
      status: "error",
      lastError: quota ? "quota" : String(e).slice(0, 200),
    });
    await ctx.runMutation(internal.store.logEvent, {
      caseId: c._id,
      kind: quota ? "quota" : "system",
      text: quota ? `Skipped ${source.name}: crawl quota reached. ${QUOTA_MESSAGE}` : `Could not scan ${source.name}: ${String(e).slice(0, 120)}`,
      meta: { sourceId },
    });
    return;
  }

  let markdown = "";
  let raw: RawListing[] = [];
  let extractor = "firecrawl-json";
  try {
    const res = await scrapeJson<{ listings?: RawListing[] }>(source.url, LISTINGS_JSON_SCHEMA, LISTINGS_PROMPT);
    markdown = res.markdown;
    raw = Array.isArray(res.json?.listings) ? res.json!.listings : [];
    if (!res.json) {
      // Firecrawl gave us the page but no JSON: try our own model on the markdown.
      const llm = await llmGuarded(ctx, String(c.ownerId), () =>
        extract(LlmListings, `${LISTINGS_PROMPT}\n\nPAGE (markdown):\n${markdown.slice(0, 12000)}`, { maxTokens: 1500 }),
      );
      if (llm.ok) {
        raw = llm.value.listings;
        extractor = llm.model;
      } else {
        extractor = `none (AI ${llm.reason})`;
      }
    }
  } catch (e) {
    const msg = String(e);
    if (/rate limit/i.test(msg) && attempt < 2) {
      // Firecrawl's per-minute limit: back off and try again shortly.
      await ctx.runMutation(internal.store.setSourceStatus, { sourceId, status: "new", lastError: "Waiting for crawl rate limit" });
      await ctx.scheduler.runAfter(RATE_LIMIT_RETRY_MS * (attempt + 1), internal.crawl.scrapeSource, { sourceId, attempt: attempt + 1 });
      return;
    }
    const unsupported = /do not support this site|not supported/i.test(msg);
    await ctx.runMutation(internal.store.setSourceStatus, {
      sourceId,
      status: unsupported ? "unsupported" : "error",
      lastScrapedAt: Date.now(),
      lastError: unsupported ? "Firecrawl does not support this site" : msg.slice(0, 200),
    });
    await ctx.runMutation(internal.store.logEvent, {
      caseId: c._id,
      kind: "system",
      text: unsupported
        ? `Skipping ${source.name}: this site cannot be crawled.`
        : `Could not scan ${source.name}: ${msg.replace(/^\w*Error:\s*/, "").slice(0, 120)}`,
      meta: { sourceId, url: source.url },
    });
    return;
  }

  // Lift a contact email off the page when discovery did not find one, so the
  // flyer still goes out even when the model is unavailable.
  if (!source.orgEmail) {
    const email = firstEmail(markdown);
    if (email) {
      await ctx.runMutation(internal.store.setSourceEmail, { sourceId, orgEmail: email });
      const r = await ctx.runMutation(internal.store.upsertContact, {
        caseId: c._id,
        orgName: source.name,
        email,
        kind: source.kind,
        sourceUrl: source.url,
      });
      if (r.created) await ctx.scheduler.runAfter(0, internal.outreach.sendFlyers, { caseId: c._id });
    }
  }

  let created = 0;
  const newIds: Id<"listings">[] = [];
  for (const l of raw.slice(0, 40)) {
    if (!l.description || l.description.trim().length < 8) continue;
    const listingUrl = absolute(l.url, source.url) ?? `${source.url}#${slugify(l.description)}`;
    const r = await ctx.runMutation(internal.store.upsertListing, {
      sourceId,
      caseId: c._id,
      listingUrl,
      species: l.species?.toLowerCase(),
      description: l.description.trim().slice(0, 600),
      colors: (l.colors ?? []).map((x) => x.toLowerCase().trim()).filter(Boolean).slice(0, 6),
      locationText: l.location?.trim() || undefined,
      foundAt: l.foundDate?.trim() || undefined,
      imageUrl: absolute(l.imageUrl, source.url),
      rawExcerpt: excerpt(markdown, 1500),
      extracted: { ...l, extractor },
    });
    if (r.created) {
      created++;
      newIds.push(r.listingId);
    }
  }

  await ctx.runMutation(internal.store.setSourceStatus, {
    sourceId,
    status: "ok",
    lastScrapedAt: Date.now(),
    lastHash: djb2(markdown),
    listingCount: raw.length,
    rawExcerpt: excerpt(markdown),
  });
  await ctx.runMutation(internal.store.logEvent, {
    caseId: c._id,
    kind: "scan",
    text: `Scanned ${source.name} — ${raw.length} listing${raw.length === 1 ? "" : "s"}, ${created} new${created ? ", matching now" : ""}.`,
    meta: { sourceId, url: source.url, listings: raw.length, created, extractor },
  });

  // Stagger scoring so a burst of listings does not trip the LLM burst limit.
  for (const [i, listingId] of newIds.entries()) {
    await ctx.scheduler.runAfter(i * 1500, internal.ai.scoreListing, { listingId });
  }
}

export const scrapeSource = internalAction({
  args: { sourceId: v.id("sources"), attempt: v.optional(v.number()) },
  handler: async (ctx, { sourceId, attempt }): Promise<void> => {
    await scrapeOne(ctx, sourceId, attempt ?? 0);
  },
});

/** Cron: re-scrape stale sources of open cases. */
export const sweep = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    if (process.env.APP_PAUSED === "1") return { scheduled: 0 };
    const due: Id<"sources">[] = await ctx.runQuery(internal.store.sourcesDueForSweep, {
      olderThanMs: 25 * 60 * 1000,
      limit: 20,
    });
    // Firecrawl free tier: ~10 requests a minute and 2 concurrent. Stagger.
    for (const [i, sourceId] of due.entries()) {
      await ctx.scheduler.runAfter(i * SCRAPE_STAGGER_MS, internal.crawl.scrapeSource, { sourceId });
    }
    return { scheduled: due.length };
  },
});

/** The "Scan now" button. Owner (or demo case), per-user rate limited. */
export const scanNow = action({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }): Promise<{ ok: boolean; message?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false, message: "Sign in first" };
    const data: { source: Doc<"sources">; case: Doc<"cases"> | null } | null = await ctx.runQuery(internal.store.getSource, { sourceId });
    if (!data?.case) return { ok: false, message: "Source not found" };
    if (!data.case.isDemo && data.case.ownerId !== userId) return { ok: false, message: "Not your case" };
    if (data.case.status !== "open") return { ok: false, message: "Case is closed" };
    try {
      assertNotPaused();
      await rateLimiter.limit(ctx, "userCrawl", { key: userId, throws: true });
    } catch (e) {
      if (isRateLimitError(e)) return { ok: false, message: QUOTA_MESSAGE };
      return { ok: false, message: String(e).replace(/^.*Error: /, "") };
    }
    await scrapeOne(ctx, sourceId);
    return { ok: true };
  },
});
