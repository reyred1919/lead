import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { cn } from "@/components/ui/primitives";

export type Branding = {
  system_title: string; footer_label: string; brand_label: string; logo_alt: string; logo_scale: number; revision: number; placeholder: boolean; demo_mode?: boolean;
  light: { id: string; url: string; width: number; height: number } | null; dark: { id: string; url: string; width: number; height: number } | null;
};

export function useBranding() {
  return useQuery({ queryKey: ["branding"], queryFn: () => get<Branding>("/branding"), staleTime: 5 * 60_000 });
}

/** Uploaded organization logo, or a neutral, explicitly-labelled placeholder logotype. Never a fabricated official mark. */
export function BrandLogo({ variant = "light", height = 32, showTitle = true, className }: { variant?: "light" | "dark"; height?: number; showTitle?: boolean; className?: string }) {
  const { data } = useBranding();
  const asset = data ? (variant === "dark" ? data.dark ?? data.light : data.light ?? data.dark) : null;
  const h = Math.round(height * (data?.logo_scale ?? 1));
  return (
    <div className={cn("flex items-center gap-2.5 min-w-0", className)}>
      {asset ? (
        <img src={`${asset.url}?r=${data?.revision}`} alt={data?.logo_alt || "نشان سازمان"} style={{ height: h, width: "auto", maxWidth: h * 5 }} className="object-contain shrink-0" />
      ) : (
        <span className={cn("shrink-0 grid place-items-center rounded-[10px] font-extrabold", variant === "dark" ? "bg-white/10 text-white" : "bg-navy text-white")}
          style={{ height: h, width: h, fontSize: h * 0.42 }} aria-label="نشان موقت (جایگزین)" title="نشان موقت — نشان رسمی سازمان هنوز بارگذاری نشده است">
          <svg viewBox="0 0 24 24" width={h * 0.58} height={h * 0.58} aria-hidden>
            <rect x="4" y="5" width="16" height="3" rx="1.5" fill="currentColor" />
            <rect x="4" y="10.5" width="11" height="3" rx="1.5" fill="currentColor" opacity=".65" />
            <rect x="4" y="16" width="13" height="3" rx="1.5" fill="#5f97ff" />
          </svg>
        </span>
      )}
      {showTitle && (
        <span className="min-w-0 leading-tight">
          <span className={cn("block font-extrabold text-[15px] truncate", variant === "dark" ? "text-white" : "text-ink")}>{data?.system_title ?? "سامانه لیدهای نمایشگاهی"}</span>
          <span className={cn("block text-[11.5px] truncate", variant === "dark" ? "text-white/60" : "text-muted")}>
            {data?.brand_label}{data?.placeholder ? " · نشان موقت" : ""}
          </span>
        </span>
      )}
    </div>
  );
}
