import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODELS, LLMError, MAX_ATTEMPTS, OpenRouterLLM, parseKeys, resetRotation, rotated } from "./llm";

type Call = { url: string; init: RequestInit; model: string };
let calls: Call[];
let answers: Record<string, () => Response | Promise<Response>>;

const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { status: 200 });
const status = (code: number) => new Response("{}", { status: code });

const fakeFetch = (async (url: string, init: RequestInit) => {
  const model = JSON.parse(String(init.body)).model as string;
  calls.push({ url, init, model });
  return (answers[model] ?? (() => ok(`from ${model}`)))();
}) as unknown as typeof fetch;

const llm = (over: Partial<ConstructorParameters<typeof OpenRouterLLM>[0]> = {}) =>
  new OpenRouterLLM({ apiKey: () => "sk-or-secret", fetchImpl: fakeFetch, ...over });
const ask = (l = llm()) => l.complete({ system: "SYS", user: "USER" });

beforeEach(() => {
  calls = [];
  answers = {};
  resetRotation();
});

describe("rotation", () => {
  it("starts one model further along each time, keeping the rest as fallbacks", () => {
    const m = ["a", "b", "c"];
    expect([rotated(m), rotated(m), rotated(m), rotated(m)]).toEqual([["a", "b", "c"], ["b", "c", "a"], ["c", "a", "b"], ["a", "b", "c"]]);
    expect(rotated([])).toEqual([]);
  });

  it("each request begins on the next model", async () => {
    const first = [await ask(), await ask(), await ask()];
    expect(first).toEqual(DEFAULT_MODELS.slice(0, 3).map((m) => `from ${m}`));
  });
});

describe("the request", () => {
  it("goes to OpenRouter with the key, the system and user text, and nowhere else", async () => {
    await ask();
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-secret");
    expect(JSON.parse(String(init.body)).messages).toEqual([{ role: "system", content: "SYS" }, { role: "user", content: "USER" }]);
    expect(String(init.body)).not.toContain("sk-or-secret"); // the key is a header, never part of the content
  });

  it("uses the configured models, trimming the key", async () => {
    await ask(llm({ models: () => ["x/one:free"], apiKey: () => "  key  " }));
    expect(calls[0].model).toBe("x/one:free");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer key");
  });
});

describe("when models fail", () => {
  it("a rate-limited or broken model falls through to the next", async () => {
    answers[DEFAULT_MODELS[0]] = () => status(429);
    answers[DEFAULT_MODELS[1]] = () => ok("   ");
    expect(await ask()).toBe(`from ${DEFAULT_MODELS[2]}`);
    expect(calls.map((c) => c.model)).toEqual(DEFAULT_MODELS.slice(0, 3));
  });

  it("an unreachable or timed-out model falls through too", async () => {
    answers[DEFAULT_MODELS[0]] = () => {
      throw new TypeError("network down");
    };
    answers[DEFAULT_MODELS[1]] = () => new Promise<Response>(() => {}); // never answers
    expect(await ask(llm({ timeoutMs: 20, fetchImpl: ((u: string, i: RequestInit) => {
      const p = fakeFetch(u, i) as Promise<Response>;
      const sig = i.signal as AbortSignal;
      return new Promise((res, rej) => {
        sig.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
        p.then(res, rej);
      });
    }) as unknown as typeof fetch }))).toBe(`from ${DEFAULT_MODELS[2]}`);
  });

  it("when every model fails, the error says why for each, without the key", async () => {
    for (const m of DEFAULT_MODELS) answers[m] = () => status(500);
    const err = await ask().catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.message).toMatch(/^All models failed: /);
    for (const m of DEFAULT_MODELS) expect(err.message).toContain(`${m}: error 500`);
    expect(err.message).not.toContain("sk-or-secret");
  });

  it("a refused key stops at once instead of asking every model", async () => {
    for (const m of DEFAULT_MODELS) answers[m] = () => status(401);
    const err = await ask().catch((e) => e);
    expect(err.message).toContain("the key was refused");
    expect(calls).toHaveLength(1);
  });

  it("no key means no request, and a clear instruction", async () => {
    await expect(ask(llm({ apiKey: () => "  " }))).rejects.toThrow(/No AI key is set up yet/);
    expect(calls).toHaveLength(0);
  });
});

