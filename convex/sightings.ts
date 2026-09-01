import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { rateLimiter, QUOTA_MESSAGE } from "./lib/limits";

/**
 * Public sighting report from the flyer page. No auth (a finder should never
 * have to sign up), rate-limited per slug so a bot cannot spam one case.
 */
export const reportPublic = mutation({
  args: {
    slug: v.string(),
    note: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    locationText: v.optional(v.string()),
    reporterName: v.optional(v.string()),
    photoId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const c = await ctx.db
      .query("cases")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!c) throw new ConvexError("This flyer is no longer active");

    const { ok } = await rateLimiter.limit(ctx, "publicReport", { key: args.slug });
    if (!ok) throw new ConvexError(QUOTA_MESSAGE);

    const note = args.note.trim().slice(0, 1000);
    if (!note) throw new ConvexError("Tell us what you saw");

    const sightingId = await ctx.db.insert("sightings", {
      caseId: c._id,
      lat: args.lat,
      lng: args.lng,
      locationText: args.locationText?.trim() || undefined,
      note,
      photoId: args.photoId,
      source: "form",
      reporterName: args.reporterName?.trim() || undefined,
      reportedAt: Date.now(),
    });
    await ctx.db.insert("events", {
      caseId: c._id,
      kind: "sighting",
      text: `Sighting reported on the flyer page${args.reporterName ? ` by ${args.reporterName.trim()}` : ""}: ${note.slice(0, 140)}`,
      meta: { sightingId, pinned: args.lat !== undefined, source: "form" },
      at: Date.now(),
    });
    return sightingId;
  },
});

/** Photo upload for a public sighting. Rate-limited per slug like the report. */
export const generatePublicUploadUrl = mutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const c = await ctx.db
      .query("cases")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!c) throw new ConvexError("This flyer is no longer active");
    const { ok } = await rateLimiter.limit(ctx, "publicReport", { key: `${slug}:upload` });
    if (!ok) throw new ConvexError(QUOTA_MESSAGE);
    return await ctx.storage.generateUploadUrl();
  },
});
