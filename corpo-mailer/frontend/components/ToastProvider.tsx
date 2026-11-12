"use client";

import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { snap } from "./motion/springs";

type Tone = "default" | "error";
type Toast = { id: number; message: string; tone: Tone };
const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const show = useCallback((message: string, tone: Tone = "default") => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4 max-md:bottom-24"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={snap}
              role={t.tone === "error" ? "alert" : "status"}
              className={`pointer-events-auto rounded-full border px-4 py-2 text-sm backdrop-blur-xl ${
                t.tone === "error"
                  ? "border-danger/40 bg-[rgba(40,12,20,0.7)] text-danger"
                  : "border-glass-border bg-glass-strong text-heading"
              }`}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
