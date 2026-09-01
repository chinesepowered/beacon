"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { discover } from "./crawl";
import { sendFlyersFor } from "./outreach";

/**
 * Runs once per new case, scheduled from cases.create:
 *   discover sources (Firecrawl search + LLM pick) → email the contacts
 *   (AgentMail) → schedule the first scrape of every source → mark ready.
 * Each stage logs to the live feed, so the owner watches it happen.
 */
export const kickoff = internalAction({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }): Promise<void> => {
    const c: (Doc<"cases"> & { photoUrls: string[] }) | null = await ctx.runQuery(internal.store.getCase, { caseId });
    if (!c || c.status !== "open") return;

    const set = (status: string, note?: string) =>
      ctx.runMutation(internal.store.setPipeline, { caseId, status, note });

    try {
      await set("discovering");
      await discover(ctx, c);

      await set("emailing");
      await sendFlyersFor(ctx, c);

      await set("scanning");
      const sources: Doc<"sources">[] = await ctx.runQuery(internal.store.caseSources, { caseId });
      // Firecrawl free tier: 2 concurrent requests. Stagger the first scans.
      sources.forEach((s: Doc<"sources">, i: number) => {
        void ctx.scheduler.runAfter(i * 4000, internal.crawl.scrapeSource, { sourceId: s._id });
      });
      if (!sources.length) {
        await ctx.runMutation(internal.store.logEvent, {
          caseId,
          kind: "system",
          text: "No sources to scan yet. The 30-minute sweep will retry discovery on the next run.",
        });
      }
      await set("ready");
    } catch (e) {
      await set("degraded", String(e).slice(0, 200));
      await ctx.runMutation(internal.store.logEvent, {
        caseId,
        kind: "system",
        text: `Pipeline hit a problem: ${String(e).slice(0, 160)}. The next sweep will continue.`,
      });
    }
  },
});
