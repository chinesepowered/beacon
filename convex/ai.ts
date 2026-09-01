"use node";

import { v } from "convex/values";
import { z } from "zod";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { extract, modelId, visionAvailable } from "./lib/llm";
import { rateLimiter, isRateLimitError, assertNotPaused } from "./lib/limits";
import { haversineKm } from "./lib/geo";

/**
 * Every LLM call in Beacon goes through `llmGuarded`, which
 *   1. refuses while APP_PAUSED,
 *   2. takes a per-user and a global rate-limit token,
 *   3. skips the call entirely while the circuit breaker is open (the hosted
 *      endpoint has been timing out; a 10-minute breaker keeps pipelines
 *      snappy instead of stalling every step for minutes),
 *   4. meters the call in `usage`.
 * Callers always have a deterministic fallback and mark rows "AI unavailable".
 */

const BREAKER_KEY = "llmDownUntil";
const BREAKER_MS = 10 * 60 * 1000;
const CALL_DEADLINE_MS = 45_000;

export type Guarded<T> =
  | { ok: true; value: T; model: string }
  | { ok: false; reason: "paused" | "quota" | "unavailable"; error: string };

export async function llmGuarded<T>(
  ctx: ActionCtx,
  userKey: string,
  fn: () => Promise<T>,
): Promise<Guarded<T>> {
  try {
    assertNotPaused();
  } catch (e) {
    return { ok: false, reason: "paused", error: String(e) };
  }

  const flag = await ctx.runQuery(internal.store.getFlag, { key: BREAKER_KEY });
  if (flag && Number(flag.value) > Date.now()) {
    return { ok: false, reason: "unavailable", error: "LLM circuit breaker open" };
  }

  try {
    await rateLimiter.limit(ctx, "globalLlm", { throws: true });
    await rateLimiter.limit(ctx, "userLlm", { key: userKey, throws: true });
  } catch (e) {
    if (isRateLimitError(e)) return { ok: false, reason: "quota", error: "LLM quota reached" };
    throw e;
  }

  await ctx.runMutation(internal.usage.bump, { provider: "llm" });
  try {
    const value = await withDeadline(fn(), CALL_DEADLINE_MS);
    if (flag) await ctx.runMutation(internal.store.setFlag, { key: BREAKER_KEY, value: "0" });
    return { ok: true, value, model: modelId() };
  } catch (e) {
    await ctx.runMutation(internal.store.setFlag, {
      key: BREAKER_KEY,
      value: String(Date.now() + BREAKER_MS),
    });
    return { ok: false, reason: "unavailable", error: String(e).slice(0, 300) };
  }
}

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`LLM call exceeded ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Smoke test for the configured LLM endpoint: `convex run ai:ping`. */
export const ping = internalAction({
  args: { word: v.optional(v.string()) },
  handler: async (_ctx, { word }) => {
    const t0 = Date.now();
    const out = await extract(
      z.object({ upper: z.string(), length: z.number() }),
      `Return the word "${word ?? "beacon"}" uppercased and its length.`,
      { maxTokens: 100 },
    );
    return { model: modelId(), out, ms: Date.now() - t0 };
  },
});

// ------------------------------------------------------------------ scoring

const ScoreSchema = z.object({
  score: z.number().min(0).max(100),
  reasons: z.array(z.string()).max(3),
});

function norm(s: string | undefined) {
  return (s ?? "").toLowerCase();
}

function speciesOf(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b(dog|puppy|canine|hound|terrier|retriever|beagle|shepherd|lab|poodle|husky|collie|spaniel|bulldog|chihuahua|pit ?bull|mix)\b/.test(t)) return "dog";
  if (/\b(cat|kitten|feline|tabby|siamese|calico|tortoiseshell)\b/.test(t)) return "cat";
  return null;
}

/**
 * Deterministic fallback used when the LLM is unavailable or over quota.
 * Conservative on purpose: it can surface a plausible match, never a silly one.
 */
export function heuristicScore(c: {
  species: string;
  breed?: string;
  colors: string[];
  distinguishingMarks: string;
  lastSeenLat: number;
  lastSeenLng: number;
  radiusKm: number;
}, l: {
  species?: string;
  description: string;
  colors: string[];
  locationText?: string;
  lat?: number;
  lng?: number;
  foundAt?: string;
}): { score: number; reasons: string[] } {
  const text = `${norm(l.species)} ${norm(l.description)} ${l.colors.map(norm).join(" ")} ${norm(l.locationText)}`;
  const reasons: string[] = [];
  let score = 0;

  const ls = norm(l.species) || speciesOf(text) || "";
  if (ls && ls !== norm(c.species)) return { score: 0, reasons: ["Different species"] };
  if (ls) {
    score += 30;
    reasons.push(`Same species: ${ls}`);
  } else score += 10;

  if (c.breed) {
    const b = norm(c.breed).split(/[\s/,-]+/).filter((w) => w.length > 3);
    if (b.some((w) => text.includes(w))) {
      score += 30;
      reasons.push(`Same breed: ${c.breed}`);
    }
  }

  const overlap = c.colors.map(norm).filter((col) => col && text.includes(col));
  if (overlap.length) {
    score += Math.min(20, 8 * overlap.length);
    reasons.push(`Colour match: ${overlap.join(", ")}`);
  }

  const marks = norm(c.distinguishingMarks)
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 5 && !["white", "black", "brown", "small", "large", "collar"].includes(w));
  const hit = marks.filter((w) => text.includes(w));
  if (hit.length) {
    score += Math.min(15, 5 * hit.length);
    reasons.push(`Mentions "${hit[0]}"`);
  }

  if (l.lat !== undefined && l.lng !== undefined) {
    const km = haversineKm(c.lastSeenLat, c.lastSeenLng, l.lat, l.lng);
    if (km <= c.radiusKm) {
      score += 10;
      reasons.push(`Found ${km.toFixed(1)} km from last seen`);
    }
  }

  return { score: Math.min(100, Math.round(score)), reasons: reasons.slice(0, 3) };
}

/**
 * Score one listing against the case its source belongs to. Text scoring via
 * the LLM (vision blended in when LLM_VISION_MODEL is set and both photos
 * exist); heuristic fallback when the model is unavailable. Matches >= 60
 * become rows the owner sees slide in live.
 */
export const scoreListing = internalAction({
  args: { listingId: v.id("listings") },
  handler: async (ctx, { listingId }): Promise<void> => {
    const data = await ctx.runQuery(internal.store.getListing, { listingId });
    if (!data || !data.case || !data.source) return;
    const { listing, case: c, source } = data;
    if (c.status !== "open") {
      await ctx.runMutation(internal.store.setListingScoreStatus, { listingId, scoreStatus: "skipped" });
      return;
    }

    // Strict species gate so the demo never shows a cat matched to a dog.
    const ls = norm(listing.species) || speciesOf(`${listing.description} ${listing.colors.join(" ")}`);
    if (ls && ls !== norm(c.species)) {
      await ctx.runMutation(internal.store.setListingScoreStatus, { listingId, scoreStatus: "skipped" });
      return;
    }

    const prompt = [
      `LOST PET (owner's report):`,
      `- Name: ${c.petName}`,
      `- Species: ${c.species}${c.breed ? `, breed: ${c.breed}` : ""}`,
      `- Colours: ${c.colors.join(", ") || "unknown"}`,
      `- Distinguishing marks: ${c.distinguishingMarks || "none given"}`,
      c.sizeKg ? `- Size: about ${c.sizeKg} kg` : "",
      `- Last seen: ${c.lastSeenAddress} (${c.city}) on ${new Date(c.lastSeenAt).toUTCString()}`,
      ``,
      `FOUND LISTING (from ${source.name}, ${source.url}):`,
      `- Species: ${listing.species ?? "not stated"}`,
      `- Description: ${listing.description}`,
      `- Colours: ${listing.colors.join(", ") || "not stated"}`,
      `- Location: ${listing.locationText ?? "not stated"}`,
      `- Found on: ${listing.foundAt ?? "not stated"}`,
      ``,
      `How likely is it that this listing is the lost pet? Give a 0-100 score and up to 3 short reasons`,
      `(like "same breed", "found 2 km away, 1 day later", "white chest patch mentioned").`,
      `Be strict: different species or clearly different breed => score under 20.`,
    ]
      .filter(Boolean)
      .join("\n");

    const images =
      visionAvailable() && c.photoUrls[0] && listing.imageUrl
        ? [{ url: c.photoUrls[0] }, { url: listing.imageUrl }]
        : undefined;

    const res = await llmGuarded(ctx, String(c.ownerId), () =>
      extract(ScoreSchema, prompt, {
        system: "You match lost-pet reports to found-animal listings for a shelter volunteer. Be calibrated and concise.",
        maxTokens: 400,
        images,
      }),
    );

    let score: number;
    let reasons: string[];
    let model: string;
    let visionUsed = false;
    if (res.ok) {
      score = Math.round(res.value.score);
      reasons = res.value.reasons;
      model = res.model;
      visionUsed = Boolean(images);
    } else {
      const h = heuristicScore(c, listing);
      score = h.score;
      reasons = h.reasons;
      model = `heuristic (AI ${res.reason})`;
    }

    await ctx.runMutation(internal.store.setListingScoreStatus, { listingId, scoreStatus: "scored" });

    if (score >= 60) {
      const { created } = await ctx.runMutation(internal.store.insertMatch, {
        caseId: c._id,
        listingId,
        score,
        reasons,
        visionUsed,
        model,
      });
      if (created) {
        await ctx.runMutation(internal.store.logEvent, {
          caseId: c._id,
          kind: "match",
          text: `Possible match at ${source.name}: ${score}% — ${reasons.join("; ") || "see details"}`,
          meta: { listingId, score, model, aiUnavailable: !res.ok },
        });
      }
    }
  },
});

