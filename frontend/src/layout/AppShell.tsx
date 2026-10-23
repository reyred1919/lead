import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell, BarChart3, Building2, CalendarRange, ClipboardList, CloudOff, CloudUpload, Copy, FileDown, Fingerprint, Home, Inbox, LayoutGrid,
  ListChecks, LogOut, Megaphone, MessageSquareText, Palette, Plus, RefreshCw, ShieldCheck, Tags, UserCircle2, Users, Package, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useOnline, useQueueCounts, useWorkCounts } from "@/lib/hooks";
import { offlineQueue } from "@/lib/offline";
import { faNum } from "@/lib/format";
import { BrandLogo, useBranding } from "@/components/brand/BrandLogo";
import { Avatar, Button, cn } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlay";
import { DemoBadge } from "@/components/ui/status";

type Item = { to: string; label: string; icon: ReactNode; show: boolean; badge?: number; end?: boolean };

export function useNav() {
  const { can, me } = useAuth();
  const { data: counts } = useWorkCounts();
  const inbox = (counts?.referrals_incoming ?? 0) + (counts?.tasks_open ?? 0) + (counts?.actions_open ?? 0);
  const main: Item[] = [
    { to: "/", label: "خانه", icon: <Home className="size-5" />, show: true, end: true },
    { to: "/leads", label: "لیدها", icon: <ClipboardList className="size-5" />, show: true },
    { to: "/inbox", label: "کارتابل", icon: <Inbox className="size-5" />, show: true, badge: inbox },
    { to: "/notifications", label: "اعلان‌ها", icon: <Bell className="size-5" />, show: true, badge: counts?.notifications_unread },
    { to: "/dashboard", label: "داشبورد تحلیلی", icon: <BarChart3 className="size-5" />, show: can("dashboard.view") },
    { to: "/reports", label: "گزارش و خروجی", icon: <FileDown className="size-5" />, show: can("export.run") },
    { to: "/messages", label: "پیام و درخواست اقدام", icon: <Megaphone className="size-5" />, show: can("notification.send") },
  ];
  const admin: Item[] = [
    { to: "/admin/events", label: "رویدادها و تیم‌ها", icon: <CalendarRange className="size-5" />, show: can("event.manage") || can("event.team.manage") },
    { to: "/admin/users", label: "کاربران", icon: <Users className="size-5" />, show: can("user.manage") },
    { to: "/admin/catalog", label: "طرح‌ها و محصولات", icon: <Package className="size-5" />, show: can("catalog.manage") },
    { to: "/admin/accounts", label: "سازمان‌ها و مخاطبان", icon: <Building2 className="size-5" />, show: can("contact.merge") || can("lead.view.all") },
    { to: "/admin/duplicates", label: "بازبینی تکراری‌ها", icon: <Copy className="size-5" />, show: can("contact.merge") },
    { to: "/admin/quarantine", label: "ثبت‌های آفلاین معلق", icon: <CloudOff className="size-5" />, show: can("sync.review") },
    { to: "/admin/tags", label: "برچسب‌های لید", icon: <Tags className="size-5" />, show: can("tags.manage") },
    { to: "/admin/notify", label: "اعلان، پیامک و ایمیل", icon: <MessageSquareText className="size-5" />, show: can("notification.configure") || can("provider.manage") },
    { to: "/admin/branding", label: "هویت بصری", icon: <Palette className="size-5" />, show: can("branding.manage") },
    { to: "/admin/roles", label: "نقش‌ها و مجوزها", icon: <Fingerprint className="size-5" />, show: can("role.manage") },
    { to: "/admin/audit", label: "گزارش ممیزی", icon: <ShieldCheck className="size-5" />, show: can("audit.view") },
  ];
  return { main: main.filter((i) => i.show), admin: admin.filter((i) => i.show), counts, canCapture: !!me?.capture_events.length };
}

function NavItem({ item, onClick }: { item: Item; onClick?: () => void }) {
  return (
    <NavLink to={item.to} end={item.end} onClick={onClick}
      className={({ isActive }) => cn("flex items-center gap-3 h-11 px-3 rounded-[12px] text-[14.5px] font-medium transition-colors", isActive ? "bg-white/12 text-white" : "text-white/70 hover:text-white hover:bg-white/6")}>
      {item.icon}
      <span className="flex-1 truncate">{item.label}</span>
      {!!item.badge && <span className="min-w-6 h-6 px-1.5 rounded-full bg-action text-white text-[12px] grid place-items-center num">{faNum(item.badge)}</span>}
    </NavLink>
  );
}

