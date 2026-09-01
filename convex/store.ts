import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { sourceKind, emailStatus } from "./schema";

/**
 * Internal reads/writes used by the Node-runtime pipeline actions
 * (pipeline.ts, crawl.ts, ai.ts, outreach.ts, inbound.ts). Default runtime,
 * so nothing here may import an SDK.
 */

export async function photoUrlsFor(ctx: QueryCtx, c: Doc<"cases">): Promise<string[]> {
  const urls: string[] = [];
  for (const id of c.photoIds) {
    const u = await ctx.storage.getUrl(id);
    if (u) urls.push(u);
  }
  if (!urls.length && c.demoPhotoUrl) urls.push(c.demoPhotoUrl);
  return urls;
}

// ---------------------------------------------------------------- cases

export const getCase = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) => {
    const c = await ctx.db.get(caseId);
    if (!c) return null;
    return { ...c, photoUrls: await photoUrlsFor(ctx, c) };
  },
});

/** Resolve a mailMessages.targetId (string) or a caseCode to a case. */
export const resolveCase = internalQuery({
  args: { targetId: v.optional(v.string()), caseCode: v.optional(v.string()) },
  handler: async (ctx, { targetId, caseCode }) => {
    let c: Doc<"cases"> | null = null;
    if (targetId) {
      const id = ctx.db.normalizeId("cases", targetId);
      if (id) c = await ctx.db.get(id);
    }
    if (!c && caseCode) {
      c = await ctx.db
        .query("cases")
        .withIndex("by_caseCode", (q) => q.eq("caseCode", caseCode))
        .unique();
    }
    if (!c) return null;
    return { ...c, photoUrls: await photoUrlsFor(ctx, c) };
  },
});

export const setPipeline = internalMutation({
  args: { caseId: v.id("cases"), status: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, { caseId, status, note }) => {
    await ctx.db.patch(caseId, { pipelineStatus: status, pipelineNote: note });
  },
});

export const logEvent = internalMutation({
  args: { caseId: v.id("cases"), kind: v.string(), text: v.string(), meta: v.optional(v.any()) },
  handler: async (ctx, args) => {
    await ctx.db.insert("events", { ...args, at: Date.now() });
  },
});

// ---------------------------------------------------------------- flags (LLM circuit breaker)

export const getFlag = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) =>
    await ctx.db
      .query("flags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique(),
});

export const setFlag = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, { key, value }) => {
    const row = await ctx.db
      .query("flags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row) await ctx.db.patch(row._id, { value, at: Date.now() });
    else await ctx.db.insert("flags", { key, value, at: Date.now() });
  },
});

// ---------------------------------------------------------------- sources + contacts

export const upsertSource = internalMutation({
  args: {
    caseId: v.id("cases"),
    url: v.string(),
    kind: sourceKind,
    name: v.string(),
    orgEmail: v.optional(v.string()),
    discoveredVia: v.optional(v.string()),
    rawExcerpt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sources")
      .withIndex("by_case_url", (q) => q.eq("caseId", args.caseId).eq("url", args.url))
      .unique();
    if (existing) return { sourceId: existing._id, created: false };
    const sourceId = await ctx.db.insert("sources", { ...args, status: "new" });
    return { sourceId, created: true };
  },
});

export const upsertContact = internalMutation({
  args: {
    caseId: v.id("cases"),
    orgName: v.string(),
    email: v.string(),
    kind: sourceKind,
    sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.toLowerCase().trim();
    const existing = await ctx.db
      .query("contacts")
      .withIndex("by_case_email", (q) => q.eq("caseId", args.caseId).eq("email", email))
      .unique();
    if (existing) return { contactId: existing._id, created: false };
    const contactId = await ctx.db.insert("contacts", {
      ...args,
      email,
      emailStatus: "queued",
    });
    return { contactId, created: true };
  },
});

export const getSource = internalQuery({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const s = await ctx.db.get(sourceId);
    if (!s) return null;
    const c = await ctx.db.get(s.caseId);
    return { source: s, case: c };
  },
});

