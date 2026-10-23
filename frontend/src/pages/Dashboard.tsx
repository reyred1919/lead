import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowLeft, CalendarClock, CircleUserRound, Inbox, Plus, Sparkles, UsersRound } from "lucide-react";
import { get, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useWorkCounts } from "@/lib/hooks";
import { faNum, fmtDate, relTime } from "@/lib/format";
import { QUALITY, STAGE } from "@/lib/labels";
import { Button, Card, CardHeader, EmptyState, ErrorState, Ltr, PageHeader, Segmented, Select, Skeleton, Stat } from "@/components/ui/primitives";
import { DemoBadge, QualityBadge } from "@/components/ui/status";

type Dash = { personal: any; aggregate: any | null; demo_data: boolean; generated_at?: string };

const BLUE = "#2368E5";
const GRID = "#EEF1F6";
const AXIS = { fontSize: 12, fill: "#5d6b81", fontFamily: "Vazirmatn" };

function ChartTip({ active, payload, label, unit = "ثبت" }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-panel border border-line rounded-[10px] shadow-[var(--shadow-pop)] px-3 py-2 text-[13px]">
      <div className="text-muted">{label}</div>
      <div className="font-bold text-ink num">{faNum(payload[0].value)} {unit}</div>
    </div>
  );
}

