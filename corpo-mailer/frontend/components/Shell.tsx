"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import BrandGlyph from "@/components/BrandGlyph";
import CommandPalette from "@/components/CommandPalette";
import Reveal from "@/components/motion/Reveal";
import { snap, soft } from "@/components/motion/springs";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/hooks";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/leads", label: "Leads" },
  { href: "/companies", label: "Companies" },
  { href: "/discovery", label: "Discovery" },
  { href: "/drafts", label: "Drafts" },
];

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

/** Emails still waiting on a human: drafts to approve plus approved-but-unsent. */
function useReviewCount(pathname: string) {
  const { data } = useQuery(`nav-drafts:${pathname}`, () => api.drafts.list());
  return data ? data.filter((d) => d.status === "draft" || d.status === "approved").length : 0;
}

function NavLinks({ pathname, count, layoutId, className }: { pathname: string; count: number; layoutId: string; className: string }) {
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
            {active && <motion.span layoutId={layoutId} transition={snap} className="absolute inset-0 rounded-full bg-glass-strong" />}
            <span className="relative">{n.label}</span>
            {n.href === "/drafts" && count > 0 && (
              <span className="relative rounded-full bg-white/10 px-1.5 font-mono text-[0.7rem] tabular-nums text-heading">{count}</span>
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
    <div className="min-h-screen">
      <Reveal as="header" delay={150} y={-12} className="sticky top-4 z-20 mx-auto flex max-w-[76rem] items-center justify-between gap-3 px-4">
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
        </div>
      </Reveal>

      <motion.main
        key={pathname}
        initial={{ opacity: 0, y: reduce ? 0 : 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduce ? { duration: 0.15 } : soft}
        className="mx-auto max-w-[76rem] px-5 pb-32 pt-10 md:pb-24"
      >
        {children}
      </motion.main>

      {/* Small screens: the links move to a bar at the bottom. */}
      <NavLinks
        pathname={pathname}
        count={count}
        layoutId="nav-pill-mobile"
        className="fixed inset-x-4 bottom-4 z-20 flex h-14 items-center justify-between gap-1 rounded-full border border-glass-border bg-[rgba(14,13,20,0.8)] p-1 backdrop-blur-[18px] md:hidden"
      />

      <AnimatePresence>{paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}</AnimatePresence>
    </div>
  );
}
