import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button, Card, Pill, Skeleton } from "../components/ui";
import { timeAgo } from "../lib/format";

/** Free-tier burn and unrouted mail. Visible to any signed-in user; contains no secrets. */
export function Admin({ navigate }: { navigate: (to: string) => void }) {
  const usage = useQuery(api.usage.today);
  const unrouted = useQuery(api.mail.unrouted);
  const settings = useQuery(api.mail.getSettings);

  const budgets: Record<string, number> = { firecrawl: 150, agentmail: 25, llm: 500 };

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-8">
      <button onClick={() => navigate("/")} className="mb-6 text-sm text-ink-500 hover:text-ink-900">← Back</button>
      <h1 className="font-display text-4xl font-semibold tracking-tight">Usage today</h1>
      <p className="mt-2 text-ink-500">Daily counters per provider, against this deployment's global caps.</p>

      {usage === undefined ? (
        <Skeleton className="mt-6 h-40" />
      ) : usage === null ? (
        <p className="mt-6">Sign in required.</p>
      ) : (
        <Card className="mt-6 p-6">
          {usage.paused && <Pill tone="warn" className="mb-4">Paused — APP_PAUSED=1</Pill>}
          <div className="grid gap-5 sm:grid-cols-3">
            {(["firecrawl", "llm", "agentmail"] as const).map((p) => {
              const n = usage.counts[p] ?? 0;
              const cap = budgets[p];
              return (
                <div key={p}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{p}</p>
                  <p className="font-display text-4xl font-semibold">{n}<span className="text-base text-ink-300"> / {cap}</span></p>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-cream-200">
                    <div className="h-full rounded-full bg-ember-500 transition-all" style={{ width: `${Math.min(100, (n / cap) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-5 text-xs text-ink-300">{usage.day} (UTC) · inbox {settings?.inboxAddress ?? "not created yet"}</p>
        </Card>
      )}

      <h2 className="mt-10 font-display text-2xl font-semibold">Unrouted email</h2>
      <p className="text-sm text-ink-500">Inbound mail that matched no thread, case code or sender route. Never dropped.</p>
      {unrouted === undefined ? (
        <Skeleton className="mt-4 h-20" />
      ) : unrouted.length === 0 ? (
        <Card className="mt-4 p-6 text-sm text-ink-500">Nothing unrouted.</Card>
      ) : (
        <ul className="mt-4 space-y-2">
          {unrouted.map((m) => (
            <li key={m._id}>
              <Card className="p-4 text-sm">
                <p className="font-semibold">{m.subject || "(no subject)"}</p>
                <p className="text-xs text-ink-500">{timeAgo(m.at)}</p>
                <p className="mt-1 line-clamp-3 text-ink-700">{m.extractedText}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" className="mt-8" onClick={() => navigate("/")}>Home</Button>
    </div>
  );
}
