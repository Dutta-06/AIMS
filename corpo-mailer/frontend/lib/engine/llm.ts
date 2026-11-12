/**
 * The AI: OpenRouter's free models, called straight from the browser with the key the person
 * pasted into Settings (it stays in this browser and goes only to openrouter.ai).
 * Requests rotate round-robin across the models so free-tier rate limits are spread out; a model
 * that errors or is rate limited falls through to the next.
 *
 * Several keys can be given (one per line). Each is a separate person's OpenRouter account, so their
 * free allowances add up: requests take turns across the keys, a rate-limited key hands over to the
 * next, and a refused key is skipped for the rest of that request. (Several keys from the *same*
 * account would share one allowance and gain nothing.)
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
  keyCounter = 0;
};

let keyCounter = 0;
export const MAX_ATTEMPTS = 12; // a hard stop, so a bad day can't burn through everyone's allowance

/** The keys in a pasted block: separated by new lines, spaces or commas; blanks and repeats dropped. */
export function parseKeys(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map((k) => k.trim()).filter(Boolean))];
}

export type OpenRouterOptions = {
  /** One key, or several separated by new lines. */
  apiKey: () => string;
  models?: () => string[];
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class OpenRouterLLM implements LLM {
  constructor(private o: OpenRouterOptions) {}

  async complete({ system, user }: { system: string; user: string }): Promise<string> {
    const keys = parseKeys(this.o.apiKey());
    if (!keys.length) throw new LLMError("Add your OpenRouter key in Settings to use the AI");
    const doFetch = this.o.fetchImpl ?? fetch;
    const base = this.o.baseUrl ?? "https://openrouter.ai/api/v1";
    const errors: string[] = [];
    const many = keys.length > 1;
    const startKey = keyCounter++ % keys.length;
    const order = keys.map((_, i) => (startKey + i) % keys.length); // this request's key order
    const refused = new Set<number>();
    let attempts = 0;
    for (const model of rotated((this.o.models ?? (() => DEFAULT_MODELS))())) {
      if (refused.size === keys.length || attempts >= MAX_ATTEMPTS) break;
      for (const ki of order) {
        if (refused.has(ki)) continue;
        if (attempts >= MAX_ATTEMPTS) break;
        attempts += 1;
        const tag = many ? ` (key ${ki + 1})` : "";
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 60_000);
        try {
          const res = await doFetch(`${base}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${keys[ki]}`, "Content-Type": "application/json" },
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
            errors.push(`${model}${tag}: ${res.status === 401 ? "the key was refused" : `error ${res.status}`}`);
            if (res.status === 401) {
              refused.add(ki); // this key is wrong: no model will accept it
              continue; // another key may still work
            }
            if (many && (res.status === 429 || res.status === 402)) continue; // out of allowance: the next key's turn
            break; // another model, not another key
          }
          const text = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
          if (text && text.trim()) return text;
          errors.push(`${model}${tag}: empty response`);
          break;
        } catch (e) {
          errors.push(`${model}${tag}: ${e instanceof Error && e.name === "AbortError" ? "took too long" : "couldn't be reached"}`);
          break;
        } finally {
          clearTimeout(timer);
        }
      }
    }
    throw new LLMError("All models failed: " + errors.join("; "));
  }
}
