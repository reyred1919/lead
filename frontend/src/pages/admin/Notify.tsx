import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, FlaskConical, Plug, Plus, RefreshCw, Send } from "lucide-react";
import { ApiError, get, patch, post, qs, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { faNum, fmtDateTime, relTime } from "@/lib/format";
import { CHANNEL, PRIORITY, PROVIDER_MODE, RECIPIENT_TYPE, SKIP_REASON } from "@/lib/labels";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, LoadingRows, Ltr, PageHeader, Segmented, Select, Switch, Textarea } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlay";
import { JobStatus, MockBadge } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";

type Tab = "providers" | "rules" | "templates" | "logs";

export function NotifyAdminPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>(can("provider.manage") ? "providers" : "rules");
  const tabs = [
    ...(can("provider.manage") ? [{ value: "providers" as Tab, label: "سرویس‌دهنده‌ها (پیامک/ایمیل)" }] : []),
    ...(can("notification.configure") ? [{ value: "rules" as Tab, label: "قواعد" }, { value: "templates" as Tab, label: "قالب‌ها" }] : []),
    { value: "logs" as Tab, label: "گزارش ارسال" },
  ];
  return (
    <div>
      <PageHeader title="اعلان، پیامک و ایمیل" subtitle="معماری مستقل از سرویس‌دهنده: رویداد دامنه ← صف تراکنشی ← قاعده ← کار اعلان ← آداپتر. ارسال واقعی فقط پس از ثبت اطلاعات اتصال و آزمون موفق فعال می‌شود." />
      <Segmented label="بخش" value={tab} onChange={setTab} options={tabs} className="mb-4" />
      {tab === "providers" && <Providers />}
      {tab === "rules" && <Rules />}
      {tab === "templates" && <Templates />}
      {tab === "logs" && <Logs />}
    </div>
  );
}

const ADAPTERS: Record<string, string> = { MOCK_SMS: "پیامک شبیه‌سازی", HTTP_SMS: "درگاه پیامک HTTP عمومی", MOCK_EMAIL: "ایمیل شبیه‌سازی", SMTP: "سرور SMTP سازمانی" };

