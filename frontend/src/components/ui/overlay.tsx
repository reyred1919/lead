import * as RD from "@radix-ui/react-dialog";
import * as RP from "@radix-ui/react-popover";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, cn } from "./primitives";

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md" }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl";
}) {
  return (
    <RD.Root open={open} onOpenChange={onOpenChange}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-[rgb(16_41_76/0.28)] backdrop-blur-[2px] data-[state=open]:animate-[fadeIn_150ms]" />
        <RD.Content
          dir="rtl"
          className={cn(
            "fixed z-50 inset-x-0 bottom-0 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 w-full bg-panel shadow-[var(--shadow-pop)] outline-none",
            "rounded-t-[24px] md:rounded-[22px] max-h-[92dvh] flex flex-col animate-rise",
            size === "sm" && "md:max-w-md", size === "md" && "md:max-w-lg", size === "lg" && "md:max-w-2xl", size === "xl" && "md:max-w-4xl",
          )}
        >
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-line md:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
            <div>
              <RD.Title className="text-[18px] font-bold">{title}</RD.Title>
              {description ? <RD.Description className="text-[13.5px] text-muted mt-1 leading-6">{description}</RD.Description> : <RD.Description className="sr-only">{typeof title === "string" ? title : ""}</RD.Description>}
            </div>
            <RD.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="بستن"><X className="size-5" /></Button>
            </RD.Close>
          </div>
          <div className="px-6 py-3 overflow-y-auto scrollbar-thin">{children}</div>
          {footer && <div className="px-6 py-4 border-t border-line-2 flex flex-wrap justify-end gap-2 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel = "تأیید", tone = "primary", onConfirm, loading }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; body?: ReactNode; confirmLabel?: string; tone?: "primary" | "danger"; onConfirm: () => void; loading?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} size="sm"
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>انصراف</Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </>}>
      {body && <div className="text-[14.5px] leading-7 text-ink-2">{body}</div>}
    </Dialog>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ title: string; body?: ReactNode; confirmLabel?: string; tone?: "primary" | "danger"; resolve?: (v: boolean) => void } | null>(null);
  const confirm = (opts: { title: string; body?: ReactNode; confirmLabel?: string; tone?: "primary" | "danger" }) =>
    new Promise<boolean>((resolve) => setState({ ...opts, resolve }));
  const node = state ? (
    <ConfirmDialog open title={state.title} body={state.body} confirmLabel={state.confirmLabel} tone={state.tone}
      onOpenChange={(o) => { if (!o) { state.resolve?.(false); setState(null); } }}
      onConfirm={() => { state.resolve?.(true); setState(null); }} />
  ) : null;
  return { confirm, node };
}

export function Popover({ trigger, children, open, onOpenChange, align = "start", className }: { trigger: ReactNode; children: ReactNode; open?: boolean; onOpenChange?: (o: boolean) => void; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <RP.Root open={open} onOpenChange={onOpenChange}>
      <RP.Trigger asChild>{trigger}</RP.Trigger>
      <RP.Portal>
        <RP.Content dir="rtl" align={align} sideOffset={8} collisionPadding={12}
          className={cn("z-50 bg-panel rounded-[16px] border border-line shadow-[var(--shadow-pop)] p-2 outline-none animate-rise w-[min(92vw,320px)]", className)}>
          {children}
        </RP.Content>
      </RP.Portal>
    </RP.Root>
  );
}
