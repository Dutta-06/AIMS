"use client";

import { useAnimationControls, useReducedMotion } from "motion/react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import BrandGlyph from "@/components/BrandGlyph";
import Reveal from "@/components/motion/Reveal";
import WordReveal from "@/components/motion/WordReveal";
import { useSignal } from "@/components/signal/SignalProvider";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { getToken, setToken, subscribeToken } from "@/lib/auth";
import { useAction } from "@/lib/hooks";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const barInput =
  "h-12 w-full min-w-0 flex-none bg-transparent px-3 text-[1.02rem] text-heading outline-none sm:h-full sm:flex-1 sm:px-0 sm:text-[1.1rem]";

export default function LoginPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const signal = useSignal();
  const token = useSyncExternalStore(subscribeToken, getToken, () => undefined);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();
  const shake = useAnimationControls();
  const enterRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (token) router.replace("/");
  }, [token, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      const res = await api.login(password, name.trim());
      signal.pulse(enterRef.current); // the light answers the click...
      await sleep(reduce ? 0 : 450); // ...and gets a beat to travel before we leave
      setToken(res.access_token);
    });
    if (!ok && !reduce) shake.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.32 } });
  }

  return (
    <div className="relative flex min-h-[100lvh] flex-col items-center justify-center px-5 text-center sm:px-10">
      <Reveal
        as="header"
        delay={150}
        y={-12}
        className="absolute inset-x-0 top-0 flex items-center px-5 py-5 sm:px-10 sm:py-7"
      >
        <Link href="/" className="flex items-center gap-[0.6rem] text-[1.25rem] font-medium tracking-[-0.01em]">
          <BrandGlyph className="h-6 w-6" />
          Corpo Mailer
        </Link>
      </Reveal>

      <div className="relative z-10 flex w-full max-w-[22rem] flex-col items-center sm:max-w-[40rem] lg:max-w-[50rem]">
        <Reveal delay={320}>
          <p className="inline-flex items-center gap-2 rounded-full border border-glass-border bg-glass px-3.5 py-1.5 text-[0.78rem] text-body backdrop-blur-[14px]">
            <span className="breathe h-1.5 w-1.5 rounded-full bg-[image:var(--ember)]" />
            brAInwave 3 · Sponsor desk
          </p>
        </Reveal>

        <WordReveal
          as="h1"
          text="Every sponsor. One clear signal."
          accent={["signal."]}
          delay={480}
          stagger={85}
          duration={720}
          rise={26}
          className="mt-7 max-w-[20rem] text-[2.1rem] font-medium leading-[1.08] tracking-[-0.025em] text-heading sm:max-w-[34rem] sm:text-[3.6rem] lg:max-w-[46rem] lg:text-[5rem]"
        />

        <WordReveal
          as="p"
          text="Know who to reach, what they said, and what happens next. Nothing leaves without your sign-off."
          delay={1150}
          stagger={22}
          duration={600}
          rise={14}
          className="mt-5 max-w-[20rem] text-[1rem] leading-normal text-body sm:max-w-[34rem] sm:text-[1.1rem]"
        />

        <Reveal delay={1450} className="mt-10 flex w-full flex-col items-center">
          <form onSubmit={submit} className="w-[36rem] max-w-full">
            <motion.div
              animate={shake}
              className="flex flex-col rounded-3xl border border-glass-border bg-glass p-2 backdrop-blur-[14px] transition-[border-color] duration-150 focus-within:border-white/30 sm:h-16 sm:flex-row sm:items-center sm:rounded-full sm:py-0 sm:pl-6 sm:pr-[0.4rem]"
            >
              <input
                aria-label="Your name"
                placeholder="Your name"
                autoComplete="name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={barInput}
              />
              <span aria-hidden="true" className="mx-3 h-px bg-hairline sm:mx-4 sm:h-6 sm:w-px" />
              <input
                aria-label="Team password"
                placeholder="Team password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={barInput}
              />
              <Button
                ref={enterRef}
                type="submit"
                variant="primary"
                disabled={busy}
                className="mt-2 h-11 sm:ml-2 sm:mt-0 sm:h-12 sm:px-6"
              >
                {busy ? (
                  <span className="flex items-center gap-1" aria-label="Signing in">
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="breathe h-1.5 w-1.5 rounded-full bg-action-fg"
                        style={{ animationDelay: `${i * 0.15}s`, animationDuration: "0.9s" }}
                      />
                    ))}
                  </span>
                ) : (
                  "Enter"
                )}
              </Button>
            </motion.div>
            <p role="alert" className="mt-3 min-h-5 text-sm text-danger">
              {error}
            </p>
          </form>
        </Reveal>
      </div>

      <Reveal
        as="footer"
        delay={1650}
        className="absolute inset-x-0 bottom-0 flex justify-center px-5 py-5 text-[0.78rem] text-faint sm:px-10 sm:py-6"
      >
        © 2026 Corpo Mailer · built for brAInwave, DTU.
      </Reveal>
    </div>
  );
}
