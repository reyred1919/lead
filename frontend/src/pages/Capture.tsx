import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Building2, Check, CheckCircle2, CloudOff, Lock, Mail, Phone, Plus, Sparkles, UserRound, X } from "lucide-react";
import { ApiError, get, post, qs } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced, useOnline } from "@/lib/hooks";
import { newRecordId, offlineQueue, type CapturePayload } from "@/lib/offline";
import { fmtPhone, relTime, toLatinDigits } from "@/lib/format";
import { Button, Card, EmptyState, Field, Input, Ltr, Segmented, Textarea, cn } from "@/components/ui/primitives";
import { QualityBadge } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";

type EventProduct = { id: string; code: string; name_fa: string; name_en: string; plan_name: string | null };
type MyEvent = { id: string; code: string; display_name: string; status: string; city: string; venue: string; can_capture: boolean; products: EventProduct[] };

const mobileRe = /^(?:\+?98|0098|0)?9\d{9}$/;
const schema = z
  .object({
    contact_name: z.string().trim().min(1, "نام مخاطب الزامی است.").max(200),
    contact_method: z.enum(["mobile", "email"]),
    mobile: z.string().optional(),
    email: z.string().optional(),
    product_ids: z.array(z.string()).min(1, "حداقل یک محصول مورد علاقه را انتخاب کنید."),
    quality: z.enum(["SERIOUS", "FOLLOW_UP", "INTRO"]),
    note: z.string().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.contact_method === "mobile") {
      const m = toLatinDigits(v.mobile ?? "").replace(/[\s\-()]/g, "");
      if (!m) ctx.addIssue({ code: "custom", path: ["mobile"], message: "شماره موبایل یا ایمیل معتبر الزامی است." });
      else if (!mobileRe.test(m)) ctx.addIssue({ code: "custom", path: ["mobile"], message: "شماره موبایل معتبر نیست (نمونه: ۰۹۱۲۳۴۵۶۷۸۹)." });
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test((v.email ?? "").trim())) {
      ctx.addIssue({ code: "custom", path: ["email"], message: "ایمیل معتبر وارد کنید." });
    }
  });
type FormV = z.infer<typeof schema>;

type Account = { id: string; name: string; city?: string; exact?: boolean };
type ContactHit = { id: string; full_name: string; mobile_masked: string; account: { id: string; name: string } | null; same_mobile: boolean };
type Done = { kind: "synced" | "queued"; id?: string; name: string; duplicate?: boolean };

