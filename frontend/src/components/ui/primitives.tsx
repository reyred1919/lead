import { cloneElement, forwardRef, isValidElement, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2 } from "lucide-react";

export const cn = (...a: Parameters<typeof clsx>) => twMerge(clsx(...a));

const button = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background,box-shadow,color,transform] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none",
  {
    variants: {
      variant: {
        primary: "bg-action text-white hover:bg-action-2 shadow-[0_1px_0_rgb(255_255_255/0.2)_inset,0_1px_2px_rgb(16_41_76/0.2)]",
        navy: "bg-navy text-white hover:bg-navy-2",
        secondary: "bg-panel text-ink border border-line hover:bg-line-2",
        ghost: "text-ink-2 hover:bg-line-2",
        soft: "bg-action-soft text-action-2 hover:bg-[#dde8fc]",
        danger: "bg-danger text-white hover:brightness-95",
        "danger-soft": "bg-danger-soft text-danger hover:brightness-95",
      },
      size: {
        sm: "h-9 px-3 text-sm rounded-[10px]",
        md: "h-11 px-4 text-[15px] rounded-[12px]",
        lg: "h-13 px-6 text-base rounded-[14px] min-h-[52px]",
        icon: "h-11 w-11 rounded-[12px]",
        "icon-sm": "h-9 w-9 rounded-[10px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant, size, loading, children, disabled, ...props }, ref) {
  return (
    <button ref={ref} className={cn(button({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

const fieldBase =
  "w-full bg-panel border border-line rounded-[var(--radius-field)] px-3.5 text-[15px] text-ink placeholder:text-muted/80 transition-[border,box-shadow] duration-150 hover:border-[#d5dce7] focus:outline-none focus:border-action focus:shadow-[0_0_0_4px_rgb(35_104_229/0.12)] aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-[0_0_0_4px_rgb(180_35_24/0.08)] disabled:bg-line-2 disabled:text-muted";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-12", className)} {...p} />;
});
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, "py-3 min-h-[88px] leading-7", className)} {...p} />;
});
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, "h-12 pe-9 appearance-none bg-[length:16px] bg-no-repeat bg-[position:left_12px_center]", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23718198' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...p}>
      {children}
    </select>
  );
});
Select.displayName = "Select";

const LABELLABLE = new Set(["input", "select", "textarea", "Input", "Select", "Textarea", "JalaliDatePicker"]);