export const caseSources = internalQuery({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }) =>
    await ctx.db
      .query("sources")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect(),
});

export const setSourceStatus = internalMutation({
  args: {
    sourceId: v.id("sources"),
    status: v.string(),
    lastScrapedAt: v.optional(v.number()),
    lastHash: v.optional(v.string()),
    listingCount: v.optional(v.number()),
    lastError: v.optional(v.string()),
    rawExcerpt: v.optional(v.string()),
  },
  handler: async (ctx, { sourceId, ...rest }) => {
    const patch: Record<string, unknown> = { status: rest.status };
    for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
    if (rest.status === "ok") patch.lastError = undefined;
    await ctx.db.patch(sourceId, patch);
  },
});

export const setSourceEmail = internalMutation({
  args: { sourceId: v.id("sources"), orgEmail: v.string() },
  handler: async (ctx, { sourceId, orgEmail }) => {
    await ctx.db.patch(sourceId, { orgEmail });
  },
});

/** Sources belonging to open cases that have not been scraped recently. */
export const sourcesDueForSweep = internalQuery({
  args: { olderThanMs: v.number(), limit: v.number() },
  handler: async (ctx, { olderThanMs, limit }) => {
    const open = await ctx.db
      .query("cases")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .collect();
    const cutoff = Date.now() - olderThanMs;
    const due: Id<"sources">[] = [];
    for (const c of open) {
      const sources = await ctx.db
        .query("sources")
        .withIndex("by_case", (q) => q.eq("caseId", c._id))
        .collect();
      for (const s of sources) {
        if (s.status === "scanning" || s.status === "unsupported") continue;
        if ((s.lastScrapedAt ?? 0) < cutoff) due.push(s._id);
        if (due.length >= limit) return due;
      }
    }
    return due;
  },
});

export const contactsForCase = internalQuery({
  args: { caseId: v.id("cases"), status: v.optional(emailStatus) },
  handler: async (ctx, { caseId, status }) => {
    const all = await ctx.db
      .query("contacts")
      .withIndex("by_case", (q) => q.eq("caseId", caseId))
      .collect();
    return status ? all.filter((c) => c.emailStatus === status) : all;
  },
});

export const setContactStatus = internalMutation({
  args: {
    contactId: v.id("contacts"),
    emailStatus,
    lastMessageId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { contactId, ...rest }) => {
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) if (val !== undefined) patch[k] = val;
    if (rest.emailStatus === "sent") patch.sentAt = Date.now();
    await ctx.db.patch(contactId, patch);
  },
});

// ---------------------------------------------------------------- listings + matches

export const upsertListing = internalMutation({
  args: {
    sourceId: v.id("sources"),
    caseId: v.id("cases"),
    listingUrl: v.string(),
    species: v.optional(v.string()),
    description: v.string(),
    colors: v.array(v.string()),
    locationText: v.optional(v.string()),
    foundAt: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    rawExcerpt: v.string(),
    extracted: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("listings")
      .withIndex("by_listingUrl", (q) => q.eq("listingUrl", args.listingUrl))
      .filter((q) => q.eq(q.field("caseId"), args.caseId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { fetchedAt: Date.now() });
      return { listingId: existing._id, created: false };
    }
    const listingId = await ctx.db.insert("listings", {
      ...args,
      fetchedAt: Date.now(),
      scoreStatus: "pending",
    });
    return { listingId, created: true };
  },
});

export const getListing = internalQuery({
  args: { listingId: v.id("listings") },
  handler: async (ctx, { listingId }) => {
    const l = await ctx.db.get(listingId);
    if (!l) return null;
    const s = await ctx.db.get(l.sourceId);
    const c = await ctx.db.get(l.caseId);
    return {
      listing: l,
      source: s,
      case: c ? { ...c, photoUrls: await photoUrlsFor(ctx, c) } : null,
    };
  },
});

