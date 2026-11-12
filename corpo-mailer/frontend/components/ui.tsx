"use client";

import {
  useRef,
  type ComponentPropsWithRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import WordReveal from "@/components/motion/WordReveal";
import { CHANNEL_LABEL, STATUS_COLOR, STATUS_LABEL } from "@/lib/format";
import { CHANNELS, STATUSES, type Channel, type Status } from "@/lib/types";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

/**
 * A surface. `panel` (default) is for anything dense: tables, forms, long text.
 * `glass` is for chrome and small cards floating over the background.
 * Both get a soft highlight that follows the pointer.
 */
export function Card({
  glass,
  className,
  onPointerMove,
  ...p
}: { glass?: boolean } & HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onPointerMove={(e) => {
        const el = ref.current;
        if (el) {
          const r = el.getBoundingClientRect();
          el.style.setProperty("--mx", `${e.clientX - r.left}px`);
          el.style.setProperty("--my", `${e.clientY - r.top}px`);
        }
        onPointerMove?.(e);
      }}
      className={cx(
        "relative rounded-[1.25rem] border p-4",
        glass
          ? "border-glass-border bg-glass backdrop-blur-[14px] backdrop-saturate-[1.4]"
          : "border-hairline bg-panel backdrop-blur-[22px]",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:opacity-0 before:transition-opacity before:duration-300 hover:before:opacity-100",
        "before:[background:radial-gradient(14rem_circle_at_var(--mx,50%)_var(--my,50%),rgba(255,255,255,0.08),transparent_60%)]",
        className,
      )}
      {...p}
    />
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  accent,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  accent?: string[];
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <WordReveal
          as="h1"
          text={title}
          accent={accent}
          className="text-[2.4rem] font-medium leading-[1.1] tracking-[-0.02em] text-heading"
        />
        {subtitle && <p className="mt-2 text-[0.95rem] text-body">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[0.72rem] font-medium uppercase tracking-[0.08em] text-body/80">{children}</h2>
      {right}
    </div>
  );
}

type BtnProps = ComponentPropsWithRef<"button"> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "ember";
  small?: boolean;
};
export function Button({ variant = "secondary", small, className, ...p }: BtnProps) {
  const styles = {
    primary: "bg-action text-action-fg hover:bg-action/85",
    secondary: "border border-glass-border bg-glass text-heading backdrop-blur-xl hover:bg-glass-strong",
    danger: "border border-danger/40 text-danger hover:bg-danger/10",
    ghost: "text-body hover:bg-glass hover:text-heading",
    // Reserved for one thing in the whole app: sending an email.
    ember: "bg-[image:var(--ember)] font-semibold text-white hover:brightness-110",
  }[variant];
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-full font-medium transition-[background,transform,filter] duration-150",
        "active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heading/70",
        "disabled:pointer-events-none disabled:opacity-45",
        small ? "h-8 px-3 text-xs" : "h-10 px-[1.125rem] text-[0.9rem]",
        styles,
        className,
      )}
      {...p}
    />
  );
}

const fieldCls =
  "w-full rounded-xl border border-hairline bg-white/[0.04] px-3.5 text-[0.92rem] text-heading outline-none transition-[border-color,box-shadow] duration-150 focus:border-white/30 focus:shadow-[0_0_0_4px_rgba(255,107,94,0.14)] disabled:opacity-60";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-body">{label}</span>
      {children}
    </label>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={cx(fieldCls, "h-11", p.className)} />
);
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={cx(fieldCls, "min-h-24 resize-y py-2.5", p.className)} />
);
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={cx(fieldCls, "h-11 [&>option]:bg-[#14121c]", p.className)} />
);

/** Status chip: the same colour means the same status everywhere (yellow/green/red as in the sheet). */
export function StatusBadge({ status }: { status: Status }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.72rem] font-medium"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A status you can change in place. It is a real <select>, so it works with keyboard and screen readers. */
export function StatusSelect({
  value,
  onChange,
  disabled,
  label,
}: {
  value: Status;
  onChange: (status: Status) => void;
  disabled?: boolean;
  label: string;
}) {
  const color = STATUS_COLOR[value];
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Status)}
      className="h-7 cursor-pointer appearance-none rounded-full border-0 px-3 text-[0.75rem] font-medium outline-none transition-[filter] hover:brightness-125 focus-visible:ring-2 focus-visible:ring-heading/70 disabled:cursor-not-allowed disabled:opacity-60"
      style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      {STATUSES.map((st) => (
        <option key={st} value={st} className="bg-[#14121c] text-heading">
          {STATUS_LABEL[st]}
        </option>
      ))}
    </select>
  );
}

/** Read-only channel pills. */
export function ChannelPills({ channels }: { channels: Channel[] }) {
  if (channels.length === 0) return <span className="text-faint">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {channels.map((c) => (
        <span key={c} className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[0.7rem] text-body">
          {CHANNEL_LABEL[c]}
        </span>
      ))}
    </span>
  );
}

/** Multi-select for how someone was reached. Each channel is a toggle button. */
export function ChannelPicker({
  value,
  onChange,
  disabled,
  small,
}: {
  value: Channel[];
  onChange: (channels: Channel[]) => void;
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <div role="group" aria-label="Channels used" className={cx("flex gap-1.5", small ? "flex-nowrap gap-1" : "flex-wrap")}>
      {CHANNELS.map((c) => {
        const on = value.includes(c);
        return (
          <button
            key={c}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== c) : [...value, c])}
            className={cx(
              "rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heading/70 disabled:opacity-50",
              small ? "whitespace-nowrap px-2 py-0.5 text-[0.68rem]" : "px-3 py-1 text-[0.8rem]",
              on
                ? "border-transparent bg-heading/90 font-medium text-action-fg"
                : "border-glass-border bg-glass text-body hover:bg-glass-strong hover:text-heading",
            )}
          >
            {CHANNEL_LABEL[c]}
          </button>
        );
      })}
    </div>
  );
}

export function Pill({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "amber" | "green" | "rose" | "indigo";
  children: ReactNode;
}) {
  const t = {
    muted: "bg-white/[0.07] text-body",
    amber: "bg-amber-400/15 text-amber-300",
    green: "bg-ok/15 text-ok",
    rose: "bg-danger/15 text-danger",
    indigo: "bg-[var(--st-in_discussion)]/15 text-[var(--st-in_discussion)]",
  }[tone];
  return (
    <span className={cx("inline-block rounded-full px-2 py-0.5 text-xs font-medium", t)}>{children}</span>
  );
}

export function ErrorNote({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

/** Skeleton blocks in the shape of the content that is about to arrive. */
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4">
      <div className="skeleton h-9 w-56" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-28 !rounded-[1.25rem]" />
        ))}
      </div>
      <div className="skeleton h-56 !rounded-[1.25rem]" />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[1.25rem] border border-dashed border-hairline py-8 text-center text-sm text-faint">
      {children}
    </p>
  );
}
