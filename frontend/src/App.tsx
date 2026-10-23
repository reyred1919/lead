import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/layout/AppShell";
import { LoginPage, ResetPasswordPage } from "@/pages/Login";
import { CapturePage, OfflineQueuePage } from "@/pages/Capture";
import { LeadsPage } from "@/pages/Leads";
import { LeadDetailPage } from "@/pages/LeadDetail";
import { InboxPage } from "@/pages/Inbox";
import { NotificationsPage } from "@/pages/Notifications";
import { DashboardPage, HomePage } from "@/pages/Dashboard";
import { ReportsPage } from "@/pages/Reports";
import { MessagesPage } from "@/pages/Messages";
import { ProfilePage } from "@/pages/Profile";
import { EventDetailPage, EventsPage } from "@/pages/admin/Events";
import { UsersPage } from "@/pages/admin/Users";
import { CatalogPage } from "@/pages/admin/Catalog";
import { BrandingAdminPage, TagsAdminPage } from "@/pages/admin/Settings";
import { NotifyAdminPage } from "@/pages/admin/Notify";
import { AccountsPage, AuditPage, DuplicatesPage, QuarantinePage, RolesPage } from "@/pages/admin/DataQuality";
import { EmptyState } from "@/components/ui/primitives";
import { BrandLogo } from "@/components/brand/BrandLogo";
import type { ReactNode } from "react";

function Protected({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading)
    return (
      <div className="min-h-dvh grid place-items-center" role="status" aria-label="در حال بارگذاری">
        <div className="flex flex-col items-center gap-4 animate-rise"><BrandLogo height={44} /><div className="skeleton h-1.5 w-40" /></div>
      </div>
    );
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

function Guard({ cap, any, children }: { cap?: string; any?: string[]; children: ReactNode }) {
  const { can } = useAuth();
  const ok = cap ? can(cap) : (any ?? []).some((c) => can(c));
  if (!ok) return <EmptyState title="دسترسی مجاز نیست" body="این بخش در محدوده مجوزهای شما نیست. مجوزها در سرور نیز بررسی می‌شوند." />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<Protected><AppShell /></Protected>}>
        <Route index element={<HomePage />} />
        <Route path="capture" element={<CapturePage />} />
        <Route path="capture/queue" element={<OfflineQueuePage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="leads/:id" element={<LeadDetailPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="dashboard" element={<Guard cap="dashboard.view"><DashboardPage /></Guard>} />
        <Route path="reports" element={<Guard cap="export.run"><ReportsPage /></Guard>} />
        <Route path="messages" element={<Guard cap="notification.send"><MessagesPage /></Guard>} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin/events" element={<Guard any={["event.manage", "event.team.manage"]}><EventsPage /></Guard>} />
        <Route path="admin/events/:id" element={<Guard any={["event.manage", "event.team.manage"]}><EventDetailPage /></Guard>} />
        <Route path="admin/users" element={<Guard cap="user.manage"><UsersPage /></Guard>} />
        <Route path="admin/catalog" element={<Guard cap="catalog.manage"><CatalogPage /></Guard>} />
        <Route path="admin/accounts" element={<Guard any={["contact.merge", "lead.view.all"]}><AccountsPage /></Guard>} />
        <Route path="admin/duplicates" element={<Guard cap="contact.merge"><DuplicatesPage /></Guard>} />
        <Route path="admin/quarantine" element={<Guard cap="sync.review"><QuarantinePage /></Guard>} />
        <Route path="admin/tags" element={<Guard cap="tags.manage"><TagsAdminPage /></Guard>} />
        <Route path="admin/branding" element={<Guard cap="branding.manage"><BrandingAdminPage /></Guard>} />
        <Route path="admin/notify" element={<Guard any={["notification.configure", "provider.manage"]}><NotifyAdminPage /></Guard>} />
        <Route path="admin/roles" element={<Guard cap="role.manage"><RolesPage /></Guard>} />
        <Route path="admin/audit" element={<Guard cap="audit.view"><AuditPage /></Guard>} />
        <Route path="*" element={<EmptyState title="صفحه یافت نشد" />} />
      </Route>
    </Routes>
  );
}
