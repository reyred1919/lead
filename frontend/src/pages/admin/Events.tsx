import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CalendarPlus, Copy, MapPin, Plus, UserPlus, Users } from "lucide-react";
import { ApiError, get, patch, post, qs, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { faNum, fmtDate, fmtDateTime } from "@/lib/format";
import { EVENT_STATUS } from "@/lib/labels";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, ErrorState, Field, Input, LoadingRows, Ltr, PageHeader, Segmented, Select, Textarea } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog } from "@/components/ui/overlay";
import { JalaliDatePicker } from "@/components/ui/datepicker";
import { EventStatus } from "@/components/ui/status";
import { UserPicker, type UserLite } from "@/components/ui/pickers";
import { useToast } from "@/components/ui/toast";

type Ev = {
  id: string; code: string; display_name: string; description: string; city: string; venue: string; starts_at: string; ends_at: string; status: string;
  owner: string | null; owner_name: string | null; sync_grace_hours: number; referral_sla_hours: number | null; version: number;
  product_count: number; member_count: number; interaction_count: number; can_manage?: boolean; can_manage_team?: boolean; allowed_transitions?: string[];
  activated_at: string | null; closed_at: string | null;
};

const TRANSITION_LABEL: Record<string, string> = { READY: "آماده‌سازی", ACTIVE: "فعال‌سازی", CLOSED: "پایان رویداد", ARCHIVED: "بایگانی", DRAFT: "بازگشت به پیش‌نویس" };

