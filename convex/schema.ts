import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Shared chassis tables (usage, settings, mailMessages, senderRoutes) plus the
 * Beacon product tables (cases, sources, listings, matches, contacts,
 * sightings, events).
 */

export const caseStatus = v.union(v.literal("open"), v.literal("found"), v.literal("closed"));
export const sourceKind = v.union(v.literal("shelter"), v.literal("lostfound"), v.literal("vet"));
export const matchStatus = v.union(v.literal("new"), v.literal("dismissed"), v.literal("confirmed"));
export const emailStatus = v.union(
  v.literal("queued"),
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("bounced"),
  v.literal("replied"),
  v.literal("skipped"),
);

export default defineSchema({
  ...authTables,

  /** Daily per-provider counters so free-tier burn is visible on /admin. */
  usage: defineTable({
    day: v.string(), // YYYY-MM-DD
    provider: v.string(), // firecrawl | agentmail | llm
    count: v.number(),
  }).index("by_day_provider", ["day", "provider"]),

  /** Singleton row: the app's one AgentMail inbox. */
  settings: defineTable({
    key: v.string(), // always "singleton"
    inboxId: v.string(),
    inboxAddress: v.string(),
  }).index("by_key", ["key"]),

  /**
   * Every email in or out. Inbound is routed to a case by, in order:
   * thread id, [CASE-CODE] in the subject, then a registered sender address.
   */
  mailMessages: defineTable({
    direction: v.union(v.literal("in"), v.literal("out")),
    messageId: v.string(),
    threadId: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.array(v.string())),
    subject: v.string(),
    extractedText: v.optional(v.string()),
    fullText: v.optional(v.string()),
    caseCode: v.optional(v.string()),
    /** Product row this message belongs to, once routed. */
    targetId: v.optional(v.string()),
    routed: v.boolean(),
    classification: v.optional(v.string()),
    summary: v.optional(v.string()),
    deliveryStatus: v.optional(v.string()), // sent | delivered | bounced
    at: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_threadId", ["threadId"])
    .index("by_caseCode", ["caseCode"])
    .index("by_target", ["targetId"])
    .index("by_routed", ["routed"]),

  /** Sender address to product row, for "forward your email here" flows. */
  senderRoutes: defineTable({
    email: v.string(),
    targetId: v.string(),
    ownerId: v.optional(v.id("users")),
  }).index("by_email", ["email"]),

  // ---------------------------------------------------------------------
  // Beacon product tables
  // ---------------------------------------------------------------------

  /** A lost-pet report. One owner, one unguessable public slug, one caseCode. */
  cases: defineTable({
    ownerId: v.id("users"),
    slug: v.string(),
    status: caseStatus,
    petName: v.string(),
    species: v.string(), // dog | cat | other
    breed: v.optional(v.string()),
    colors: v.array(v.string()),
    distinguishingMarks: v.string(),
    sizeKg: v.optional(v.number()),
    photoIds: v.array(v.id("_storage")),
    /** Fallback photo for seeded demo cases (served from /public). */
    demoPhotoUrl: v.optional(v.string()),
    lastSeenLat: v.number(),
    lastSeenLng: v.number(),
    lastSeenAddress: v.string(),
    city: v.string(),
    lastSeenAt: v.number(),
    radiusKm: v.number(),
    caseCode: v.string(),
    /** queued | discovering | emailing | scanning | ready | degraded */
    pipelineStatus: v.string(),
    pipelineNote: v.optional(v.string()),
    createdAt: v.number(),
    foundAt: v.optional(v.number()),
    /** Seeded showcase case: visible to every visitor, resettable via seed. */
    isDemo: v.optional(v.boolean()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_demo", ["isDemo"])
    .index("by_slug", ["slug"])
    .index("by_caseCode", ["caseCode"])
    .index("by_status", ["status"]),

  /** A web page Beacon re-scrapes for found-animal listings. */
  sources: defineTable({
    caseId: v.id("cases"),
    url: v.string(),
    kind: sourceKind,
    name: v.string(),
    orgEmail: v.optional(v.string()),
    lastScrapedAt: v.optional(v.number()),
    lastHash: v.optional(v.string()),
    /** new | scanning | ok | error */
    status: v.string(),
    listingCount: v.optional(v.number()),
    lastError: v.optional(v.string()),
    rawExcerpt: v.optional(v.string()),
    discoveredVia: v.optional(v.string()),
  })
    .index("by_case", ["caseId"])
    .index("by_url", ["url"])
    .index("by_case_url", ["caseId", "url"]),

  /** A found-animal listing extracted from a source page. */
  listings: defineTable({
    sourceId: v.id("sources"),
    caseId: v.id("cases"),
    listingUrl: v.string(),
    species: v.optional(v.string()),
    description: v.string(),
    colors: v.array(v.string()),
    locationText: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    foundAt: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    rawExcerpt: v.string(),
    extracted: v.any(),
    fetchedAt: v.number(),
    /** pending | scored | skipped | failed */
    scoreStatus: v.string(),
  })
    .index("by_listingUrl", ["listingUrl"])
    .index("by_source", ["sourceId"])
    .index("by_case", ["caseId"]),

  /** An AI-scored pairing of a case and a listing. */
  matches: defineTable({
    caseId: v.id("cases"),
    listingId: v.id("listings"),
    score: v.number(),
    reasons: v.array(v.string()),
    visionUsed: v.boolean(),
    model: v.string(),
    status: matchStatus,
    createdAt: v.number(),
  })
    .index("by_case_status", ["caseId", "status"])
    .index("by_case", ["caseId"])
    .index("by_listing", ["listingId"]),

  /** A shelter / vet / rescue Beacon emails about the case. */
  contacts: defineTable({
    caseId: v.id("cases"),
    orgName: v.string(),
    email: v.string(),
    kind: sourceKind,
    sourceUrl: v.optional(v.string()),
    emailStatus: emailStatus,
    lastMessageId: v.optional(v.string()),
    threadId: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    note: v.optional(v.string()),
  })
    .index("by_case", ["caseId"])
    .index("by_case_email", ["caseId", "email"])
    .index("by_thread", ["threadId"]),

  /** A reported sighting: from the public flyer form or a classified email. */
  sightings: defineTable({
    caseId: v.id("cases"),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    locationText: v.optional(v.string()),
    note: v.string(),
    photoId: v.optional(v.id("_storage")),
    photoUrl: v.optional(v.string()),
    source: v.union(v.literal("form"), v.literal("email")),
    messageId: v.optional(v.string()),
    reporterName: v.optional(v.string()),
    reportedAt: v.number(),
  }).index("by_case", ["caseId"]),

  /** Small key/value flags, e.g. the LLM circuit breaker ("llmDownUntil"). */
  flags: defineTable({
    key: v.string(),
    value: v.string(),
    at: v.number(),
  }).index("by_key", ["key"]),

  /** The live feed shown in the war room. Every pipeline step writes one. */
  events: defineTable({
    caseId: v.id("cases"),
    /** discover | scan | email | reply | match | sighting | found | system | quota */
    kind: v.string(),
    text: v.string(),
    meta: v.optional(v.any()),
    at: v.number(),
  }).index("by_case", ["caseId"]),

  /** Every Firecrawl result we have ever fetched, kept so a repeat costs nothing
   * and so the app still has data to show once the credit pool is reserved. */
  crawlCache: defineTable({
    key: v.string(),
    payload: v.string(),
    credits: v.number(),
    fetchedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Authoritative Firecrawl balance plus today's spend, in credits. */
  crawlBudget: defineTable({
    key: v.string(),
    remainingCredits: v.number(),
    checkedAt: v.number(),
    day: v.string(),
    spentToday: v.number(),
  }).index("by_key", ["key"]),
});
