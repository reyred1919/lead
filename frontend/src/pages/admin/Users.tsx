import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Search, UserPlus } from "lucide-react";
import { ApiError, get, patch, post, qs, type Page } from "@/lib/api";
import { useDebounced } from "@/lib/hooks";
import { fmtDateTime, fmtPhone, relTime } from "@/lib/format";
import { CHANNEL, JOB_STATUS } from "@/lib/labels";
import { Avatar, Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Ltr, PageHeader, Segmented, Select } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlay";
import { DemoBadge, EventStatus } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";

const STATUS: Record<string, string> = { ACTIVE: "فعال", SUSPENDED: "تعلیق", ARCHIVED: "بایگانی" };

export function UsersPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const dq = useDebounced(q);
  const users = useQuery({ queryKey: ["users", dq, status], queryFn: () => get<Page<any>>(`/users${qs({ q: dq, status, page_size: 100 })}`) });
  const [editing, setEditing] = useState<any | "new" | null>(null);
  return (
    <div>
      <PageHeader title="کاربران" subtitle="شماره موبایل سازمانی برای اعلان‌های داخلی الزامی است. رمز عبور فقط به‌صورت هش ذخیره می‌شود و برای مدیر قابل مشاهده نیست."
        actions={<Button onClick={() => setEditing("new")}><UserPlus className="size-4" />کاربر جدید</Button>} />
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1"><Search className="absolute start-3.5 top-3.5 size-5 text-muted" /><Input aria-label="جست‌وجو" className="ps-11" value={q} onChange={(e) => setQ(e.target.value)} placeholder="نام، نام کاربری، سمت یا شماره" /></div>
        <Segmented label="وضعیت" value={status} onChange={setStatus} options={[{ value: "", label: "همه" }, { value: "ACTIVE", label: "فعال" }, { value: "SUSPENDED", label: "تعلیق" }, { value: "ARCHIVED", label: "بایگانی" }]} />
      </div>
      <Card>
        {users.isLoading ? <LoadingRows /> : !users.data?.results.length ? <EmptyState title="کاربری یافت نشد" /> : (
          <ul className="divide-y divide-line-2">
            {users.data.results.map((u: any) => (
              <li key={u.id}><button onClick={() => setEditing(u)} className="w-full px-5 py-3 flex flex-wrap items-center gap-3 text-start hover:bg-canvas">
                <Avatar name={u.full_name} size={38} />
                <div className="flex-1 min-w-[180px]">
                  <div className="font-semibold">{u.full_name} {!u.has_password && <Badge tone="warning">در انتظار فعال‌سازی</Badge>}</div>
                  <div className="text-[12.5px] text-muted">{u.title} · <Ltr className="font-mono">{u.username}</Ltr> · <Ltr>{fmtPhone(u.mobile)}</Ltr></div>
                </div>
                <div className="flex flex-wrap gap-1">{u.global_roles.map((r: any) => <Badge key={r.code} tone="navy">{r.name_fa}</Badge>)}</div>
                <Badge tone={u.status === "ACTIVE" ? "success" : "neutral"} dot>{STATUS[u.status]}</Badge>
              </button></li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <UserDialog user={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function UserDialog({ user, onClose }: { user: any | null; onClose: () => void }) {
  const detail = useQuery({ queryKey: ["user", user?.id], queryFn: () => get<any>(`/users/${user.id}`), enabled: !!user });
  const roles = useQuery({ queryKey: ["roles", "GLOBAL"], queryFn: () => get<any[]>("/roles?scope=GLOBAL") });
  const src = detail.data ?? user;
  const [v, setV] = useState({
    username: user?.username ?? "", first_name: user?.first_name ?? "", last_name: user?.last_name ?? "", title: user?.title ?? "",
    mobile: user?.mobile ? fmtPhone(user.mobile) : "", email: user?.email ?? "", status: user?.status ?? "ACTIVE",
    global_role_codes: (user?.global_roles ?? []).map((r: any) => r.code) as string[],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activation, setActivation] = useState<any>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => (user ? patch(`/users/${user.id}`, { ...v, username: undefined, version: src.version }) : post<any>("/users", v)),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["user", user?.id] });
      if (!user) setActivation(r.activation);
      else { toast({ tone: "success", title: "کاربر ذخیره شد" }); onClose(); }
    },
    onError: (e: any) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); toast({ tone: "error", title: e.isConflict ? "تغییر هم‌زمان؛ دوباره باز کنید" : "ذخیره نشد", body: e.message }); },
  });
  const reset = useMutation({ mutationFn: () => post<any>(`/users/${user.id}/reset-password`), onSuccess: (r) => setActivation(r), onError: (e: any) => toast({ tone: "error", title: e.message }) });

  if (activation) {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="لینک فعال‌سازی/بازنشانی صادر شد" footer={<Button onClick={onClose}>بستن</Button>}>
        <div className="space-y-3 text-[14px] leading-7">
          <p>لینک یک‌بارمصرف و محدود به {activation.expires_hours} ساعت است.</p>
          <ul className="space-y-1">{activation.deliveries.map((d: any) => <li key={d.channel}>{CHANNEL[d.channel]}: <Badge tone={d.status === "SIMULATED" ? "warning" : d.status === "SENT" ? "success" : "neutral"}>{JOB_STATUS[d.status] ?? d.status}</Badge> {d.reason && <span className="text-muted text-[12.5px]">({d.reason})</span>}</li>)}{!activation.deliveries.length && <li className="text-muted">کانال تحویلی موجود نیست.</li>}</ul>
          {activation.demo_link && (
            <div className="rounded-[12px] bg-warning-soft p-3 space-y-2">
              <div className="flex items-center gap-2"><DemoBadge /><span className="text-[12.5px]">فقط در حالت نمایشی نمایش داده می‌شود؛ در محیط عملیاتی لینک فقط از طریق کانال امن ارسال می‌شود.</span></div>
              <div className="flex gap-2"><Input readOnly dir="ltr" value={activation.demo_link} className="text-[12px] font-mono" /><Button variant="secondary" size="icon" aria-label="کپی" onClick={() => navigator.clipboard?.writeText(activation.demo_link)}><Copy className="size-4" /></Button></div>
            </div>
          )}
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={user ? `ویرایش ${user.full_name}` : "کاربر جدید"} size="lg"
      footer={<>
        {user && <Button variant="secondary" className="me-auto" loading={reset.isPending} onClick={() => reset.mutate()}><KeyRound className="size-4" />صدور لینک بازنشانی رمز</Button>}
        <Button variant="secondary" onClick={onClose}>انصراف</Button><Button loading={save.isPending} onClick={() => save.mutate()}>{user ? "ذخیره" : "ایجاد و ارسال لینک فعال‌سازی"}</Button>
      </>}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="نام کاربری" required error={errors.username} hint={user ? "قابل تغییر نیست" : "لاتین"}><Input dir="ltr" className="text-left font-mono" disabled={!!user} value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} /></Field>
        <Field label="وضعیت حساب"><Select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="نام" required error={errors.first_name}><Input value={v.first_name} onChange={(e) => setV({ ...v, first_name: e.target.value })} /></Field>
        <Field label="نام خانوادگی" required error={errors.last_name}><Input value={v.last_name} onChange={(e) => setV({ ...v, last_name: e.target.value })} /></Field>
        <Field label="سمت"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="موبایل سازمانی" required error={errors.mobile} hint="برای اعلان داخلی؛ جدا از شماره مخاطبان لید"><Input dir="ltr" inputMode="tel" className="text-left" value={v.mobile} onChange={(e) => setV({ ...v, mobile: e.target.value })} placeholder="0912 345 6789" /></Field>
        <Field label="ایمیل (اختیاری)" error={errors.email}><Input dir="ltr" type="email" className="text-left" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="نقش‌های سراسری" className="sm:col-span-2" hint="نقش‌ها افزایشی‌اند. مدیرکل نقش عملیاتی است و به اسرار و رمزها دسترسی ندارد.">
          <div className="grid sm:grid-cols-2">{roles.data?.map((r) => <Checkbox key={r.code} id={`gr-${r.code}`} label={r.name_fa} checked={v.global_role_codes.includes(r.code)} onChange={(on) => setV({ ...v, global_role_codes: on ? [...v.global_role_codes, r.code] : v.global_role_codes.filter((c) => c !== r.code) })} />)}</div>
        </Field>
        {detail.data?.memberships && (
          <div className="sm:col-span-2">
            <div className="text-[13px] font-semibold text-ink-2 mb-2">تاریخچه عضویت در رویدادها</div>
            {!detail.data.memberships.length ? <p className="text-[13px] text-muted">عضویتی ندارد.</p> : (
              <ul className="space-y-1.5 text-[13.5px]">{detail.data.memberships.map((m: any) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">{m.event_name} <Ltr className="font-mono text-[11.5px] text-muted">{m.event_code}</Ltr><EventStatus s={m.event_status} /><Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{m.status === "ACTIVE" ? "عضو فعال" : `خارج‌شده ${relTime(m.left_at)}`}</Badge><span className="text-muted">{m.roles.join("، ")}</span></li>
              ))}</ul>
            )}
            <p className="text-[12px] text-muted mt-2">آخرین ورود: {detail.data.last_login ? fmtDateTime(detail.data.last_login) : "هرگز"}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
