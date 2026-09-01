"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { rateLimiter, isRateLimitError, assertNotPaused, QUOTA_MESSAGE } from "./lib/limits";
import { APP_NAME } from "./lib/app";

/**
 * AgentMail outbound. Every send goes through internal.mailActions.send (which
 * applies the DEMO_RECIPIENT_OVERRIDE redirect, records the message for
 * thread routing and meters usage). Here we add the per-case cap, the global
 * send quota and the flyer rendering.
 */

const MAX_RECIPIENTS = 8;
type CaseWithPhotos = Doc<"cases"> & { photoUrls: string[] };

function siteUrl(): string {
  return (process.env.SITE_URL ?? "").replace(/\/$/, "");
}

function absolutePhoto(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith("/") ? `${siteUrl()}${url}` : url;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

export function flyer(c: CaseWithPhotos, inboxAddress: string | null) {
  const flyerUrl = `${siteUrl()}/p/${c.slug}`;
  const photo = absolutePhoto(c.photoUrls[0]);
  const when = new Date(c.lastSeenAt).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
  const lines = [
    `${c.petName} — lost ${c.species}${c.breed ? ` (${c.breed})` : ""}`,
    `Colours: ${c.colors.join(", ") || "n/a"}`,
    `Marks: ${c.distinguishingMarks || "n/a"}`,
    c.sizeKg ? `Size: about ${c.sizeKg} kg` : "",
    `Last seen: ${c.lastSeenAddress}, ${c.city} — ${when}`,
    ``,
    `Flyer & sighting form: ${flyerUrl}`,
    photo ? `Photo: ${photo}` : "",
    ``,
    `If an animal matching this description comes in or you hear of a sighting, please just reply to this email`,
    `(keep [${c.caseCode}] in the subject) — replies are routed straight to the owner's live case board.`,
    inboxAddress ? `Or write to ${inboxAddress} with [${c.caseCode}] in the subject.` : "",
    ``,
    `Sent by ${APP_NAME}, a lost-pet search assistant, on behalf of the owner.`,
  ].filter((l) => l !== "");
  const text = lines.join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#fbf7f1;font-family:Georgia,'Times New Roman',serif;color:#2b1d12">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #eadfd0">
    <div style="background:#c2410c;color:#fff;padding:18px 24px;font-size:13px;letter-spacing:.12em;text-transform:uppercase">Lost ${esc(c.species)} — please help</div>
    ${photo ? `<img src="${esc(photo)}" alt="${esc(c.petName)}" style="display:block;width:100%;max-height:420px;object-fit:cover">` : ""}
    <div style="padding:24px">
      <h1 style="margin:0 0 6px;font-size:36px;line-height:1.1">${esc(c.petName)}</h1>
      <p style="margin:0 0 18px;color:#7c5a3c;font-size:15px">${esc(c.breed ?? c.species)} · ${esc(c.colors.join(", "))}${c.sizeKg ? ` · ~${c.sizeKg} kg` : ""}</p>
      <table style="font-size:15px;line-height:1.5;border-collapse:collapse">
        <tr><td style="padding:2px 12px 2px 0;color:#7c5a3c;vertical-align:top">Marks</td><td>${esc(c.distinguishingMarks || "n/a")}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#7c5a3c;vertical-align:top">Last seen</td><td>${esc(c.lastSeenAddress)}, ${esc(c.city)}<br><span style="color:#7c5a3c">${esc(when)}</span></td></tr>
      </table>
      <a href="${esc(flyerUrl)}" style="display:inline-block;margin:22px 0 8px;padding:12px 18px;background:#c2410c;color:#fff;text-decoration:none;border-radius:999px;font-family:system-ui,sans-serif;font-weight:600">Open the flyer / report a sighting</a>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#4a3524">If an animal matching this description comes in, or you hear of a sighting, <strong>just reply to this email</strong> (keep <code>[${esc(c.caseCode)}]</code> in the subject). Replies land on the owner's live case board within seconds.</p>
      <p style="margin:18px 0 0;font-size:12px;color:#9a7d63;font-family:system-ui,sans-serif">Sent by ${APP_NAME}, a lost-pet search assistant, on behalf of the owner.</p>
    </div>
  </div></body></html>`;
  return { subject: `Lost ${c.species}: ${c.petName} near ${c.lastSeenAddress}`, text, html };
}

class QuotaError extends Error {}

async function takeSendToken(ctx: ActionCtx) {
  assertNotPaused();
  try {
    await rateLimiter.limit(ctx, "globalSend", { throws: true });
  } catch (e) {
    if (isRateLimitError(e)) throw new QuotaError(QUOTA_MESSAGE);
    throw e;
  }
}

export async function sendFlyersFor(ctx: ActionCtx, c: CaseWithPhotos): Promise<{ sent: number }> {
  let inboxAddress: string | null = null;
  try {
    const s = await ctx.runAction(internal.mailActions.ensureInbox, {});
    inboxAddress = s.inboxAddress;
  } catch {
    inboxAddress = null;
  }

  const queued: Doc<"contacts">[] = await ctx.runQuery(internal.store.contactsForCase, { caseId: c._id, status: "queued" });
  const batch = queued.slice(0, MAX_RECIPIENTS);
  for (const extra of queued.slice(MAX_RECIPIENTS)) {
    await ctx.runMutation(internal.store.setContactStatus, {
      contactId: extra._id,
      emailStatus: "skipped",
      note: `Over the ${MAX_RECIPIENTS}-recipient cap`,
    });
  }
  if (!batch.length) return { sent: 0 };

  const mail = flyer(c, inboxAddress);
  let sent = 0;
  for (const contact of batch) {
    try {
      await takeSendToken(ctx);
    } catch (e) {
      const quota = e instanceof QuotaError;
      await ctx.runMutation(internal.store.setContactStatus, {
        contactId: contact._id,
        emailStatus: "skipped",
        note: quota ? "Daily email quota reached" : String(e).slice(0, 120),
      });
      await ctx.runMutation(internal.store.logEvent, {
        caseId: c._id,
        kind: "quota",
        text: quota ? `Email quota reached before ${contact.orgName}. ${QUOTA_MESSAGE}` : `Emails paused: ${String(e).slice(0, 120)}`,
      });
      if (quota) continue;
      break;
    }
    try {
      const res = await ctx.runAction(internal.mailActions.send, {
        to: contact.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        caseCode: c.caseCode,
        targetId: c._id,
      });
      // Thread id is on the recorded mailMessages row; look it up for routing.
      const rows = await ctx.runQuery(internal.store.getMailMessageByMessageId, { messageId: res.messageId });
      await ctx.runMutation(internal.store.setContactStatus, {
        contactId: contact._id,
        emailStatus: "sent",
        lastMessageId: res.messageId,
        threadId: rows?.threadId,
        note: res.redirected ? "Redirected to the demo inbox (DEMO_RECIPIENT_OVERRIDE)" : undefined,
      });
      sent++;
      await ctx.runMutation(internal.store.logEvent, {
        caseId: c._id,
        kind: "email",
        text: `Emailed ${contact.orgName} the flyer${res.redirected ? " (demo redirect)" : ""}.`,
        meta: { contactId: contact._id, kind: contact.kind, messageId: res.messageId },
      });
    } catch (e) {
      await ctx.runMutation(internal.store.setContactStatus, {
        contactId: contact._id,
        emailStatus: "bounced",
        note: String(e).slice(0, 160),
      });
      await ctx.runMutation(internal.store.logEvent, {
        caseId: c._id,
        kind: "system",
        text: `Could not email ${contact.orgName}: ${String(e).slice(0, 100)}`,
      });
    }
  }
  return { sent };
}

export const sendFlyers = internalAction({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }): Promise<{ sent: number }> => {
    const c: CaseWithPhotos | null = await ctx.runQuery(internal.store.getCase, { caseId });
    if (!c) return { sent: 0 };
    return await sendFlyersFor(ctx, c);
  },
});

/** After "This is them!": tell everyone we emailed that the pet is home. */
export const sendFoundNotice = internalAction({
  args: { caseId: v.id("cases") },
  handler: async (ctx, { caseId }): Promise<void> => {
    const c: CaseWithPhotos | null = await ctx.runQuery(internal.store.getCase, { caseId });
    if (!c) return;
    const all: Doc<"contacts">[] = await ctx.runQuery(internal.store.contactsForCase, { caseId });
    const notified = all.filter((k: Doc<"contacts">) => ["sent", "delivered", "replied"].includes(k.emailStatus));
    let sent = 0;
    for (const contact of notified) {
      try {
        await takeSendToken(ctx);
        await ctx.runAction(internal.mailActions.send, {
          to: contact.email,
          subject: `${c.petName} is home — thank you`,
          text: `Good news: ${c.petName} has been found and is safely home.\n\nThank you for keeping an eye out. You can stop watching for this one.\n\n— ${APP_NAME}, on behalf of the owner`,
          caseCode: c.caseCode,
          targetId: c._id,
        });
        sent++;
      } catch (e) {
        await ctx.runMutation(internal.store.logEvent, {
          caseId,
          kind: e instanceof QuotaError ? "quota" : "system",
          text: `Could not send the thank-you to ${contact.orgName}: ${String(e).slice(0, 100)}`,
        });
        if (e instanceof QuotaError) break;
      }
    }
    await ctx.runMutation(internal.store.logEvent, {
      caseId,
      kind: "found",
      text: sent
        ? `${sent} shelter${sent === 1 ? "" : "s"} and vets notified that ${c.petName} is home.`
        : `No thank-you emails sent (nobody had been emailed yet).`,
      meta: { sent },
    });
  },
});
