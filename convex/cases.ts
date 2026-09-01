import { ConvexError, v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { newCaseCode } from "./lib/mailUtil";
import { CASE_PREFIX } from "./lib/app";
import { rateLimiter, QUOTA_MESSAGE } from "./lib/limits";
import { photoUrlsFor } from "./store";

/**
 * Owner-facing case API. Every read checks the caller owns the case (or that
 * the case is the shared demo case), so anonymous users never see each other's
 * data. The public flyer page uses `publicBySlug`, which exposes pet info and
 * sightings only.
 */

function newSlug(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 10; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/** Load a case the caller may see: their own, or the shared demo case. */
export async function accessibleCase(
  ctx: QueryCtx | MutationCtx,
  caseId: Id<"cases">,
): Promise<Doc<"cases"> | null> {
  const c = await ctx.db.get(caseId);
  if (!c) return null;
  if (c.isDemo) return c;
  const userId = await getAuthUserId(ctx);
  if (!userId || c.ownerId !== userId) return null;
  return c;
}

async function requireCase(ctx: QueryCtx | MutationCtx, caseId: Id<"cases">) {
  const c = await accessibleCase(ctx, caseId);
  if (!c) throw new ConvexError("Case not found");
  return c;
}

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    petName: v.string(),
    species: v.string(),
    breed: v.optional(v.string()),
    colors: v.array(v.string()),
    distinguishingMarks: v.string(),
    sizeKg: v.optional(v.number()),
    photoIds: v.array(v.id("_storage")),
    lastSeenLat: v.number(),
    lastSeenLng: v.number(),
    lastSeenAddress: v.string(),
    city: v.string(),
    lastSeenAt: v.number(),
    radiusKm: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError("Sign in first");

    const { ok } = await rateLimiter.limit(ctx, "createCase", { key: userId });
    if (!ok) throw new ConvexError(QUOTA_MESSAGE);

    // Unique caseCode: 32^4 space, retry on the rare collision.
    let caseCode = newCaseCode(CASE_PREFIX);
    for (let i = 0; i < 5; i++) {
      const clash = await ctx.db
        .query("cases")
        .withIndex("by_caseCode", (q) => q.eq("caseCode", caseCode))
        .unique();
      if (!clash) break;
      caseCode = newCaseCode(CASE_PREFIX);
    }

    const caseId = await ctx.db.insert("cases", {
      ownerId: userId,
      slug: newSlug(),
      status: "open",
      petName: args.petName.trim(),
      species: args.species,
      breed: args.breed?.trim() || undefined,
      colors: args.colors.map((c) => c.trim()).filter(Boolean),
      distinguishingMarks: args.distinguishingMarks.trim(),
      sizeKg: args.sizeKg,
      photoIds: args.photoIds,
      lastSeenLat: args.lastSeenLat,
      lastSeenLng: args.lastSeenLng,
      lastSeenAddress: args.lastSeenAddress.trim(),
      city: args.city.trim(),
      lastSeenAt: args.lastSeenAt,
      radiusKm: Math.min(50, Math.max(1, args.radiusKm)),
      caseCode,
      pipelineStatus: "queued",
      createdAt: Date.now(),
    });

    await ctx.db.insert("events", {
      caseId,
      kind: "system",
      text: `Case opened for ${args.petName.trim()}. Searching within ${args.radiusKm} km of ${args.lastSeenAddress.trim()}.`,
      at: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.pipeline.kickoff, { caseId });
    const c = await ctx.db.get(caseId);
    return { caseId, slug: c!.slug, caseCode };
  },
});

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const mine = await ctx.db
      .query("cases")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .order("desc")
      .collect();
    const demo = await ctx.db
      .query("cases")
      .withIndex("by_demo", (q) => q.eq("isDemo", true))
      .collect();
    const seen = new Set(mine.map((c) => c._id));
    const all = [...mine, ...demo.filter((d) => !seen.has(d._id))];
    const out = [];
    for (const c of all) {
      const matches = await ctx.db
        .query("matches")
        .withIndex("by_case_status", (q) => q.eq("caseId", c._id).eq("status", "new"))
        .collect();
      out.push({ ...c, photoUrls: await photoUrlsFor(ctx, c), newMatches: matches.length });
    }
    return out;
  },
});

export const get = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await accessibleCase(ctx, caseId);
    if (!c) return null;
    const userId = await getAuthUserId(ctx);
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    return {
      ...c,
      photoUrls: await photoUrlsFor(ctx, c),
      isOwner: userId === c.ownerId,
      inboxAddress: settings?.inboxAddress ?? null,
    };
  },
});

