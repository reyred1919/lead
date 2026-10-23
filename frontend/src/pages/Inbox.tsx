import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CheckCircle2, Inbox as InboxIcon, Undo2 } from "lucide-react";
import { get, post, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useWorkCounts } from "@/lib/hooks";
import { fmtDateTime, relTime } from "@/lib/format";
import { QUALITY } from "@/lib/labels";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingRows, Ltr, PageHeader, Segmented, Textarea, cn } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlay";
import { ActionStatus, ReferralStatus } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";

type Tab = "referrals" | "accepted" | "outgoing" | "returned" | "tasks" | "actions" | "team";

export function InboxPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "referrals";
  const { data: counts } = useWorkCounts();
  const { can } = useAuth();
  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: "referrals", label: "ارجاع‌های جدید", count: counts?.referrals_incoming },
    { value: "tasks", label: "وظایف من", count: counts?.tasks_open },
    { value: "actions", label: "درخواست‌های اقدام", count: counts?.actions_open },
    { value: "accepted", label: "پذیرفته‌شده" },
    { value: "outgoing", label: "ارسالی" },
    { value: "returned", label: "بازگشتی", count: counts?.referrals_returned },
    ...(can("lead.assign") ? [{ value: "team" as Tab, label: "کارتابل تیم" }] : []),
  ];
  return (
    <div>
      <PageHeader title="کارتابل" subtitle="ارجاع‌ها، وظایف پیگیری و درخواست‌های اقدام شما — جدا از اعلان‌های اطلاع‌رسانی." />
      <Segmented label="بخش کارتابل" value={tab} onChange={(v) => setParams({ tab: v })} options={tabs} className="mb-4" />
      {tab === "tasks" ? <TaskList /> : tab === "actions" ? <ActionList /> : <ReferralList box={tab === "referrals" ? "incoming" : tab} />}
    </div>
  );
}

