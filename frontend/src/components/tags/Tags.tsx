import { useMemo, useRef, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { Popover } from "@/components/ui/overlay";
import { cn } from "@/components/ui/primitives";
import { TAG_COLORS, TAG_COLOR_LABEL, type TagColor } from "@/lib/labels";

export type TagT = { id: string; code: string; name_fa: string; name_en?: string; color: string; status: string };

/** Restrained price-label palette: tinted fill, hairline border, strong readable label (WCAG AA). */
export const TAG_STYLE: Record<TagColor, { bg: string; fg: string; border: string; dot: string }> = {
  slate: { bg: "#f1f4f8", fg: "#334155", border: "#dbe2ea", dot: "#64748b" },
  indigo: { bg: "#eef0fe", fg: "#3730a3", border: "#d9ddfc", dot: "#6366f1" },
  violet: { bg: "#f4effe", fg: "#5b21b6", border: "#e5dafc", dot: "#8b5cf6" },
  blue: { bg: "#ebf3fe", fg: "#1e4fae", border: "#d3e3fb", dot: "#2368e5" },
  teal: { bg: "#e8f7f5", fg: "#0f5f58", border: "#cdebe7", dot: "#14b8a6" },
  green: { bg: "#eaf7ef", fg: "#166534", border: "#cfead9", dot: "#22c55e" },
  amber: { bg: "#fdf4e3", fg: "#8a4b00", border: "#f4e0bb", dot: "#f59e0b" },
  rose: { bg: "#fdedf0", fg: "#a01a3c", border: "#f8d3dc", dot: "#f43f5e" },
};

export function TagChip({ tag, onRemove, size = "md" }: { tag: TagT; onRemove?: () => void; size?: "sm" | "md" }) {
  const s = TAG_STYLE[(tag.color as TagColor) ?? "slate"] ?? TAG_STYLE.slate;
  const label = tag.name_fa;
  return (
    <span
      title={tag.name_en ? `${label} — ${tag.name_en}` : label}
      className={cn("inline-flex items-center gap-1.5 rounded-[8px] border font-semibold max-w-[220px] align-middle", size === "sm" ? "h-6 ps-2 pe-2 text-[12px]" : "h-7 md:h-[26px] ps-2.5 pe-2 text-[12.5px] max-md:h-8")}
      style={{ background: s.bg, color: s.fg, borderColor: s.border }}
    >
      <span className="size-1.5 rounded-full shrink-0" style={{ background: s.dot }} aria-hidden />
      <span className="truncate">{label}</span>
      {tag.status === "ARCHIVED" && <span className="text-[10.5px] opacity-70 font-medium">(بایگانی)</span>}
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`حذف برچسب ${label}`}
          className="relative -me-1 size-5 grid place-items-center rounded-full hover:bg-black/5 before:absolute before:-inset-3 before:content-['']">
          <X className="size-3.5" />
        </button>
      )}
    </span>
  );
}

export function TagCombobox({ all, selectedIds, onAdd, disabled }: { all: TagT[]; selectedIds: string[]; onAdd: (t: TagT) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((t) => t.status === "ACTIVE" && !selectedIds.includes(t.id) && (!needle || t.name_fa.includes(q.trim()) || (t.name_en ?? "").toLowerCase().includes(needle)));
  }, [all, selectedIds, q]);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); setQ(""); setCursor(0); if (o) setTimeout(() => inputRef.current?.focus(), 30); }} className="w-[min(92vw,280px)] p-1.5"
      trigger={
        <button type="button" disabled={disabled}
          className="inline-flex items-center gap-1 h-7 max-md:h-8 px-2.5 rounded-[8px] border border-dashed border-[#cfd7e3] text-[12.5px] font-semibold text-muted hover:text-action hover:border-action disabled:opacity-50">
          <Plus className="size-3.5" />افزودن برچسب
        </button>
      }>
      <div className="flex items-center gap-2 px-2 h-10 border-b border-line-2 mb-1">
        <Search className="size-4 text-muted" />
        <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} placeholder="جست‌وجوی برچسب…" aria-label="جست‌وجوی برچسب"
          role="combobox" aria-expanded aria-controls="tag-options" aria-activedescendant={options[cursor] ? `tag-opt-${options[cursor].id}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(options.length - 1, c + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            if (e.key === "Enter" && options[cursor]) { e.preventDefault(); onAdd(options[cursor]); setQ(""); }
          }}
          className="flex-1 bg-transparent outline-none text-[14px]" />
      </div>
      <ul id="tag-options" role="listbox" aria-label="برچسب‌های قابل انتخاب" className="max-h-64 overflow-y-auto scrollbar-thin">
        {options.map((t, i) => (
          <li key={t.id} id={`tag-opt-${t.id}`} role="option" aria-selected={i === cursor}>
            <button type="button" onMouseEnter={() => setCursor(i)} onClick={() => onAdd(t)} className={cn("w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-[10px] min-h-10", i === cursor && "bg-line-2")}>
              <TagChip tag={t} size="sm" />
              {t.name_en && <span className="text-[11.5px] text-muted ltr truncate">{t.name_en}</span>}
            </button>
          </li>
        ))}
        {!options.length && <li className="text-center text-[13px] text-muted py-5 px-3 leading-6">{all.length ? "برچسب دیگری برای افزودن وجود ندارد." : "هنوز برچسبی تعریف نشده است. مدیر توسعه بازار برچسب‌ها را تعریف می‌کند."}</li>}
      </ul>
    </Popover>
  );
}

export function TagColorPicker({ value, onChange }: { value: string; onChange: (c: TagColor) => void }) {
  return (
    <div role="radiogroup" aria-label="رنگ برچسب" className="flex flex-wrap gap-2">
      {TAG_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={TAG_COLOR_LABEL[c]} onClick={() => onChange(c)}
          className={cn("size-9 rounded-full grid place-items-center border-2 transition-transform hover:scale-105", value === c ? "border-ink" : "border-transparent")}
          style={{ background: TAG_STYLE[c].bg, boxShadow: `inset 0 0 0 1px ${TAG_STYLE[c].border}` }}>
          <span className="size-3.5 rounded-full grid place-items-center" style={{ background: TAG_STYLE[c].dot }}>{value === c && <Check className="size-2.5 text-white" />}</span>
        </button>
      ))}
    </div>
  );
}
