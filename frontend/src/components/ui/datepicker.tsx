import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { toJalaali } from "jalaali-js";
import { Popover } from "./overlay";
import { Button, cn } from "./primitives";
import { JALALI_MONTHS, WEEKDAYS, faNum, fmtDateTime, isoToJalali, jalaliToIso, monthGrid, tehranParts } from "@/lib/format";

/** Jalali date(+time) picker. Value is a UTC ISO string; display is Jalali (Asia/Tehran). */
export function JalaliDatePicker({ value, onChange, withTime = true, placeholder = "انتخاب تاریخ", id, label }: {
  value?: string | null; onChange: (iso: string | null) => void; withTime?: boolean; placeholder?: string; id?: string; label?: string;
}) {
  const today = useMemo(() => {
    const p = tehranParts(new Date());
    return toJalaali(p.y, p.m, p.d);
  }, []);
  const initial = value ? isoToJalali(value) : { jy: today.jy, jm: today.jm, jd: today.jd, hh: 10, mm: 0 };
  const [open, setOpen] = useState(false);
  const [view, setView] = useState({ jy: initial.jy, jm: initial.jm });
  const [time, setTime] = useState({ hh: initial.hh, mm: initial.mm });
  const selected = value ? isoToJalali(value) : null;

  const shift = (delta: number) => {
    let m = view.jm + delta, y = view.jy;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setView({ jy: y, jm: m });
  };
  const pick = (d: number) => {
    onChange(jalaliToIso(view.jy, view.jm, d, time.hh, time.mm));
    if (!withTime) setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen} className="w-[min(92vw,330px)] p-3"
      trigger={
        <button id={id} type="button" aria-label={label}
          className="h-12 w-full flex items-center gap-2 px-3.5 rounded-[var(--radius-field)] border border-line bg-panel text-start hover:border-[#d5dce7] focus:outline-none focus:border-action">
          <CalendarDays className="size-4 text-muted" />
          <span className={cn("flex-1 text-[15px]", !value && "text-muted")}>{value ? (withTime ? fmtDateTime(value) : fmtDateTime(value).split("،")[0]) : placeholder}</span>
          {value && <span role="button" tabIndex={0} aria-label="پاک کردن تاریخ" onClick={(e) => { e.stopPropagation(); onChange(null); }} className="text-muted hover:text-ink"><X className="size-4" /></span>}
        </button>
      }>
      <div className="flex items-center justify-between mb-2">
        <Button variant="ghost" size="icon-sm" aria-label="ماه قبل" onClick={() => shift(-1)}><ChevronRight className="size-4" /></Button>
        <div className="flex items-center gap-1 font-bold">
          <span>{JALALI_MONTHS[view.jm - 1]}</span>
          <select aria-label="سال" value={view.jy} onChange={(e) => setView({ ...view, jy: +e.target.value })} className="bg-transparent font-bold num">
            {Array.from({ length: 9 }, (_, i) => today.jy - 4 + i).map((y) => <option key={y} value={y}>{faNum(String(y))}</option>)}
          </select>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="ماه بعد" onClick={() => shift(1)}><ChevronLeft className="size-4" /></Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[12px] text-muted mb-1">
        {WEEKDAYS.map((w) => <div key={w} aria-hidden>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid">
        {monthGrid(view.jy, view.jm).map((d, i) => {
          const isSel = d && selected && selected.jy === view.jy && selected.jm === view.jm && selected.jd === d;
          const isToday = d && today.jy === view.jy && today.jm === view.jm && today.jd === d;
          return d ? (
            <button key={i} type="button" onClick={() => pick(d)} aria-pressed={!!isSel}
              aria-label={`${faNum(String(d))} ${JALALI_MONTHS[view.jm - 1]} ${faNum(String(view.jy))}`}
              className={cn("h-10 rounded-[10px] text-[14px] num transition-colors", isSel ? "bg-action text-white font-bold" : "hover:bg-line-2", isToday && !isSel && "ring-1 ring-action text-action font-bold")}>
              {faNum(String(d))}
            </button>
          ) : <div key={i} />;
        })}
      </div>
      {withTime && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line-2">
          <span className="text-[13px] text-muted">ساعت</span>
          <input aria-label="ساعت" type="number" min={0} max={23} value={time.hh} onChange={(e) => setTime({ ...time, hh: Math.max(0, Math.min(23, +e.target.value)) })} className="w-16 h-9 rounded-lg border border-line text-center num" dir="ltr" />
          <span>:</span>
          <input aria-label="دقیقه" type="number" min={0} max={59} step={5} value={time.mm} onChange={(e) => setTime({ ...time, mm: Math.max(0, Math.min(59, +e.target.value)) })} className="w-16 h-9 rounded-lg border border-line text-center num" dir="ltr" />
          <Button size="sm" className="ms-auto" onClick={() => {
            if (selected) onChange(jalaliToIso(selected.jy, selected.jm, selected.jd, time.hh, time.mm));
            setOpen(false);
          }}>تأیید</Button>
        </div>
      )}
    </Popover>
  );
}

JalaliDatePicker.displayName = "JalaliDatePicker";