function ReferralList({ box }: { box: string }) {
  const [status, setStatus] = useState("PENDING");
  const q = useQuery({ queryKey: ["referrals", box, status], queryFn: () => get<Page<any>>(`/referrals?box=${box}${box === "team" ? `&status=${status}` : ""}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const [ret, setRet] = useState<{ id: string; note: string } | null>(null);
  const done = (msg: string) => { toast({ tone: "success", title: msg }); qc.invalidateQueries({ queryKey: ["referrals"] }); qc.invalidateQueries({ queryKey: ["work-counts"] }); };
  const accept = useMutation({ mutationFn: (id: string) => post(`/referrals/${id}/accept`), onSuccess: () => done("ارجاع پذیرفته شد"), onError: (e: any) => toast({ tone: "error", title: e.message }) });
  const back = useMutation({ mutationFn: (r: { id: string; note: string }) => post(`/referrals/${r.id}/return`, { note: r.note }), onSuccess: () => { setRet(null); done("ارجاع بازگردانده شد"); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  return (
    <Card>
      {box === "team" && <div className="p-4 border-b border-line-2"><Segmented size="sm" label="وضعیت" value={status} onChange={setStatus} options={[{ value: "PENDING", label: "در انتظار" }, { value: "RETURNED", label: "بازگشتی" }, { value: "ACCEPTED", label: "پذیرفته" }]} /></div>}
      {q.isLoading ? <LoadingRows /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data?.results.length ? (
        <EmptyState icon={<InboxIcon className="size-6" />} title="موردی وجود ندارد" body={box === "incoming" ? "ارجاع تازه‌ای برای شما ثبت نشده است." : undefined} />
      ) : (
        <ul className="divide-y divide-line-2">
          {q.data.results.map((r: any) => {
            const overdue = r.status === "PENDING" && r.due_at && new Date(r.due_at) < new Date();
            return (
              <li key={r.id} className="p-4 md:px-5 flex flex-col md:flex-row md:items-center gap-3">
                <Link to={`/leads/${r.interaction_id}`} className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{r.lead.contact_name}</span>
                    {r.lead.account_name && <span className="text-muted text-[13.5px]">· {r.lead.account_name}</span>}
                    <Ltr className="text-[11.5px] text-muted font-mono">{r.lead.event_code}</Ltr>
                    <Badge tone="neutral">{QUALITY[r.lead.quality]}</Badge>
                    <Badge tone="info">{r.purpose_label}</Badge>
                  </div>
                  <div className="text-[13px] text-muted mt-1">
                    از {r.from_user?.full_name} به {r.to_user?.full_name} · {relTime(r.created_at)}
                    {r.due_at && <span className={cn(overdue && "text-danger font-semibold")}> · مهلت {fmtDateTime(r.due_at)}{overdue && " (معوق)"}</span>}
                  </div>
                  {r.reason && <div className="text-[13.5px] mt-1 text-ink-2">«{r.reason}»</div>}
                  {r.response_note && <div className="text-[13.5px] mt-1 text-danger">دلیل بازگشت: {r.response_note}</div>}
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  <ReferralStatus s={r.status} />
                  {box === "incoming" && <>
                    <Button size="sm" onClick={() => accept.mutate(r.id)} loading={accept.isPending && accept.variables === r.id}><CheckCircle2 className="size-4" />پذیرش</Button>
                    <Button size="sm" variant="danger-soft" onClick={() => setRet({ id: r.id, note: "" })}><Undo2 className="size-4" />بازگرداندن</Button>
                  </>}
                  {(box === "returned" || (box === "team" && r.status === "RETURNED")) && <Link to={`/leads/${r.interaction_id}`}><Button size="sm" variant="soft">ارجاع مجدد</Button></Link>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={!!ret} onOpenChange={(o) => !o && setRet(null)} title="بازگرداندن ارجاع" size="sm"
        footer={<Button variant="danger" disabled={!ret?.note.trim()} loading={back.isPending} onClick={() => ret && back.mutate(ret)}>بازگرداندن</Button>}>
        <Textarea aria-label="دلیل" placeholder="دلیل بازگشت (الزامی)" value={ret?.note ?? ""} onChange={(e) => setRet(ret && { ...ret, note: e.target.value })} />
      </Dialog>
    </Card>
  );
}

function TaskList() {
  const [scope, setScope] = useState("mine");
  const [status, setStatus] = useState("OPEN");
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["tasks", scope, status], queryFn: () => get<Page<any>>(`/tasks?scope=${scope}&status=${status}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const [done, setDone] = useState<{ id: string; text: string } | null>(null);
  const m = useMutation({ mutationFn: (d: { id: string; text: string }) => post(`/tasks/${d.id}/complete`, { outcome: d.text }), onSuccess: () => { setDone(null); qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["work-counts"] }); toast({ tone: "success", title: "وظیفه انجام شد" }); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  return (
    <Card>
      <div className="p-4 border-b border-line-2 flex flex-wrap gap-2">
        <Segmented size="sm" label="محدوده" value={scope} onChange={setScope} options={[{ value: "mine", label: "واگذارشده به من" }, { value: "created", label: "تعریف‌شده توسط من" }, ...(can("task.manage") ? [{ value: "team", label: "تیم" }] : [])]} />
        <Segmented size="sm" label="وضعیت" value={status} onChange={setStatus} options={[{ value: "OPEN", label: "باز" }, { value: "DONE", label: "انجام‌شده" }, { value: "ALL", label: "همه" }]} />
      </div>
      {q.isLoading ? <LoadingRows /> : !q.data?.results.length ? <EmptyState icon={<CalendarClock className="size-6" />} title="وظیفه‌ای نیست" /> : (
        <ul className="divide-y divide-line-2">
          {q.data.results.map((t: any) => {
            const overdue = t.status === "OPEN" && t.due_at && new Date(t.due_at) < new Date();
            return (
              <li key={t.id} className="p-4 md:px-5 flex items-center gap-3">
                <Link to={`/leads/${t.interaction_id}`} className="flex-1 min-w-0">
                  <div className={cn("font-semibold", t.status !== "OPEN" && "line-through text-muted")}>{t.title}</div>
                  <div className="text-[13px] text-muted">{t.lead.contact_name} · <Ltr className="font-mono">{t.lead.event_code}</Ltr> · {t.owner?.full_name}
                    {t.due_at && <span className={cn(overdue && "text-danger font-semibold")}> · {fmtDateTime(t.due_at)}{overdue && " (معوق)"}</span>}</div>
                </Link>
                {t.status === "OPEN" ? <Button size="sm" variant="soft" onClick={() => setDone({ id: t.id, text: "" })}>انجام شد</Button> : <Badge tone="success">{t.status_label}</Badge>}
              </li>
            );
          })}
        </ul>
      )}
      <Dialog open={!!done} onOpenChange={(o) => !o && setDone(null)} title="ثبت نتیجه" size="sm" footer={<Button loading={m.isPending} onClick={() => done && m.mutate(done)}>ثبت انجام</Button>}>
        <Textarea aria-label="نتیجه" value={done?.text ?? ""} onChange={(e) => setDone(done && { ...done, text: e.target.value })} placeholder="نتیجه پیگیری" />
      </Dialog>
    </Card>
  );
}

const NEXT_LABEL: Record<string, string> = { ACKNOWLEDGED: "دیدم", IN_PROGRESS: "شروع کار", DONE: "انجام شد", RETURNED: "بازگرداندن", OPEN: "بازگشایی", CANCELLED: "لغو" };

export function ActionList({ scope: initial = "mine" }: { scope?: string }) {
  const [scope, setScope] = useState(initial);
  const q = useQuery({ queryKey: ["actions", scope], queryFn: () => get<Page<any>>(`/action-requests?scope=${scope}&status=${scope === "mine" ? "OPEN,ACKNOWLEDGED,IN_PROGRESS,RETURNED" : "ALL"}`) });
  const qc = useQueryClient();
  const toast = useToast();
  const [noteFor, setNoteFor] = useState<{ id: string; status: string; note: string } | null>(null);
  const m = useMutation({
    mutationFn: (d: { id: string; status: string; note?: string }) => post(`/action-requests/${d.id}/transition`, { status: d.status, note: d.note ?? "" }),
    onSuccess: () => { setNoteFor(null); qc.invalidateQueries({ queryKey: ["actions"] }); qc.invalidateQueries({ queryKey: ["work-counts"] }); qc.invalidateQueries({ queryKey: ["notifications"] }); toast({ tone: "success", title: "وضعیت به‌روز شد" }); },
    onError: (e: any) => toast({ tone: "error", title: e.message }),
  });
  return (
    <Card>
      <div className="p-4 border-b border-line-2">
        <Segmented size="sm" label="محدوده" value={scope} onChange={setScope} options={[{ value: "mine", label: "واگذارشده به من" }, { value: "requested", label: "درخواست‌های من (پایش تکمیل)" }]} />
      </div>
      {q.isLoading ? <LoadingRows /> : !q.data?.results.length ? <EmptyState title="درخواست اقدامی نیست" body="درخواست‌های اقدام تا تکمیل صریح باز می‌مانند؛ خواندن اعلان آن‌ها را بسته نمی‌کند." /> : (
        <ul className="divide-y divide-line-2">
          {q.data.results.map((a: any) => (
            <li key={a.id} className="p-4 md:px-5 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{a.subject}</span>
                <Badge tone="info">{a.action_type_label}</Badge>
                <ActionStatus s={a.status} />
                {a.overdue && <Badge tone="danger">معوق</Badge>}
              </div>
              <div className="text-[13px] text-muted">{scope === "mine" ? `از ${a.requested_by?.full_name}` : `برای ${a.assignee?.full_name}`} · {relTime(a.created_at)}{a.due_at && ` · مهلت ${fmtDateTime(a.due_at)}`}</div>
              {a.instructions && <p className="text-[14px] leading-7 text-ink-2 whitespace-pre-wrap">{a.instructions}</p>}
              {a.related_interaction_id && <Link className="text-action text-[13.5px] font-semibold" to={`/leads/${a.related_interaction_id}`}>مشاهده لید مرتبط</Link>}
              <div className="flex flex-wrap gap-2">
                {a.allowed_transitions.filter((s: string) => scope === "mine" ? !["CANCELLED", "OPEN"].includes(s) : ["CANCELLED", "OPEN"].includes(s)).map((s: string) => (
                  <Button key={s} size="sm" variant={s === "DONE" ? "primary" : s === "RETURNED" || s === "CANCELLED" ? "danger-soft" : "secondary"}
                    onClick={() => (s === "RETURNED" || s === "DONE" ? setNoteFor({ id: a.id, status: s, note: "" }) : m.mutate({ id: a.id, status: s }))}>{NEXT_LABEL[s]}</Button>
                ))}
              </div>
              {a.history.length > 1 && (
                <details className="text-[12.5px] text-muted"><summary className="cursor-pointer">تاریخچه</summary>
                  <ul className="mt-1 space-y-0.5">{a.history.map((h: any, i: number) => <li key={i}>{h.actor?.full_name}: {h.from || "—"} ← {h.to} · {relTime(h.at)}{h.note && ` · «${h.note}»`}</li>)}</ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!noteFor} onOpenChange={(o) => !o && setNoteFor(null)} title={noteFor?.status === "RETURNED" ? "دلیل بازگرداندن" : "ثبت انجام"} size="sm"
        footer={<Button loading={m.isPending} disabled={noteFor?.status === "RETURNED" && !noteFor.note.trim()} onClick={() => noteFor && m.mutate(noteFor)}>ثبت</Button>}>
        <Textarea aria-label="توضیح" value={noteFor?.note ?? ""} onChange={(e) => setNoteFor(noteFor && { ...noteFor, note: e.target.value })} placeholder={noteFor?.status === "RETURNED" ? "دلیل (الزامی)" : "توضیح (اختیاری)"} />
      </Dialog>
    </Card>
  );
}
