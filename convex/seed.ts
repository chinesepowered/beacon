import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Demo fixtures: one showcase case ("Milo", a beagle lost at Victoria Park,
 * Kitchener) with real shelter pages as sources, a few extracted listings, two
 * AI-style matches, a sighting and a live-feed history, so the app looks alive
 * on first load and the on-camera demo never waits on a slow crawl.
 *
 *   pnpm exec convex run seed:run            (dev)
 *   pnpm exec convex run seed:run --prod     (production)
 *
 * Re-running resets the demo case to this exact state (safe to run any time).
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

export const run = internalMutation({
  args: { ownerId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    // Wipe any previous demo case so the seed is idempotent.
    const previous = await ctx.db
      .query("cases")
      .withIndex("by_demo", (q) => q.eq("isDemo", true))
      .collect();
    for (const c of previous) await wipeCase(ctx, c._id);

    let ownerId: Id<"users"> | undefined = args.ownerId;
    if (!ownerId) {
      const existing = await ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("name"), "Beacon demo owner"))
        .first();
      ownerId = existing?._id ?? (await ctx.db.insert("users", { name: "Beacon demo owner", isAnonymous: true }));
    }

    const now = Date.now();
    const created = now - 2 * HOUR;
    const caseId = await ctx.db.insert("cases", {
      ownerId,
      slug: "milo-victoria-park",
      status: "open",
      petName: "Milo",
      species: "dog",
      breed: "Beagle",
      colors: ["tricolour", "white", "brown", "black"],
      distinguishingMarks: "White chest patch, brown ears, small notch in left ear, red collar with a bone tag",
      sizeKg: 11,
      photoIds: [],
      demoPhotoUrl: "/demo/milo.jpg",
      lastSeenLat: 43.4471,
      lastSeenLng: -80.4967,
      lastSeenAddress: "Victoria Park, near the clock tower",
      city: "Kitchener, Ontario",
      lastSeenAt: now - 14 * HOUR,
      radiusKm: 8,
      caseCode: "BCN-MILO",
      pipelineStatus: "ready",
      createdAt: created,
      isDemo: true,
    });

    // Sources: real public shelter / lost-and-found pages in the region.
    const kw = await ctx.db.insert("sources", {
      caseId,
      url: "https://kwsphumane.ca/found-pets",
      kind: "shelter",
      name: "Humane Society of Kitchener Waterloo & Stratford Perth",
      orgEmail: "info@kwsphumane.ca",
      lastScrapedAt: now - 35 * MIN,
      status: "ok",
      listingCount: 3,
      discoveredVia: "Kitchener, Ontario animal shelter found animals stray intake",
      rawExcerpt:
        "# Found Pets\n\nAnimals brought to our Kitchener and Stratford centres as strays are listed here for 3 days before becoming available for adoption. If you recognise your pet, call 519-745-5615 or visit with proof of ownership.\n\n- Beagle, male, tricolour — found Sept 1, Victoria Park area, Kitchener\n- Domestic short-hair cat, grey tabby — found Aug 31, Fairway Rd\n- Golden retriever mix, female — found Aug 30, Stratford",
    });
    const guelph = await ctx.db.insert("sources", {
      caseId,
      url: "https://guelphhumane.ca/services/lost-found/",
      kind: "shelter",
      name: "Guelph Humane Society",
      orgEmail: "info@guelphhumane.ca",
      lastScrapedAt: now - 33 * MIN,
      status: "ok",
      listingCount: 1,
      discoveredVia: "Kitchener, Ontario animal shelter found animals stray intake",
      rawExcerpt:
        "# Lost & Found\n\nIf you have found a stray animal in Guelph or Wellington County please bring it to the shelter or call animal services. Current stray intakes:\n\n- Beagle mix, tricolour, no collar — found Aug 31 at Waterloo Park",
    });
    const petfbi = await ctx.db.insert("sources", {
      caseId,
      url: "https://petfbi.org/",
      kind: "lostfound",
      name: "Pet FBI lost & found database",
      lastScrapedAt: now - 31 * MIN,
      status: "ok",
      listingCount: 0,
      discoveredVia: "Kitchener, Ontario lost and found pets",
      rawExcerpt:
        "# Pet FBI\n\nFree lost and found pet database. Search found pets by location and species.",
    });
    // Listings extracted from those pages.
    const l1 = await ctx.db.insert("listings", {
      sourceId: kw,
      caseId,
      listingUrl: "https://kwsphumane.ca/found-pets#beagle-male-tricolour-victoria-park",
      species: "dog",
      description: "Beagle, male, tricolour. Friendly, wearing a red collar with no tag. Brought in as a stray from the Victoria Park area.",
      colors: ["tricolour", "white", "brown", "black"],
      locationText: "Victoria Park area, Kitchener",
      lat: 43.4512,
      lng: -80.5031,
      foundAt: "Sept 1, morning",
      imageUrl: "/demo/listing-1.jpg",
      rawExcerpt: "- Beagle, male, tricolour — found Sept 1, Victoria Park area, Kitchener",
      extracted: { extractor: "firecrawl-json" },
      fetchedAt: now - 35 * MIN,
      scoreStatus: "scored",
    });
    const l2 = await ctx.db.insert("listings", {
      sourceId: guelph,
      caseId,
      listingUrl: "https://guelphhumane.ca/services/lost-found/#beagle-mix-waterloo-park",
      species: "dog",
      description: "Beagle mix, tricolour, no collar. Shy but food-motivated. Found near Waterloo Park.",
      colors: ["tricolour", "white", "tan"],
      locationText: "Waterloo Park, Waterloo",
      lat: 43.4667,
      lng: -80.5312,
      foundAt: "Aug 31",
      imageUrl: "/demo/listing-2.jpg",
      rawExcerpt: "- Beagle mix, tricolour, no collar — found Aug 31 at Waterloo Park",
      extracted: { extractor: "firecrawl-json" },
      fetchedAt: now - 33 * MIN,
      scoreStatus: "scored",
    });
    await ctx.db.insert("listings", {
      sourceId: kw,
      caseId,
      listingUrl: "https://kwsphumane.ca/found-pets#golden-retriever-mix-stratford",
      species: "dog",
      description: "Golden retriever mix, female, cream coloured. Found in Stratford.",
      colors: ["cream", "golden"],
      locationText: "Stratford",
      foundAt: "Aug 30",
      imageUrl: "/demo/listing-3.jpg",
      rawExcerpt: "- Golden retriever mix, female — found Aug 30, Stratford",
      extracted: { extractor: "firecrawl-json" },
      fetchedAt: now - 35 * MIN,
      scoreStatus: "scored",
    });
    await ctx.db.insert("listings", {
      sourceId: kw,
      caseId,
      listingUrl: "https://kwsphumane.ca/found-pets#grey-tabby-fairway",
      species: "cat",
      description: "Domestic short-hair cat, grey tabby. Found on Fairway Rd.",
      colors: ["grey"],
      locationText: "Fairway Rd, Kitchener",
      foundAt: "Aug 31",
      rawExcerpt: "- Domestic short-hair cat, grey tabby — found Aug 31, Fairway Rd",
      extracted: { extractor: "firecrawl-json" },
      fetchedAt: now - 35 * MIN,
      scoreStatus: "skipped",
    });

    // Matches the owner sees first.
    await ctx.db.insert("matches", {
      caseId,
      listingId: l1,
      score: 87,
      reasons: ["Same breed: beagle, male, tricolour", "Found 0.8 km from last seen, next morning", "Red collar matches"],
      visionUsed: false,
      model: "demo-fixture",
      status: "new",
      createdAt: now - 34 * MIN,
    });
    await ctx.db.insert("matches", {
      caseId,
      listingId: l2,
      score: 64,
      reasons: ["Beagle mix, tricolour", "Found 3.6 km away, the day before", "No collar (Milo wore a red collar)"],
      visionUsed: false,
      model: "demo-fixture",
      status: "new",
      createdAt: now - 32 * MIN,
    });

    // Contacts the flyer went to.
    const contacts: { orgName: string; email: string; kind: "shelter" | "lostfound" | "vet"; sourceUrl?: string; status: "sent" | "delivered" | "replied" }[] = [
      { orgName: "Humane Society of Kitchener Waterloo & Stratford Perth", email: "info@kwsphumane.ca", kind: "shelter", sourceUrl: "https://kwsphumane.ca/found-pets", status: "replied" },
      { orgName: "Guelph Humane Society", email: "info@guelphhumane.ca", kind: "shelter", sourceUrl: "https://guelphhumane.ca/services/lost-found/", status: "delivered" },
      { orgName: "Victoria Park Animal Hospital", email: "frontdesk@vpah.example", kind: "vet", status: "sent" },
      { orgName: "Belmont Village Veterinary Clinic", email: "hello@belmontvet.example", kind: "vet", status: "sent" },
      { orgName: "Waterloo Region Animal Services", email: "animalservices@region.example", kind: "shelter", status: "delivered" },
    ];
    for (const k of contacts) {
      await ctx.db.insert("contacts", {
        caseId,
        orgName: k.orgName,
        email: k.email,
        kind: k.kind,
        sourceUrl: k.sourceUrl,
        emailStatus: k.status,
        sentAt: created + 6 * MIN,
        note: "Seeded demo — no email was actually sent",
      });
    }

    // The outbound flyer record, so a hand-written reply with [BCN-MILO] routes here.
    await ctx.db.insert("mailMessages", {
      direction: "out",
      messageId: `seed-flyer-${caseId}`,
      to: ["info@kwsphumane.ca"],
      subject: "[BCN-MILO] Lost dog: Milo near Victoria Park, near the clock tower",
      fullText:
        "Milo — lost dog (Beagle)\nColours: tricolour, white, brown, black\nMarks: white chest patch, brown ears, small notch in left ear, red collar\nLast seen: Victoria Park, near the clock tower, Kitchener\n\nIf an animal matching this description comes in, just reply to this email.",
      caseCode: "BCN-MILO",
      targetId: caseId,
      routed: true,
      deliveryStatus: "delivered",
      at: created + 6 * MIN,
    });
    await ctx.db.insert("mailMessages", {
      direction: "in",
      messageId: `seed-reply-${caseId}`,
      from: "Front desk <info@kwsphumane.ca>",
      subject: "Re: [BCN-MILO] Lost dog: Milo near Victoria Park, near the clock tower",
      extractedText:
        "Hi — a male beagle wearing a red collar was brought in this morning from the Victoria Park area by a jogger. He is at our Kitchener centre. Can you come by with proof of ownership?",
      caseCode: "BCN-MILO",
      targetId: caseId,
      routed: true,
      classification: "sighting",
      summary: "A male beagle in a red collar was brought to the Kitchener centre this morning from Victoria Park.",
      at: now - 20 * MIN,
    });

    // Sightings on the map.
    await ctx.db.insert("sightings", {
      caseId,
      lat: 43.4498,
      lng: -80.4934,
      locationText: "Jubilee Dr, Victoria Park",
      note: "Saw a beagle trotting along Jubilee Drive by the lake around 7am, heading north. Had a red collar.",
      source: "form",
      reporterName: "Priya (dog walker)",
      reportedAt: now - 55 * MIN,
    });
    await ctx.db.insert("sightings", {
      caseId,
      lat: 43.4512,
      lng: -80.5031,
      locationText: "KW Humane Society, Kitchener centre",
      note: "A male beagle in a red collar was brought to the Kitchener centre this morning from Victoria Park.",
      source: "email",
      messageId: `seed-reply-${caseId}`,
      reporterName: "Humane Society of Kitchener Waterloo & Stratford Perth",
      reportedAt: now - 20 * MIN,
    });

    // Live feed history.
    const feed: [number, string, string, unknown?][] = [
      [created, "system", "Case opened for Milo. Searching within 8 km of Victoria Park, near the clock tower."],
      [created + 2 * MIN, "discover", "Found 3 shelters and lost-and-found pages near Kitchener, Ontario, 2 with a contact email.", { sources: [{ name: "Humane Society of Kitchener Waterloo & Stratford Perth", url: "https://kwsphumane.ca/found-pets", kind: "shelter" }, { name: "Guelph Humane Society", url: "https://guelphhumane.ca/services/lost-found/", kind: "shelter" }, { name: "Pet FBI lost & found database", url: "https://petfbi.org/", kind: "lostfound" }] }],
      [created + 6 * MIN, "email", "Emailed Humane Society of Kitchener Waterloo & Stratford Perth the flyer."],
      [created + 6 * MIN + 5000, "email", "Emailed Guelph Humane Society the flyer."],
      [created + 6 * MIN + 9000, "email", "Emailed Victoria Park Animal Hospital the flyer."],
      [created + 6 * MIN + 13000, "email", "Emailed Belmont Village Veterinary Clinic the flyer."],
      [created + 6 * MIN + 17000, "email", "Emailed Waterloo Region Animal Services the flyer."],
      [created + 9 * MIN, "scan", "Scanned Pet FBI lost & found database — 0 listings, 0 new.", { url: "https://petfbi.org/", listings: 0, created: 0 }],
      [now - 55 * MIN, "sighting", "Sighting reported on the flyer page by Priya (dog walker): Saw a beagle trotting along Jubilee Drive by the lake around 7am, heading north.", { pinned: true, source: "form" }],
      [now - 35 * MIN, "scan", "Scanned Humane Society of Kitchener Waterloo & Stratford Perth — 3 listings, 3 new, matching now.", { url: "https://kwsphumane.ca/found-pets", listings: 3, created: 3, extractor: "firecrawl-json" }],
      [now - 34 * MIN, "match", "Possible match at Humane Society of Kitchener Waterloo & Stratford Perth: 87% — Same breed: beagle, male, tricolour; Found 0.8 km from last seen, next morning; Red collar matches", { score: 87 }],
      [now - 33 * MIN, "scan", "Scanned Guelph Humane Society — 1 listing, 1 new, matching now.", { url: "https://guelphhumane.ca/services/lost-found/", listings: 1, created: 1, extractor: "firecrawl-json" }],
      [now - 32 * MIN, "match", "Possible match at Guelph Humane Society: 64% — Beagle mix, tricolour; Found 3.6 km away, the day before; No collar (Milo wore a red collar)", { score: 64 }],
      [now - 20 * MIN, "sighting", "Sighting from Humane Society of Kitchener Waterloo & Stratford Perth: A male beagle in a red collar was brought to the Kitchener centre this morning from Victoria Park.", { classification: "sighting", pinned: true }],
    ];
    for (const [at, kind, text, meta] of feed) {
      await ctx.db.insert("events", { caseId, kind, text, meta, at });
    }

    void petfbi;
    return { caseId, slug: "milo-victoria-park", caseCode: "BCN-MILO" };
  },
});

async function wipeCase(ctx: { db: any }, caseId: Id<"cases">) {
  for (const table of ["sources", "listings", "matches", "contacts", "sightings", "events"] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_case", (q: any) => q.eq("caseId", caseId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  }
  const mail = await ctx.db
    .query("mailMessages")
    .withIndex("by_target", (q: any) => q.eq("targetId", caseId))
    .collect();
  for (const m of mail) await ctx.db.delete(m._id);
  await ctx.db.delete(caseId);
}