function BarList({ title, rows, unit }: { title: string; rows: { label: string; value: number }[]; unit?: string }) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card>
      <CardHeader title={title} actions={<button className="text-[12.5px] text-action font-semibold min-h-9" onClick={() => setTable(!table)} aria-pressed={table}>{table ? "نمایش نمودار" : "نمایش جدول"}</button>} />
      <div className="px-5 pb-5">
        {!rows.length ? <p className="text-muted text-[14px]">داده‌ای وجود ندارد.</p> : table ? (
          <table className="w-full text-[13.5px]"><tbody>{rows.map((r) => <tr key={r.label} className="border-b border-line-2"><td className="py-2">{r.label}</td><td className="py-2 text-end num font-semibold">{faNum(r.value)}</td></tr>)}</tbody></table>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.label} className="group" title={`${r.label}: ${r.value} ${unit ?? ""}`}>
                <div className="flex justify-between text-[13.5px] mb-1"><span className="truncate">{r.label}</span><span className="num font-semibold text-ink-2">{faNum(r.value)}</span></div>
                <div className="h-2 rounded-full bg-line-2"><div className="h-2 rounded-full bg-action group-hover:bg-action-2 transition-colors" style={{ width: `${(100 * r.value) / max}%` }} /></div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const { me } = useAuth();
  const [eventId, setEventId] = useState("");
  const [range, setRange] = useState("all");
  const dateFrom = range === "7" ? new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10) : range === "30" ? new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) : "";
  const q = useQuery({ queryKey: ["dashboard", eventId, range], queryFn: () => get<Dash>(`/dashboard${qs({ event_id: eventId, date_from: dateFrom })}`) });
  const a = q.data?.aggregate;
  return (
    <div>
      <PageHeader title="داشبورد تحلیلی" subtitle="ثبت‌ها، مخاطبان یکتا، فرصت‌های ارزیابی‌شده و پیگیری‌های انجام‌شده — هر شاخص جدا تعریف شده است؛ از تعداد ثبت، درآمد استنتاج نمی‌شود."
        actions={q.data?.demo_data ? <DemoBadge /> : undefined} />
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <Select aria-label="رویداد" value={eventId} onChange={(e) => setEventId(e.target.value)} className="sm:max-w-xs">
          <option value="">همه رویدادهای مجاز</option>
          {me?.events.map((e) => <option key={e.id} value={e.id}>{e.display_name}</option>)}
        </Select>
        <Segmented label="بازه زمانی" value={range} onChange={setRange} options={[{ value: "all", label: "کل دوره" }, { value: "30", label: "۳۰ روز" }, { value: "7", label: "۷ روز" }]} />
      </div>
      {q.isLoading ? <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-[18px]" />)}</div>
        : q.isError ? <Card><ErrorState error={q.error} onRetry={() => q.refetch()} /></Card>
        : !a ? <Card><EmptyState title="دسترسی به داشبورد تجمیعی ندارید" body="آمار شخصی شما در صفحه خانه نمایش داده می‌شود." /></Card> : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="تعاملات ثبت‌شده" value={faNum(a.interactions)} hint={a.metric_definitions.interactions} />
              <Stat label="مخاطبان یکتا" value={faNum(a.unique_contacts)} hint={`${faNum(a.unique_accounts)} سازمان یکتا`} />
              <Stat label="فرصت‌های ارزیابی‌شده" value={faNum(a.qualified_opportunities)} hint={`${faNum(a.won)} موفق`} />
              <Stat label="پیگیری‌های انجام‌شده" value={faNum(a.completed_followups)} hint={`${faNum(a.open_tasks)} وظیفه باز`} tone="success" />
              <Stat label="بدون مسئول" value={faNum(a.ownerless)} tone={a.ownerless ? "danger" : "default"} icon={<AlertTriangle className="size-4" />} hint="نه مسئول، نه ارجاع در انتظار" />
              <Stat label="ارجاع در انتظار" value={faNum(a.pending_referrals)} hint={`${faNum(a.overdue_referrals)} معوق · ${faNum(a.returned_referrals)} بازگشتی`} tone={a.overdue_referrals ? "warning" : "default"} />
              <Stat label="وظایف معوق" value={faNum(a.overdue_tasks)} tone={a.overdue_tasks ? "danger" : "default"} icon={<CalendarClock className="size-4" />} />
              <Stat label="علاقه بین‌محصولی" value={faNum(a.multi_product_interactions)} hint={`${faNum(a.offline_captures)} ثبت آفلاین`} />
            </div>

            <Card>
              <CardHeader title="روند ثبت روزانه" subtitle="تعداد تعاملات در روزهای دارای ثبت (تاریخ شمسی)" />
              <div className="h-64 px-2 pb-4" role="img" aria-label="نمودار روند ثبت روزانه">
                {a.by_day.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={a.by_day.map((d: any) => ({ ...d, label: fmtDate(d.date + "T12:00:00Z", { year: undefined, month: "short" }) }))} margin={{ top: 8, right: 16, left: 16, bottom: 0 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} reversed />
                      <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} orientation="right" width={32} tickFormatter={(v) => faNum(v)} />
                      <Tooltip content={<ChartTip />} cursor={{ fill: "#F4F6FA" }} />
                      <Bar dataKey="count" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <EmptyState title="هنوز ثبتی وجود ندارد" />}
              </div>
            </Card>

            <div className="grid lg:grid-cols-2 gap-5">
              <BarList title="علاقه به محصولات" rows={a.by_product.map((r: any) => ({ label: r.name_fa, value: r.count }))} />
              <Card>
                <CardHeader title="مراحل فرصت" subtitle="فقط فرصت‌های ایجادشده با ارزیابی صریح" />
                <div className="h-60 px-2 pb-4" role="img" aria-label="نمودار مراحل فرصت">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={Object.keys(STAGE).map((s) => ({ label: STAGE[s], count: a.by_stage[s] ?? 0 }))} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} reversed interval={0} />
                      <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} orientation="right" width={28} tickFormatter={(v) => faNum(v)} />
                      <Tooltip content={<ChartTip unit="فرصت" />} cursor={{ fill: "#F4F6FA" }} />
                      <Bar dataKey="count" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <BarList title="کیفیت گفت‌وگو" rows={Object.keys(QUALITY).map((k) => ({ label: QUALITY[k], value: a.by_quality[k] ?? 0 }))} />
              <BarList title="مقایسه رویدادها" rows={a.by_event.map((r: any) => ({ label: `${r.name} (${r.code})`, value: r.count }))} />
              <BarList title="ثبت به تفکیک کارشناس" rows={a.by_creator.map((r: any) => ({ label: r.name, value: r.count }))} />
              <Card>
                <CardHeader title="لیدهای بدون مسئول" actions={<Link to="/leads?scope=ownerless" className="text-action text-[13px] font-semibold">همه</Link>} />
                {!a.ownerless_sample.length ? <p className="px-5 pb-5 text-[14px] text-success">همه لیدها مسئول یا ارجاع فعال دارند.</p> : (
                  <ul className="divide-y divide-line-2">{a.ownerless_sample.map((r: any) => (
                    <li key={r.id}><Link to={`/leads/${r.id}`} className="px-5 py-3 flex justify-between hover:bg-canvas"><span>{r.contact_name}</span><span className="text-[12.5px] text-muted"><Ltr className="font-mono">{r.event_code}</Ltr> · {relTime(r.captured_at)}</span></Link></li>
                  ))}</ul>
                )}
              </Card>
            </div>
          </div>
        )}
    </div>
  );
}

