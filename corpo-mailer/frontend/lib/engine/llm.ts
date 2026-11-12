/**
 * The AI: OpenRouter's free models, called straight from the browser with the key the person
 * pasted into Settings (it stays in this browser and goes only to openrouter.ai).
 * Requests rotate round-robin across the models so free-tier rate limits are spread out; a model
 * that errors or is rate limited falls through to the next.
 */
export class LLMError extends Error {}

export interface LLM {
  complete(args: { system: string; user: string }): Promise<string>;
}

export const DEFAULT_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
];

let counter = 0; // shared, so rotation continues across requests

/** Round-robin start point: each call begins one model further along; the rest follow as fallbacks. */
export function rotated<T>(models: T[]): T[] {
  if (models.length === 0) return [];
  const start = counter++ % models.length;
  return [...models.slice(start), ...models.slice(0, start)];
}
export const resetRotation = () => {
  counter = 0;
};

export type OpenRouterOptions = {
  apiKey: () => string;
  models?: () => string[];
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class OpenRouterLLM implements LLM {
  constructor(private o: OpenRouterOptions) {}

  async complete({ system, user }: { system: string; user: string }): Promise<string> {
    const key = this.o.apiKey().trim();
    if (!key) throw new LLMError("Add your OpenRouter key in Settings to use the AI");
    const doFetch = this.o.fetchImpl ?? fetch;
    const base = this.o.baseUrl ?? "https://openrouter.ai/api/v1";
    const errors: string[] = [];
    for (const model of rotated((this.o.models ?? (() => DEFAULT_MODELS))())) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 60_000);
      try {
        const res = await doFetch(`${base}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: ctl.signal,
        });
        if (!res.ok) {
          errors.push(`${model}: ${res.status === 401 ? "the key was refused" : `error ${res.status}`}`);
          if (res.status === 401) break; // the key is wrong: no other model will accept it either
          continue;
        }
        const text = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
        if (text && text.trim()) return text;
        errors.push(`${model}: empty response`);
      } catch (e) {
        errors.push(`${model}: ${e instanceof Error && e.name === "AbortError" ? "took too long" : "couldn't be reached"}`);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new LLMError("All models failed: " + errors.join("; "));
  }
}