export function SyncIndicator({ compact }: { compact?: boolean }) {
  const online = useOnline();
  const c = useQueueCounts();
  const pending = c.queued + c.syncing;
  const [open, setOpen] = useState(false);
  let tone = "text-success", label = "همگام", icon = <CheckCircle2 className="size-4" />;
  if (!online) { tone = "text-warning"; label = pending ? `آفلاین · ${faNum(pending)} در صف` : "آفلاین"; icon = <CloudOff className="size-4" />; }
  else if (c.failed) { tone = "text-danger"; label = `${faNum(c.failed)} ناموفق`; icon = <AlertTriangle className="size-4" />; }
  else if (pending) { tone = "text-info"; label = `در حال همگام‌سازی ${faNum(pending)}`; icon = <CloudUpload className="size-4" />; }
  const nav = useNavigate();
  return (
    <>
      <button onClick={() => (pending || c.failed || c.review ? nav("/capture/queue") : setOpen(true))} className={cn("inline-flex items-center gap-1.5 h-9 px-2.5 rounded-full bg-panel border border-line text-[12.5px] font-semibold", tone)} aria-label={`وضعیت همگام‌سازی: ${label}`}>
        {icon}
        {!compact && <span>{label}</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title="وضعیت همگام‌سازی" size="sm">
        <p className="text-[14px] leading-7 text-ink-2">
          {online ? "اتصال برقرار است و صف ثبت‌های آفلاین خالی است." : "اتصال اینترنت قطع است. ثبت‌های جدید به‌صورت رمزنگاری‌شده روی همین دستگاه ذخیره و پس از اتصال خودکار ارسال می‌شوند."}
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => offlineQueue.syncNow()}><RefreshCw className="size-4" />همگام‌سازی اکنون</Button>
      </Dialog>
    </>
  );
}

function EventContextBar() {
  const { me, activeEventId, setActiveEventId } = useAuth();
  const events = me?.capture_events ?? [];
  const active = events.find((e) => e.id === activeEventId);
  if (!events.length) {
    return <div className="text-[12.5px] text-muted truncate">رویداد فعالی برای ثبت لید به شما اختصاص داده نشده است.</div>;
  }
  if (events.length === 1) {
    return (
      <div className="flex items-center gap-2 min-w-0" aria-label="رویداد فعال">
        <span className="size-2 rounded-full bg-success shrink-0" aria-hidden />
        <span className="font-semibold text-[13.5px] truncate">{active?.display_name}</span>
        <bdi className="ltr text-[11.5px] text-muted font-mono hidden sm:inline">{active?.code}</bdi>
      </div>
    );
  }
  return (
    <label className="flex items-center gap-2 min-w-0">
      <span className="size-2 rounded-full bg-success shrink-0" aria-hidden />
      <span className="sr-only">رویداد فعال برای ثبت</span>
      <select value={activeEventId ?? ""} onChange={(e) => setActiveEventId(e.target.value)} className="bg-transparent font-semibold text-[13.5px] max-w-[60vw] md:max-w-xs truncate outline-none">
        {events.map((e) => <option key={e.id} value={e.id}>{e.display_name} ({e.code})</option>)}
      </select>
    </label>
  );
}

function UserMenu({ onLogout }: { onLogout: () => void }) {
  const { me } = useAuth();
  return (
    <div className="flex items-center gap-3 p-2 rounded-[14px] bg-white/6">
      <Avatar name={me?.user.full_name} size={36} />
      <NavLink to="/profile" className="flex-1 min-w-0 text-white">
        <div className="text-[14px] font-semibold truncate">{me?.user.full_name}</div>
        <div className="text-[12px] text-white/60 truncate">{me?.user.title}</div>
      </NavLink>
      <button onClick={onLogout} aria-label="خروج" className="size-10 grid place-items-center rounded-[10px] text-white/70 hover:text-white hover:bg-white/10"><LogOut className="size-5" /></button>
    </div>
  );
}

export function useLogout() {
  const { logout } = useAuth();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState<number | null>(null);
  const start = async () => {
    const pending = await offlineQueue.pendingCount().catch(() => 0);
    if (pending) setConfirm(pending);
    else {
      await logout();
      nav("/login");
    }
  };
  const node = (
    <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)} title="ثبت‌های همگام‌نشده" size="sm"
      footer={<>
        <Button variant="secondary" onClick={async () => { await offlineQueue.syncNow(); setConfirm((await offlineQueue.pendingCount()) || null); }}>همگام‌سازی اکنون</Button>
        <Button variant="danger" onClick={async () => { await logout({ discardQueue: true }); setConfirm(null); nav("/login"); }}>حذف و خروج</Button>
      </>}>
      <p className="text-[14px] leading-7">{faNum(confirm ?? 0)} ثبت هنوز به سرور ارسال نشده است. با خروج، داده‌های رمزنگاری‌شده این دستگاه پاک می‌شوند. ابتدا همگام‌سازی کنید.</p>
    </Dialog>
  );
  return { start, node };
}

