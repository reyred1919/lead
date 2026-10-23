import { useState } from "react";
import { Navigate, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { ApiError, get, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { BrandLogo, useBranding } from "@/components/brand/BrandLogo";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlay";
import { DemoBadge } from "@/components/ui/status";
import { toLatinDigits } from "@/lib/format";

const DEMO_USERS = [
  ["admin", "مدیر سامانه"], ["mdm", "مدیر توسعه بازار"], ["dg", "مدیرکل"], ["planmgr", "مدیر طرح"],
  ["owner", "مالک محصول"], ["specialist1", "کارشناس غرفه"], ["exec", "ناظر فقط‌خواندنی"],
];

export function LoginPage() {
  const { me, login } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgot, setForgot] = useState(false);
  const brand = useBranding();
  if (me) return <Navigate to={params.get("next") || "/"} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(toLatinDigits(username.trim()), password);
      nav(params.get("next") || "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 429 ? "تلاش‌های ناموفق زیاد بود؛ چند دقیقه بعد دوباره امتحان کنید." : err.message) : "ورود ناموفق بود.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh grid lg:grid-cols-[1.1fr_1fr] bg-canvas">
      <section className="hidden lg:flex flex-col justify-between bg-navy text-white p-12 relative overflow-hidden">
        <div className="absolute -top-40 -start-40 size-[520px] rounded-full bg-action/25 blur-3xl" aria-hidden />
        <div className="absolute bottom-0 end-0 size-[420px] rounded-full bg-[#5f97ff]/15 blur-3xl" aria-hidden />
        <BrandLogo variant="dark" height={40} />
        <div className="relative max-w-md">
          <h1 className="text-[40px] font-extrabold leading-[1.25] tracking-tight">هر گفت‌وگوی غرفه،<br />یک فرصت قابل‌پیگیری.</h1>
          <p className="text-white/70 mt-5 text-[16px] leading-8">ثبت سریع در غرفه، ارجاع شفاف به مسئول پیگیری، تکمیل اطلاعات پس از رویداد و گزارش تجمیعی بین رویدادها — در یک سامانه مستقل.</p>
        </div>
        <div className="text-white/40 text-[12.5px]">{brand.data?.footer_label || "اداره توسعه بازار و مدیریت کانال‌های فروش راهکارهای هوشمند"}</div>
      </section>
      <section className="flex flex-col items-center justify-center p-5 md:p-10">
        <div className="lg:hidden mb-8"><BrandLogo height={40} /></div>
        <form onSubmit={submit} className="card w-full max-w-[420px] p-6 md:p-8 space-y-5" noValidate>
          <div>
            <h2 className="text-[24px] font-extrabold">ورود به سامانه</h2>
            <p className="text-[14px] text-muted mt-1">با نام کاربری سازمانی خود وارد شوید.</p>
          </div>
          <Field label="نام کاربری" htmlFor="username">
            <Input id="username" autoComplete="username" dir="ltr" className="text-left" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </Field>
          <Field label="رمز عبور" htmlFor="password">
            <div className="relative">
              <Input id="password" type={show ? "text" : "password"} autoComplete="current-password" dir="ltr" className="text-left pe-12" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? "پنهان کردن رمز" : "نمایش رمز"} className="absolute end-1.5 top-1.5 size-9 grid place-items-center text-muted hover:text-ink rounded-lg">
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          {error && <div role="alert" className="rounded-[12px] bg-danger-soft text-danger text-[14px] px-3.5 py-2.5">{error}</div>}
          <Button type="submit" size="lg" className="w-full" loading={loading}>ورود</Button>
          <button type="button" onClick={() => setForgot(true)} className="w-full text-center text-[14px] text-action font-semibold min-h-11">رمز عبور را فراموش کرده‌اید؟</button>
        </form>
        {brand.data?.demo_mode && (
          <div className="w-full max-w-[420px] mt-5 card p-4">
            <div className="flex items-center justify-between mb-2"><span className="text-[13px] font-bold">حساب‌های نمایشی</span><DemoBadge /></div>
            <p className="text-[12.5px] text-muted mb-3 leading-6">رمز همه حساب‌های نمونه: <bdi className="ltr font-mono">Demo@Expo1405</bdi></p>
            <div className="flex flex-wrap gap-1.5">
              {DEMO_USERS.map(([u, l]) => (
                <button key={u} type="button" onClick={() => { setUsername(u); setPassword("Demo@Expo1405"); }} className="h-8 px-2.5 rounded-[9px] bg-line-2 hover:bg-action-soft text-[12.5px]">
                  {l} <bdi className="ltr text-muted font-mono">{u}</bdi>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
      <ForgotDialog open={forgot} onOpenChange={setForgot} />
    </div>
  );
}

function ForgotDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [username, setUsername] = useState("");
  const m = useMutation({ mutationFn: () => post<{ detail: string }>("/auth/password/forgot", { username: toLatinDigits(username) }) });
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) m.reset(); }} title="بازنشانی رمز عبور" description="لینک بازنشانی محدود به زمان به شماره موبایل یا ایمیل ثبت‌شده شما ارسال می‌شود."
      footer={m.isSuccess ? <Button onClick={() => onOpenChange(false)}>متوجه شدم</Button> : <Button loading={m.isPending} onClick={() => m.mutate()} disabled={!username}>ارسال لینک</Button>}>
      {m.isSuccess ? <p className="text-[14px] leading-7">{m.data.detail}</p> : (
        <Field label="نام کاربری" htmlFor="forgot-username"><Input id="forgot-username" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} /></Field>
      )}
    </Dialog>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const check = useQuery({ queryKey: ["reset", token], queryFn: () => get<{ valid: boolean; purpose: string; username: string }>(`/auth/password/reset?token=${encodeURIComponent(token)}`), retry: false });
  const m = useMutation({ mutationFn: () => post("/auth/password/reset", { token, password }) });
  const err = m.error instanceof ApiError ? m.error.fieldErrors().password || m.error.message : "";
  return (
    <div className="min-h-dvh grid place-items-center p-5 bg-canvas">
      <div className="card w-full max-w-[420px] p-7 space-y-5">
        <BrandLogo height={34} />
        <div className="flex items-center gap-2"><KeyRound className="size-5 text-action" /><h1 className="text-[22px] font-extrabold">{check.data?.purpose === "ACTIVATION" ? "فعال‌سازی حساب" : "تعیین رمز عبور جدید"}</h1></div>
        {check.isLoading ? <p className="text-muted">در حال بررسی لینک…</p> : check.isError ? (
          <p role="alert" className="text-danger">این لینک نامعتبر یا منقضی شده است. از مدیر سامانه بخواهید لینک تازه صادر کند.</p>
        ) : m.isSuccess ? (
          <div className="space-y-4"><p className="text-success font-semibold">رمز عبور با موفقیت ثبت شد.</p><Link to="/login" className="text-action font-semibold">ورود به سامانه</Link></div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (password === confirm) m.mutate(); }}>
            <p className="text-[14px] text-muted">نام کاربری: <bdi className="ltr font-mono">{check.data?.username}</bdi></p>
            <Field label="رمز عبور جدید" htmlFor="np" hint="حداقل ۱۰ نویسه، ترکیبی و غیرتکراری." error={err}>
              <Input id="np" type="password" dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <Field label="تکرار رمز" htmlFor="npc" error={confirm && confirm !== password ? "تکرار رمز یکسان نیست." : undefined}>
              <Input id="npc" type="password" dir="ltr" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button type="submit" className="w-full" size="lg" loading={m.isPending} disabled={!password || password !== confirm}>ثبت رمز</Button>
          </form>
        )}
      </div>
    </div>
  );
}
