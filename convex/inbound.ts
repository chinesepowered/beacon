"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { caseCodeFromSubject } from "./lib/mailUtil";
import { classifyReply } from "./ai";
import { geocodeNear } from "./lib/geo";

/**
 * Runs (scheduled, off the webhook path) for every inbound email once it has
 * been stored and routed by mail.ingest. Beacon uses it to classify the reply
 * — sighting / no match / question / auto-reply — summarise it for the feed,
 * geocode a mentioned place, and drop a sighting pin on the owner's map.
 *
 * Node runtime, because the LLM helper uses the OpenAI SDK.
 */
export const onInbound = internalAction({
  args: { mailMessageId: v.id("mailMessages") },
  handler: async (ctx, { mailMessageId }): Promise<void> => {
    const msg = await ctx.runQuery(internal.store.getMailMessage, { id: mailMessageId });
    if (!msg || msg.direction !== "in") return;

    // Resolve the case: by the routed target, else by a [BCN-XXXX] code in the
    // subject (covers a hand-written email to the inbox before any flyer went out).
    const code = msg.caseCode ?? caseCodeFromSubject(msg.subject) ?? undefined;
    const c = await ctx.runQuery(internal.store.resolveCase, { targetId: msg.targetId, caseCode: code });
    if (!c) return; // stays in the unrouted list on /admin
    if (!msg.routed || msg.targetId !== c._id) {
      await ctx.runMutation(internal.store.routeMessage, { id: mailMessageId, caseId: c._id, caseCode: c.caseCode });
    }

    const text = (msg.extractedText || msg.fullText || "").trim();
    const { result, aiUnavailable } = await classifyReply(ctx, {
      ownerKey: String(c.ownerId),
      petName: c.petName,
      species: c.species,
      city: c.city,
      text: text || msg.subject,
    });

    let lat = result.lat;
    let lng = result.lng;
    if (result.classification === "sighting" && (lat === undefined || lng === undefined) && result.locationText) {
      const hit = await geocodeNear(
        result.locationText,
        { lat: c.lastSeenLat, lng: c.lastSeenLng, radiusKm: Math.max(c.radiusKm, 5) * 2 },
        c.city,
      );
      if (hit) {
        lat = hit.lat;
        lng = hit.lng;
      }
    }

    await ctx.runMutation(internal.store.applyClassification, {
      id: mailMessageId,
      caseId: c._id,
      classification: result.classification,
      summary: result.summary || text.slice(0, 200) || msg.subject,
      locationText: result.locationText,
      lat,
      lng,
      aiUnavailable,
    });
  },
});