export function AppShell() {
  const { me } = useAuth();
  const { main, admin, canCapture } = useNav();
  const { start: logout, node: logoutDialog } = useLogout();
  const [moreOpen, setMoreOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const brand = useBranding();
  const isCapture = loc.pathname.startsWith("/capture");

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[280px_1fr]">
      {/* Desktop sidebar */}
      <div className="hidden lg:block bg-navy"><aside className="flex flex-col text-white sticky top-0 h-dvh p-4 gap-4" aria-label="ناوبری اصلی">
        <div className="px-1 pt-1"><BrandLogo variant="dark" height={34} /></div>
        <Button onClick={() => nav("/capture")} disabled={!canCapture} size="lg" className="w-full" title={canCapture ? undefined : "برای ثبت لید باید عضو فعال یک رویداد باشید"}>
          <Plus className="size-5" />ثبت لید جدید
        </Button>
        <nav className="flex-1 overflow-y-auto scrollbar-thin -mx-1 px-1 space-y-1">
          {main.map((i) => <NavItem key={i.to} item={i} />)}
          {!!admin.length && <div className="pt-4 pb-1 px-3 text-[11.5px] font-bold tracking-wide text-white/60">مدیریت و تنظیمات</div>}
          {admin.map((i) => <NavItem key={i.to} item={i} />)}
        </nav>
        {brand.data?.footer_label && <div className="text-[11px] text-white/60 px-2">{brand.data.footer_label}</div>}
        <UserMenu onLogout={logout} />
      </aside></div>

      <div className="min-w-0 flex flex-col">
        {/* Sticky top bar: event context always visible */}
        <header className="sticky top-0 z-30 glass border-b border-line">
          <div className="flex items-center gap-3 px-4 md:px-6 h-14">
            <div className="lg:hidden shrink-0"><BrandLogo height={28} showTitle={false} /></div>
            <div className="flex-1 min-w-0"><EventContextBar /></div>
            {me?.demo_mode && <span className="hidden sm:inline-flex"><DemoBadge /></span>}
            <span className="sm:hidden"><SyncIndicator compact /></span><span className="hidden sm:inline-flex"><SyncIndicator /></span>
            <NavLink to="/notifications" className="lg:hidden relative size-10 grid place-items-center rounded-full hover:bg-line-2" aria-label="اعلان‌ها"><Bell className="size-5" /></NavLink>
          </div>
        </header>

        <main id="main" className={cn("flex-1 w-full mx-auto px-4 md:px-6 lg:px-8 py-5 md:py-8 pb-28 lg:pb-10", isCapture ? "max-w-2xl" : "max-w-[1240px]")}>
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom tabs with centered capture action */}
      <nav aria-label="ناوبری پایین" className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5 h-16 items-center">
          <TabLink to="/" end icon={<Home className="size-[22px]" />} label="خانه" />
          <TabLink to="/leads" icon={<ListChecks className="size-[22px]" />} label="لیدها" />
          <div className="grid place-items-center">
            <button onClick={() => nav("/capture")} disabled={!canCapture} aria-label="ثبت لید جدید"
              className="-mt-6 size-14 rounded-full bg-action text-white grid place-items-center shadow-[0_8px_24px_rgb(35_104_229/0.45)] disabled:opacity-50 active:scale-95 transition-transform">
              <Plus className="size-7" />
            </button>
          </div>
          <TabLink to="/inbox" icon={<Inbox className="size-[22px]" />} label="کارتابل" badge={main.find((m) => m.to === "/inbox")?.badge} />
          <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-0.5 text-[11px] text-muted" aria-label="بیشتر"><LayoutGrid className="size-[22px]" />بیشتر</button>
        </div>
      </nav>
      <Dialog open={moreOpen} onOpenChange={setMoreOpen} title="منو">
        <div className="grid grid-cols-1 gap-1 pb-2">
          {[...main.slice(3), ...admin, { to: "/profile", label: "پروفایل من", icon: <UserCircle2 className="size-5" />, show: true } as Item].map((i) => (
            <NavLink key={i.to} to={i.to} onClick={() => setMoreOpen(false)} className="flex items-center gap-3 h-12 px-3 rounded-[12px] hover:bg-line-2 text-[15px]">
              <span className="text-muted">{i.icon}</span>{i.label}
              {!!i.badge && <span className="ms-auto min-w-6 h-6 px-1.5 rounded-full bg-action text-white text-[12px] grid place-items-center num">{faNum(i.badge)}</span>}
            </NavLink>
          ))}
          <button onClick={() => { setMoreOpen(false); logout(); }} className="flex items-center gap-3 h-12 px-3 rounded-[12px] hover:bg-danger-soft text-danger text-[15px]"><LogOut className="size-5" />خروج</button>
        </div>
      </Dialog>
      {logoutDialog}
    </div>
  );
}

function TabLink({ to, icon, label, end, badge }: { to: string; icon: ReactNode; label: string; end?: boolean; badge?: number }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cn("relative flex flex-col items-center gap-0.5 text-[11px] font-medium min-h-12 justify-center", isActive ? "text-action" : "text-muted")}>
      {icon}
      {label}
      {!!badge && <span className="absolute top-0.5 start-1/2 ms-2 min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[10.5px] grid place-items-center num">{faNum(badge)}</span>}
    </NavLink>
  );
}