export function EventsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["events", status], queryFn: () => get<Page<Ev>>(`/events${qs({ status, page_size: 100 })}`) });
  const [create, setCreate] = useState(false);
  return (
    <div>
      <PageHeader title="رویدادها" subtitle="هر رویداد تیم، محصولات، مسئولیت‌ها و گزارش مستقل دارد؛ پیکربندی رویداد آینده بدون تغییر کد انجام می‌شود."
        actions={can("event.manage") && <Button onClick={() => setCreate(true)}><CalendarPlus className="size-4" />رویداد جدید</Button>} />
      <Segmented label="وضعیت" value={status} onChange={setStatus} className="mb-4" options={[{ value: "", label: "همه" }, ...Object.entries(EVENT_STATUS).map(([value, label]) => ({ value, label }))]} />
      {q.isLoading ? <Card><LoadingRows /></Card> : q.isError ? <Card><ErrorState error={q.error} /></Card> : !q.data?.results.length ? <Card><EmptyState title="رویدادی وجود ندارد" /></Card> : (
        <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 xl:grid-cols-3 gap-4">
          {q.data.results.map((e) => (
            <Link key={e.id} to={`/admin/events/${e.id}`} className="card p-5 hover:shadow-[var(--shadow-pop)] transition-shadow flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h2 className="font-bold text-[16.5px] leading-7">{e.display_name}</h2><Ltr className="text-[12px] text-muted font-mono">{e.code}</Ltr></div>
                <EventStatus s={e.status} />
              </div>
              <div className="text-[13.5px] text-muted flex items-center gap-1.5"><MapPin className="size-4" />{[e.city, e.venue].filter(Boolean).join(" · ") || "—"}</div>
              <div className="text-[13.5px] text-muted">{fmtDate(e.starts_at)} تا {fmtDate(e.ends_at)}</div>
              <div className="flex gap-4 text-[13px] mt-auto pt-2 border-t border-line-2">
                <span><b className="num">{faNum(e.member_count)}</b> عضو</span><span><b className="num">{faNum(e.product_count)}</b> محصول</span><span><b className="num">{faNum(e.interaction_count)}</b> ثبت</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <EventForm open={create} onOpenChange={setCreate} />
    </div>
  );
}

function EventForm({ open, onOpenChange, event }: { open: boolean; onOpenChange: (o: boolean) => void; event?: Ev }) {
  const [v, setV] = useState({
    code: event?.code ?? "", display_name: event?.display_name ?? "", city: event?.city ?? "", venue: event?.venue ?? "", description: event?.description ?? "",
    starts_at: event?.starts_at ?? null as string | null, ends_at: event?.ends_at ?? null as string | null,
    sync_grace_hours: event?.sync_grace_hours ?? 24, referral_sla_hours: event?.referral_sla_hours ?? ("" as number | ""),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => {
      const body = { ...v, referral_sla_hours: v.referral_sla_hours === "" ? null : v.referral_sla_hours };
      return event ? patch(`/events/${event.id}`, { ...body, code: undefined, version: event.version }) : post("/events", body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["events"] }); qc.invalidateQueries({ queryKey: ["event"] }); toast({ tone: "success", title: event ? "رویداد به‌روز شد" : "رویداد ایجاد شد (پیش‌نویس)" }); onOpenChange(false); },
    onError: (e: any) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); toast({ tone: "error", title: e.isConflict ? "تغییر هم‌زمان؛ صفحه را تازه کنید" : "ذخیره نشد", body: e.message }); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={event ? "ویرایش رویداد" : "رویداد جدید"} size="lg"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>انصراف</Button><Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button></>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="کد رویداد (تغییرناپذیر)" required error={errors.code} hint={event ? "پس از ایجاد قابل تغییر نیست." : "حروف لاتین، عدد و خط تیره"}>
          <Input dir="ltr" className="text-left font-mono uppercase" value={v.code} disabled={!!event} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="EXPO-1405" />
        </Field>
        <Field label="نام نمایشی" required error={errors.display_name}><Input value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} /></Field>
        <Field label="شهر"><Input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} /></Field>
        <Field label="محل برگزاری"><Input value={v.venue} onChange={(e) => setV({ ...v, venue: e.target.value })} /></Field>
        <Field label="شروع" required error={errors.starts_at}><JalaliDatePicker value={v.starts_at} onChange={(x) => setV({ ...v, starts_at: x })} /></Field>
        <Field label="پایان" required error={errors.ends_at}><JalaliDatePicker value={v.ends_at} onChange={(x) => setV({ ...v, ends_at: x })} /></Field>
        <Field label="مهلت همگام‌سازی آفلاین پس از پایان (ساعت)" hint="ثبت‌های آفلاینِ زمان رویداد تا این مهلت پذیرفته و پس از آن برای بازبینی مدیر نگه داشته می‌شوند.">
          <Input type="number" min={0} dir="ltr" value={v.sync_grace_hours} onChange={(e) => setV({ ...v, sync_grace_hours: +e.target.value })} />
        </Field>
        <Field label="SLA پذیرش ارجاع (ساعت، اختیاری)"><Input type="number" min={1} dir="ltr" value={v.referral_sla_hours} onChange={(e) => setV({ ...v, referral_sla_hours: e.target.value ? +e.target.value : "" })} /></Field>
        <Field label="توضیحات" className="sm:col-span-2"><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

export function EventDetailPage() {
  const { id = "" } = useParams();
  const q = useQuery({ queryKey: ["event", id], queryFn: () => get<Ev>(`/events/${id}`) });
  const [tab, setTab] = useState<"team" | "products" | "settings">("team");
  const [edit, setEdit] = useState(false);
  const [clone, setClone] = useState(false);
  const [transition, setTransition] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const tm = useMutation({
    mutationFn: (status: string) => post(`/events/${id}/transition`, { status, version: q.data?.version }),
    onSuccess: () => { setTransition(null); qc.invalidateQueries({ queryKey: ["event", id] }); qc.invalidateQueries({ queryKey: ["events"] }); toast({ tone: "success", title: "وضعیت رویداد تغییر کرد" }); },
    onError: (e: any) => { setTransition(null); toast({ tone: "error", title: e.message }); },
  });
  if (q.isLoading) return <Card><LoadingRows /></Card>;
  if (q.isError) return <Card><ErrorState error={q.error} /></Card>;
  const e = q.data!;
  return (
    <div className="space-y-5">
      <Link to="/admin/events" className="inline-flex items-center gap-1 text-[14px] text-muted min-h-9"><ArrowRight className="size-4" />رویدادها</Link>
      <PageHeader eyebrow={<Ltr className="font-mono">{e.code}</Ltr>} title={e.display_name} subtitle={`${[e.city, e.venue].filter(Boolean).join(" · ")} · ${fmtDate(e.starts_at)} تا ${fmtDate(e.ends_at)}`}
        actions={<>
          <EventStatus s={e.status} />
          {e.can_manage && e.allowed_transitions?.map((s) => <Button key={s} size="sm" variant={s === "ACTIVE" ? "primary" : s === "CLOSED" ? "danger-soft" : "secondary"} onClick={() => setTransition(s)}>{TRANSITION_LABEL[s]}</Button>)}
          {e.can_manage && <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>ویرایش</Button>}
          {e.can_manage && <Button size="sm" variant="secondary" onClick={() => setClone(true)}><Copy className="size-4" />کپی پیکربندی</Button>}
        </>} />
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4"><div className="text-[12.5px] text-muted">اعضا</div><div className="text-[24px] font-extrabold num">{faNum(e.member_count)}</div></Card>
        <Card className="p-4"><div className="text-[12.5px] text-muted">محصولات فعال</div><div className="text-[24px] font-extrabold num">{faNum(e.product_count)}</div></Card>
        <Card className="p-4"><div className="text-[12.5px] text-muted">ثبت‌ها</div><div className="text-[24px] font-extrabold num">{faNum(e.interaction_count)}</div></Card>
      </div>
      {e.status === "CLOSED" && <div className="rounded-[14px] bg-warning-soft text-warning px-4 py-3 text-[14px]">رویداد پایان یافته است: ثبت لید تازه بسته است، اما تکمیل اطلاعات و پیگیری لیدهای قبلی ادامه دارد.{e.closed_at && ` (پایان: ${fmtDateTime(e.closed_at)} · مهلت همگام‌سازی آفلاین ${faNum(e.sync_grace_hours)} ساعت)`}</div>}
      <Segmented label="بخش" value={tab} onChange={setTab} options={[{ value: "team", label: "تیم و نقش‌ها" }, { value: "products", label: "محصولات رویداد" }, { value: "settings", label: "تنظیمات" }]} />
      {tab === "team" && <TeamTab event={e} />}
      {tab === "products" && <ProductsTab event={e} />}
      {tab === "settings" && (
        <Card className="p-5 grid sm:grid-cols-2 gap-4 text-[14.5px]">
          <div><div className="text-[12.5px] text-muted">مسئول رویداد</div>{e.owner_name ?? "—"}</div>
          <div><div className="text-[12.5px] text-muted">مهلت همگام‌سازی آفلاین</div>{faNum(e.sync_grace_hours)} ساعت</div>
          <div><div className="text-[12.5px] text-muted">SLA ارجاع</div>{e.referral_sla_hours ? `${faNum(e.referral_sla_hours)} ساعت` : "تعریف نشده"}</div>
          <div><div className="text-[12.5px] text-muted">منطقه زمانی</div><Ltr>Asia/Tehran</Ltr></div>
          <div className="sm:col-span-2"><div className="text-[12.5px] text-muted">توضیحات</div>{e.description || "—"}</div>
          <div className="sm:col-span-2 text-[13px] text-muted">قواعد اعلان رویداد در بخش «اعلان، پیامک و ایمیل» با دامنه همین رویداد تعریف می‌شود.</div>
        </Card>
      )}
      {edit && <EventForm open onOpenChange={setEdit} event={e} />}
      <CloneDialog open={clone} onOpenChange={setClone} event={e} />
      <ConfirmDialog open={!!transition} onOpenChange={(o) => !o && setTransition(null)} title={`${TRANSITION_LABEL[transition ?? ""]} «${e.display_name}»؟`} loading={tm.isPending}
        tone={transition === "CLOSED" || transition === "ARCHIVED" ? "danger" : "primary"} onConfirm={() => transition && tm.mutate(transition)}
        body={transition === "CLOSED" ? "پس از پایان، ثبت تازه بسته می‌شود؛ پیگیری و تکمیل اطلاعات ادامه دارد." : transition === "ACTIVE" ? "اعضای فعال رویداد می‌توانند لید ثبت کنند." : undefined} />
    </div>
  );
}

function CloneDialog({ open, onOpenChange, event }: { open: boolean; onOpenChange: (o: boolean) => void; event: Ev }) {
  const [v, setV] = useState({ code: "", display_name: `${event.display_name} (کپی)`, include_products: true, include_members: false, starts_at: null as string | null, ends_at: null as string | null });
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: () => post<Ev>(`/events/${event.id}/clone`, { ...v, starts_at: v.starts_at ?? undefined, ends_at: v.ends_at ?? undefined }), onSuccess: (n) => { qc.invalidateQueries({ queryKey: ["events"] }); toast({ tone: "success", title: `رویداد ${n.code} به‌صورت پیش‌نویس ایجاد شد` }); onOpenChange(false); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="کپی پیکربندی رویداد" description="فقط تنظیمات منتخب، محصولات و اعضا کپی می‌شوند؛ لیدها و فرصت‌ها هرگز کپی نمی‌شوند."
      footer={<Button loading={m.isPending} disabled={!v.code} onClick={() => m.mutate()}>ایجاد کپی</Button>}>
      <div className="space-y-4">
        <Field label="کد رویداد جدید" required><Input dir="ltr" className="text-left font-mono" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="نام"><Input value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} /></Field>
        <div className="grid sm:grid-cols-2 gap-3"><Field label="شروع"><JalaliDatePicker value={v.starts_at} onChange={(x) => setV({ ...v, starts_at: x })} /></Field><Field label="پایان"><JalaliDatePicker value={v.ends_at} onChange={(x) => setV({ ...v, ends_at: x })} /></Field></div>
        <Checkbox id="cp" label="کپی محصولات رویداد" checked={v.include_products} onChange={(x) => setV({ ...v, include_products: x })} />
        <Checkbox id="cm" label="کپی اعضا و نقش‌ها" checked={v.include_members} onChange={(x) => setV({ ...v, include_members: x })} />
      </div>
    </Dialog>
  );
}

function TeamTab({ event }: { event: Ev }) {
  const q = useQuery({ queryKey: ["members", event.id], queryFn: () => get<any[]>(`/events/${event.id}/members`) });
  const [add, setAdd] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  return (
    <Card>
      <CardHeader title="تیم رویداد" subtitle="همه اعضای فعالِ رویداد فعال می‌توانند لید ثبت کنند؛ نقش‌ها مجوزهای افزوده می‌دهند." actions={event.can_manage_team && <Button size="sm" onClick={() => setAdd(true)}><UserPlus className="size-4" />افزودن عضو</Button>} />
      {q.isLoading ? <LoadingRows /> : !q.data?.length ? <EmptyState icon={<Users className="size-6" />} title="عضوی ندارد" /> : (
        <ul className="divide-y divide-line-2">
          {q.data.map((m) => (
            <li key={m.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="font-semibold">{m.user_name} {m.status !== "ACTIVE" && <Badge tone="neutral">خارج‌شده</Badge>}</div>
                <div className="text-[12.5px] text-muted">{m.user_title} · <Ltr className="font-mono">{m.username}</Ltr></div>
              </div>
              <div className="flex flex-wrap gap-1">{m.roles_detail.length ? m.roles_detail.map((r: any) => <Badge key={r.code} tone="action">{r.name_fa}</Badge>) : <Badge tone="neutral">عضو (ثبت لید)</Badge>}
                {[...m.allowed_plans_detail, ...m.allowed_products_detail].map((p: any) => <Badge key={p.id} tone="neutral">محدود به {p.name_fa}</Badge>)}</div>
              {event.can_manage_team && <Button size="sm" variant="ghost" onClick={() => setEditing(m)}>ویرایش</Button>}
            </li>
          ))}
        </ul>
      )}
      {(add || editing) && <MemberDialog event={event} member={editing} onClose={() => { setAdd(false); setEditing(null); }} />}
    </Card>
  );
}

function MemberDialog({ event, member, onClose }: { event: Ev; member?: any; onClose: () => void }) {
  const [user, setUser] = useState<UserLite | null>(member ? { id: member.user, full_name: member.user_name } : null);
  const [roles, setRoles] = useState<string[]>(member?.roles_detail.map((r: any) => r.code) ?? []);
  const [plans, setPlans] = useState<string[]>(member?.allowed_plans_detail.map((p: any) => p.id) ?? []);
  const [products, setProducts] = useState<string[]>(member?.allowed_products_detail.map((p: any) => p.id) ?? []);
  const roleQ = useQuery({ queryKey: ["roles", "EVENT"], queryFn: () => get<any[]>("/roles?scope=EVENT") });
  const planQ = useQuery({ queryKey: ["plans"], queryFn: () => get<any[]>("/plans?status=ACTIVE") });
  const epQ = useQuery({ queryKey: ["event-products", event.id], queryFn: () => get<any[]>(`/events/${event.id}/products`) });
  const qc = useQueryClient();
  const toast = useToast();
  const body = { role_codes: roles, allowed_plan_ids: plans, allowed_product_ids: products };
  const done = (msg: string) => { qc.invalidateQueries({ queryKey: ["members", event.id] }); qc.invalidateQueries({ queryKey: ["event", event.id] }); toast({ tone: "success", title: msg }); onClose(); };
  const save = useMutation({ mutationFn: () => (member ? patch(`/events/${event.id}/members/${member.id}`, body) : post(`/events/${event.id}/members`, { user: user?.id, ...body })), onSuccess: () => done("عضویت ذخیره شد"), onError: (e: any) => toast({ tone: "error", title: e.message }) });
  const toggle = useMutation({ mutationFn: () => patch(`/events/${event.id}/members/${member.id}`, { status: member.status === "ACTIVE" ? "REMOVED" : "ACTIVE" }), onSuccess: () => done(member.status === "ACTIVE" ? "از رویداد خارج شد (حساب و تاریخچه حفظ شد)" : "دوباره فعال شد") });
  const tog = (list: string[], set: (v: string[]) => void, x: string) => set(list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={member ? `عضویت ${member.user_name}` : "افزودن عضو به رویداد"} size="lg"
      footer={<>
        {member && <Button variant={member.status === "ACTIVE" ? "danger-soft" : "secondary"} className="me-auto" loading={toggle.isPending} onClick={() => toggle.mutate()}>{member.status === "ACTIVE" ? "خروج از رویداد" : "فعال‌سازی مجدد"}</Button>}
        <Button disabled={!user} loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button>
      </>}>
      <div className="space-y-5">
        {!member && <UserPicker value={user} onChange={setUser} />}
        <Field label="نقش‌های رویدادی (افزایشی)" hint="بدون نقش هم عضو می‌تواند لید ثبت کند و لیدهای خود را ببیند.">
          <div className="grid sm:grid-cols-2">{roleQ.data?.map((r) => <Checkbox key={r.code} id={`r-${r.code}`} label={r.name_fa} checked={roles.includes(r.code)} onChange={() => tog(roles, setRoles, r.code)} />)}</div>
        </Field>
        <Field label="محدودیت طرح (اختیاری)" hint="خالی = کل رویداد">
          <div className="grid sm:grid-cols-2">{planQ.data?.map((p) => <Checkbox key={p.id} id={`p-${p.id}`} label={p.name_fa} checked={plans.includes(p.id)} onChange={() => tog(plans, setPlans, p.id)} />)}</div>
        </Field>
        <Field label="محدودیت محصول (اختیاری)">
          <div className="grid sm:grid-cols-2">{epQ.data?.map((p) => <Checkbox key={p.product} id={`pp-${p.product}`} label={p.product_name} checked={products.includes(p.product)} onChange={() => tog(products, setProducts, p.product)} />)}</div>
        </Field>
      </div>
    </Dialog>
  );
}

function ProductsTab({ event }: { event: Ev }) {
  const q = useQuery({ queryKey: ["event-products", event.id], queryFn: () => get<any[]>(`/events/${event.id}/products`) });
  const all = useQuery({ queryKey: ["products", "ACTIVE"], queryFn: () => get<any[]>("/products?status=ACTIVE") });
  const [pick, setPick] = useState("");
  const [ownerFor, setOwnerFor] = useState<any>(null);
  const [owner, setOwner] = useState<UserLite | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const inv = () => { qc.invalidateQueries({ queryKey: ["event-products", event.id] }); qc.invalidateQueries({ queryKey: ["event", event.id] }); };
  const add = useMutation({ mutationFn: () => post(`/events/${event.id}/products`, { product: pick }), onSuccess: () => { setPick(""); inv(); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  const upd = useMutation({ mutationFn: ({ id, body }: { id: string; body: any }) => patch(`/events/${event.id}/products/${id}`, body), onSuccess: () => { setOwnerFor(null); inv(); } });
  const existing = new Set((q.data ?? []).map((p) => p.product));
  return (
    <Card>
      <CardHeader title="محصولات ارائه‌شده در رویداد" subtitle="فقط همین محصولات در فرم ثبت غرفه قابل انتخاب‌اند. مسئول پیش‌فرض، ارجاع خودکار ایجاد می‌کند." />
      {event.can_manage_team && (
        <div className="px-5 pb-4 flex gap-2">
          <Select aria-label="افزودن محصول" value={pick} onChange={(e) => setPick(e.target.value)}><option value="">افزودن محصول از کاتالوگ…</option>{all.data?.filter((p) => !existing.has(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name_fa} ({p.code})</option>)}</Select>
          <Button disabled={!pick} loading={add.isPending} onClick={() => add.mutate()}><Plus className="size-4" />افزودن</Button>
        </div>
      )}
      {q.isLoading ? <LoadingRows /> : !q.data?.length ? <EmptyState title="هنوز محصولی اختصاص داده نشده" body="برای فعال‌سازی رویداد حداقل یک محصول لازم است." /> : (
        <ul className="divide-y divide-line-2">
          {q.data.map((p) => (
            <li key={p.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="font-semibold">{p.product_name} {p.product_name_en && <span className="text-muted text-[13px] ltr">{p.product_name_en}</span>}</div>
                <div className="text-[12.5px] text-muted"><Ltr className="font-mono">{p.product_code}</Ltr>{p.plan_name && ` · ${p.plan_name}`} · مسئول پیش‌فرض: {p.default_owner_name ?? "—"}</div>
              </div>
              {!p.is_active && <Badge tone="neutral">غیرفعال در این رویداد</Badge>}
              {event.can_manage_team && <>
                <Button size="sm" variant="ghost" onClick={() => { setOwnerFor(p); setOwner(p.default_owner ? { id: p.default_owner, full_name: p.default_owner_name } : null); }}>مسئول پیش‌فرض</Button>
                <Button size="sm" variant="ghost" onClick={() => upd.mutate({ id: p.id, body: { is_active: !p.is_active } })}>{p.is_active ? "غیرفعال‌سازی" : "فعال‌سازی"}</Button>
              </>}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!ownerFor} onOpenChange={(o) => !o && setOwnerFor(null)} title={`مسئول پیش‌فرض ${ownerFor?.product_name ?? ""}`}
        footer={<Button loading={upd.isPending} onClick={() => upd.mutate({ id: ownerFor.id, body: { default_owner: owner?.id ?? null } })}>ذخیره</Button>}>
        <UserPicker value={owner} onChange={setOwner} eventId={event.id} />
      </Dialog>
    </Card>
  );
}
