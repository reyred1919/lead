import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight, BadgeCheck, Building2, CalendarClock, CheckCircle2, CircleDot, ClipboardCheck, CloudOff, History, ListTodo, Mail, MessageSquarePlus,
  PencilLine, Phone, Send, Sparkles, Undo2, UserRound,
} from "lucide-react";
import { ApiError, del, get, patch, post } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, fmtPhone, faNum, relTime } from "@/lib/format";
import { COMPLETENESS_LABELS, STAGE, URGENCY } from "@/lib/labels";
import { Avatar, Badge, Button, Card, CardHeader, ErrorState, Field, Input, LoadingRows, Ltr, Segmented, Select, Textarea, cn } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlay";
import { JalaliDatePicker } from "@/components/ui/datepicker";
import { InteractionStatus, QualityBadge, ReferralStatus, StageBadge } from "@/components/ui/status";
import { UserPicker, type UserLite } from "@/components/ui/pickers";
import { TagChip, TagCombobox, type TagT } from "@/components/tags/Tags";
import { useToast } from "@/components/ui/toast";

type U = { id: string; full_name: string; title?: string } | null;
export type Lead = {
  id: string; version: number; event: { id: string; code: string; display_name: string; status: string }; captured_at: string; received_at: string;
  client_record_id: string; captured_offline: boolean; created_by: U; updated_by: U;
  captured: { contact_name: string; mobile: string; email: string; org_name: string };
  contact: { id: string; full_name: string; title: string; mobile: string; email: string; alt_phone: string; contact_preference: string; version: number; provenance: Record<string, any> };
  account: null | { id: string; name: string; official_name: string; alt_name: string; industry: string; org_type: string; city: string; website: string; legal_id: string; version: number; provenance: Record<string, any> };
  products: { id: string; code: string; name_fa: string; name_en: string }[];
  quality: string; note: string; status: string; triage_owner: U;
  opportunity: null | {
    id: string; stage: string; owner: U; qualified_by: U; qualified_at: string; business_problem: string; use_case: string; urgency: string; decision_role: string;
    stakeholders: string; size_estimate: string; readiness: string; blockers: string; next_step: string; next_step_due_at: string | null; outcome_note: string;
    version: number; allowed_stages: string[]; tags: TagT[]; provenance: Record<string, any>;
  };
  referrals: { id: string; status: string; purpose_label: string; from_user: U; to_user: U; reason: string; due_at: string | null; response_note: string; created_at: string }[];
  tasks: { id: string; title: string; owner: U; due_at: string | null; status: string; status_label: string; outcome: string; created_by: U }[];
  completeness: { percent: number; missing: string[] };
  permissions: { edit_detail: boolean; assign: boolean; qualify: boolean; manage_tasks: boolean; view_pii: boolean; correct_capture: boolean };
  other_interactions: { id: string; event_code: string; captured_at: string }[];
};
type Activity = { id: string; type: string; type_label: string; actor: U; notes: string; metadata: any; created_at: string };

