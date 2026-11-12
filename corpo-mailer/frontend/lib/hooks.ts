"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/lib/engine/app";

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

type QueryState<T> = { key: string; data?: T; error?: string };

/**
 * Load data for `key`. Change the key (e.g. include an id) to refetch; call `reload()` after a
 * mutation. While reloading, the previous data stays visible.
 */
export function useQuery<T>(key: string, fn: () => Promise<T>) {
  const [state, setState] = useState<QueryState<T>>({ key: "" });
  const [tick, setTick] = useState(0);
  // The data lives in this browser, so anything that changes it (a background reply check, another
  // part of the page) refreshes what's shown without being asked.
  const { data_version: version } = useApp();
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let cancelled = false;
    fnRef
      .current()
      .then((data) => !cancelled && setState({ key, data }))
      .catch((e) => !cancelled && setState({ key, error: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [key, tick, version]);

  const current = state.key === key;
  return {
    data: current ? state.data : undefined,
    error: current ? state.error : undefined,
    loading: !current,
    reload: () => setTick((t) => t + 1),
  };
}

/** Wrap a button handler: tracks `busy` and surfaces the error message. Returns true on success. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, clearError: () => setError(null) };
}