export function Field({ label, hint, error, required, children, htmlFor, className }: { label: ReactNode; hint?: ReactNode; error?: string; required?: boolean; children: ReactNode; htmlFor?: string; className?: string }) {
  // Bind the visible label to its control when the caller didn't pass htmlFor/id (WCAG 1.3.1 / 4.1.2, QA-A11Y).
  const autoId = useId();
  const type = isValidElement(children) ? (children.type as any) : null;
  const typeName = typeof type === "string" ? type : type?.displayName ?? type?.render?.displayName ?? type?.name;
  const bindable = isValidElement(children) && !htmlFor && !(children.props as any).id && LABELLABLE.has(typeName);
  if (bindable) {
    children = cloneElement(children as React.ReactElement<any>, { id: autoId });
    htmlFor = autoId;
  }
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink-2">
        {label}
        {required && <span className="text-danger ms-1" aria-hidden>*</span>}
        {required && <span className="sr-only">(الزامی)</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[13px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[12.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const badge = cva("inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap border", {
  variants: {
    tone: {
      neutral: "bg-line-2 text-ink-2 border-line",
      info: "bg-info-soft text-info border-[#d3e2f8]",
      success: "bg-success-soft text-success border-[#cbead9]",
      warning: "bg-warning-soft text-warning border-[#f5e0b8]",
      danger: "bg-danger-soft text-danger border-[#f6cdc9]",
      navy: "bg-navy text-white border-navy",
      action: "bg-action-soft text-action-2 border-[#d3e2fb]",
    },
    size: { sm: "h-6 px-2 text-[12px]", md: "h-7 px-2.5 text-[13px]" },
  },
  defaultVariants: { tone: "neutral", size: "sm" },
});

export function Badge({ tone, size, className, children, dot }: VariantProps<typeof badge> & { className?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cn(badge({ tone, size }), className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...p}>{children}</div>;
}

export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-5 pb-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[17px] font-bold text-ink leading-7">{title}</h2>
        {subtitle && <p className="text-[13px] text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} aria-hidden />;
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" role="status" aria-label="در حال بارگذاری">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="w-1/3" />
            <Skeleton className="w-2/3 h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center text-center px-6 py-12 gap-3", className)}>
      {icon && <div className="size-14 rounded-2xl bg-line-2 grid place-items-center text-muted">{icon}</div>}
      <h3 className="text-[16px] font-bold">{title}</h3>
      {body && <p className="text-[14px] text-muted max-w-sm leading-7">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const status = (error as any)?.status;
  const denied = status === 403;
  return (
    <EmptyState
      title={denied ? "دسترسی مجاز نیست" : status === 404 ? "یافت نشد" : "بارگذاری ناموفق بود"}
      body={(error as Error)?.message}
      action={onRetry && !denied ? <Button variant="secondary" onClick={onRetry}>تلاش دوباره</Button> : undefined}
    />
  );
}

export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi dir="ltr" className={cn("ltr num", className)}>{children}</bdi>;
}

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50", checked ? "bg-success" : "bg-[#d7dde7]")}
    >
      <span className={cn("absolute top-0.5 size-6 rounded-full bg-white shadow transition-[inset-inline-start] duration-200", checked ? "start-[22px]" : "start-0.5")} />
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label, className, size = "md" }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; label: string; className?: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex p-1 rounded-[13px] bg-line-2 border border-line gap-1 max-w-full overflow-x-auto scrollbar-thin", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[10px] font-medium transition-all duration-150 whitespace-nowrap inline-flex items-center gap-1.5",
            size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-[14px]",
            value === o.value ? "bg-panel text-ink shadow-[0_1px_3px_rgb(16_41_76/0.12)]" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-action text-white text-[11px] grid place-items-center num">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, size = 36 }: { name?: string; size?: number }) {
  const initials = (name || "؟").trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join("‌");
  const hue = [...(name || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return (
    <span aria-hidden className="inline-grid place-items-center rounded-full font-bold text-white shrink-0" style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${hue} 45% 42%), hsl(${(hue + 30) % 360} 50% 32%))` }}>
      {initials}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-6">
      <div className="min-w-0">
        {eyebrow && <div className="text-[13px] font-semibold text-action mb-1">{eyebrow}</div>}
        <h1 className="text-[26px] md:text-[30px] font-extrabold tracking-tight leading-tight text-ink">{title}</h1>
        {subtitle && <p className="text-[14.5px] text-muted mt-1.5 leading-7">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Stat({ label, value, hint, tone = "default", icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "warning" | "danger" | "success"; icon?: ReactNode }) {
  return (
    <div className="card p-4 md:p-5 flex flex-col gap-1">
      <div className="flex items-center justify-between text-[13px] text-muted font-medium">
        <span>{label}</span>
        {icon && <span className={cn("text-muted", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{icon}</span>}
      </div>
      <div className={cn("text-[28px] font-extrabold num leading-tight", tone === "danger" && "text-danger", tone === "warning" && "text-warning", tone === "success" && "text-success")}>{value}</div>
      {hint && <div className="text-[12.5px] text-muted leading-6">{hint}</div>}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; id?: string }) {
  return (
    <label htmlFor={id} className="inline-flex items-center gap-2.5 cursor-pointer min-h-11 text-[14.5px]">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 rounded-md accent-[var(--color-action)]" />
      <span>{label}</span>
    </label>
  );
}
