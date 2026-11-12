"use client";

import { useState } from "react";
import { Button, ErrorNote, Field, Input } from "@/components/ui";
import { DEFAULT_BACKEND, resetBackend, saveBackend, useBackendUrl } from "@/lib/backend";

/** Choose which backend this page talks to. Changing it reloads the page, signed out. */
export default function BackendAddress() {
  const current = useBackendUrl();
  const custom = current !== DEFAULT_BACKEND;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          saveBackend(value);
          window.location.reload();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Couldn't save that address");
        }
      }}
    >
      <Field label="Backend address">
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://your-codespace-8000.app.github.dev" autoCapitalize="none" spellCheck={false} className="font-mono text-[0.82rem]" />
      </Field>
      <p className="text-xs text-faint">
        Using <span className="font-mono">{current}</span>
        {custom ? "" : " (the default)"}
      </p>
      <ErrorNote message={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" small disabled={!value.trim()}>
          Use this address
        </Button>
        {custom && (
          <Button
            type="button"
            small
            variant="ghost"
            onClick={() => {
              resetBackend();
              window.location.reload();
            }}
          >
            Use the default ({new URL(DEFAULT_BACKEND).host})
          </Button>
        )}
      </div>
    </form>
  );
}