export function HomePage() {
  const { me, can, activeEventId } = useAuth();
  const q = useQuery({ queryKey: ["dashboard-personal"], queryFn: () => get<Dash>("/dashboard") });
  const { data: counts } = useWorkCounts();
  const event = me?.capture_events.find((e) => e.id === activeEventId) ?? me?.capture_events[0];
  const p = q.data?.personal;
  const a = q.data?.aggregate;
  const hour = new Date().getHours();
  return (
    <div className="space-y-5">
      <PageHeader eyebrow={hour < 12 ? "صبح بخیر" : hour < 17 ? "روز بخیر" : "عصر بخیر"} title={me?.user.full_name ?? ""} subtitle={me?.user.title} />
      <Card className="p-5 md:p-6 overflow-hidden relative">
        <div className="absolute -top-24 -end-20 size-72 rounded-full bg-action/8 blur-2xl" aria-hidden />
        {event ? (
          <div className="relative flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <div className="text-[13px] text-success font-semibold flex items-center gap-1.5"><span className="size-2 rounded-full bg-success" />رویداد فعال</div>
              <h2 className="text-[22px] font-extrabold mt-1">{event.display_name}</h2>
              <p className="text-muted text-[14px] mt-1">{[event.city, event.venue].filter(Boolean).join(" · ")} · <Ltr className="font-mono text-[12.5px]">{event.code}</Ltr></p>
            </div>
            <Link to="/capture"><Button size="lg" className="w-full md:w-auto"><Plus className="size-5" />ثبت لید جدید</Button></Link>
          </div>
        ) : (
          <div className="relative text-[14.5px] text-muted leading-7">در حال حاضر عضو فعال رویدادی نیستید؛ پیگیری لیدها و کارتابل همچنان در دسترس است.</div>
        )}
      </Card>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="ثبت‌های امروز من" value={faNum(p?.my_captures_today ?? 0)} icon={<Sparkles className="size-4" />} hint={`مجموع: ${faNum(p?.my_captures_total ?? 0)}`} />
        <Link to="/inbox"><Stat label="ارجاع در انتظار من" value={faNum(counts?.referrals_incoming ?? 0)} icon={<Inbox className="size-4" />} tone={counts?.referrals_overdue ? "warning" : "default"} hint={counts?.referrals_overdue ? `${faNum(counts.referrals_overdue)} معوق` : "پذیرش یا بازگرداندن"} /></Link>
        <Link to="/inbox?tab=tasks"><Stat label="وظایف باز من" value={faNum(counts?.tasks_open ?? 0)} icon={<CalendarClock className="size-4" />} tone={counts?.tasks_overdue ? "danger" : "default"} hint={counts?.tasks_overdue ? `${faNum(counts.tasks_overdue)} معوق` : undefined} /></Link>
        <Link to="/inbox?tab=actions"><Stat label="درخواست اقدام" value={faNum(counts?.actions_open ?? 0)} icon={<CircleUserRound className="size-4" />} /></Link>
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader title="آخرین ثبت‌های من" actions={<Link to="/leads?scope=mine" className="text-action text-[13px] font-semibold">همه</Link>} />
          {!p?.recent?.length ? <EmptyState title="هنوز ثبتی ندارید" body="ثبت سریع در کمتر از یک دقیقه انجام می‌شود." /> : (
            <ul className="divide-y divide-line-2">{p.recent.map((r: any) => (
              <li key={r.id}><Link to={`/leads/${r.id}`} className="px-5 py-3 flex items-center gap-3 hover:bg-canvas">
                <span className="flex-1 min-w-0"><span className="font-semibold">{r.contact_name}</span>{r.account_name && <span className="text-muted text-[13px]"> · {r.account_name}</span>}</span>
                <QualityBadge q={r.quality} /><span className="text-[12px] text-muted">{relTime(r.captured_at)}</span>
              </Link></li>
            ))}</ul>
          )}
        </Card>
        {a && can("dashboard.view") && (
          <Card>
            <CardHeader title="نمای کلی محدوده من" subtitle={q.data?.demo_data ? "داده نمونه (DEMO)" : undefined} actions={<Link to="/dashboard" className="text-action text-[13px] font-semibold inline-flex items-center gap-1">داشبورد<ArrowLeft className="size-4" /></Link>} />
            <div className="grid grid-cols-2 gap-px bg-line-2 border-t border-line-2">
              {[["تعاملات", a.interactions], ["مخاطبان یکتا", a.unique_contacts], ["فرصت‌ها", a.qualified_opportunities], ["بدون مسئول", a.ownerless]].map(([l, v]) => (
                <div key={l} className="bg-panel p-4"><div className="text-[12.5px] text-muted">{l}</div><div className="text-[22px] font-extrabold num">{faNum(v as number)}</div></div>
              ))}
            </div>
            {a.overdue_sample.length > 0 && (
              <div className="p-4 border-t border-line-2">
                <div className="text-[13px] font-bold text-danger mb-2 flex items-center gap-1.5"><UsersRound className="size-4" />پیگیری‌های معوق تیم</div>
                <ul className="space-y-1.5 text-[13.5px]">{a.overdue_sample.slice(0, 4).map((t: any) => (
                  <li key={t.id}><Link to={`/leads/${t.interaction_id}`} className="hover:text-action">{t.title} · <span className="text-muted">{t.owner}</span></Link></li>
                ))}</ul>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