export function LeadDetailPage() {
  const { id = "" } = useParams();
  const { me } = useAuth();
  const lead = useQuery({ queryKey: ["lead", id], queryFn: () => get<Lead>(`/interactions/${id}`) });
  const acts = useQuery({ queryKey: ["lead-acts", id], queryFn: () => get<Activity[]>(`/interactions/${id}/activities`) });
  const [dialog, setDialog] = useState<null | "refer" | "qualify" | "stage" | "note" | "task" | "enrich" | "correct">(null);
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["lead", id] }); qc.invalidateQueries({ queryKey: ["lead-acts", id] }); qc.invalidateQueries({ queryKey: ["work-counts"] }); qc.invalidateQueries({ queryKey: ["leads"] }); };

  if (lead.isLoading) return <Card><LoadingRows rows={5} /></Card>;
  if (lead.isError) return <Card><ErrorState error={lead.error} onRetry={() => lead.refetch()} /></Card>;
  const l = lead.data!;
  const p = l.permissions;
  const opp = l.opportunity;
  const myPendingRef = l.referrals.find((r) => r.status === "PENDING" && r.to_user?.id === me?.user.id);

  return (
    <div className="space-y-5">
      <Link to="/leads" className="inline-flex items-center gap-1 text-[14px] text-muted hover:text-ink min-h-9"><ArrowRight className="size-4" />بازگشت به لیدها</Link>

      <Card className="p-5 md:p-6">
        <div className="flex flex-col md:flex-row md:items-start gap-4">
          <Avatar name={l.contact.full_name} size={56} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[24px] font-extrabold leading-tight [overflow-wrap:anywhere]">{l.contact.full_name}</h1>
              <QualityBadge q={l.quality} />
              <StageBadge s={opp?.stage} />
              {l.captured_offline && <Badge tone="neutral"><CloudOff className="size-3" />ثبت آفلاین</Badge>}
            </div>
            <div className="text-[14.5px] text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1"><Building2 className="size-4" />{l.account?.name ?? "شخص حقیقی / بدون سازمان"}</span>
              <span>{l.event.display_name} <Ltr className="font-mono text-[12px]">{l.event.code}</Ltr></span>
              <span>{fmtDateTime(l.captured_at)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">{l.products.map((pr) => <Badge key={pr.id} tone="action" size="md">{pr.name_fa}</Badge>)}</div>
          </div>
          <div className="flex flex-wrap gap-2 md:justify-end md:max-w-[360px]">
            {myPendingRef && <ReferralResponse referralId={myPendingRef.id} onDone={refresh} />}
            {p.edit_detail && <Button onClick={() => setDialog("enrich")}><PencilLine className="size-4" />تکمیل اطلاعات لید</Button>}
            {p.qualify && !opp && <Button variant="navy" onClick={() => setDialog("qualify")}><BadgeCheck className="size-4" />ارزیابی و ایجاد فرصت</Button>}
            {opp && (p.qualify || opp.owner?.id === me?.user.id) && opp.allowed_stages.length > 0 && <Button variant="secondary" onClick={() => setDialog("stage")}><CircleDot className="size-4" />تغییر مرحله</Button>}
            {p.assign && <Button variant="secondary" onClick={() => setDialog("refer")}><Send className="size-4" />ارجاع</Button>}
            {p.manage_tasks && <Button variant="secondary" onClick={() => setDialog("task")}><ListTodo className="size-4" />وظیفه</Button>}
            {(p.edit_detail || l.created_by?.id === me?.user.id) && <Button variant="ghost" onClick={() => setDialog("note")}><MessageSquarePlus className="size-4" />یادداشت</Button>}
            {p.correct_capture && <Button variant="ghost" onClick={() => setDialog("correct")}>اصلاح ثبت</Button>}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
        <div className="space-y-5 min-w-0">
          {/* Attribution: creator vs follow-up owner are distinct identities */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Person label="ثبت‌کننده" user={l.created_by} />
            <Person label="مسئول پیگیری" user={opp?.owner ?? l.triage_owner} empty="تعیین نشده" />
            <Person label="ارزیاب" user={opp?.qualified_by ?? null} empty="هنوز ارزیابی نشده" />
          </div>

          <TagsSection lead={l} onChange={refresh} />

          <Card>
            <CardHeader title="اطلاعات تماس و سازمان" subtitle={p.view_pii ? undefined : "شماره و ایمیل مخاطب در محدوده دسترسی شما پوشانده شده است."} />
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 px-5 pb-5 text-[14.5px]">
              <Info label="موبایل" value={l.contact.mobile && (p.view_pii ? <a href={`tel:${l.contact.mobile}`} className="text-action inline-flex items-center gap-1.5"><Phone className="size-4" /><Ltr>{fmtPhone(l.contact.mobile)}</Ltr></a> : <Ltr>{l.contact.mobile}</Ltr>)} />
              <Info label="ایمیل" value={l.contact.email && (p.view_pii ? <a href={`mailto:${l.contact.email}`} className="text-action inline-flex items-center gap-1.5"><Mail className="size-4" /><Ltr>{l.contact.email}</Ltr></a> : <Ltr>{l.contact.email}</Ltr>)} />
              <Info label="سمت" value={l.contact.title} />
              <Info label="تلفن جایگزین" value={l.contact.alt_phone && <Ltr>{l.contact.alt_phone}</Ltr>} />
              <Info label="صنعت" value={l.account?.industry} />
              <Info label="شهر" value={l.account?.city} />
              <Info label="وب‌سایت" value={l.account?.website && <a href={l.account.website} target="_blank" rel="noopener noreferrer" className="text-action"><Ltr>{l.account.website.replace(/^https?:\/\//, "")}</Ltr></a>} />
              <Info label="نام رسمی سازمان" value={l.account?.official_name} />
            </dl>
          </Card>

          {opp && (
            <Card>
              <CardHeader title="ارزیابی فرصت" subtitle={opp.qualified_at ? `ارزیابی ${relTime(opp.qualified_at)}` : undefined} />
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 px-5 pb-5 text-[14.5px]">
                <Info label="مسئله کسب‌وکار" value={opp.business_problem} wide />
                <Info label="کاربرد" value={opp.use_case} />
                <Info label="فوریت" value={opp.urgency && URGENCY[opp.urgency]} />
                <Info label="نقش در تصمیم" value={opp.decision_role} />
                <Info label="ذی‌نفعان" value={opp.stakeholders} />
                <Info label="آمادگی" value={opp.readiness} />
                <Info label="موانع" value={opp.blockers} />
                <Info label="اقدام بعدی" value={opp.next_step && <span>{opp.next_step}{opp.next_step_due_at && <span className="text-muted text-[13px]"> · {fmtDateTime(opp.next_step_due_at)}</span>}</span>} />
                <Info label="نتیجه" value={opp.outcome_note} />
              </dl>
            </Card>
          )}

          <Card>
            <CardHeader title="یادداشت غرفه و ثبت اولیه" subtitle="داده واردشده در غرفه بدون تغییر نگهداری می‌شود." />
            <div className="px-5 pb-5 space-y-3">
              {l.note ? <p className="text-[14.5px] leading-8 whitespace-pre-wrap">{l.note}</p> : <p className="text-[14px] text-muted">یادداشتی ثبت نشده است.</p>}
              <div className="text-[13px] text-muted bg-canvas rounded-[12px] p-3 leading-7">
                ثبت اولیه: {l.captured.contact_name}{l.captured.org_name && ` · ${l.captured.org_name}`}{l.captured.mobile && <> · <Ltr>{l.captured.mobile}</Ltr></>} · <InteractionStatus s={l.status} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="تاریخچه" subtitle="همه تغییرات با نام انجام‌دهنده و زمان ثبت می‌شوند." />
            <Timeline items={acts.data ?? []} loading={acts.isLoading} />
          </Card>
        </div>

        <aside className="space-y-5">
          <Completeness c={l.completeness} canEdit={p.edit_detail} onEdit={() => setDialog("enrich")} />
          <Card>
            <CardHeader title="ارجاع‌ها" />
            {!l.referrals.length ? <p className="px-5 pb-5 text-[14px] text-muted">ارجاعی ثبت نشده است.</p> : (
              <ul className="divide-y divide-line-2">
                {l.referrals.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-[13.5px] space-y-1">
                    <div className="flex items-center justify-between gap-2"><span>{r.from_user?.full_name} ← <b>{r.to_user?.full_name}</b></span><ReferralStatus s={r.status} /></div>
                    <div className="text-muted">{r.purpose_label} · {relTime(r.created_at)}{r.due_at && ` · مهلت ${fmtDateTime(r.due_at)}`}</div>
                    {r.reason && <div className="text-ink-2">«{r.reason}»</div>}
                    {r.response_note && <div className="text-danger">پاسخ: {r.response_note}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <TasksCard lead={l} onChange={refresh} />
          {l.other_interactions.length > 0 && (
            <Card>
              <CardHeader title="برخوردهای دیگر با این مخاطب" subtitle="در رویدادهای مختلف (در محدوده دسترسی شما)" />
              <ul className="px-5 pb-4 space-y-2 text-[13.5px]">
                {l.other_interactions.map((o) => <li key={o.id}><Link to={`/leads/${o.id}`} className="text-action"><Ltr className="font-mono">{o.event_code}</Ltr> · {fmtDateTime(o.captured_at)}</Link></li>)}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <ReferDialog open={dialog === "refer"} onOpenChange={(o) => !o && setDialog(null)} lead={l} onDone={refresh} />
      <QualifyDialog open={dialog === "qualify"} onOpenChange={(o) => !o && setDialog(null)} lead={l} onDone={refresh} />
      <StageDialog open={dialog === "stage"} onOpenChange={(o) => !o && setDialog(null)} lead={l} onDone={refresh} />
      <NoteDialog open={dialog === "note"} onOpenChange={(o) => !o && setDialog(null)} lead={l} onDone={refresh} />
      <TaskDialog open={dialog === "task"} onOpenChange={(o) => !o && setDialog(null)} lead={l} onDone={refresh} />
      <CorrectDialog open={dialog === "correct"} onOpenChange={(o) => !o && setDialog(null)} lead={l} onDone={refresh} />
      {dialog === "enrich" && <EnrichDialog onClose={() => setDialog(null)} lead={l} onDone={refresh} />}
    </div>
  );
}

function Person({ label, user, empty = "—" }: { label: string; user: U; empty?: string }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      {user ? <Avatar name={user.full_name} size={38} /> : <span className="size-[38px] rounded-full bg-line-2 grid place-items-center text-muted"><UserRound className="size-4" /></span>}
      <div className="min-w-0">
        <div className="text-[12px] text-muted">{label}</div>
        <div className={cn("font-semibold text-[14.5px] truncate", !user && "text-muted font-normal")}>{user?.full_name ?? empty}</div>
      </div>
    </div>
  );
}

function Info({ label, value, wide }: { label: string; value?: ReactNode; wide?: boolean }) {
  return (
    <div className={cn(wide && "sm:col-span-2")}>
      <dt className="text-[12.5px] text-muted mb-0.5">{label}</dt>
      <dd className={cn("leading-7", !value && "text-muted text-[13.5px]")}>{value || "ثبت نشده"}</dd>
    </div>
  );
}

function Completeness({ c, canEdit, onEdit }: { c: Lead["completeness"]; canEdit: boolean; onEdit: () => void }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold">کامل بودن اطلاعات</h2>
        <span className="text-[22px] font-extrabold num text-action">{faNum(c.percent)}٪</span>
      </div>
      <div className="h-2 rounded-full bg-line-2 overflow-hidden" role="progressbar" aria-valuenow={c.percent} aria-valuemin={0} aria-valuemax={100} aria-label="درصد تکمیل">
        <div className="h-full rounded-full bg-gradient-to-l from-action to-[#5f97ff] transition-[width] duration-500" style={{ width: `${c.percent}%` }} />
      </div>
      {c.missing.length > 0 && (
        <>
          <p className="text-[12.5px] text-muted mt-3 mb-2">موارد ثبت‌نشده (نامعلوم، نه منفی):</p>
          <div className="flex flex-wrap gap-1.5">{c.missing.map((m) => <Badge key={m} tone="neutral">{COMPLETENESS_LABELS[m] ?? m}</Badge>)}</div>
        </>
      )}
      {canEdit && c.missing.length > 0 && <Button variant="soft" size="sm" className="mt-4 w-full" onClick={onEdit}>تکمیل اطلاعات</Button>}
    </Card>
  );
}

function TagsSection({ lead, onChange }: { lead: Lead; onChange: () => void }) {
  const opp = lead.opportunity;
  const editable = lead.permissions.edit_detail && !!opp;
  const all = useQuery({ queryKey: ["tags-active"], queryFn: () => get<TagT[]>("/tags?active=1"), enabled: editable });
  const toast = useToast();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const mutate = async (fn: () => Promise<unknown>, id: string) => {
    setPending(id);
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ["lead", lead.id] });
      onChange();
    } catch (e) {
      toast({ tone: "error", title: "تغییر برچسب ذخیره نشد", body: (e as Error).message });
    } finally {
      setPending(null);
    }
  };
  return (
    <Card className="p-5">
      <h2 className="text-[13px] font-bold text-muted mb-2.5">برچسب‌ها</h2>
      {!opp ? (
        <p className="text-[13.5px] text-muted">برچسب‌گذاری پس از ارزیابی و ایجاد فرصت فعال می‌شود.</p>
      ) : (
        <div className={cn("flex flex-wrap items-center gap-1.5", pending && "opacity-70")} aria-busy={!!pending}>
          {opp.tags.map((t) => <TagChip key={t.id} tag={t} onRemove={editable ? () => mutate(() => del(`/opportunities/${opp.id}/tags/${t.id}`), t.id) : undefined} />)}
          {!opp.tags.length && !editable && <span className="text-[13.5px] text-muted">برچسبی ندارد.</span>}
          {editable && <TagCombobox all={all.data ?? []} selectedIds={opp.tags.map((t) => t.id)} onAdd={(t) => mutate(() => post(`/opportunities/${opp.id}/tags`, { tag_id: t.id }), t.id)} />}
        </div>
      )}
    </Card>
  );
}

const ACT_ICON: Record<string, ReactNode> = {
  CAPTURED: <Sparkles className="size-4" />, QUALIFIED: <BadgeCheck className="size-4" />, ENRICHED: <PencilLine className="size-4" />,
  REFERRAL_CREATED: <Send className="size-4" />, REFERRAL_ACCEPTED: <CheckCircle2 className="size-4" />, REFERRAL_RETURNED: <Undo2 className="size-4" />,
  TASK_CREATED: <ListTodo className="size-4" />, TASK_COMPLETED: <ClipboardCheck className="size-4" />, CALL: <Phone className="size-4" />,
};

const FIELD_LABEL: Record<string, string> = {
  name: "نام", official_name: "نام رسمی", alt_name: "نام جایگزین", industry: "صنعت", org_type: "نوع سازمان", city: "شهر", website: "وب‌سایت", legal_id: "شناسه حقوقی",
  full_name: "نام کامل", title: "سمت", email: "ایمیل", alt_phone: "تلفن جایگزین", mobile: "موبایل", contact_preference: "ترجیح تماس",
  business_problem: "مسئله", use_case: "کاربرد", urgency: "فوریت", decision_role: "نقش تصمیم", stakeholders: "ذی‌نفعان", size_estimate: "اندازه",
  readiness: "آمادگی", blockers: "موانع", next_step: "اقدام بعدی", next_step_due_at: "موعد", outcome_note: "نتیجه",
};

function Timeline({ items, loading }: { items: Activity[]; loading: boolean }) {
  if (loading) return <LoadingRows rows={3} />;
  if (!items.length) return <p className="px-5 pb-5 text-muted text-[14px]">فعالیتی ثبت نشده است.</p>;
  return (
    <ol className="px-5 pb-5 relative">
      {items.map((a) => (
        <li key={a.id} className="relative ps-10 pb-5 last:pb-0">
          <span className="absolute start-[15px] top-8 bottom-0 w-px bg-line last:hidden" aria-hidden />
          <span className="absolute start-0 top-0.5 size-8 rounded-full bg-line-2 text-ink-2 grid place-items-center">{ACT_ICON[a.type] ?? <History className="size-4" />}</span>
          <div className="text-[14px]"><b>{a.type_label}</b> <span className="text-muted">· {a.actor?.full_name ?? "سامانه"} · {relTime(a.created_at)}</span></div>
          {a.notes && <p className="text-[14px] text-ink-2 mt-1 leading-7 whitespace-pre-wrap">{a.notes}</p>}
          {a.type === "REFERRAL_CREATED" && a.metadata?.to && <p className="text-[13px] text-muted mt-0.5">به {a.metadata.to.name}{a.metadata.auto && " (خودکار)"}</p>}
          {a.type === "STAGE_CHANGED" && <p className="text-[13px] text-muted mt-0.5">{STAGE[a.metadata.from]} ← {STAGE[a.metadata.to]}</p>}
          {(a.type === "TAG_APPLIED" || a.type === "TAG_REMOVED") && <p className="text-[13px] text-muted mt-0.5">«{a.metadata.tag_name}»</p>}
          {a.type === "ENRICHED" && a.metadata?.changes && (
            <ul className="mt-1.5 text-[12.5px] text-muted space-y-0.5">
              {Object.entries(a.metadata.changes as Record<string, Record<string, { from: any; to: any }>>).flatMap(([, ch]) => Object.entries(ch).map(([f, v]) => (
                <li key={f}>{FIELD_LABEL[f] ?? f}: <span className="line-through opacity-70">{String(v.from || "—")}</span> ← <span className="text-ink-2">{String(v.to || "—")}</span></li>
              )))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

function ReferralResponse({ referralId, onDone }: { referralId: string; onDone: () => void }) {
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const toast = useToast();
  const accept = useMutation({ mutationFn: () => post(`/referrals/${referralId}/accept`), onSuccess: () => { toast({ tone: "success", title: "ارجاع پذیرفته شد" }); onDone(); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  const ret = useMutation({ mutationFn: () => post(`/referrals/${referralId}/return`, { note }), onSuccess: () => { setReturning(false); toast({ tone: "success", title: "ارجاع بازگردانده شد" }); onDone(); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  return (
    <>
      <Button variant="primary" onClick={() => accept.mutate()} loading={accept.isPending}><CheckCircle2 className="size-4" />پذیرش ارجاع</Button>
      <Button variant="danger-soft" onClick={() => setReturning(true)}><Undo2 className="size-4" />بازگرداندن</Button>
      <Dialog open={returning} onOpenChange={setReturning} title="بازگرداندن ارجاع" description="ارجاع‌دهنده دلیل را می‌بیند و می‌تواند دوباره ارجاع دهد."
        footer={<Button variant="danger" disabled={!note.trim()} loading={ret.isPending} onClick={() => ret.mutate()}>بازگرداندن</Button>}>
        <Textarea aria-label="دلیل بازگشت" value={note} onChange={(e) => setNote(e.target.value)} placeholder="دلیل بازگشت (الزامی)" />
      </Dialog>
    </>
  );
}

function useAction(onDone: () => void, close: () => void, success: string) {
  const toast = useToast();
  return (fn: () => Promise<unknown>) => ({
    mutationFn: fn,
    onSuccess: () => { toast({ tone: "success", title: success }); onDone(); close(); },
    onError: (e: unknown) => {
      const err = e as ApiError;
      toast({ tone: "error", title: err.isConflict ? "تغییر هم‌زمان" : "ذخیره نشد", body: err.isConflict ? "این رکورد هم‌زمان توسط کاربر دیگری تغییر کرده است؛ صفحه به‌روز شد." : err.message });
      if (err.isConflict) onDone();
    },
  });
}

function ReferDialog({ open, onOpenChange, lead, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; lead: Lead; onDone: () => void }) {
  const [user, setUser] = useState<UserLite | null>(null);
  const [reason, setReason] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const [purpose, setPurpose] = useState<"FOLLOW_UP" | "QUALIFICATION">(lead.opportunity ? "FOLLOW_UP" : "QUALIFICATION");
  const m = useMutation(useAction(onDone, () => onOpenChange(false), "ارجاع ثبت شد")(() => post(`/interactions/${lead.id}/refer`, { to_user_id: user?.id, reason, due_at: due, purpose })));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="ارجاع لید" description="گیرنده در کارتابل خود مطلع می‌شود؛ ارجاع قبلیِ در انتظار، با حفظ تاریخچه جایگزین می‌شود." size="lg"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>انصراف</Button><Button disabled={!user} loading={m.isPending} onClick={() => m.mutate()}>ارجاع</Button></>}>
      <div className="space-y-4">
        <Segmented label="هدف ارجاع" value={purpose} onChange={setPurpose} options={[{ value: "QUALIFICATION", label: "ارزیابی" }, { value: "FOLLOW_UP", label: "پیگیری" }]} />
        <UserPicker value={user} onChange={setUser} eventId={lead.event.id} placeholder="جست‌وجو در اعضای رویداد…" />
        <Field label="مهلت (اختیاری)"><JalaliDatePicker value={due} onChange={setDue} label="مهلت ارجاع" /></Field>
        <Field label="دلیل یا توضیح" htmlFor="ref-reason"><Textarea id="ref-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}

function QualifyDialog({ open, onOpenChange, lead, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; lead: Lead; onDone: () => void }) {
  const [owner, setOwner] = useState<UserLite | null>(lead.triage_owner);
  const [v, setV] = useState({ business_problem: "", urgency: "", next_step: "" });
  const [due, setDue] = useState<string | null>(null);
  const m = useMutation(useAction(onDone, () => onOpenChange(false), "فرصت ایجاد شد")(() => post(`/interactions/${lead.id}/qualify`, { ...v, owner_id: owner?.id, next_step_due_at: due })));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="ارزیابی و ایجاد فرصت" description="فرصت فقط با ارزیابی صریح ایجاد می‌شود؛ ثبت غرفه به‌خودی‌خود فرصت فروش نیست." size="lg"
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>انصراف</Button><Button loading={m.isPending} onClick={() => m.mutate()}>ایجاد فرصت</Button></>}>
      <div className="space-y-4">
        <Field label="مسئله کسب‌وکار"><Textarea value={v.business_problem} onChange={(e) => setV({ ...v, business_problem: e.target.value })} /></Field>
        <Field label="فوریت"><Segmented label="فوریت" value={v.urgency || ""} onChange={(x) => setV({ ...v, urgency: x })} options={[{ value: "", label: "نامشخص" }, { value: "LOW", label: "کم" }, { value: "MEDIUM", label: "متوسط" }, { value: "HIGH", label: "زیاد" }]} /></Field>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="اقدام بعدی"><Input value={v.next_step} onChange={(e) => setV({ ...v, next_step: e.target.value })} /></Field>
          <Field label="موعد اقدام بعدی"><JalaliDatePicker value={due} onChange={setDue} /></Field>
        </div>
        <Field label="مسئول پیگیری (اختیاری)"><UserPicker value={owner} onChange={setOwner} eventId={lead.event.id} /></Field>
      </div>
    </Dialog>
  );
}

function StageDialog({ open, onOpenChange, lead, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; lead: Lead; onDone: () => void }) {
  const opp = lead.opportunity!;
  const [stage, setStage] = useState("");
  const [note, setNote] = useState("");
  const m = useMutation(useAction(onDone, () => onOpenChange(false), "مرحله تغییر کرد")(() => post(`/opportunities/${opp?.id}/stage`, { stage, note, version: opp?.version })));
  if (!opp) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="تغییر مرحله فرصت" size="sm"
      footer={<Button disabled={!stage} loading={m.isPending} onClick={() => m.mutate()}>ثبت</Button>}>
      <div className="space-y-3">
        <p className="text-[14px] text-muted">مرحله فعلی: <StageBadge s={opp.stage} /></p>
        <div className="grid grid-cols-2 gap-2">
          {opp.allowed_stages.map((s) => (
            <button key={s} type="button" aria-pressed={stage === s} onClick={() => setStage(s)} className={cn("min-h-11 rounded-[12px] border text-[14px]", stage === s ? "border-action bg-action-soft text-action font-semibold" : "border-line")}>{STAGE[s]}</button>
          ))}
        </div>
        <Textarea aria-label="توضیح" placeholder="توضیح یا نتیجه (اختیاری)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  );
}

function NoteDialog({ open, onOpenChange, lead, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; lead: Lead; onDone: () => void }) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"NOTE" | "CALL" | "MEETING">("NOTE");
  const m = useMutation(useAction(() => { setText(""); onDone(); }, () => onOpenChange(false), "ثبت شد")(() => post(`/interactions/${lead.id}/activities`, { text, kind })));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="ثبت فعالیت" size="sm" footer={<Button disabled={!text.trim()} loading={m.isPending} onClick={() => m.mutate()}>ثبت</Button>}>
      <div className="space-y-3">
        <Segmented label="نوع" value={kind} onChange={setKind} options={[{ value: "NOTE", label: "یادداشت" }, { value: "CALL", label: "تماس" }, { value: "MEETING", label: "جلسه" }]} />
        <Textarea aria-label="متن" value={text} onChange={(e) => setText(e.target.value)} rows={4} />
      </div>
    </Dialog>
  );
}

function TaskDialog({ open, onOpenChange, lead, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; lead: Lead; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState<UserLite | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const m = useMutation(useAction(() => { setTitle(""); onDone(); }, () => onOpenChange(false), "وظیفه تعریف شد")(() => post(`/interactions/${lead.id}/tasks`, { title, owner_id: owner?.id, due_at: due })));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="وظیفه پیگیری جدید" size="lg" footer={<Button disabled={!title.trim()} loading={m.isPending} onClick={() => m.mutate()}>ثبت وظیفه</Button>}>
      <div className="space-y-4">
        <Field label="عنوان" required htmlFor="task-title"><Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً تماس پیگیری و ارسال پیشنهاد" /></Field>
        <Field label="موعد"><JalaliDatePicker value={due} onChange={setDue} /></Field>
        <Field label="مسئول (پیش‌فرض: خودم)"><UserPicker value={owner} onChange={setOwner} eventId={lead.event.id} /></Field>
      </div>
    </Dialog>
  );
}

function CorrectDialog({ open, onOpenChange, lead, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; lead: Lead; onDone: () => void }) {
  const [quality, setQuality] = useState(lead.quality);
  const [note, setNote] = useState(lead.note);
  const m = useMutation(useAction(onDone, () => onOpenChange(false), "ثبت اصلاح شد")(() => patch(`/interactions/${lead.id}`, { quality, note, version: lead.version })));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="اصلاح ثبت غرفه" description="تا پایان رویداد، ثبت‌کننده می‌تواند کیفیت و یادداشت را اصلاح کند. تغییرات در تاریخچه ثبت می‌شوند." size="sm"
      footer={<Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button>}>
      <div className="space-y-3">
        <Segmented label="کیفیت" value={quality} onChange={setQuality} options={[{ value: "SERIOUS", label: "جدی" }, { value: "FOLLOW_UP", label: "قابل‌پیگیری" }, { value: "INTRO", label: "آشنایی" }]} />
        <Textarea aria-label="یادداشت" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Dialog>
  );
}

function TasksCard({ lead, onChange }: { lead: Lead; onChange: () => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const [outcome, setOutcome] = useState<{ id: string; text: string } | null>(null);
  const m = useMutation({ mutationFn: ({ id, text }: { id: string; text: string }) => post(`/tasks/${id}/complete`, { outcome: text }), onSuccess: () => { setOutcome(null); onChange(); toast({ tone: "success", title: "وظیفه انجام شد" }); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  return (
    <Card>
      <CardHeader title="وظایف پیگیری" />
      {!lead.tasks.length ? <p className="px-5 pb-5 text-[14px] text-muted">وظیفه‌ای تعریف نشده است.</p> : (
        <ul className="divide-y divide-line-2">
          {lead.tasks.map((t) => {
            const overdue = t.status === "OPEN" && t.due_at && new Date(t.due_at) < new Date();
            return (
              <li key={t.id} className="px-5 py-3 text-[13.5px]">
                <div className="flex items-start gap-2">
                  {t.status === "DONE" ? <CheckCircle2 className="size-4 text-success mt-1" /> : <CalendarClock className={cn("size-4 mt-1", overdue ? "text-danger" : "text-muted")} />}
                  <div className="flex-1 min-w-0">
                    <div className={cn("font-semibold", t.status !== "OPEN" && "line-through text-muted")}>{t.title}</div>
                    <div className="text-muted">{t.owner?.full_name}{t.due_at && ` · ${fmtDateTime(t.due_at)}`}{overdue && <span className="text-danger"> · معوق</span>}</div>
                    {t.outcome && <div className="text-ink-2 mt-0.5">{t.outcome}</div>}
                  </div>
                  {t.status === "OPEN" && (t.owner?.id === me?.user.id || lead.permissions.manage_tasks) && (
                    <Button size="sm" variant="soft" onClick={() => setOutcome({ id: t.id, text: "" })}>انجام شد</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={!!outcome} onOpenChange={(o) => !o && setOutcome(null)} title="ثبت نتیجه وظیفه" size="sm"
        footer={<Button loading={m.isPending} onClick={() => outcome && m.mutate(outcome)}>ثبت انجام</Button>}>
        <Textarea aria-label="نتیجه" placeholder="نتیجه پیگیری (اختیاری)" value={outcome?.text ?? ""} onChange={(e) => setOutcome(outcome && { ...outcome, text: e.target.value })} />
      </Dialog>
    </Card>
  );
}

/** Progressive, sectioned enrichment. Each section is saved with its own version check. */
function EnrichDialog({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: () => void }) {
  const [section, setSection] = useState<"account" | "contact" | "qualification">("account");
  const a = lead.account;
  const [acc, setAcc] = useState({ name: a?.name ?? lead.captured.org_name ?? "", official_name: a?.official_name ?? "", alt_name: a?.alt_name ?? "", industry: a?.industry ?? "", org_type: a?.org_type ?? "", city: a?.city ?? "", website: a?.website ?? "", legal_id: a?.legal_id ?? "" });
  const c = lead.contact;
  const [con, setCon] = useState({ full_name: c.full_name, title: c.title, email: lead.permissions.view_pii ? c.email : "", alt_phone: lead.permissions.view_pii ? c.alt_phone : "", contact_preference: c.contact_preference });
  const o = lead.opportunity;
  const [qual, setQual] = useState({ business_problem: o?.business_problem ?? "", use_case: o?.use_case ?? "", urgency: o?.urgency ?? "", decision_role: o?.decision_role ?? "", stakeholders: o?.stakeholders ?? "", size_estimate: o?.size_estimate ?? "", readiness: o?.readiness ?? "", blockers: o?.blockers ?? "", next_step: o?.next_step ?? "", next_step_due_at: o?.next_step_due_at ?? null as string | null, outcome_note: o?.outcome_note ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => {
      const body: any = {};
      if (section === "account") body.account = { ...acc, version: a?.version };
      if (section === "contact") body.contact = { ...con, version: c.version, ...(lead.permissions.view_pii ? {} : { email: undefined, alt_phone: undefined }) };
      if (section === "qualification") body.qualification = { ...qual, version: o?.version };
      return patch<any>(`/interactions/${lead.id}/enrichment`, body);
    },
    onSuccess: (r) => {
      setErrors({});
      const n = Object.values(r.changes ?? {}).reduce((s: number, x: any) => s + Object.keys(x).length, 0);
      toast({ tone: "success", title: n ? `${faNum(n)} فیلد ذخیره شد` : "تغییری برای ذخیره نبود" });
      onDone();
    },
    onError: (e: any) => {
      if (e instanceof ApiError && e.isConflict) setConflict(true);
      else {
        const fe = e instanceof ApiError ? e.data?.[section] ?? e.fieldErrors() : {};
        setErrors(typeof fe === "object" ? fe : {});
        toast({ tone: "error", title: "ذخیره نشد", body: e.message });
      }
    },
  });
  const F = ({ k, label, obj, set, area, ltr, hint }: { k: string; label: string; obj: any; set: (v: any) => void; area?: boolean; ltr?: boolean; hint?: string }) => (
    <Field label={label} htmlFor={`en-${k}`} error={(errors as any)[k]} hint={hint ?? provenanceHint(section === "account" ? a?.provenance : section === "contact" ? c.provenance : o?.provenance, k)}>
      {area ? <Textarea id={`en-${k}`} value={obj[k] ?? ""} onChange={(e) => set({ ...obj, [k]: e.target.value })} /> : <Input id={`en-${k}`} dir={ltr ? "ltr" : undefined} className={ltr ? "text-left" : undefined} value={obj[k] ?? ""} onChange={(e) => set({ ...obj, [k]: e.target.value })} />}
    </Field>
  );
  return (
    <Dialog open onOpenChange={(op) => !op && onClose()} title="تکمیل اطلاعات لید" description="بخش‌ها را به‌ترتیب و مستقل ذخیره کنید. مقادیر قبلی و نام ویرایشگر در تاریخچه می‌ماند. این فرم پس از پایان رویداد نیز در دسترس است." size="xl"
      footer={<><Button variant="secondary" onClick={onClose}>بستن</Button><Button loading={save.isPending} disabled={section === "qualification" && !o} onClick={() => save.mutate()}>ذخیره این بخش</Button></>}>
      <div className="space-y-5">
        <Segmented label="بخش" value={section} onChange={(s) => { setSection(s); setErrors({}); }} options={[{ value: "account", label: "سازمان" }, { value: "contact", label: "مخاطب" }, { value: "qualification", label: "ارزیابی و پیگیری" }]} />
        {conflict && (
          <div role="alert" className="rounded-[12px] bg-warning-soft text-warning p-3 text-[14px] flex items-center gap-3">
            این بخش هم‌زمان توسط کاربر دیگری تغییر کرده است. برای جلوگیری از بازنویسی، داده تازه را بارگذاری کنید.
            <Button size="sm" variant="secondary" onClick={() => { onDone(); onClose(); }}>بارگذاری مجدد</Button>
          </div>
        )}
        {section === "account" && (
          <div className="grid sm:grid-cols-2 gap-4">
            {F({ k: "name", label: a ? "نام نمایشی سازمان" : "نام سازمان (ایجاد سازمان)", obj: acc, set: setAcc })}
            {F({ k: "official_name", label: "نام رسمی", obj: acc, set: setAcc })}
            {F({ k: "alt_name", label: "نام جایگزین / تجاری", obj: acc, set: setAcc })}
            {F({ k: "industry", label: "صنعت", obj: acc, set: setAcc })}
            <Field label="نوع سازمان" htmlFor="en-org_type">
              <Select id="en-org_type" value={acc.org_type} onChange={(e) => setAcc({ ...acc, org_type: e.target.value })}>
                <option value="">نامشخص</option><option value="GOVERNMENT">دولتی</option><option value="PRIVATE">خصوصی</option><option value="SEMI_PUBLIC">عمومی غیردولتی</option><option value="ACADEMIC">دانشگاهی/پژوهشی</option><option value="OTHER">سایر</option>
              </Select>
            </Field>
            {F({ k: "city", label: "شهر", obj: acc, set: setAcc })}
            {F({ k: "website", label: "وب‌سایت", obj: acc, set: setAcc, ltr: true })}
            {F({ k: "legal_id", label: "شناسه حقوقی (فقط در صورت نیاز)", obj: acc, set: setAcc, ltr: true })}
          </div>
        )}
        {section === "contact" && (
          <div className="grid sm:grid-cols-2 gap-4">
            {F({ k: "full_name", label: "نام کامل", obj: con, set: setCon })}
            {F({ k: "title", label: "سمت", obj: con, set: setCon })}
            {lead.permissions.view_pii && F({ k: "email", label: "ایمیل کاری", obj: con, set: setCon, ltr: true })}
            {lead.permissions.view_pii && F({ k: "alt_phone", label: "تلفن جایگزین", obj: con, set: setCon, ltr: true })}
            <Field label="ترجیح تماس" htmlFor="en-pref">
              <Select id="en-pref" value={con.contact_preference} onChange={(e) => setCon({ ...con, contact_preference: e.target.value })}>
                <option value="">نامشخص</option><option value="PHONE">تلفن</option><option value="EMAIL">ایمیل</option><option value="MEETING">جلسه حضوری</option>
              </Select>
            </Field>
            <p className="sm:col-span-2 text-[12.5px] text-muted">رضایت ارسال پیام بازاریابی به مخاطب در این فاز ثبت و استفاده نمی‌شود (ارسال به مشتری غیرفعال است).</p>
          </div>
        )}
        {section === "qualification" && (!o ? (
          <p className="text-[14px] text-muted">برای ثبت اطلاعات ارزیابی، ابتدا لید را «ارزیابی و ایجاد فرصت» کنید.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {F({ k: "business_problem", label: "مسئله کسب‌وکار", obj: qual, set: setQual, area: true })}
            {F({ k: "use_case", label: "کاربرد / Use case", obj: qual, set: setQual, area: true })}
            <Field label="فوریت"><Segmented label="فوریت" value={qual.urgency} onChange={(x) => setQual({ ...qual, urgency: x })} options={[{ value: "", label: "نامشخص" }, { value: "LOW", label: "کم" }, { value: "MEDIUM", label: "متوسط" }, { value: "HIGH", label: "زیاد" }]} /></Field>
            {F({ k: "decision_role", label: "نقش در تصمیم‌گیری", obj: qual, set: setQual })}
            {F({ k: "stakeholders", label: "ذی‌نفعان مرتبط", obj: qual, set: setQual })}
            {F({ k: "size_estimate", label: "اندازه تقریبی (در صورت وجود پشتوانه)", obj: qual, set: setQual })}
            {F({ k: "readiness", label: "آمادگی", obj: qual, set: setQual })}
            {F({ k: "blockers", label: "موانع", obj: qual, set: setQual, area: true })}
            {F({ k: "next_step", label: "اقدام بعدی", obj: qual, set: setQual })}
            <Field label="موعد اقدام بعدی"><JalaliDatePicker value={qual.next_step_due_at} onChange={(v) => setQual({ ...qual, next_step_due_at: v })} /></Field>
            {F({ k: "outcome_note", label: "نتیجه نهایی", obj: qual, set: setQual, area: true })}
          </div>
        ))}
      </div>
    </Dialog>
  );
}

function provenanceHint(prov: Record<string, any> | undefined, k: string) {
  const p = prov?.[k];
  if (!p) return undefined;
  return `آخرین تغییر ${relTime(p.at)}${p.source === "BOOTH_CAPTURE" ? " (ثبت غرفه)" : ""}`;
}