// ------------------------------------------------------------------ inbound classification

export const ReplySchema = z.object({
  classification: z.enum(["sighting", "no_match", "question", "auto_reply", "other"]),
  summary: z.string().max(240),
  locationText: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});
export type ReplyClassification = z.infer<typeof ReplySchema>;

/** Keyword fallback for reply classification when the model is unavailable. */
export function heuristicClassify(text: string): ReplyClassification {
  const t = text.toLowerCase();
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith(">")) ?? text;
  const summary = firstLine.slice(0, 200);
  if (/out of (the )?office|auto-?reply|automatic reply|do not reply/.test(t)) {
    return { classification: "auto_reply", summary };
  }
  if (/\b(no match|haven'?t seen|have not seen|not seen|nothing (yet|matching)|no (dog|cat|animal)s? matching|sorry,? (no|we))\b/.test(t)) {
    return { classification: "no_match", summary };
  }
  // Shelters phrase a hold a dozen ways ("surrendered to us", "turned in",
  // "we may have your dog"), so keep this vocabulary wide. The no_match branch
  // above runs first, so "we have not seen him" never lands here.
  const SIGHTING =
    /\b(saw|seen|spotted|sighting|found|picked up|running loose|wandering|stray|intake)\b|\b(brought|turned|handed|dropped|taken)\s+(in|into|to|over)\b|\bsurrendered\b|\bcame in\b|\bin our (care|custody|shelter|kennels?)\b|\b(we|they|i)\s+(may\s+|might\s+|possibly\s+|think\s+we\s+|believe\s+we\s+)?have\b/;
  if (SIGHTING.test(t)) {
    return { classification: "sighting", summary, locationText: guessPlace(text) };
  }
  if (t.includes("?")) return { classification: "question", summary };
  return { classification: "other", summary };
}

