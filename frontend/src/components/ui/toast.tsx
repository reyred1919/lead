import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "./primitives";

type Toast = { id: number; tone: "success" | "error" | "info"; title: string; body?: string; action?: { label: string; onClick: () => void } };
const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), t.tone === "error" ? 7000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="fixed z-[60] inset-x-0 top-3 md:top-auto md:bottom-6 flex flex-col items-center gap-2 pointer-events-none px-3">
        {items.map((t) => (
          <div key={t.id} role={t.tone === "error" ? "alert" : "status"}
            className={cn("pointer-events-auto w-full max-w-md glass border border-line rounded-[16px] shadow-[var(--shadow-pop)] px-4 py-3 flex items-start gap-3 animate-rise")}>
            {t.tone === "success" ? <CheckCircle2 className="size-5 text-success mt-0.5 shrink-0" /> : t.tone === "error" ? <AlertTriangle className="size-5 text-danger mt-0.5 shrink-0" /> : <Info className="size-5 text-info mt-0.5 shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[14.5px]">{t.title}</div>
              {t.body && <div className="text-[13px] text-muted mt-0.5 leading-6">{t.body}</div>}
            </div>
            {t.action && <button className="text-action font-semibold text-[14px] min-h-8" onClick={t.action.onClick}>{t.action.label}</button>}
            <button aria-label="بستن" className="text-muted hover:text-ink" onClick={() => setItems((s) => s.filter((x) => x.id !== t.id))}><X className="size-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
