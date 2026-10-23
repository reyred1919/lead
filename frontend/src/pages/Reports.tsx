import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileJson, FileSpreadsheet, FileText, ShieldCheck } from "lucide-react";
import { get, post, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bytes, faNum, fmtDateTime } from "@/lib/format";
import { QUALITY, STAGE } from "@/lib/labels";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Field, LoadingRows, PageHeader, Segmented, Select, cn } from "@/components/ui/primitives";
import { JalaliDatePicker } from "@/components/ui/datepicker";
import { useToast } from "@/components/ui/toast";

const DATASETS: [string, string][] = [
  ["fact_leads", "جدول تحلیلی تجمیعی (fact)"], ["accounts", "سازمان‌ها"], ["contacts", "مخاطبان"], ["interactions", "تعاملات"],
  ["interaction_products", "علاقه به محصولات"], ["opportunities", "فرصت‌ها"], ["opportunity_tags", "برچسب‌ها"], ["referrals", "ارجاع‌ها"],
  ["tasks", "وظایف"], ["activities", "فعالیت‌ها"],
];

export function ReportsPage() {
  const { me } = useAuth();
  const [format, setFormat] = useState<"XLSX" | "CSV" | "JSON">("XLSX");
  const [datasets, setDatasets] = useState<string[]>(DATASETS.map((d) => d[0]));
  const [events, setEvents] = useState<string[]>([]);
  const [quality, setQuality] = useState("");
  const [stage, setStage] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const jobs = useQuery({ queryKey: ["exports"], queryFn: () => get<Page<any>>("/exports"), refetchInterval: (q) => (q.state.data?.results.some((j: any) => ["QUEUED", "RUNNING"].includes(j.status)) ? 2000 : false) });
  const m = useMutation({
    mutationFn: () => post<any>("/exports", { format, datasets, filters: { event_id: events, quality, stage, date_from: from?.slice(0, 10), date_to: to?.slice(0, 10) } }),
    onSuccess: (j) => { qc.invalidateQueries({ queryKey: ["exports"] }); toast({ tone: "success", title: j.status === "READY" ? "خروجی آماده است" : "خروجی در صف تولید است" }); },
    onError: (e: any) => toast({ tone: "error", title: "خروجی ایجاد نشد", body: e.message }),
  });
  return (
    <div>
      <PageHeader title="گزارش و خروجی داده" subtitle="خروجی ساختاریافته با شناسه‌های پایدار، زمان UTC، کدهای استاندارد و فرهنگ داده نسخه‌دار — با همان محدوده مجوز صفحه‌ها." />
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_380px] gap-5">
        <Card>
          <CardHeader title="خروجی جدید" />
          <div className="px-5 pb-5 space-y-5">
            <Field label="قالب">
              <Segmented label="قالب خروجی" value={format} onChange={setFormat} options={[
                { value: "XLSX", label: <><FileSpreadsheet className="size-4" />Excel</> }, { value: "CSV", label: <><FileText className="size-4" />CSV (UTF‑8 BOM)</> }, { value: "JSON", label: <><FileJson className="size-4" />JSON</> },
              ]} />
            </Field>
            <Field label="رویدادها" hint="خالی = همه رویدادهای مجاز (تجمیع بین‌رویدادی)">
              <div className="flex flex-wrap gap-2">
                {me?.events.map((e) => {
                  const on = events.includes(e.id);
                  return <button key={e.id} type="button" aria-pressed={on} onClick={() => setEvents(on ? events.filter((x) => x !== e.id) : [...events, e.id])} className={cn("min-h-10 px-3 rounded-[10px] border text-[13.5px]", on ? "bg-action text-white border-action" : "border-line")}>{e.display_name}</button>;
                })}
                {!me?.events.length && <span className="text-[13px] text-muted">همه رویدادهای در محدوده دسترسی سراسری شما</span>}
              </div>
            </Field>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="کیفیت"><Select value={quality} onChange={(e) => setQuality(e.target.value)}><option value="">همه</option>{Object.entries(QUALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="مرحله"><Select value={stage} onChange={(e) => setStage(e.target.value)}><option value="">همه</option><option value="NONE">در انتظار ارزیابی</option>{Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="از تاریخ"><JalaliDatePicker withTime={false} value={from} onChange={setFrom} /></Field>
              <Field label="تا تاریخ"><JalaliDatePicker withTime={false} value={to} onChange={setTo} /></Field>
            </div>
            <Field label="مجموعه داده‌ها" hint="در Excel هر مجموعه یک برگه است؛ در CSV چند مجموعه به‌صورت ZIP">
              <div className="grid sm:grid-cols-2 gap-x-4">
                {DATASETS.map(([k, l]) => <Checkbox key={k} id={`ds-${k}`} label={l} checked={datasets.includes(k)} onChange={(v) => setDatasets(v ? [...datasets, k] : datasets.filter((x) => x !== k))} />)}
              </div>
            </Field>
            <Button size="lg" className="w-full" disabled={!datasets.length} loading={m.isPending} onClick={() => m.mutate()}><Download className="size-5" />ایجاد خروجی</Button>
          </div>
        </Card>
        <div className="space-y-5">
          <Card className="p-5 text-[13.5px] leading-7 text-ink-2 space-y-2">
            <div className="flex items-center gap-2 font-bold text-ink"><ShieldCheck className="size-5 text-success" />حفاظت از داده</div>
            <p>مقادیر متنی که با = + - @ آغاز می‌شوند برای جلوگیری از تزریق فرمول در Excel با علامت ' پیشوند می‌گیرند.</p>
            <p>شماره و ایمیل مخاطبان خارج از مجوز شما پوشانده می‌شود. لینک دریافت فقط برای شما، با توکن یکتا و دارای انقضا است و هر دریافت ممیزی می‌شود.</p>
            <p>نسخه طرح داده: <b>1.0</b> — فرهنگ ستون‌ها داخل هر فایل قرار دارد.</p>
          </Card>
          <Card>
            <CardHeader title="خروجی‌های اخیر من" />
            {jobs.isLoading ? <LoadingRows rows={2} /> : !jobs.data?.results.length ? <EmptyState title="هنوز خروجی نگرفته‌اید" /> : (
              <ul className="divide-y divide-line-2">
                {jobs.data.results.map((j: any) => (
                  <li key={j.id} className="px-5 py-3 text-[13.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{j.format} · {faNum(Object.values(j.row_counts as Record<string, number>).reduce((a, b) => a + b, 0))} ردیف</span>
                      <Badge tone={j.status === "READY" ? "success" : j.status === "FAILED" ? "danger" : "neutral"}>{j.status_label}</Badge>
                    </div>
                    <div className="text-muted text-[12.5px]">{fmtDateTime(j.created_at)} · {bytes(j.file_size)}{j.pii_masked && " · PII پوشانده"}{j.expires_at && ` · انقضا ${fmtDateTime(j.expires_at)}`}</div>
                    {j.download_url && <a href={j.download_url} className="inline-flex items-center gap-1 text-action font-semibold mt-1 min-h-9"><Download className="size-4" />دریافت {j.file_name}</a>}
                    {j.error && <div className="text-danger">{j.error}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