export function useMyEvents() {
  const { me } = useAuth();
  return useQuery({
    queryKey: ["my-events"],
    enabled: !!me,
    queryFn: async () => {
      try {
        const data = await get<MyEvent[]>("/events/mine");
        if (me) offlineQueue.cacheEvents(me.user.id, data).catch(() => undefined);
        return data;
      } catch (e) {
        if (e instanceof ApiError && e.isNetwork) {
          const cached = await offlineQueue.cachedEvents();
          if (cached) return cached as MyEvent[];
        }
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function CapturePage() {
  const { me, activeEventId, setActiveEventId } = useAuth();
  const events = useMyEvents();
  const captureEvents = (events.data ?? []).filter((e) => e.can_capture);
  const event = captureEvents.find((e) => e.id === activeEventId) ?? captureEvents[0];
  const online = useOnline();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const nameRef = useRef<HTMLInputElement | null>(null);

  const [account, setAccount] = useState<Account | null>(null);
  const [orgText, setOrgText] = useState("");
  const [individual, setIndividual] = useState(false);
  const [contact, setContact] = useState<ContactHit | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const recordId = useRef(newRecordId());

  const form = useForm<FormV>({
    resolver: zodResolver(schema),
    defaultValues: { contact_name: "", contact_method: "mobile", mobile: "", email: "", product_ids: [], quality: "FOLLOW_UP", note: "" },
  });
  const { register, handleSubmit, watch, setValue, control, formState: { errors }, reset } = form;
  const method = watch("contact_method");
  const mobile = watch("mobile");
  const selected = watch("product_ids");

  useEffect(() => {
    if (event && event.products.length === 1 && !selected.length) setValue("product_ids", [event.products[0].id]);
  }, [event?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Search-first suggestions (never blocking).
  const debouncedMobile = useDebounced(toLatinDigits(mobile ?? "").replace(/[\s\-()]/g, ""), 300);
  const contactHits = useQuery({
    queryKey: ["contact-hits", debouncedMobile],
    enabled: online && mobileRe.test(debouncedMobile) && !contact,
    queryFn: () => get<ContactHit[]>(`/contacts/search${qs({ mobile: debouncedMobile })}`),
  });
  const debouncedOrg = useDebounced(orgText, 250);
  const orgHits = useQuery({
    queryKey: ["org-hits", debouncedOrg],
    enabled: online && debouncedOrg.trim().length >= 2 && !account,
    queryFn: () => get<Account[]>(`/accounts/search${qs({ q: debouncedOrg })}`),
  });

  const recent = useQuery({ queryKey: ["dashboard-personal"], queryFn: () => get<any>("/dashboard"), enabled: online });

  const resetForm = () => {
    reset({ contact_name: "", contact_method: method, mobile: "", email: "", product_ids: event?.products.length === 1 ? [event.products[0].id] : [], quality: "FOLLOW_UP", note: "" });
    setAccount(null);
    setOrgText("");
    setIndividual(false);
    setContact(null);
    setServerErrors({});
    recordId.current = newRecordId();
    setDone(null);
    setTimeout(() => nameRef.current?.focus(), 50);
  };

  const onSubmit = async (v: FormV) => {
    if (!event) return;
    setServerErrors({});
    setSubmitting(true);
    const payload: CapturePayload = {
      client_record_id: recordId.current,
      event_id: event.id,
      captured_at: new Date().toISOString(),
      captured_offline: true,
      contact_name: v.contact_name.trim(),
      mobile: v.contact_method === "mobile" ? toLatinDigits(v.mobile ?? "") : "",
      email: v.contact_method === "email" ? (v.email ?? "").trim() : "",
      org_name: individual ? "" : account ? "" : orgText.trim(),
      account_id: individual ? undefined : account?.id,
      contact_id: contact?.id,
      product_ids: v.product_ids,
      quality: v.quality,
      note: v.note?.trim(),
    };
    const queue = async () => {
      await offlineQueue.enqueue(payload, event.code);
      setDone({ kind: "queued", name: payload.contact_name });
    };
    try {
      if (!navigator.onLine) {
        await queue();
        return;
      }
      const body: Partial<CapturePayload> = { ...payload };
      delete body.captured_offline;
      delete body.captured_at;
      const res = await post<any>("/interactions", body);
      setDone({ kind: "synced", id: res.id, name: payload.contact_name, duplicate: res.capture_status === "DUPLICATE" });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard-personal"] });
      qc.invalidateQueries({ queryKey: ["work-counts"] });
    } catch (e) {
      if (e instanceof ApiError && (e.isNetwork || e.status >= 502)) {
        await queue();
      } else if (e instanceof ApiError) {
        setServerErrors(e.fieldErrors());
        toast({ tone: "error", title: "ثبت انجام نشد", body: e.message });
      } else {
        toast({ tone: "error", title: "خطای ناشناخته", body: String(e) });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (events.isLoading) return <Card className="p-6"><div className="skeleton h-8 w-1/2 mb-4" /><div className="skeleton h-12 mb-3" /><div className="skeleton h-12" /></Card>;
  if (!event) {
    return (
      <Card>
        <EmptyState icon={<Lock className="size-6" />} title="ثبت لید در دسترس نیست"
          body={(events.data ?? []).length ? "رویدادهای شما در حال حاضر فعال نیستند. ثبت تازه فقط در رویداد فعال ممکن است؛ پیگیری لیدهای قبلی همچنان ادامه دارد." : "شما عضو فعال هیچ رویدادی نیستید. برای ثبت لید، مدیر سامانه باید شما را به تیم رویداد اضافه کند."}
          action={<Link to="/leads"><Button variant="secondary">مشاهده لیدها</Button></Link>} />
      </Card>
    );
  }

  if (done) {
    return (
      <div className="animate-rise">
        <Card className="p-8 text-center">
          <div className={cn("mx-auto size-16 rounded-full grid place-items-center mb-4", done.kind === "synced" ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
            {done.kind === "synced" ? <CheckCircle2 className="size-8" /> : <CloudOff className="size-8" />}
          </div>
          <h1 className="text-[24px] font-extrabold">{done.kind === "synced" ? "ثبت شد" : "در صف همگام‌سازی"}</h1>
          <p className="text-muted mt-2 leading-7">
            {done.kind === "synced"
              ? `${done.name} در رویداد ${event.display_name} ثبت شد.${done.duplicate ? " (این ثبت قبلاً ارسال شده بود؛ رکورد تکراری ایجاد نشد.)" : ""}`
              : `${done.name} روی این دستگاه به‌صورت رمزنگاری‌شده ذخیره شد و پس از اتصال خودکار ارسال می‌شود.`}
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center mt-6">
            <Button size="lg" onClick={resetForm} autoFocus><Plus className="size-5" />ثبت بعدی</Button>
            {done.id ? <Button size="lg" variant="secondary" onClick={() => nav(`/leads/${done.id}`)}>مشاهده جزئیات</Button> : <Button size="lg" variant="secondary" onClick={() => nav("/capture/queue")}>صف آفلاین</Button>}
          </div>
        </Card>
        <RecentCaptures data={recent.data} />
      </div>
    );
  }

  const err = (k: keyof FormV | string) => (errors as any)[k]?.message || serverErrors[k as string];

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {/* Sticky event context: auto-attached, never typed */}
      <div className="card p-4 flex items-center gap-3">
        <div className="size-11 rounded-[12px] bg-success-soft text-success grid place-items-center shrink-0"><Sparkles className="size-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-muted">ثبت در رویداد</div>
          {captureEvents.length > 1 ? (
            <select aria-label="رویداد" value={event.id} onChange={(e) => setActiveEventId(e.target.value)} className="font-bold text-[16px] bg-transparent outline-none max-w-full truncate">
              {captureEvents.map((e) => <option key={e.id} value={e.id}>{e.display_name}</option>)}
            </select>
          ) : (
            <div className="font-bold text-[16px] leading-7 flex items-start gap-1.5">
              <span className="line-clamp-2 break-words">{event.display_name}</span>
              <Lock className="size-3.5 text-muted shrink-0 mt-1.5" role="img" aria-label="رویداد قفل‌شده" />
            </div>
          )}
        </div>
        <Ltr className="hidden sm:inline-block text-[12px] text-muted font-mono bg-line-2 px-2 py-1 rounded-md shrink-0">{event.code}</Ltr>
      </div>
      {!online && (
        <div role="status" className="rounded-[14px] bg-warning-soft text-warning px-4 py-3 text-[13.5px] flex gap-2 items-start"><CloudOff className="size-4 mt-0.5 shrink-0" />آفلاین هستید. ثبت روی همین دستگاه رمزنگاری و ذخیره می‌شود و بعداً ارسال خواهد شد.</div>
      )}

      <Card className="p-5 space-y-5">
        <Field label="نام مخاطب" required htmlFor="contact_name" error={err("contact_name")}>
          <div className="relative">
            <UserRound className="absolute start-3.5 top-3.5 size-5 text-muted" aria-hidden />
            <Input id="contact_name" autoComplete="off" className="ps-11" {...register("contact_name")} ref={(el) => { register("contact_name").ref(el); nameRef.current = el; }} aria-invalid={!!err("contact_name")} placeholder="مثلاً سارا احمدی" autoFocus />
          </div>
        </Field>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink-2">راه تماس<span className="text-danger ms-1" aria-hidden>*</span></span>
            <Controller control={control} name="contact_method" render={({ field }) => (
              <Segmented size="sm" label="نوع راه تماس" value={field.value} onChange={field.onChange} options={[{ value: "mobile", label: <><Phone className="size-3.5" />موبایل</> }, { value: "email", label: <><Mail className="size-3.5" />ایمیل</> }]} />
            )} />
          </div>
          {method === "mobile" ? (
            <Field label={<span className="sr-only">شماره موبایل</span>} htmlFor="mobile" error={err("mobile")}>
              <Input id="mobile" inputMode="tel" autoComplete="off" dir="ltr" className="text-left num tracking-wide" placeholder="0912 345 6789" {...register("mobile")} aria-invalid={!!err("mobile")} />
            </Field>
          ) : (
            <Field label={<span className="sr-only">ایمیل</span>} htmlFor="email" error={err("email")}>
              <Input id="email" type="email" inputMode="email" dir="ltr" className="text-left" placeholder="name@company.com" {...register("email")} aria-invalid={!!err("email")} />
            </Field>
          )}
          {contact ? (
            <div className="flex items-center gap-2 rounded-[12px] bg-action-soft px-3 py-2 text-[13.5px]">
              <Check className="size-4 text-action" />اتصال به مخاطب موجود: <b>{contact.full_name}</b>
              <button type="button" className="ms-auto text-muted" aria-label="لغو اتصال" onClick={() => setContact(null)}><X className="size-4" /></button>
            </div>
          ) : (contactHits.data ?? []).length > 0 && (
            <div className="rounded-[12px] border border-line p-2 space-y-1">
              <div className="text-[12px] text-muted px-1">مخاطب(های) موجود با این شماره — در صورت یکسان بودن انتخاب کنید (اختیاری):</div>
              {contactHits.data!.map((c) => (
                <button key={c.id} type="button" onClick={() => { setContact(c); setValue("contact_name", c.full_name); if (c.account) { setAccount({ id: c.account.id, name: c.account.name }); setIndividual(false); } }}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-[10px] hover:bg-line-2 text-start min-h-11">
                  <UserRound className="size-4 text-muted" />
                  <span className="font-semibold">{c.full_name}</span>
                  {c.account && <span className="text-muted text-[13px] truncate">· {c.account.name}</span>}
                  <Ltr className="ms-auto text-[12px] text-muted">{c.mobile_masked}</Ltr>
                </button>
              ))}
            </div>
          )}
        </div>

        <Field label="محصول مورد علاقه" required error={err("product_ids")} hint="فقط محصولات ارائه‌شده در این رویداد نمایش داده می‌شوند.">
          <Controller control={control} name="product_ids" render={({ field }) => (
            <div role="group" aria-label="محصولات" className="flex flex-wrap gap-2">
              {event.products.map((p) => {
                const on = field.value.includes(p.id);
                return (
                  <button key={p.id} type="button" aria-pressed={on} onClick={() => field.onChange(on ? field.value.filter((x) => x !== p.id) : [...field.value, p.id])}
                    className={cn("min-h-11 px-3.5 rounded-[12px] border text-[14px] font-medium inline-flex items-center gap-2 transition-colors text-start",
                      on ? "bg-action text-white border-action" : "bg-panel border-line hover:border-[#c9d3e1]")}>
                    {on && <Check className="size-4" />}
                    <span>{p.name_fa}</span>
                  </button>
                );
              })}
            </div>
          )} />
        </Field>
      </Card>

      <Card className="p-5 space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label htmlFor="org" className="text-[13px] font-semibold text-ink-2">سازمان / شرکت <span className="text-muted font-normal">(اختیاری)</span></label>
            <button type="button" aria-pressed={individual} onClick={() => { setIndividual(!individual); setAccount(null); setOrgText(""); }}
              className={cn("text-[12.5px] h-8 px-2.5 rounded-[9px] border", individual ? "bg-navy text-white border-navy" : "border-line text-muted")}>شخص حقیقی</button>
          </div>
          {!individual && (account ? (
            <div className="flex items-center gap-2 h-12 px-3.5 rounded-[12px] border border-action bg-action-soft">
              <Building2 className="size-4 text-action" /><span className="font-semibold flex-1 truncate">{account.name}</span>
              <span className="text-[12px] text-action">سازمان موجود</span>
              <button type="button" aria-label="حذف سازمان" onClick={() => setAccount(null)} className="text-muted"><X className="size-4" /></button>
            </div>
          ) : (
            <div className="relative">
              <Building2 className="absolute start-3.5 top-3.5 size-5 text-muted" aria-hidden />
              <Input id="org" className="ps-11" value={orgText} onChange={(e) => setOrgText(e.target.value)} placeholder="جست‌وجو یا نام سازمان جدید" autoComplete="off" />
              {(orgHits.data ?? []).length > 0 && orgText && (
                <ul className="mt-1.5 rounded-[12px] border border-line p-1 bg-panel" aria-label="سازمان‌های موجود">
                  {orgHits.data!.map((a) => (
                    <li key={a.id}><button type="button" onClick={() => { setAccount(a); setOrgText(""); }} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[10px] hover:bg-line-2 text-start min-h-11">
                      <Building2 className="size-4 text-muted" /><span className="flex-1 truncate">{a.name}</span>{a.city && <span className="text-[12px] text-muted">{a.city}</span>}
                    </button></li>
                  ))}
                  <li className="px-2.5 py-1.5 text-[12px] text-muted">یا ادامه دهید تا «{orgText}» به‌عنوان سازمان جدید ثبت شود.</li>
                </ul>
              )}
            </div>
          ))}
        </div>

        <Field label="کیفیت گفت‌وگو">
          <Controller control={control} name="quality" render={({ field }) => (
            <Segmented label="کیفیت گفت‌وگو" value={field.value} onChange={field.onChange} className="w-full [&>button]:flex-1 [&>button]:justify-center"
              options={[{ value: "SERIOUS", label: "جدی" }, { value: "FOLLOW_UP", label: "قابل‌پیگیری" }, { value: "INTRO", label: "آشنایی" }]} />
          )} />
        </Field>

        <Field label="یادداشت کوتاه" htmlFor="note" error={err("note")}>
          <Textarea id="note" rows={3} {...register("note")} placeholder="نیاز، زمان‌بندی یا نکته مهم گفت‌وگو" />
        </Field>
      </Card>

      <div className="sticky bottom-20 lg:bottom-4 z-10">
        <Button type="submit" size="lg" className="w-full shadow-[0_10px_30px_rgb(35_104_229/0.35)]" loading={submitting}>
          {online ? "ثبت لید" : "ذخیره آفلاین"}
        </Button>
      </div>
      <p className="text-center text-[12px] text-muted">رویداد، ثبت‌کننده ({me?.user.full_name}) و زمان به‌صورت خودکار ثبت می‌شوند.</p>
      <RecentCaptures data={recent.data} />
    </form>
  );
}

function RecentCaptures({ data }: { data: any }) {
  const items = data?.personal?.recent ?? [];
  const local = useLocalQueue();
  if (!items.length && !local.length) return null;
  return (
    <Card className="mt-4">
      <div className="px-5 pt-4 pb-2 text-[13px] font-bold text-muted">آخرین ثبت‌های من</div>
      <ul className="divide-y divide-line-2">
        {local.map((q) => (
          <li key={q.id} className="px-5 py-3 flex items-center gap-3">
            <CloudOff className="size-4 text-warning" /><span className="flex-1 truncate">{q.payload?.contact_name ?? "ثبت آفلاین"}</span>
            <span className="text-[12px] text-warning">در صف</span>
          </li>
        ))}
        {items.slice(0, 3).map((r: any) => (
          <li key={r.id}><Link to={`/leads/${r.id}`} className="px-5 py-3 flex items-center gap-3 hover:bg-line-2/50">
            <CheckCircle2 className="size-4 text-success" />
            <span className="flex-1 min-w-0"><span className="font-semibold">{r.contact_name}</span>{r.account_name && <span className="text-muted text-[13px]"> · {r.account_name}</span>}</span>
            <QualityBadge q={r.quality} />
            <span className="text-[12px] text-muted">{relTime(r.captured_at)}</span>
          </Link></li>
        ))}
      </ul>
    </Card>
  );
}

function useLocalQueue() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof offlineQueue.list>>>([]);
  useEffect(() => {
    const load = () => offlineQueue.list().then((l) => setItems(l.filter((i) => i.status === "queued" || i.status === "syncing").slice(-3))).catch(() => undefined);
    load();
    const unsub = offlineQueue.subscribe(load);
    return () => { unsub(); };
  }, []);
  return items;
}

export function OfflineQueuePage() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof offlineQueue.list>>>([]);
  const online = useOnline();
  useEffect(() => {
    const load = () => offlineQueue.list().then(setItems).catch(() => undefined);
    load();
    const unsub = offlineQueue.subscribe(load);
    return () => { unsub(); };
  }, []);
  const sorted = useMemo(() => [...items].reverse(), [items]);
  const label: Record<string, [string, string]> = {
    queued: ["در صف همگام‌سازی", "text-warning"], syncing: ["در حال ارسال", "text-info"], synced: ["همگام‌شده", "text-success"],
    failed: ["ناموفق — نیاز به اصلاح یا حذف", "text-danger"], review: ["در انتظار بازبینی مدیر (رویداد بسته شده)", "text-info"],
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[24px] font-extrabold">صف ثبت‌های آفلاین</h1>
        <Button variant="secondary" disabled={!online} onClick={() => offlineQueue.syncNow()}>همگام‌سازی اکنون</Button>
      </div>
      <p className="text-[13.5px] text-muted leading-7">ثبت‌ها با کلید یکتا ارسال می‌شوند؛ تلاش مجدد هرگز رکورد تکراری نمی‌سازد و هیچ ثبتی به رویداد دیگری منتسب نمی‌شود.</p>
      <Card>
        {!sorted.length ? <EmptyState title="صف خالی است" body="همه ثبت‌های این دستگاه با سرور همگام هستند." /> : (
          <ul className="divide-y divide-line-2">
            {sorted.map((i) => (
              <li key={i.id} className="px-5 py-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-semibold">{i.payload?.contact_name ?? (i.interaction_id ? "ثبت همگام‌شده" : "—")}</div>
                  <div className="text-[12.5px] text-muted">رویداد <Ltr>{i.event_code}</Ltr> · {relTime(i.created_at)} {i.payload?.mobile && <>· <Ltr>{fmtPhone(i.payload.mobile)}</Ltr></>}</div>
                  {i.error && i.status === "failed" && <div className="text-[12.5px] text-danger mt-1">{i.error}</div>}
                </div>
                <span className={cn("text-[13px] font-semibold", label[i.status][1])}>{label[i.status][0]}</span>
                {i.status === "failed" && <>
                  <Button size="sm" variant="secondary" onClick={() => offlineQueue.retry(i.id)}>تلاش مجدد</Button>
                  <Button size="sm" variant="danger-soft" onClick={() => offlineQueue.discard(i.id)}>حذف</Button>
                </>}
                {i.interaction_id && <Link to={`/leads/${i.interaction_id}`} className="text-action text-[13px] font-semibold">مشاهده</Link>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
