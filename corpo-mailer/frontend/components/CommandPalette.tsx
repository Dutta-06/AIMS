"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { contactLabel } from "@/lib/format";
import type { Company, Contact } from "@/lib/types";
import { snap } from "./motion/springs";

const PAGES = [
  { label: "Dashboard", href: "/" },
  { label: "Leads", href: "/leads" },
  { label: "Import leads", href: "/leads/import" },
  { label: "Companies", href: "/companies" },
  { label: "Discovery", href: "/discovery" },
  { label: "Drafts", href: "/drafts" },
];

type Item =
  | { kind: "page"; key: string; label: string; href: string }
  | { kind: "lead"; key: string; label: string; sub: string; href: string }
  | { kind: "company"; key: string; label: string; href: string };

/**
 * ⌘K: jump to a page, a lead or a company. It only navigates; there is deliberately no
 * command here that approves or sends anything.
 */
export default function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [leads, setLeads] = useState<Contact[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  // Debounced company search. Results are only read when there is a query.
  useEffect(() => {
    if (!q.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api.companies
        .list(q.trim())
        .then((rows) => !cancelled && setCompanies(rows.slice(0, 4)))
        .catch(() => !cancelled && setCompanies([]));
      api.contacts
        .list({ q: q.trim() })
        .then((rows) => !cancelled && setLeads(rows.slice(0, 5)))
        .catch(() => !cancelled && setLeads([]));
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const pages: Item[] = PAGES.filter((p) => p.label.toLowerCase().includes(needle)).map((p) => ({
      kind: "page",
      key: `page:${p.href}`,
      label: p.label,
      href: p.href,
    }));
    const found: Item[] = needle
      ? [
          ...leads.map((c): Item => ({ kind: "lead", key: `lead:${c.id}`, label: contactLabel(c), sub: c.company_name, href: `/leads/${c.id}` })),
          ...companies.map((c): Item => ({ kind: "company", key: `co:${c.id}`, label: c.name, href: `/companies/${c.id}` })),
        ]
      : [];
    return [...pages, ...found];
  }, [q, companies, leads]);

  const clamped = Math.min(active, Math.max(items.length - 1, 0));

  function open(item: Item | undefined) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (clamped + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(items.length, 1);
      setActive(next);
      listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(items[clamped]);
    } else if (e.key === "Tab") e.preventDefault(); // one focusable control: keep focus inside
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(7,7,12,0.6)] px-4 pt-[15vh] backdrop-blur-[6px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Search and jump"
        initial={{ opacity: 0, y: -8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -8, scale: 0.98 }}
        transition={snap}
        className="w-[36rem] max-w-full overflow-hidden rounded-[1.25rem] border border-glass-border bg-[rgba(14,13,20,0.85)] shadow-2xl backdrop-blur-2xl"
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
            if (!e.target.value.trim()) {
              setCompanies([]);
              setLeads([]);
            }
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[clamped] ? `palette-${items[clamped].key}` : undefined}
          placeholder="Search companies, or jump to…"
          className="h-14 w-full border-b border-hairline bg-transparent px-5 text-[1.02rem] text-heading outline-none"
        />
        <ul id="palette-list" role="listbox" ref={listRef} className="max-h-[18rem] overflow-y-auto p-2" data-lenis-prevent>
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-faint">
              {q.trim() ? "No match" : "Type to search"}
            </li>
          )}
          {items.map((it, i) => (
            <li
              key={it.key}
              id={`palette-${it.key}`}
              role="option"
              aria-selected={i === clamped}
              onMouseEnter={() => setActive(i)}
              onClick={() => open(it)}
              className={`flex cursor-pointer items-center justify-between rounded-xl px-3 py-2.5 text-sm ${
                i === clamped ? "bg-glass-strong text-heading" : "text-body"
              }`}
            >
              <span>
                {it.label}
                {it.kind === "lead" && <span className="ml-2 text-xs text-faint">{it.sub}</span>}
              </span>
              <span className="text-xs text-faint">{it.kind === "page" ? "Go to" : it.kind === "lead" ? "Lead" : "Company"}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-4 border-t border-hairline px-4 py-2 text-[0.7rem] text-faint">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