export const feed = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    await requireCase(ctx, caseId);
    return await ctx.db
      .query("events")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .order("desc")
      .take(100);
  },
});

export const sources = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    await requireCase(ctx, caseId);
    return await ctx.db
      .query("sources")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect();
  },
});

export const listings = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    await requireCase(ctx, caseId);
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .order("desc")
      .take(200);
    const out = [];
    for (const l of rows) {
      const s = await ctx.db.get(l.sourceId);
      out.push({ ...l, sourceName: s?.name ?? "Unknown source", sourceUrl: s?.url });
    }
    return out;
  },
});

export const matches = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    await requireCase(ctx, caseId);
    const rows = await ctx.db
      .query("matches")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect();
    const out = [];
    for (const m of rows) {
      const l = await ctx.db.get(m.listingId);
      if (!l) continue;
      const s = await ctx.db.get(l.sourceId);
      out.push({
        ...m,
        listing: { ...l, sourceName: s?.name ?? "Unknown source", sourceUrl: s?.url },
      });
    }
    return out.sort((a, b) => b.score - a.score);
  },
});

export const contacts = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    await requireCase(ctx, caseId);
    return await ctx.db
      .query("contacts")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect();
  },
});

export const sightings = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    await requireCase(ctx, caseId);
    const rows = await ctx.db
      .query("sightings")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .order("desc")
      .collect();
    const out = [];
    for (const s of rows) {
      const photoUrl = s.photoId ? await ctx.storage.getUrl(s.photoId) : s.photoUrl;
      out.push({ ...s, photoUrl: photoUrl ?? undefined });
    }
    return out;
  },
});

/** Email thread for the case: flyers out, replies in. Addresses are redacted. */
export const messages = query({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    await requireCase(ctx, caseId);
    const rows = await ctx.db
      .query("mailMessages")
      .withIndex("by_target", (q) => q.eq("targetId", caseId))
      .order("desc")
      .take(50);
    return rows.map((m) => ({
      _id: m._id,
      direction: m.direction,
      subject: m.subject,
      text: (m.extractedText || m.fullText || "").slice(0, 2000),
      to: m.to?.map(redact),
      from: m.from ? redact(m.from) : undefined,
      classification: m.classification,
      summary: m.summary,
      deliveryStatus: m.deliveryStatus,
      at: m.at,
    }));
  },
});

function redact(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  const bare = (m ? m[1] : addr).trim();
  const at = bare.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${bare.slice(0, Math.min(2, at))}***${bare.slice(at)}`;
}

export const markFound = mutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await requireCase(ctx, caseId);
    if (c.status === "found") return;
    await ctx.db.patch(caseId, { status: "found", foundAt: Date.now() });
    await ctx.db.insert("events", {
      caseId,
      kind: "found",
      text: `${c.petName} is home. Letting every shelter and vet know.`,
      at: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.outreach.sendFoundNotice, { caseId });
  },
});

export const reopen = mutation({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await requireCase(ctx, caseId);
    if (c.status === "open") return;
    await ctx.db.patch(caseId, { status: "open", foundAt: undefined });
    await ctx.db.insert("events", {
      caseId,
      kind: "system",
      text: `Case reopened. Scans and matching resume on the next sweep.`,
      at: Date.now(),
    });
  },
});

/** Public flyer data: pet info + sightings + the case inbox. No auth. */
export const publicBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const c = await ctx.db
      .query("cases")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!c) return null;
    const settings = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    const sightings = await ctx.db
      .query("sightings")
      .withIndex("by_case", (q) => q.eq("caseId", c._id))
      .order("desc")
      .take(20);
    return {
      caseId: c._id,
      petName: c.petName,
      species: c.species,
      breed: c.breed,
      colors: c.colors,
      distinguishingMarks: c.distinguishingMarks,
      sizeKg: c.sizeKg,
      status: c.status,
      lastSeenAddress: c.lastSeenAddress,
      lastSeenLat: c.lastSeenLat,
      lastSeenLng: c.lastSeenLng,
      lastSeenAt: c.lastSeenAt,
      radiusKm: c.radiusKm,
      caseCode: c.caseCode,
      inboxAddress: settings?.inboxAddress ?? null,
      photoUrls: await photoUrlsFor(ctx, c),
      sightings: sightings.map((s) => ({
        _id: s._id,
        lat: s.lat,
        lng: s.lng,
        locationText: s.locationText,
        note: s.note,
        reportedAt: s.reportedAt,
        source: s.source,
      })),
    };
  },
});
