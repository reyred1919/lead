import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, put } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtPhone } from "@/lib/format";
import { Badge, Button, Card, CardHeader, Field, Input, Ltr, PageHeader, Switch } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

export function ProfilePage() {
  const { me } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: ["prefs"], queryFn: () => get<any>("/notifications/preferences") });
  const savePrefs = useMutation({ mutationFn: (channels: any[]) => put("/notifications/preferences", { channels }), onSuccess: () => qc.invalidateQueries({ queryKey: ["prefs"] }) });
  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm: "" });
  const change = useMutation({
    mutationFn: () => post("/auth/password/change", pw),
    onSuccess: () => { setPw({ current_password: "", new_password: "", confirm: "" }); toast({ tone: "success", title: "رمز عبور تغییر کرد" }); },
    onError: (e: any) => toast({ tone: "error", title: "تغییر رمز انجام نشد", body: e.fieldErrors?.().current_password || e.fieldErrors?.().password || e.message }),
  });
  if (!me) return null;
  const u = me.user;
  return (
    <div className="max-w-3xl">
      <PageHeader title="پروفایل من" subtitle="نام، سمت و شماره موبایل را مدیر سامانه ثبت می‌کند؛ برای اصلاح با اداره توسعه بازار هماهنگ کنید." />
      <div className="space-y-5">
        <Card>
          <CardHeader title="اطلاعات حساب" />
          <dl className="grid sm:grid-cols-2 gap-4 px-5 pb-5 text-[14.5px]">
            <div><dt className="text-[12.5px] text-muted">نام</dt><dd>{u.full_name}</dd></div>
            <div><dt className="text-[12.5px] text-muted">سمت</dt><dd>{u.title || "—"}</dd></div>
            <div><dt className="text-[12.5px] text-muted">نام کاربری</dt><dd><Ltr className="font-mono">{u.username}</Ltr></dd></div>
            <div><dt className="text-[12.5px] text-muted">موبایل (اعلان‌های داخلی)</dt><dd><Ltr>{fmtPhone(u.mobile)}</Ltr></dd></div>
            <div><dt className="text-[12.5px] text-muted">ایمیل</dt><dd><Ltr>{u.email || "—"}</Ltr></dd></div>
            <div><dt className="text-[12.5px] text-muted">نقش‌های سراسری</dt><dd className="flex flex-wrap gap-1">{me.authz.global_roles.length ? me.authz.global_roles.map((r) => <Badge key={r} tone="navy">{r}</Badge>) : "—"}</dd></div>
          </dl>
          <div className="px-5 pb-5">
            <div className="text-[12.5px] text-muted mb-2">عضویت در رویدادها</div>
            <ul className="space-y-1.5 text-[14px]">{me.events.map((e) => <li key={e.id}>{e.display_name} <Ltr className="text-muted text-[12px] font-mono">{e.code}</Ltr> — {e.roles.map((r) => r.name_fa).join("، ") || "عضو (ثبت لید)"}</li>)}</ul>
          </div>
        </Card>
        <Card>
          <CardHeader title="کانال‌های اعلان" subtitle={prefs.data?.note} />
          <div className="px-5 pb-5 space-y-3">
            {prefs.data?.channels.map((c: any) => (
              <div key={c.channel} className="flex items-center justify-between min-h-11">
                <span>{c.channel === "SMS" ? "پیامک به موبایل سازمانی" : "ایمیل"}</span>
                <Switch label={c.channel} checked={c.enabled} onChange={(v) => savePrefs.mutate(prefs.data.channels.map((x: any) => (x.channel === c.channel ? { ...x, enabled: v } : x)))} />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="تغییر رمز عبور" />
          <form className="px-5 pb-5 grid sm:grid-cols-3 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
            <Field label="رمز فعلی" htmlFor="pw0"><Input id="pw0" type="password" dir="ltr" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
            <Field label="رمز جدید" htmlFor="pw1"><Input id="pw1" type="password" dir="ltr" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
            <Field label="تکرار" htmlFor="pw2"><Input id="pw2" type="password" dir="ltr" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            <Button type="submit" className="sm:col-span-3 sm:justify-self-start" loading={change.isPending} disabled={!pw.new_password || pw.new_password !== pw.confirm}>ذخیره رمز</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