export const setListingScoreStatus = internalMutation({
  args: { listingId: v.id("listings"), scoreStatus: v.string() },
  handler: async (ctx, { listingId, scoreStatus }) => {
    await ctx.db.patch(listingId, { scoreStatus });
  },
});

export const insertMatch = internalMutation({
  args: {
    caseId: v.id("cases"),
    listingId: v.id("listings"),
    score: v.number(),
    reasons: v.array(v.string()),
    visionUsed: v.boolean(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const dupe = await ctx.db
      .query("matches")
      .withIndex("by_listing", (q) => q.eq("listingId", args.listingId))
      .filter((q) => q.eq(q.field("caseId"), args.caseId))
      .first();
    if (dupe) {
      await ctx.db.patch(dupe._id, {
        score: args.score,
        reasons: args.reasons,
        visionUsed: args.visionUsed,
        model: args.model,
      });
      return { matchId: dupe._id, created: false };
    }
    const matchId = await ctx.db.insert("matches", { ...args, status: "new", createdAt: Date.now() });
    return { matchId, created: true };
  },
});

// ---------------------------------------------------------------- inbound mail

export const getMailMessage = internalQuery({
  args: { id: v.id("mailMessages") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});

export const getMailMessageByMessageId = internalQuery({
  args: { messageId: v.string() },
  handler: async (ctx, { messageId }) =>
    await ctx.db
      .query("mailMessages")
      .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
      .unique(),
});

/** Late routing: attach an unrouted message to a case found by its caseCode. */
export const routeMessage = internalMutation({
  args: { id: v.id("mailMessages"), caseId: v.id("cases"), caseCode: v.string() },
  handler: async (ctx, { id, caseId, caseCode }) => {
    await ctx.db.patch(id, { targetId: caseId, caseCode, routed: true });
  },
});

/**
 * Apply a classification to an inbound message: patch the message, flip the
 * contact that replied to "replied", log a feed event and, for sightings,
 * insert a sighting row (which becomes a map pin in the war room).
 */
export const applyClassification = internalMutation({
  args: {
    id: v.id("mailMessages"),
    caseId: v.id("cases"),
    classification: v.string(),
    summary: v.string(),
    locationText: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    orgName: v.optional(v.string()),
    aiUnavailable: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.id);
    if (!msg) return;
    await ctx.db.patch(args.id, { classification: args.classification, summary: args.summary });

    // Who replied? Match the thread first, then the sender address.
    let who = args.orgName;
    const contacts = await ctx.db
      .query("contacts")
      .withIndex("by_case", (q) => q.eq("caseId", args.caseId))
      .collect();
    const sender = (msg.from ?? "").toLowerCase();
    const contact =
      contacts.find((c) => c.threadId && c.threadId === msg.threadId) ??
      contacts.find((c) => sender.includes(c.email));
    if (contact) {
      await ctx.db.patch(contact._id, { emailStatus: "replied" });
      who = who ?? contact.orgName;
    }
    who = who ?? (msg.from?.replace(/<.*>/, "").trim() || "a finder");

    if (args.classification === "sighting") {
      await ctx.db.insert("sightings", {
        caseId: args.caseId,
        lat: args.lat,
        lng: args.lng,
        locationText: args.locationText,
        note: args.summary,
        source: "email",
        messageId: msg.messageId,
        reporterName: who,
        reportedAt: Date.now(),
      });
    }

    const label: Record<string, string> = {
      sighting: "Sighting",
      no_match: "No match yet",
      question: "Question",
      auto_reply: "Auto-reply",
      other: "Reply",
    };
    await ctx.db.insert("events", {
      caseId: args.caseId,
      kind: args.classification === "sighting" ? "sighting" : "reply",
      text: `${label[args.classification] ?? "Reply"} from ${who}: ${args.summary}`,
      meta: {
        mailMessageId: args.id,
        classification: args.classification,
        aiUnavailable: args.aiUnavailable ?? false,
        locationText: args.locationText,
        pinned: args.lat !== undefined,
      },
      at: Date.now(),
    });
  },
});
