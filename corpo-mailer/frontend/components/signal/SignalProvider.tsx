"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { FRAGMENT, VERTEX } from "@/lib/signal/shader";

type PulseTarget = HTMLElement | { x: number; y: number } | null;
type SignalApi = { pulse: (target?: PulseTarget) => void };

const SignalContext = createContext<SignalApi>({ pulse: () => {} });
export const useSignal = () => useContext(SignalContext);

const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
// One calm intensity everywhere; the entrance burst on first load rises above it and settles to it.
const REST = 0.55;
const BURST_PEAK = 1.5;

// A fixed-size film grain: tiny inline SVG noise, blended over everything.
const GRAIN = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>",
)}")`;

type Sim = {
  reduced: boolean;
  cur: number; // intensity currently on screen
  from: number;
  to: number;
  tweenStart: number;
  burstStart: number | null;
  burstPulsed: boolean;
  pointer: [number, number];
  pointerTarget: [number, number];
  pulseStart: number | null;
  pulseAt: [number, number];
  redraw: () => void; // draw one still frame (reduced motion)
};

export default function SignalProvider({ children }: { children: React.ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Sim>({
    reduced: false,
    cur: REST,
    from: REST,
    to: REST,
    tweenStart: 0,
    burstStart: null,
    burstPulsed: false,
    pointer: [0.5, 0.5],
    pointerTarget: [0.5, 0.5],
    pulseStart: null,
    pulseAt: [0.5, 0.5],
    redraw: () => {},
  });

  const pulse = useCallback((target?: PulseTarget) => {
    const S = sim.current;
    if (S.reduced) {
      if (target instanceof HTMLElement)
        target.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 200 });
      return;
    }
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    if (target instanceof HTMLElement) {
      const r = target.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    } else if (target) {
      x = target.x;
      y = target.y;
    }
    S.pulseAt = [x / window.innerWidth, 1 - y / window.innerHeight];
    S.pulseStart = performance.now();
  }, []);

  // The renderer: mounted once for the life of the page.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const S = sim.current;
    const markNoGL = () => {
      document.documentElement.dataset.nogl = "1";
      canvas.style.display = "none";
    };

    const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false });
    if (!gl) return markNoGL();

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return markNoGL();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return markNoGL();
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const U = {
      res: gl.getUniformLocation(prog, "uRes"),
      time: gl.getUniformLocation(prog, "uTime"),
      pointer: gl.getUniformLocation(prog, "uPointer"),
      intensity: gl.getUniformLocation(prog, "uIntensity"),
      pulse: gl.getUniformLocation(prog, "uPulse"),
      pulseAt: gl.getUniformLocation(prog, "uPulseAt"),
    };

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    S.reduced = motionQuery.matches;
    const t0 = performance.now();
    let raf = 0;
    let last = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const scale = S.burstStart !== null ? 1 : 0.6; // full size only during the entrance
      const w = Math.max(2, Math.round(window.innerWidth * dpr * scale));
      const h = Math.max(2, Math.round(window.innerHeight * dpr * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const draw = (now: number, seconds: number) => {
      resize();
      // Entrance burst: 0 -> 1.9 over 500ms, then settle to 1.0 over 1400ms.
      let intensity: number;
      if (S.burstStart !== null) {
        const e = now - S.burstStart;
        if (e >= 250 && !S.burstPulsed) {
          S.burstPulsed = true;
          S.pulseAt = [0.5, 0.5];
          S.pulseStart = now;
        }
        if (e < 500) intensity = BURST_PEAK * easeOutCubic(e / 500);
        else if (e < 1900) intensity = BURST_PEAK + (REST - BURST_PEAK) * easeOutCubic((e - 500) / 1400);
        else {
          S.burstStart = null;
          intensity = REST;
          S.from = REST;
        }
      } else {
        intensity = S.from + (S.to - S.from) * easeOutCubic((now - S.tweenStart) / 900);
      }
      S.cur = intensity;

      S.pointer[0] += (S.pointerTarget[0] - S.pointer[0]) * 0.06;
      S.pointer[1] += (S.pointerTarget[1] - S.pointer[1]) * 0.06;
      const p = S.pulseStart === null ? 1 : Math.min(1, (now - S.pulseStart) / 1600);
      if (p >= 1) S.pulseStart = null;

      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.time, seconds);
      gl.uniform2f(U.pointer, S.pointer[0], S.pointer[1]);
      gl.uniform1f(U.intensity, intensity);
      gl.uniform1f(U.pulse, easeOutCubic(p));
      gl.uniform2f(U.pulseAt, S.pulseAt[0], S.pulseAt[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      if (S.burstStart === null && now - last < 33) return; // 30fps once the entrance is over
      last = now;
      draw(now, (now - t0) / 1000);
    };

    S.redraw = () => draw(performance.now(), 20);

    // Every fresh load of the app gets the entrance burst.
    if (!S.reduced) {
      S.burstStart = performance.now();
      S.burstPulsed = false;
    }

    if (S.reduced) {
      S.cur = S.from = S.to = REST;
      S.redraw();
    } else {
      raf = requestAnimationFrame(frame);
    }

    const onMove = (e: PointerEvent) => {
      S.pointerTarget = [e.clientX / window.innerWidth, 1 - e.clientY / window.innerHeight];
    };
    const onResize = () => S.reduced && S.redraw();
    const onLost = (e: Event) => {
      e.preventDefault();
      markNoGL();
    };
    const onMotionChange = () => {
      S.reduced = motionQuery.matches;
      if (S.reduced) {
        cancelAnimationFrame(raf);
        S.cur = S.from = S.to = REST;
        S.redraw();
      } else {
        raf = requestAnimationFrame(frame);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", onResize);
    canvas.addEventListener("webglcontextlost", onLost);
    motionQuery.addEventListener("change", onMotionChange);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onLost);
      motionQuery.removeEventListener("change", onMotionChange);
    };
  }, []);

  const api = useMemo(() => ({ pulse }), [pulse]);

  return (
    <SignalContext.Provider value={api}>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 h-full w-full"
      />
      <div
        aria-hidden="true"
        data-scrim
        className="pointer-events-none fixed inset-0 z-[1]"
        style={{ background: "var(--scrim-app)" }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[2] opacity-[0.06] mix-blend-overlay"
        style={{ backgroundImage: GRAIN }}
      />
      <div className="relative z-10">{children}</div>
    </SignalContext.Provider>
  );
}
