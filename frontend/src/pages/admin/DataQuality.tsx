import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, GitMerge, Search, Undo2 } from "lucide-react";
import { get, post, qs, type Page } from "@/lib/api";
import { useDebounced } from "@/lib/hooks";
import { faNum, fmtDateTime, fmtPhone, relTime } from "@/lib/format";
import { MATCH_TYPE, QUARANTINE_REASON } from "@/lib/labels";
import { Badge, Button, Card, EmptyState, Input, LoadingRows, Ltr, PageHeader, Segmented, cn } from "@/components/ui/primitives";
import { ConfirmDialog, Dialog } from "@/components/ui/overlay";
import { QualityBadge } from "@/components/ui/status";
import { useToast } from "@/components/ui/toast";

export function DuplicatesPage() {
  const [tab, setTab] = useState<"open" | "merges">("open");
  const q = useQuery({ queryKey: ["duplicates"], queryFn: () => get<Page<any>>("/duplicates") });
  const merges = useQuery({ queryKey: ["merges"], queryFn: () => get<Page<any>>("/merges"), enabled: tab === "merges" });
  const [merge, setMerge] = useState<{ cand: any; survivor: string } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const inv = () => { qc.invalidateQueries({ queryKey: ["duplicates"] }); qc.invalidateQueries({ queryKey: ["merges"] }); };
  const doMerge = useMutation({ mutationFn: () => post(`/duplicates/${merge!.cand.id}/merge`, { survivor_id: merge!.survivor }), onSuccess: () => { setMerge(null); inv(); toast({ tone: "success", title: "ادغام انجام شد؛ قابل بازگشت است" }); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  const dismiss = useMutation({ mutationFn: (id: string) => post(`/duplicates/${id}/dismiss`), onSuccess: inv });
  const revert = useMutation({ mutationFn: (id: string) => post(`/merges/${id}/revert`), onSuccess: () => { inv(); toast({ tone: "success", title: "ادغام بازگردانده شد" }); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  const Side = ({ c, label, selected, onPick }: { c: any; label: string; selected: boolean; onPick: () => void }) => c ? (
    <button type="button" onClick={onPick} aria-pressed={selected} className={cn("flex-1 text-start rounded-[14px] border p-3.5 min-w-[220px]", selected ? "border-action bg-action-soft" : "border-line hover:border-[#c9d3e1]")}>
      <div className="text-[11.5px] text-muted mb-1">{label}</div>
      <div className="font-bold">{c.full_name ?? c.name}</div>
      {c.mobile !== undefined && <div className="text-[13px] text-muted"><Ltr>{fmtPhone(c.mobile)}</Ltr>{c.email && <> · <Ltr>{c.email}</Ltr></>}</div>}
      {c.account && <div className="text-[13px] text-muted">{c.account.name}</div>}
      {c.interaction_count !== undefined && <div className="text-[12.5px] mt-1">{faNum(c.interaction_count)} تعامل</div>}
    </button>
  ) : <div className="flex-1 text-muted">رکورد یافت نشد</div>;
  return (
    <div>
      <PageHeader title="بازبینی رکوردهای تکراری" subtitle="تطبیق دقیق (شماره/ایمیل یکسان) از تطبیق تقریبی (نام مشابه) جداست. هیچ ادغامی خودکار نیست؛ هر ادغام ممیزی و قابل بازگشت است. شماره مشترک ممکن است متعلق به افراد متفاوت باشد." />
      <Segmented label="بخش" value={tab} onChange={setTab} className="mb-4" options={[{ value: "open", label: `موارد باز${q.data ? ` (${faNum(q.data.count)})` : ""}` }, { value: "merges", label: "تاریخچه ادغام" }]} />
      {tab === "open" ? (
        <Card>
          {q.isLoading ? <LoadingRows /> : !q.data?.results.length ? <EmptyState icon={<GitMerge className="size-6" />} title="مورد تکراری بازی وجود ندارد" /> : (
            <ul className="divide-y divide-line-2">
              {q.data.results.map((c: any) => (
                <li key={c.id} className="p-5 space-y-3">
                  <div className="flex items-center gap-2"><Badge tone={c.match_type === "FUZZY_NAME" ? "warning" : "info"}>{MATCH_TYPE[c.match_type]}</Badge><span className="text-[12.5px] text-muted">{c.entity_type === "CONTACT" ? "مخاطب" : "سازمان"} · {relTime(c.created_at)}</span></div>
                  <div className="flex flex-wrap gap-3">
                    <Side c={c.existing} label="رکورد موجود" selected={merge?.cand.id === c.id && merge?.survivor === c.existing?.id} onPick={() => setMerge({ cand: c, survivor: c.existing.id })} />
                    <Side c={c.candidate} label="رکورد جدید" selected={merge?.cand.id === c.id && merge?.survivor === c.candidate?.id} onPick={() => setMerge({ cand: c, survivor: c.candidate.id })} />
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[12.5px] text-muted self-center flex-1">برای ادغام، رکورد باقی‌مانده را انتخاب کنید.</span>
                    <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(c.id)}>افراد متفاوت‌اند (رد)</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <Card>
          {merges.isLoading ? <LoadingRows /> : !merges.data?.results.length ? <EmptyState title="ادغامی انجام نشده" /> : (
            <ul className="divide-y divide-line-2">{merges.data.results.map((m: any) => (
              <li key={m.id} className="px-5 py-3 flex flex-wrap items-center gap-3 text-[13.5px]">
                <span className="flex-1">{m.entity_type === "CONTACT" ? "مخاطب" : "سازمان"} · توسط {m.performed_by?.full_name} · {fmtDateTime(m.created_at)} · {Object.entries(m.moved as Record<string, number>).map(([k, v]) => `${k}: ${faNum(v)}`).join("، ")}</span>
                {m.reverted_at ? <Badge tone="neutral">بازگردانده‌شده {relTime(m.reverted_at)}</Badge> : <Button size="sm" variant="secondary" onClick={() => revert.mutate(m.id)}><Undo2 className="size-4" />بازگرداندن</Button>}
              </li>
            ))}</ul>
          )}
        </Card>
      )}
      <ConfirmDialog open={!!merge} onOpenChange={(o) => !o && setMerge(null)} title="تأیید ادغام" confirmLabel="ادغام" loading={doMerge.isPending} onConfirm={() => doMerge.mutate()}
        body="همه تعاملات و فرصت‌های رکورد دیگر به رکورد انتخاب‌شده منتقل می‌شوند. رکورد ادغام‌شده با شناسه پایدار حفظ و این عملیات قابل بازگشت است." />
    </div>
  );
}

export function AccountsPage() {
  const [tab, setTab] = useState<"accounts" | "contacts">("accounts");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: [tab, dq], queryFn: () => get<Page<any>>(`/${tab}${qs({ q: dq, page_size: 50 })}`) });
  const [open, setOpen] = useState<string | null>(null);
  const detail = useQuery({ queryKey: [tab, "detail", open], queryFn: () => get<any>(`/${tab}/${open}`), enabled: !!open });
  return (
    <div>
      <PageHeader title="سازمان‌ها و مخاطبان" subtitle="رکوردهای اصلی مشترک بین رویدادها؛ برخوردهای تکراری با یک سازمان یا مخاطب در رویدادهای مختلف حفظ می‌شود." />
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Segmented label="نوع" value={tab} onChange={(v) => { setTab(v); setOpen(null); }} options={[{ value: "accounts", label: "سازمان‌ها" }, { value: "contacts", label: "مخاطبان" }]} />
        <div className="relative flex-1"><Search className="absolute start-3.5 top-3.5 size-5 text-muted" /><Input aria-label="جست‌وجو" className="ps-11" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جست‌وجو" /></div>
      </div>
      <Card>
        {list.isLoading ? <LoadingRows /> : !list.data?.results.length ? <EmptyState icon={<Building2 className="size-6" />} title="موردی یافت نشد" /> : (
          <ul className="divide-y divide-line-2">{list.data.results.map((r: any) => (
            <li key={r.id}><button onClick={() => setOpen(r.id)} className="w-full px-5 py-3 flex flex-wrap items-center gap-3 text-start hover:bg-canvas">
              <span className="flex-1 min-w-[200px]"><b>{r.name ?? r.full_name}</b> <span className="text-muted text-[13px]">{r.city || r.account?.name || ""}</span></span>
              {r.mobile !== undefined && <Ltr className="text-[13px] text-muted">{fmtPhone(r.mobile)}</Ltr>}
              <span className="text-[13px] text-muted">{faNum(r.interaction_count)} تعامل{r.contact_count !== undefined && ` · ${faNum(r.contact_count)} مخاطب`}</span>
            </button></li>
          ))}</ul>
        )}
      </Card>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={detail.data?.name ?? detail.data?.full_name ?? "…"} size="lg">
        {detail.data && (
          <div className="space-y-4 text-[14px]">
            {detail.data.contacts && <div><div className="font-bold mb-1">مخاطبان</div><ul className="space-y-1">{detail.data.contacts.map((c: any) => <li key={c.id}>{c.full_name} · <Ltr className="text-muted">{fmtPhone(c.mobile)}</Ltr></li>)}</ul></div>}
            <div><div className="font-bold mb-1">تاریخچه بین‌رویدادی</div><ul className="space-y-1.5">{detail.data.interactions.map((i: any) => (
              <li key={i.id}><Link to={`/leads/${i.id}`} className="text-action"><Ltr className="font-mono">{i.event_code}</Ltr> · {i.contact_name ?? i.created_by?.full_name} · {fmtDateTime(i.captured_at)}</Link> <QualityBadge q={i.quality} /></li>
            ))}</ul></div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export function QuarantinePage() {
  const [status, setStatus] = useState("PENDING");
  const q = useQuery({ queryKey: ["quarantine", status], queryFn: () => get<Page<any>>(`/sync-quarantine?status=${status}`) });
  const [act, setAct] = useState<{ id: string; action: string; note: string } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({ mutationFn: () => post(`/sync-quarantine/${act!.id}/${act!.action}`, { note: act!.note }), onSuccess: () => { setAct(null); qc.invalidateQueries({ queryKey: ["quarantine"] }); toast({ tone: "success", title: "ثبت شد" }); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  return (
    <div>
      <PageHeader title="ثبت‌های آفلاین معلق" subtitle="ثبت‌هایی که پس از مهلت پایان رویداد یا با عضویت غیرفعال همگام شده‌اند. هیچ ثبتی بی‌صدا حذف یا به رویداد دیگر منتسب نمی‌شود." />
      <Segmented label="وضعیت" value={status} onChange={setStatus} className="mb-4" options={[{ value: "PENDING", label: "در انتظار" }, { value: "APPROVED", label: "تأییدشده" }, { value: "REJECTED", label: "ردشده" }]} />
      <Card>
        {q.isLoading ? <LoadingRows /> : !q.data?.results.length ? <EmptyState title="موردی نیست" /> : (
          <ul className="divide-y divide-line-2">{q.data.results.map((x: any) => (
            <li key={x.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[220px]">
                <div className="font-semibold">{x.contact_name} {x.org_name && <span className="text-muted text-[13px]">· {x.org_name}</span>}</div>
                <div className="text-[12.5px] text-muted">{x.user?.full_name} · {x.event.display_name} <Ltr className="font-mono">{x.event.code}</Ltr> · زمان ثبت {fmtDateTime(x.captured_at)} · رسید {relTime(x.created_at)}</div>
                <Badge tone="warning">{QUARANTINE_REASON[x.reason] ?? x.reason}</Badge>
              </div>
              {x.status === "PENDING" ? <>
                <Button size="sm" onClick={() => setAct({ id: x.id, action: "approve", note: "" })}>تأیید و ثبت</Button>
                <Button size="sm" variant="danger-soft" onClick={() => setAct({ id: x.id, action: "reject", note: "" })}>رد</Button>
              </> : x.interaction_id ? <Link to={`/leads/${x.interaction_id}`} className="text-action text-[13px]">مشاهده لید</Link> : <span className="text-muted text-[13px]">{x.resolution_note}</span>}
            </li>
          ))}</ul>
        )}
      </Card>
      <Dialog open={!!act} onOpenChange={(o) => !o && setAct(null)} title={act?.action === "approve" ? "تأیید ثبت آفلاین" : "رد ثبت آفلاین"} size="sm"
        footer={<Button variant={act?.action === "approve" ? "primary" : "danger"} loading={m.isPending} onClick={() => m.mutate()}>ثبت</Button>}>
        <Input aria-label="توضیح" placeholder="توضیح (برای ممیزی)" value={act?.note ?? ""} onChange={(e) => setAct(act && { ...act, note: e.target.value })} />
      </Dialog>
    </div>
  );
}

export function AuditPage() {
  const [action, setAction] = useState("");
  const da = useDebounced(action);
  const q = useQuery({ queryKey: ["audit", da], queryFn: () => get<Page<any>>(`/audit${qs({ action: da, page_size: 100 })}`) });
  const [open, setOpen] = useState<any>(null);
  return (
    <div>
      <PageHeader title="گزارش ممیزی" subtitle="ثبت افزایشی و غیرقابل ویرایش: کنشگر، عملیات، رکورد، قبل/بعد مجاز و زمان. رمزها و اسرار هرگز ثبت نمی‌شوند." />
      <Input aria-label="فیلتر عملیات" className="mb-4 max-w-sm" dir="ltr" placeholder="filter action e.g. export, referral" value={action} onChange={(e) => setAction(e.target.value)} />
      <Card>
        {q.isLoading ? <LoadingRows /> : (
          <div className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead className="bg-canvas border-b border-line"><tr>{["زمان", "کنشگر", "عملیات", "رکورد", ""].map((h) => <th key={h} className="text-start px-4 h-10 text-muted font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-2">{q.data?.results.map((a: any) => (
              <tr key={a.id}><td className="px-4 py-2 whitespace-nowrap">{fmtDateTime(a.created_at)}</td><td className="px-4 py-2">{a.actor?.full_name ?? "سامانه/ناشناس"}</td>
                <td className="px-4 py-2"><Ltr className="font-mono">{a.action}</Ltr></td><td className="px-4 py-2"><Ltr className="font-mono text-muted">{a.entity_type}:{a.entity_id.slice(0, 8)}</Ltr></td>
                <td className="px-4 py-2"><Button size="sm" variant="ghost" onClick={() => setOpen(a)}>جزئیات</Button></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.action} size="lg">
        <pre dir="ltr" className="text-[12px] bg-canvas rounded-[12px] p-3 overflow-x-auto">{JSON.stringify({ before: open?.before, after: open?.after, metadata: open?.metadata, ip: open?.ip_address }, null, 2)}</pre>
      </Dialog>
    </div>
  );
}

export function RolesPage() {
  const roles = useQuery({ queryKey: ["roles", "all"], queryFn: () => get<any[]>("/roles") });
  const caps = useQuery({ queryKey: ["caps"], queryFn: () => get<{ code: string; label: string }[]>("/capabilities") });
  return (
    <div>
      <PageHeader title="نقش‌ها و مجوزها" subtitle="نقش‌ها بسته‌های قابلیت‌اند و به‌صورت افزایشی ترکیب می‌شوند. عضویت فعال در رویداد فعال همیشه «ثبت لید» را مجاز می‌کند. ارزیابی مجوز همیشه در سرور انجام می‌شود." />
      <Card className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="bg-canvas border-b border-line sticky top-0"><tr><th className="text-start px-3 h-10 min-w-[220px]">قابلیت</th>{roles.data?.map((r) => <th key={r.code} className="px-2 h-10 text-center font-semibold min-w-[90px]">{r.name_fa}<div className="text-[10.5px] text-muted font-normal">{r.scope === "GLOBAL" ? "سراسری" : "رویدادی"}</div></th>)}</tr></thead>
          <tbody className="divide-y divide-line-2">
            <tr><td className="px-3 py-2">ثبت لید (هر عضو فعال رویداد)</td>{roles.data?.map((r) => <td key={r.code} className="text-center text-muted">{r.scope === "EVENT" ? "✓" : "با عضویت"}</td>)}</tr>
            {caps.data?.filter((c) => c.code !== "interaction.create").map((c) => (
              <tr key={c.code}><td className="px-3 py-2">{c.label} <Ltr className="text-muted font-mono text-[11px]">{c.code}</Ltr></td>
                {roles.data?.map((r) => <td key={r.code} className="text-center">{r.capabilities.includes(c.code) ? <span className="text-success font-bold" aria-label="دارد">✓</span> : <span className="text-muted" aria-label="ندارد">—</span>}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}


