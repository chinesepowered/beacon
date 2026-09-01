import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { accessibleCase } from "./cases";

/**
 * "This is them!" / "Not them". Confirming a match flips the case to Found and
 * schedules the thank-you email to every contact.
 */
export const setStatus = mutation({
  args: { matchId: v.id("matches"), status: v.union(v.literal("confirmed"), v.literal("dismissed")) },
  handler: async (ctx, { matchId, status }) => {
    const m = await ctx.db.get(matchId);
    if (!m) throw new ConvexError("Match not found");
    const c = await accessibleCase(ctx, m.caseId);
    if (!c) throw new ConvexError("Case not found");

    await ctx.db.patch(matchId, { status });
    const listing = await ctx.db.get(m.listingId);
    const source = listing ? await ctx.db.get(listing.sourceId) : null;

    if (status === "dismissed") {
      await ctx.db.insert("events", {
        caseId: c._id,
        kind: "match",
        text: `Dismissed a ${m.score}% match from ${source?.name ?? "a source"} — not ${c.petName}.`,
        meta: { matchId, dismissed: true },
        at: Date.now(),
      });
      return;
    }

    await ctx.db.insert("events", {
      caseId: c._id,
      kind: "found",
      text: `Confirmed: the ${m.score}% match at ${source?.name ?? "a source"} is ${c.petName}!`,
      meta: { matchId, confirmed: true },
      at: Date.now(),
    });
    if (c.status !== "found") {
      await ctx.db.patch(c._id, { status: "found", foundAt: Date.now() });
      await ctx.db.insert("events", {
        caseId: c._id,
        kind: "found",
        text: `${c.petName} is home. Letting every shelter and vet know.`,
        at: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.outreach.sendFoundNotice, { caseId: c._id });
    }
  },
});
