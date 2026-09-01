import { Component, type ButtonHTMLAttributes, type ReactNode } from "react";

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
};

export function Button({ variant = "primary", size = "md", className = "", ...rest }: BtnProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500/60";
  const sizes = { sm: "h-8 px-3 text-xs", md: "h-10 px-4 text-sm", lg: "h-13 px-6 text-base" }[size];
  const variants = {
    primary: "bg-ember-600 text-white shadow-[0_6px_20px_-6px_rgba(194,65,12,.6)] hover:bg-ember-700",
    secondary: "bg-white text-ink-900 ring-1 ring-cream-300 hover:bg-cream-100",
    ghost: "text-ink-700 hover:bg-cream-100",
    danger: "bg-white text-ember-700 ring-1 ring-ember-200 hover:bg-ember-50",
    success: "bg-moss-500 text-white hover:bg-moss-700",
  }[variant];
  return <button className={`${base} ${sizes} ${variants} ${className}`} {...rest} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl bg-white ring-1 ring-cream-200 shadow-[0_1px_2px_rgba(28,20,16,.04),0_12px_32px_-20px_rgba(28,20,16,.25)] ${className}`}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint, action }: { children: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-xl font-semibold tracking-tight">{children}</h2>
        {hint && <p className="text-xs text-ink-500">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Pill({ children, tone = "neutral", className = "" }: { children: ReactNode; tone?: "neutral" | "ember" | "moss" | "sky" | "ink" | "warn"; className?: string }) {
  const tones = {
    neutral: "bg-cream-100 text-ink-700 ring-cream-200",
    ember: "bg-ember-100 text-ember-700 ring-ember-200",
    moss: "bg-moss-100 text-moss-700 ring-moss-500/20",
    sky: "bg-sky-100 text-sky-600 ring-sky-600/20",
    ink: "bg-ink-900 text-cream-50 ring-ink-900",
    warn: "bg-amber-50 text-amber-700 ring-amber-200",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${tones} ${className}`}>
      {children}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function Empty({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-cream-300 bg-cream-50/60 px-6 py-10 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-white text-2xl ring-1 ring-cream-200">{icon}</div>
      <p className="font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Animated score ring, 0-100. */
export function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 80 ? "#4d7c0f" : pct >= 60 ? "#ea580c" : "#b39a83";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#eadfd0" strokeWidth={7} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={c - (c * pct) / 100}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="font-display text-lg font-bold leading-none" style={{ color }}>
          {Math.round(pct)}
          <span className="text-[10px] font-semibold">%</span>
        </span>
      </div>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl bg-white px-3.5 py-2.5 text-sm ring-1 ring-cream-300 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-ember-500/60";

export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="relative grid size-8 place-items-center rounded-xl bg-ember-600 text-white shadow-[0_6px_16px_-6px_rgba(194,65,12,.8)]">
        <span className="absolute size-8 rounded-xl bg-ember-500/40 animate-ring" />
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor">
          <circle cx="12" cy="9" r="3.4" />
          <path d="M12 13.5c-3.6 0-6 1.8-6 4v1.5h12V17.5c0-2.2-2.4-4-6-4z" />
        </svg>
      </span>
      <span className="font-display text-xl font-bold tracking-tight">Beacon</span>
    </span>
  );
}