function Providers() {
  const q = useQuery({ queryKey: ["providers"], queryFn: () => get<any[]>("/notify/providers") });
  const [edit, setEdit] = useState<any | "new" | null>(null);
  const [testFor, setTestFor] = useState<any>(null);
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button onClick={() => setEdit("new")}><Plus className="size-4" />افزودن اتصال</Button></div>
      {q.isLoading ? <Card><LoadingRows /></Card> : !q.data?.length ? <Card><EmptyState title="اتصالی تعریف نشده" body="بدون سرویس‌دهنده، فقط اعلان درون‌برنامه ارسال می‌شود و پیامک/ایمیل با دلیل «سرویس‌دهنده فعال وجود ندارد» ثبت می‌شود." /></Card> : (
        <div className="grid md:grid-cols-2 gap-4">
          {q.data.map((p) => (
            <Card key={p.id} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-bold">{p.name}</div><div className="text-[12.5px] text-muted">{CHANNEL[p.channel]} · {ADAPTERS[p.adapter]}</div></div>
                <div className="flex flex-col items-end gap-1"><Badge tone={p.mode === "LIVE" ? "success" : p.mode === "MOCK" ? "warning" : "neutral"} dot>{PROVIDER_MODE[p.mode]}</Badge>{p.is_default && <Badge tone="navy">پیش‌فرض</Badge>}</div>
              </div>
              {p.is_mock && <MockBadge />}
              <dl className="text-[13px] grid grid-cols-2 gap-2">
                {p.config.host && <div><dt className="text-muted">میزبان</dt><dd><Ltr>{p.config.host}:{p.config.port}</Ltr></dd></div>}
                {p.config.endpoint && <div className="col-span-2"><dt className="text-muted">نشانی</dt><dd><Ltr className="break-all">{p.config.endpoint}</Ltr></dd></div>}
                {p.config.from_address && <div><dt className="text-muted">فرستنده</dt><dd><Ltr>{p.config.from_address}</Ltr></dd></div>}
                <div><dt className="text-muted">رمز/کلید</dt><dd>{p.secret_set ? "ثبت‌شده (نمایش داده نمی‌شود)" : "ثبت نشده"}</dd></div>
                <div><dt className="text-muted">آخرین آزمون</dt><dd>{p.last_test_at ? <span className={p.last_test_ok ? "text-success" : "text-danger"}>{p.last_test_ok ? "موفق" : "ناموفق"} · {relTime(p.last_test_at)}</span> : "—"}</dd></div>
              </dl>
              {p.last_test_message && <p className="text-[12.5px] text-muted">{p.last_test_message}</p>}
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="secondary" onClick={() => setTestFor(p)}><FlaskConical className="size-4" />آزمون</Button>
                <Button size="sm" variant="ghost" onClick={() => setEdit(p)}>ویرایش</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <ProviderDialog p={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {testFor && <TestDialog p={testFor} onClose={() => setTestFor(null)} />}
    </div>
  );
}

function ProviderDialog({ p, onClose }: { p: any | null; onClose: () => void }) {
  const [adapter, setAdapter] = useState(p?.adapter ?? "MOCK_SMS");
  const [name, setName] = useState(p?.name ?? "");
  const [mode, setMode] = useState(p?.mode ?? "MOCK");
  const [isDefault, setDefault] = useState(p?.is_default ?? true);
  const [config, setConfig] = useState<Record<string, any>>(p?.config ?? {});
  const [secret, setSecret] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => {
      const body = { name, mode, is_default: isDefault, config, ...(secret ? { secret } : {}) };
      return p ? patch(`/notify/providers/${p.id}`, { ...body, version: p.version }) : post("/notify/providers", { ...body, adapter });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["providers"] }); toast({ tone: "success", title: "ذخیره شد" }); onClose(); },
    onError: (e: any) => toast({ tone: "error", title: "ذخیره نشد", body: e instanceof ApiError ? e.message : String(e) }),
  });
  const isMock = adapter.startsWith("MOCK");
  const c = (k: string, label: string, opts: { ltr?: boolean; hint?: string; type?: string } = {}) => (
    <Field label={label} hint={opts.hint}><Input dir={opts.ltr ? "ltr" : undefined} type={opts.type} className={opts.ltr ? "text-left" : undefined} value={config[k] ?? ""} onChange={(e) => setConfig({ ...config, [k]: opts.type === "number" ? +e.target.value : e.target.value })} /></Field>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={p ? "ویرایش اتصال" : "اتصال جدید"} size="lg" description="اسرار فقط نوشتنی‌اند: پس از ذخیره هرگز نمایش یا بازگردانده نمی‌شوند. تغییر تنظیمات یا کلید، حالت ارسال واقعی را تا آزمون مجدد غیرفعال می‌کند."
      footer={<Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="نوع اتصال"><Select disabled={!!p} value={adapter} onChange={(e) => { setAdapter(e.target.value); setMode(e.target.value.startsWith("MOCK") ? "MOCK" : "DISABLED"); }}>{Object.entries(ADAPTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
        <Field label="نام"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="حالت" hint="«ارسال واقعی» فقط پس از آزمون اتصال و ارسال آزمایشی موفق مجاز است.">
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            {(isMock ? ["MOCK", "DISABLED"] : ["DISABLED", "CONFIGURED", "LIVE"]).map((k) => <option key={k} value={k} disabled={k === "LIVE" && !p?.live_verified_at}>{PROVIDER_MODE[k]}{k === "LIVE" && !p?.live_verified_at ? " (نیازمند تأیید)" : ""}</option>)}
          </Select>
        </Field>
        <div className="flex items-center justify-between min-h-11 self-end"><span className="text-[14px]">پیش‌فرض این کانال</span><Switch label="پیش‌فرض" checked={isDefault} onChange={setDefault} /></div>
        {isMock && <>
          <div className="flex items-center justify-between min-h-11 sm:col-span-2"><span className="text-[14px]">شبیه‌سازی خطای سرویس‌دهنده (برای آزمون مسیر خطا)</span><Switch label="شبیه‌سازی خطا" checked={!!config.simulate_failure} onChange={(v) => setConfig({ ...config, simulate_failure: v })} /></div>
          {c("test_recipient", "گیرنده آزمون", { ltr: true })}
        </>}
        {adapter === "HTTP_SMS" && <>
          {c("endpoint", "نشانی HTTPS ارسال", { ltr: true })}
          {c("sender", "خط فرستنده / شناسه الگو", { ltr: true })}
          {c("pattern_id", "شناسه الگوی تأییدشده (اختیاری)", { ltr: true })}
          {c("auth_header", "نام سربرگ احراز هویت", { ltr: true, hint: "پیش‌فرض Authorization" })}
          {c("auth_scheme", "طرح احراز هویت", { ltr: true, hint: "مثلاً Bearer" })}
          {c("timeout", "مهلت (ثانیه)", { type: "number", ltr: true })}
          {c("rate_limit_per_minute", "سقف ارسال در دقیقه", { type: "number", ltr: true })}
          {c("test_recipient", "شماره آزمون تأییدشده", { ltr: true })}
        </>}
        {adapter === "SMTP" && <>
          {c("host", "میزبان SMTP", { ltr: true })}
          {c("port", "درگاه", { type: "number", ltr: true })}
          <Field label="امنیت اتصال"><Select value={config.security ?? "STARTTLS"} onChange={(e) => setConfig({ ...config, security: e.target.value })}><option value="STARTTLS">STARTTLS</option><option value="SSL_TLS">SSL/TLS</option></Select></Field>
          {c("username", "نام کاربری", { ltr: true })}
          {c("from_address", "نشانی فرستنده تأییدشده (From)", { ltr: true, hint: "کاربران نمی‌توانند فرستنده را تغییر دهند." })}
          {c("from_name", "نام نمایشی فرستنده")}
          {c("reply_to", "Reply-To (اختیاری)", { ltr: true })}
          <Field label="دامنه‌های مجاز فرستنده" hint="جداشده با ویرگول"><Input dir="ltr" className="text-left" value={(config.allowed_sender_domains ?? []).join?.(",") ?? config.allowed_sender_domains ?? ""} onChange={(e) => setConfig({ ...config, allowed_sender_domains: e.target.value })} /></Field>
          <Field label="دامنه‌های مجاز گیرنده (اختیاری)"><Input dir="ltr" className="text-left" value={(config.allowed_recipient_domains ?? []).join?.(",") ?? config.allowed_recipient_domains ?? ""} onChange={(e) => setConfig({ ...config, allowed_recipient_domains: e.target.value })} /></Field>
          {c("test_recipient", "ایمیل آزمون تأییدشده", { ltr: true })}
        </>}
        {!isMock && <Field label={adapter === "SMTP" ? "رمز SMTP" : "کلید API"} className="sm:col-span-2" hint={p?.secret_set ? "مقداری ثبت شده است؛ برای جایگزینی وارد کنید." : "ذخیره رمزنگاری‌شده در سرور"}>
          <Input type="password" dir="ltr" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={p?.secret_set ? "••••••••" : ""} />
        </Field>}
        <p className="sm:col-span-2 text-[12.5px] text-muted">نام میزبان، دامنه یا اطلاعات واقعی سرور سازمان پیش‌فرض نشده است؛ این مقادیر باید از واحد فناوری اطلاعات دریافت شود. هماهنگی SPF/DKIM/DMARC با مدیران ایمیل سازمان الزامی است.</p>
      </div>
    </Dialog>
  );
}

function TestDialog({ p, onClose }: { p: any; onClose: () => void }) {
  const [to, setTo] = useState(p.config.test_recipient ?? "");
  const [result, setResult] = useState<any>(null);
  const qc = useQueryClient();
  const run = useMutation({ mutationFn: (kind: string) => post(`/notify/providers/${p.id}/test/${kind}`, { to }), onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ["providers"] }); }, onError: (e: any) => setResult({ ok: false, message: e.message }) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`آزمون ${p.name}`} description="آزمون اتصال پیامی ارسال نمی‌کند. ارسال آزمایشی فقط به موبایل/ایمیل خودتان یا گیرنده آزمون تأییدشده مجاز است.">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={run.isPending && run.variables === "connection"} onClick={() => run.mutate("connection")}><Plug className="size-4" />آزمون اتصال (DNS/TLS)</Button>
        </div>
        <Field label="گیرنده آزمایشی"><Input dir="ltr" className="text-left" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button loading={run.isPending && run.variables === "send"} onClick={() => run.mutate("send")}><Send className="size-4" />ارسال آزمایشی</Button>
        {result && (
          <div role="status" className={`rounded-[12px] p-3 text-[14px] leading-7 ${result.ok || result.status === "SENT" ? "bg-success-soft text-success" : result.status === "SIMULATED" ? "bg-warning-soft text-warning" : "bg-danger-soft text-danger"}`}>
            {result.status === "SIMULATED" ? "شبیه‌سازی شد — هیچ پیام واقعی ارسال نشد." : result.message}
            {result.code && <div className="text-[12px] opacity-80">کد: <Ltr>{result.code}</Ltr>{result.latency_ms ? ` · ${faNum(result.latency_ms)}ms` : ""}</div>}
            {result.live_verified && <div className="font-semibold">اتصال برای ارسال واقعی تأیید شد.</div>}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Rules() {
  const q = useQuery({ queryKey: ["rules"], queryFn: () => get<any>("/notify/rules") });
  const t = useQuery({ queryKey: ["templates"], queryFn: () => get<any>("/notify/templates") });
  const [edit, setEdit] = useState<any | "new" | null>(null);
  const qc = useQueryClient();
  const toggle = useMutation({ mutationFn: (r: any) => patch(`/notify/rules/${r.id}`, { enabled: !r.enabled, version: r.version }), onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }) });
  return (
    <Card>
      <CardHeader title="قواعد اعلان" subtitle="اعلان درون‌برنامه برای ارجاع، وظیفه و درخواست اقدام همیشه فعال است؛ قواعد، پیامک/ایمیل یا گیرندگان بیشتر اضافه می‌کنند." actions={<Button size="sm" onClick={() => setEdit("new")}><Plus className="size-4" />قاعده جدید</Button>} />
      {q.isLoading ? <LoadingRows /> : !q.data?.rules.length ? <EmptyState title="قاعده‌ای تعریف نشده" /> : (
        <ul className="divide-y divide-line-2">
          {q.data.rules.map((r: any) => (
            <li key={r.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[220px]">
                <div className="font-semibold">{r.name}</div>
                <div className="text-[12.5px] text-muted">{r.trigger_label} ← {RECIPIENT_TYPE[r.recipient_type]} · {CHANNEL[r.channel]} · {r.template_name}{r.cooldown_minutes ? ` · خنک‌سازی ${faNum(r.cooldown_minutes)} دقیقه` : ""}{r.quiet_hours_enabled ? ` · سکوت ${r.quiet_start}–${r.quiet_end}` : ""}</div>
              </div>
              <Switch label={`فعال بودن ${r.name}`} checked={r.enabled} onChange={() => toggle.mutate(r)} />
              <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>ویرایش</Button>
            </li>
          ))}
        </ul>
      )}
      {edit && <RuleDialog rule={edit === "new" ? null : edit} triggers={q.data?.triggers ?? []} templates={t.data?.templates ?? []} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function RuleDialog({ rule, triggers, templates, onClose }: { rule: any | null; triggers: any[]; templates: any[]; onClose: () => void }) {
  const { me } = useAuth();
  const roles = useQuery({ queryKey: ["roles", "EVENT"], queryFn: () => get<any[]>("/roles?scope=EVENT") });
  const [v, setV] = useState<any>(rule ?? { name: "", trigger: "referral.created", recipient_type: "DIRECT_ASSIGNEE", channel: "SMS", template: "", delay_minutes: 0, quiet_hours_enabled: false, quiet_start: "22:00", quiet_end: "07:30", cooldown_minutes: 0, max_attempts: 3, priority: "NORMAL", enabled: true, event: null, recipient_role: null });
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({ mutationFn: () => (rule ? patch(`/notify/rules/${rule.id}`, v) : post("/notify/rules", v)), onSuccess: () => { qc.invalidateQueries({ queryKey: ["rules"] }); onClose(); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  const set = (k: string) => (e: any) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={rule ? "ویرایش قاعده" : "قاعده جدید"} size="lg" footer={<Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="نام" className="sm:col-span-2"><Input value={v.name} onChange={set("name")} /></Field>
        <Field label="رویداد آغازگر"><Select value={v.trigger} onChange={set("trigger")}>{triggers.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</Select></Field>
        <Field label="گیرنده"><Select value={v.recipient_type} onChange={set("recipient_type")}>{Object.entries(RECIPIENT_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        {v.recipient_type === "EVENT_ROLE" && <Field label="نقش"><Select value={v.recipient_role ?? ""} onChange={set("recipient_role")}><option value="">—</option>{roles.data?.map((r) => <option key={r.code} value={r.code}>{r.name_fa}</option>)}</Select></Field>}
        <Field label="محدوده رویداد"><Select value={v.event ?? ""} onChange={(e) => setV({ ...v, event: e.target.value || null })}><option value="">همه رویدادها</option>{me?.events.map((e) => <option key={e.id} value={e.id}>{e.display_name}</option>)}</Select></Field>
        <Field label="کانال"><Select value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value, template: "" })}>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="قالب"><Select value={v.template} onChange={set("template")}><option value="">انتخاب…</option>{templates.filter((t) => t.channel === v.channel).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        <Field label="تأخیر (دقیقه)"><Input type="number" dir="ltr" value={v.delay_minutes} onChange={(e) => setV({ ...v, delay_minutes: +e.target.value })} /></Field>
        <Field label="خنک‌سازی/حذف تکرار (دقیقه)"><Input type="number" dir="ltr" value={v.cooldown_minutes} onChange={(e) => setV({ ...v, cooldown_minutes: +e.target.value })} /></Field>
        <Field label="حداکثر تلاش"><Input type="number" dir="ltr" min={1} max={10} value={v.max_attempts} onChange={(e) => setV({ ...v, max_attempts: +e.target.value })} /></Field>
        <Field label="اولویت"><Select value={v.priority} onChange={set("priority")}>{Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3 min-h-11">
          <Switch label="ساعات سکوت" checked={v.quiet_hours_enabled} onChange={(x) => setV({ ...v, quiet_hours_enabled: x })} /><span className="text-[14px]">ساعات سکوت (به وقت تهران)</span>
          {v.quiet_hours_enabled && <><Input type="time" dir="ltr" className="w-32" value={v.quiet_start ?? ""} onChange={set("quiet_start")} aria-label="شروع سکوت" /><span>تا</span><Input type="time" dir="ltr" className="w-32" value={v.quiet_end ?? ""} onChange={set("quiet_end")} aria-label="پایان سکوت" /></>}
        </div>
      </div>
    </Dialog>
  );
}

function Templates() {
  const q = useQuery({ queryKey: ["templates"], queryFn: () => get<any>("/notify/templates") });
  const [edit, setEdit] = useState<any | "new" | null>(null);
  return (
    <Card>
      <CardHeader title="قالب‌ها" subtitle="متغیرها فقط از فهرست مجاز؛ شماره مخاطبان، یادداشت حساس و اسرار هرگز در پیامک قرار نمی‌گیرند." actions={<Button size="sm" onClick={() => setEdit("new")}><Plus className="size-4" />قالب جدید</Button>} />
      {q.isLoading ? <LoadingRows /> : (
        <ul className="divide-y divide-line-2">
          {q.data?.templates.map((t: any) => (
            <li key={t.id} className="px-5 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0"><div className="font-semibold">{t.name} <Badge tone="neutral">{CHANNEL[t.channel]}</Badge>{!t.is_active && <Badge tone="neutral">غیرفعال</Badge>}</div><p className="text-[13px] text-muted mt-1 line-clamp-2">{t.body}</p></div>
              <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>ویرایش</Button>
            </li>
          ))}
        </ul>
      )}
      {edit && <TemplateDialog t={edit === "new" ? null : edit} vars={q.data?.variables ?? []} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function TemplateDialog({ t, vars, onClose }: { t: any | null; vars: { name: string; label: string }[]; onClose: () => void }) {
  const [v, setV] = useState({ code: t?.code ?? "", name: t?.name ?? "", channel: t?.channel ?? "SMS", subject: t?.subject ?? "", body: t?.body ?? "", body_html: t?.body_html ?? "", is_active: t?.is_active ?? true });
  const [pv, setPv] = useState<any>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({ mutationFn: () => (t ? patch(`/notify/templates/${t.id}`, { ...v, version: t.version }) : post("/notify/templates", v)), onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); onClose(); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  const preview = useMutation({ mutationFn: () => post("/notify/templates/preview", v), onSuccess: setPv });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t ? "ویرایش قالب" : "قالب جدید"} size="xl"
      footer={<><Button variant="secondary" loading={preview.isPending} onClick={() => preview.mutate()}>پیش‌نمایش</Button><Button loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button></>}>
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_280px] gap-5">
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="کد"><Input dir="ltr" disabled={!!t} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} /></Field>
            <Field label="نام"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
            <Field label="کانال"><Select disabled={!!t} value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value })}>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          </div>
          {v.channel !== "SMS" && <Field label="موضوع"><Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>}
          <Field label="متن ساده"><Textarea rows={5} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
          {v.channel === "EMAIL" && <Field label="HTML (اختیاری؛ مقادیر به‌صورت امن escape می‌شوند)"><Textarea dir="ltr" rows={4} className="font-mono text-[13px]" value={v.body_html} onChange={(e) => setV({ ...v, body_html: e.target.value })} /></Field>}
          {pv && <div className="rounded-[14px] bg-canvas border border-line-2 p-4 text-[14px] leading-7 whitespace-pre-wrap">{pv.subject && <b className="block">{pv.subject}</b>}{pv.body}{v.channel === "SMS" && <div className="text-[12px] text-muted mt-2">طول پیامک: {faNum(pv.sms_length)} نویسه</div>}{pv.unknown_variables?.length > 0 && <div className="text-danger">متغیر غیرمجاز: {pv.unknown_variables.join("، ")}</div>}</div>}
        </div>
        <div>
          <div className="text-[13px] font-semibold mb-2">متغیرهای مجاز</div>
          <ul className="space-y-1">{vars.map((x) => <li key={x.name}><button type="button" className="w-full flex justify-between text-[13px] px-2 py-1.5 rounded-lg hover:bg-line-2" onClick={() => setV({ ...v, body: `${v.body}{{${x.name}}}` })}><span>{x.label}</span><Ltr className="font-mono text-[11.5px] text-muted">{`{{${x.name}}}`}</Ltr></button></li>)}</ul>
        </div>
      </div>
    </Dialog>
  );
}

function Logs() {
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["jobs", channel, status], queryFn: () => get<Page<any>>(`/notify/jobs${qs({ channel, status, page_size: 50 })}`) });
  const qc = useQueryClient();
  const retry = useMutation({ mutationFn: (id: string) => post(`/notify/jobs/${id}/retry`), onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }) });
  return (
    <Card>
      <CardHeader title="گزارش تحویل" subtitle="وضعیت بر اساس پاسخ واقعی سرویس‌دهنده؛ «شبیه‌سازی» یعنی ارسال واقعی انجام نشده است." actions={<Button size="icon-sm" variant="ghost" aria-label="تازه‌سازی" onClick={() => q.refetch()}><RefreshCw className="size-4" /></Button>} />
      <div className="px-5 pb-3 flex flex-wrap gap-2">
        <Segmented size="sm" label="کانال" value={channel} onChange={setChannel} options={[{ value: "", label: "همه" }, { value: "IN_APP", label: "درون‌برنامه" }, { value: "SMS", label: "پیامک" }, { value: "EMAIL", label: "ایمیل" }]} />
        <Segmented size="sm" label="وضعیت" value={status} onChange={setStatus} options={[{ value: "", label: "همه" }, { value: "FAILED,DEAD", label: "ناموفق" }, { value: "SIMULATED", label: "شبیه‌سازی" }, { value: "SKIPPED", label: "ارسال‌نشده" }, { value: "PENDING", label: "در صف" }]} />
      </div>
      {q.isLoading ? <LoadingRows /> : !q.data?.results.length ? <EmptyState icon={<Activity className="size-6" />} title="گزارشی نیست" /> : (
        <ul className="divide-y divide-line-2">
          {q.data.results.map((j: any) => (
            <li key={j.id} className="px-5 py-3 text-[13.5px] space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{CHANNEL[j.channel]}</Badge><JobStatus s={j.status} />
                <b className="truncate max-w-[320px]">{j.subject || j.event_type}</b>
                <span className="text-muted">← {j.recipient?.full_name}</span>
                <span className="text-muted ms-auto text-[12px]">{fmtDateTime(j.created_at)}</span>
              </div>
              <div className="text-[12.5px] text-muted">{j.rule ? `قاعده: ${j.rule}` : j.campaign ? `پیام: ${j.campaign}` : "سیستمی"} · تلاش {faNum(j.attempts)}/{faNum(j.max_attempts)}{j.skip_reason && ` · ${SKIP_REASON[j.skip_reason] ?? j.skip_reason}`}{j.status === "PENDING" && ` · زمان‌بندی ${fmtDateTime(j.scheduled_at)}`}</div>
              {j.last_error && <div className="text-[12.5px] text-danger">{j.last_error}</div>}
              {j.delivery.map((d: any) => <div key={d.attempt_no} className="text-[12px] text-muted">#{faNum(d.attempt_no)} {d.provider} · {d.status}{d.is_mock && " (Mock)"} · <Ltr>{d.reason_code}</Ltr>{d.provider_message_id && <> · <Ltr>{d.provider_message_id}</Ltr></>}{d.cost != null && ` · هزینه ${d.cost}`}</div>)}
              {["DEAD", "FAILED", "SKIPPED"].includes(j.status) && j.channel !== "IN_APP" && <Button size="sm" variant="secondary" loading={retry.isPending && retry.variables === j.id} onClick={() => retry.mutate(j.id)}>ارسال مجدد</Button>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