describe("several keys (different people's accounts)", () => {
  type KCall = { key: string; model: string };
  let kcalls: KCall[];
  let byKey: Record<string, (model: string) => Response>;
  const kfetch = (async (_u: string, init: RequestInit) => {
    const key = String((init.headers as Record<string, string>).Authorization).replace("Bearer ", "");
    const model = JSON.parse(String(init.body)).model as string;
    kcalls.push({ key, model });
    return (byKey[key] ?? ((m: string) => ok(`${key} answered ${m}`)))(model);
  }) as unknown as typeof fetch;
  const many = (raw: string, over: Partial<ConstructorParameters<typeof OpenRouterLLM>[0]> = {}) => new OpenRouterLLM({ apiKey: () => raw, fetchImpl: kfetch, ...over });
  beforeEach(() => {
    kcalls = [];
    byKey = {};
  });

  it("reads keys separated by new lines, spaces or commas, ignoring blanks and repeats", () => {
    expect(parseKeys("  k1\nk2, k3 ;k1\n\n")).toEqual(["k1", "k2", "k3"]);
    expect(parseKeys("   ")).toEqual([]);
  });

  it("takes turns across the keys, one per request", async () => {
    const l = many("k1\nk2\nk3");
    for (let i = 0; i < 6; i++) await l.complete({ system: "s", user: "u" });
    expect(kcalls.map((c) => c.key)).toEqual(["k1", "k2", "k3", "k1", "k2", "k3"]);
  });

  it("a rate-limited key hands the same model to the next key", async () => {
    byKey.k1 = () => status(429);
    const text = await many("k1\nk2", { models: () => ["m1:free", "m2:free"] }).complete({ system: "s", user: "u" });
    expect(text).toBe("k2 answered m1:free");
    expect(kcalls).toEqual([{ key: "k1", model: "m1:free" }, { key: "k2", model: "m1:free" }]);
  });

  it("out-of-credit (402) also hands over", async () => {
    byKey.k1 = () => status(402);
    expect(await many("k1\nk2", { models: () => ["m1:free"] }).complete({ system: "s", user: "u" })).toBe("k2 answered m1:free");
  });

  it("a refused key is skipped for the rest of that request, while the others still work", async () => {
    byKey.k1 = () => status(401);
    byKey.k2 = (m) => (m === "m1:free" ? status(500) : ok("k2 ok"));
    const text = await many("k1\nk2", { models: () => ["m1:free", "m2:free"] }).complete({ system: "s", user: "u" });
    expect(text).toBe("k2 ok");
    expect(kcalls.filter((c) => c.key === "k1")).toHaveLength(1); // never asked again
  });

  it("when every key is refused it stops straight away and says so", async () => {
    byKey.k1 = byKey.k2 = () => status(401);
    const err = await many("k1\nk2").complete({ system: "s", user: "u" }).catch((e) => e);
    expect(err.message).toContain("(key 1): the key was refused");
    expect(err.message).toContain("(key 2): the key was refused");
    expect(kcalls).toHaveLength(2);
  });

  it("a model that errors (not a limit) moves on to the next model, not the next key", async () => {
    byKey.k1 = (m) => (m === "m1:free" ? status(500) : ok("ok"));
    await many("k1\nk2", { models: () => ["m1:free", "m2:free"] }).complete({ system: "s", user: "u" });
    expect(kcalls).toEqual([{ key: "k1", model: "m1:free" }, { key: "k1", model: "m2:free" }]);
  });

  it("gives up after a fixed number of tries so a bad day can't burn everyone's allowance", async () => {
    byKey.k1 = byKey.k2 = byKey.k3 = byKey.k4 = () => status(429);
    const err = await many("k1\nk2\nk3\nk4", { models: () => DEFAULT_MODELS }).complete({ system: "s", user: "u" }).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(kcalls.length).toBe(MAX_ATTEMPTS);
  });

  it("never puts a key in an error message, and labels keys by number only", async () => {
    byKey.sk1 = byKey.sk2 = () => status(500);
    const err = await many("sk1\nsk2").complete({ system: "s", user: "u" }).catch((e) => e);
    expect(err.message).not.toMatch(/sk1|sk2/);
  });

  it("with one key the messages don't mention key numbers", async () => {
    byKey.only = () => status(500);
    const err = await many("only").complete({ system: "s", user: "u" }).catch((e) => e);
    expect(err.message).not.toContain("(key");
  });
});
