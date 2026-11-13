"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import BrandGlyph from "@/components/BrandGlyph";
import CommandPalette from "@/components/CommandPalette";
import Reveal from "@/components/motion/Reveal";
import SiteFooter from "@/components/SiteFooter";
import { snap, soft } from "@/components/motion/springs";
import { api } from "@/lib/api";
import { app, useApp } from "@/lib/engine/app";
import { useQuery } from "@/lib/hooks";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/companies", label: "Companies" },
  { href: "/drafts", label: "Drafts" },
];

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

/** Emails still waiting on a human: drafts to approve plus approved-but-unsent. */
function useReviewCount(pathname: string) {
  const { data } = useQuery(`nav-drafts:${pathname}`, () => api.drafts.list());
  return data
    ? data.filter((d) => d.status === "draft" || d.status === "approved").length
    : 0;
}

function NavLinks({
  pathname,
  count,
  layoutId,
  className,
}: {
  pathname: string;
  count: number;
  layoutId: string;
  className: string;
}) {
  return (
    <nav aria-label="Main" className={className}>
      {NAV.map((n) => {
        const active = isActive(pathname, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex h-full min-w-0 items-center gap-1 rounded-full px-4 text-[0.9rem] transition-colors duration-150 max-md:flex-1 max-md:justify-center max-md:px-1 max-md:text-[0.78rem] ${
              active ? "text-heading" : "text-body hover:text-heading"
            }`}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                transition={snap}
                className="absolute inset-0 rounded-full bg-glass-strong"
              />
            )}
            <span className="relative">{n.label}</span>
            {n.href === "/drafts" && count > 0 && (
              <span className="relative rounded-full bg-white/10 px-1.5 font-mono text-[0.7rem] tabular-nums text-heading">
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  const count = useReviewCount(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const s = useApp();
  const email = s.email;
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Reveal
        as="header"
        delay={150}
        y={-12}
        className="sticky top-4 z-20 mx-auto flex max-w-[76rem] items-center justify-between gap-3 px-4"
      >
        <Link
          href="/"
          className="flex h-12 items-center gap-2.5 rounded-full border border-glass-border bg-glass px-4 text-[1.02rem] font-medium tracking-[-0.01em] backdrop-blur-[14px]"
        >
          <BrandGlyph className="h-5 w-5" />
          <span className="max-sm:hidden">Corpo Mailer</span>
        </Link>

        <NavLinks
          pathname={pathname}
          count={count}
          layoutId="nav-pill"
          className="hidden h-12 items-center gap-1 rounded-full border border-glass-border bg-glass p-1 backdrop-blur-[14px] backdrop-saturate-[1.4] md:flex"
        />

        <div className="flex h-12 items-center gap-1 rounded-full border border-glass-border bg-glass p-1 backdrop-blur-[14px]">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search and jump (Command K)"
            className="flex h-full items-center rounded-full px-3 font-mono text-[0.72rem] text-faint transition-colors hover:text-heading max-md:hidden"
          >
            ⌘K
          </button>
          <Link
            href="/settings"
            aria-current={pathname.startsWith("/settings") ? "page" : undefined}
            className={`flex h-full items-center rounded-full px-3 text-[0.82rem] transition-colors hover:bg-glass hover:text-heading ${
              pathname.startsWith("/settings")
                ? "bg-glass-strong text-heading"
                : "text-body"
            }`}
          >
            Settings
          </Link>
          <button
            type="button"
            onClick={() => void app().signOut()}
            title={email ? `Signed in as ${email}` : undefined}
            aria-label={email ? `Sign out (signed in as ${email})` : "Sign out"}
            className="flex h-full items-center rounded-full px-3 text-[0.82rem] text-body transition-colors hover:bg-glass hover:text-heading"
          >
            Sign out
          </button>
        </div>
      </Reveal>

      {(s.needs_reauth || s.save.state === "error") && (
        <div
          role="status"
          className="mx-auto mt-4 flex max-w-[76rem] flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100"
        >
          <span>
            {s.needs_reauth
              ? "Your Google sign-in expired, so changes aren't being saved. Press Continue to renew it. Nothing is lost."
              : `Your latest changes haven't reached Google Drive yet (${s.save.error ?? "no connection"}). They're kept in this browser and will be retried.`}
            {renewError && (
              <span className="ml-2 text-danger">{renewError}</span>
            )}
          </span>
          {s.needs_reauth && (
            <button
              type="button"
              disabled={renewing}
              onClick={async () => {
                setRenewing(true);
                setRenewError(null);
                try {
                  await app().renew();
                } catch (e) {
                  setRenewError(
                    e instanceof Error ? e.message : "Couldn't renew",
                  );
                } finally {
                  setRenewing(false);
                }
              }}
              className="rounded-full bg-action px-4 py-1.5 text-sm font-medium text-action-fg disabled:opacity-60"
            >
              {renewing ? "Waiting for Google…" : "Continue"}
            </button>
          )}
        </div>
      )}

      <motion.main
        key={pathname}
        initial={{ opacity: 0, y: reduce ? 0 : 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduce ? { duration: 0.15 } : soft}
        className="mx-auto w-full max-w-[76rem] flex-1 px-5 pb-8 pt-10"
      >
        {children}
      </motion.main>

      <SiteFooter className="max-md:pb-24" />

      {/* Small screens: the links move to a bar at the bottom. */}
      <NavLinks
        pathname={pathname}
        count={count}
        layoutId="nav-pill-mobile"
        className="fixed inset-x-4 bottom-4 z-20 flex h-14 items-center justify-between gap-1 rounded-full border border-glass-border bg-[rgba(14,13,20,0.8)] p-1 backdrop-blur-[18px] md:hidden"
      />

      <AnimatePresence>
        {paletteOpen && (
          <CommandPalette onClose={() => setPaletteOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