const TIME_WORDS =
  /\b(this|last|yesterday|today|tonight|morning|afternoon|evening|night|around|about|at)\s+(morning|afternoon|evening|night|\d{1,2}(:\d{2})?\s*(am|pm)?)\b|\b(yesterday|today|tonight|this morning|last night|earlier)\b/gi;

/** Best-effort place phrase out of free text: "near Victoria Park" -> "Victoria Park". */
export function guessPlace(text: string): string | undefined {
  const cleaned = text.replace(TIME_WORDS, " ").replace(/\s+/g, " ");
  const strong = cleaned.match(/\b(?:near|at|around|by|outside|beside|close to)\s+(?:the\s+)?([A-Z][\w'.-]*(?:\s+(?:[A-Z][\w'.-]*|and|of|the|&))*)/);
  if (strong?.[1]) return strong[1].trim();
  const weak = cleaned.match(/\b(?:on|in|along)\s+(?:the\s+)?([A-Z][\w'.-]*(?:\s+(?:[A-Z][\w'.-]*|and|of|the|&))*)/);
  if (weak?.[1]) return weak[1].trim();
  const lower = cleaned.match(/\b(?:near|at|around|by|along)\s+(?:the\s+)?([a-z][\w' -]{3,40}?)(?:[.,;!?\n]|$)/i);
  return lower?.[1]?.trim();
}

export async function classifyReply(
  ctx: ActionCtx,
  args: { ownerKey: string; petName: string; species: string; city: string; text: string },
): Promise<{ result: ReplyClassification; aiUnavailable: boolean; model?: string }> {
  const prompt = [
    `A shelter, vet or member of the public replied to a lost-pet email about ${args.petName}, a ${args.species} lost in ${args.city}.`,
    `Classify the reply and summarise it in one sentence for the owner.`,
    `If it reports seeing or holding an animal, classification = "sighting" and extract the place mentioned as locationText.`,
    `Only fill lat/lng if the place is a well-known named landmark or address whose coordinates you know with confidence; otherwise omit them.`,
    ``,
    `REPLY:`,
    args.text.slice(0, 4000),
  ].join("\n");

  const res = await llmGuarded(ctx, args.ownerKey, () =>
    extract(ReplySchema, prompt, {
      system: "You triage replies for a lost-pet search. Be literal; never invent a sighting.",
      maxTokens: 300,
    }),
  );
  if (res.ok) return { result: res.value, aiUnavailable: false, model: res.model };
  return { result: heuristicClassify(args.text), aiUnavailable: true };
}
