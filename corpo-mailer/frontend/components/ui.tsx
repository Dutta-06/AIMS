import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/format";
import type { Stage } from "@/lib/types";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ className, ...p }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-border bg-card p-4", className)} {...p} />;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {right}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  small?: boolean;
};
export function Button({ variant = "secondary", small, className, ...p }: BtnProps) {
  const styles = {
    primary: "bg-accent text-accent-foreground hover:opacity-90",
    secondary: "border border-border bg-card hover:bg-foreground/5",
    danger: "border border-rose-500/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400",
    ghost: "text-muted hover:bg-foreground/5 hover:text-foreground",
  }[variant];
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        small ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        styles,
        className,
      )}
      {...p}
    />
  );
}

const fieldCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={cx(fieldCls, p.className)} />
);
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={cx(fieldCls, "min-h-24 resize-y", p.className)} />
);
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(fieldCls, p.className)} />
);

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span
      className={cx("inline-block rounded-full px-2.5 py-0.5 text-xs font-medium", STAGE_TONE[stage])}
    >
      {STAGE_LABEL[stage]}
    </span>
  );
}

export function Pill({ tone = "muted", children }: { tone?: "muted" | "amber" | "green" | "rose" | "indigo"; children: ReactNode }) {
  const t = {
    muted: "bg-foreground/10 text-muted",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
    indigo: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  }[tone];
  return <span className={cx("inline-block rounded-full px-2 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

export function ErrorNote({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
      {message}
    </p>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="py-10 text-center text-sm text-muted">{label}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border py-8 text-center text-sm text-muted">{children}</p>;
}

export function DealLink({ id, children }: { id: number; children: ReactNode }) {
  return (
    <Link href={`/deals/${id}`} className="font-medium hover:text-accent hover:underline">
      {children}
    </Link>
  );
}
