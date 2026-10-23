import { toGregorian, toJalaali, jalaaliMonthLength } from "jalaali-js";

const TZ = "Asia/Tehran";

/** Dates are stored as UTC ISO strings; Jalali is presentation only. */
export function fmtDate(iso?: string | null, opts: Intl.DateTimeFormatOptions = {}) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: TZ, year: "numeric", month: "long", day: "numeric", ...opts }).format(d);
}

export function fmtDateTime(iso?: string | null) {
  return fmtDate(iso, { hour: "2-digit", minute: "2-digit" });
}

export function fmtShort(iso?: string | null) {
  return fmtDate(iso, { year: undefined, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function relTime(iso?: string | null) {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("fa", { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  return fmtDate(iso);
}

export function faNum(n?: number | string | null) {
  if (n === null || n === undefined || n === "") return "—";
  return typeof n === "number" ? new Intl.NumberFormat("fa-IR").format(n) : String(n).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[+d]);
}

export function toLatinDigits(s: string) {
  return s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

/** Displays +989121234567 as 0912 123 4567 (LTR isolated by the caller). */
export function fmtPhone(p?: string | null) {
  if (!p) return "";
  if (p.startsWith("+98") && p.length === 13 && !p.includes("•")) {
    const n = "0" + p.slice(3);
    return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
  }
  return p;
}

// ---- Jalali calendar helpers for the date picker ----
export const JALALI_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
export const WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

export function tehranParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(d)
    .reduce<Record<string, string>>((a, p) => ((a[p.type] = p.value), a), {});
  return { y: +parts.year, m: +parts.month, d: +parts.day, hh: +parts.hour, mm: +parts.minute };
}

export function isoToJalali(iso: string) {
  const p = tehranParts(new Date(iso));
  const j = toJalaali(p.y, p.m, p.d);
  return { jy: j.jy, jm: j.jm, jd: j.jd, hh: p.hh, mm: p.mm };
}

/** Builds a UTC ISO string from a Jalali date + Tehran wall-clock time. */
export function jalaliToIso(jy: number, jm: number, jd: number, hh = 9, mm = 0) {
  const g = toGregorian(jy, jm, jd);
  // Tehran is UTC+03:30 (no DST since 2022).
  const utc = Date.UTC(g.gy, g.gm - 1, g.gd, hh, mm) - 3.5 * 3600 * 1000;
  return new Date(utc).toISOString();
}

export function monthGrid(jy: number, jm: number) {
  const len = jalaaliMonthLength(jy, jm);
  const g = toGregorian(jy, jm, 1);
  const weekday = new Date(Date.UTC(g.gy, g.gm - 1, g.gd)).getUTCDay(); // 0=Sun
  const offset = (weekday + 1) % 7; // Saturday-first
  const cells: (number | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= len; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function bytes(n?: number | null) {
  if (!n) return "—";
  if (n < 1024) return `${faNum(n)} بایت`;
  if (n < 1024 * 1024) return `${faNum(Math.round(n / 102.4) / 10)} کیلوبایت`;
  return `${faNum(Math.round(n / 104857.6) / 10)} مگابایت`;
}
