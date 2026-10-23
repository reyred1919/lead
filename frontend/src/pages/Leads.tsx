import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ClipboardList, CloudOff, Filter, Search, Send, X } from "lucide-react";
import { get, post, qs, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced } from "@/lib/hooks";
import { faNum, relTime, fmtPhone } from "@/lib/format";
import { QUALITY, STAGE } from "@/lib/labels";
import { Button, Card, EmptyState, ErrorState, Input, LoadingRows, Ltr, PageHeader, Segmented, Select, Textarea, cn } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlay";
import { QualityBadge, StageBadge } from "@/components/ui/status";
import { TagChip, type TagT } from "@/components/tags/Tags";
import { UserPicker, type UserLite } from "@/components/ui/pickers";
import { useToast } from "@/components/ui/toast";

export type LeadRow = {
  id: string;
  event: { id: string; code: string; display_name: string; status: string };
  captured_at: string;
  created_by: { id: string; full_name: string } | null;
  contact: { id: string; full_name: string; mobile: string };
  account: { id: string; name: string } | null;
  products: { id: string; code: string; name_fa: string }[];
  quality: string;
  status: string;
  captured_offline: boolean;
  opportunity: { id: string; stage: string; owner: { full_name: string } | null; tags: TagT[] } | null;
  pending_referral: { id: string; to_user: { full_name: string } } | null;
  responsible: { id: string; full_name: string } | null;
  note: string;
};

type Scope = "all" | "mine" | "owned" | "ownerless";

export function LeadsPage() {
  const { me, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const scope = (params.get("scope") as Scope) || (can("lead.view.scope") || can("lead.view.all") ? "all" : "mine");
  const [q, setQ] = useState(params.get("q") ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const page = Number(params.get("page") || 1);
  const dq = useDebounced(q, 300);
  const filters = {
    q: dq, page, page_size: 25,
    event_id: params.get("event_id") ?? "", quality: params.get("quality") ?? "", stage: params.get("stage") ?? "", tag_id: params.get("tag_id") ?? "",
    created_by: scope === "mine" ? "me" : undefined, owner_id: scope === "owned" ? "me" : undefined, ownerless: scope === "ownerless" ? "1" : undefined,
  };
  const leads = useQuery({ queryKey: ["leads", filters], queryFn: () => get<Page<LeadRow>>(`/interactions${qs(filters)}`), placeholderData: keepPreviousData });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => get<TagT[]>("/tags") });
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const canAssign = can("lead.assign");
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== "page") next.delete("page");
    setParams(next, { replace: true });
  };
  const nav = useNavigate();

  const columns = useMemo<ColumnDef<LeadRow>[]>(() => [
    ...(canAssign ? [{
      id: "select",
      header: ({ table }: any) => <input type="checkbox" aria-label="انتخاب همه" className="size-4 accent-[var(--color-action)]" checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} />,
      cell: ({ row }: any) => <input type="checkbox" aria-label="انتخاب ردیف" className="size-4 accent-[var(--color-action)]" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} />,
    } as ColumnDef<LeadRow>] : []),
    {
      id: "contact", header: "مخاطب",
      cell: ({ row: { original: r } }) => (
        <div className="min-w-[180px]">
          <div className="font-semibold text-ink flex items-center gap-1.5">{r.contact.full_name}{r.captured_offline && <CloudOff className="size-3.5 text-muted" aria-label="ثبت آفلاین" />}</div>
          <div className="text-[12.5px] text-muted truncate max-w-[240px]">{r.account?.name ?? "شخص حقیقی / بدون سازمان"}</div>
        </div>
      ),
    },
    { id: "event", header: "رویداد", cell: ({ row: { original: r } }) => <Ltr className="text-[12px] font-mono text-muted">{r.event.code}</Ltr> },
    { id: "products", header: "محصول", cell: ({ row: { original: r } }) => <div className="text-[13px] max-w-[200px] truncate">{r.products.map((p) => p.name_fa).join("، ")}</div> },
    { id: "quality", header: "کیفیت", cell: ({ row: { original: r } }) => <QualityBadge q={r.quality} /> },
    { id: "stage", header: "مرحله", cell: ({ row: { original: r } }) => <StageBadge s={r.opportunity?.stage} /> },
    { id: "creator", header: "ثبت‌کننده", cell: ({ row: { original: r } }) => <span className="text-[13px]">{r.created_by?.full_name}</span> },
    {
      id: "owner", header: "مسئول پیگیری",
      cell: ({ row: { original: r } }) => r.responsible ? <span className="text-[13px]">{r.responsible.full_name}</span> : r.pending_referral ? <span className="text-[12.5px] text-warning">در انتظار {r.pending_referral.to_user.full_name}</span> : <span className="text-[12.5px] text-danger">بدون مسئول</span>,
    },
    { id: "tags", header: "برچسب", cell: ({ row: { original: r } }) => <div className="flex flex-wrap gap-1 max-w-[200px]">{r.opportunity?.tags.slice(0, 2).map((t) => <TagChip key={t.id} tag={t} size="sm" />)}</div> },
    { id: "time", header: "زمان ثبت", cell: ({ row: { original: r } }) => <span className="text-[12.5px] text-muted whitespace-nowrap">{relTime(r.captured_at)}</span> },
  ], [canAssign]);

  const table = useReactTable({
    data: leads.data?.results ?? [], columns, getCoreRowModel: getCoreRowModel(), getRowId: (r) => r.id,
    state: { rowSelection: selection }, onRowSelectionChange: setSelection, enableRowSelection: canAssign, manualPagination: true,
  });
  const selectedIds = Object.keys(selection).filter((k) => selection[k]);
  const pages = Math.max(1, Math.ceil((leads.data?.count ?? 0) / 25));
  const scopes: { value: Scope; label: string }[] = [
    ...(can("lead.view.scope") || can("lead.view.all") ? [{ value: "all" as Scope, label: "همه در محدوده من" }] : []),
    { value: "mine", label: "ثبت‌های من" },
    { value: "owned", label: "مسئولیت من" },
    ...(canAssign ? [{ value: "ownerless" as Scope, label: "بدون مسئول" }] : []),
  ];

  return (
    <div>
      <PageHeader title="لیدها" subtitle={leads.data ? `${faNum(leads.data.count)} لید در محدوده دسترسی شما` : "تعاملات ثبت‌شده و فرصت‌های پیگیری"}
        actions={me?.capture_events.length ? <Link to="/capture"><Button>ثبت لید جدید</Button></Link> : undefined} />
      <div className="flex flex-col gap-3 mb-4">
        <Segmented label="محدوده" value={scope} onChange={(v) => set("scope", v)} options={scopes} />
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute start-3.5 top-3.5 size-5 text-muted" />
            <Input aria-label="جست‌وجو" className="ps-11" value={q} onChange={(e) => { setQ(e.target.value); set("q", e.target.value); }} placeholder="نام مخاطب، سازمان یا شماره موبایل" />
          </div>
          <Button variant="secondary" size="icon" aria-label="فیلترها" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}><Filter className="size-5" /></Button>
        </div>
        {showFilters && (
          <Card className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-rise">
            <Select aria-label="رویداد" value={params.get("event_id") ?? ""} onChange={(e) => set("event_id", e.target.value)}>
              <option value="">همه رویدادها</option>
              {me?.events.map((e) => <option key={e.id} value={e.id}>{e.display_name}</option>)}
            </Select>
            <Select aria-label="کیفیت" value={params.get("quality") ?? ""} onChange={(e) => set("quality", e.target.value)}>
              <option value="">همه کیفیت‌ها</option>
              {Object.entries(QUALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select aria-label="مرحله" value={params.get("stage") ?? ""} onChange={(e) => set("stage", e.target.value)}>
              <option value="">همه مراحل</option>
              <option value="NONE">در انتظار ارزیابی</option>
              {Object.entries(STAGE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select aria-label="برچسب" value={params.get("tag_id") ?? ""} onChange={(e) => set("tag_id", e.target.value)}>
              <option value="">همه برچسب‌ها</option>
              {tags.data?.map((t) => <option key={t.id} value={t.id}>{t.name_fa}{t.status === "ARCHIVED" ? " (بایگانی)" : ""}</option>)}
            </Select>
          </Card>
        )}
      </div>

      {canAssign && selectedIds.length > 0 && (
        <div className="sticky top-16 z-20 mb-3 card p-3 flex items-center gap-3 animate-rise">
          <span className="text-[14px] font-semibold">{faNum(selectedIds.length)} لید انتخاب شده</span>
          <Button size="sm" onClick={() => setBulkOpen(true)}><Send className="size-4" />ارجاع گروهی</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelection({})}><X className="size-4" />لغو انتخاب</Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {leads.isLoading ? <LoadingRows rows={6} /> : leads.isError ? <ErrorState error={leads.error} onRetry={() => leads.refetch()} /> : !leads.data?.results.length ? (
          <EmptyState icon={<ClipboardList className="size-6" />} title="لیدی یافت نشد" body={dq || params.toString() ? "فیلترها را تغییر دهید." : "هنوز لیدی در محدوده شما ثبت نشده است."} />
        ) : (
          <>
            {/* Desktop grid */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-start">
                <thead className="bg-canvas border-b border-line">
                  {table.getHeaderGroups().map((hg) => (
                    <tr key={hg.id}>{hg.headers.map((h) => <th key={h.id} scope="col" className="text-start text-[12.5px] font-semibold text-muted px-4 h-11 whitespace-nowrap">{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-line-2">
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id} onClick={() => nav(`/leads/${row.id}`)} className={cn("cursor-pointer hover:bg-canvas transition-colors", row.getIsSelected() && "bg-action-soft/50")}>
                      {row.getVisibleCells().map((c) => <td key={c.id} className="px-4 py-3 align-middle">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile cards */}
            <ul className="md:hidden divide-y divide-line-2">
              {leads.data.results.map((r) => (
                <li key={r.id}>
                  <Link to={`/leads/${r.id}`} className="block px-4 py-3.5 active:bg-line-2">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold flex items-center gap-1.5">{r.contact.full_name}{r.captured_offline && <CloudOff className="size-3.5 text-muted" />}</div>
                        <div className="text-[13px] text-muted truncate">{r.account?.name ?? "بدون سازمان"} · <Ltr>{fmtPhone(r.contact.mobile)}</Ltr></div>
                      </div>
                      <QualityBadge q={r.quality} />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      <StageBadge s={r.opportunity?.stage} />
                      {r.opportunity?.tags.map((t) => <TagChip key={t.id} tag={t} size="sm" />)}
                      <span className="text-[12px] text-muted ms-auto">{relTime(r.captured_at)} · <Ltr className="font-mono">{r.event.code}</Ltr></span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between px-4 py-3 border-t border-line-2 text-[13px] text-muted">
              <span>صفحه {faNum(page)} از {faNum(pages)}</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="صفحه قبل" disabled={page <= 1} onClick={() => set("page", String(page - 1))}><ChevronRight className="size-4" /></Button>
                <Button variant="ghost" size="icon-sm" aria-label="صفحه بعد" disabled={page >= pages} onClick={() => set("page", String(page + 1))}><ChevronLeft className="size-4" /></Button>
              </div>
            </div>
          </>
        )}
      </Card>
      <BulkReferDialog open={bulkOpen} onOpenChange={setBulkOpen} ids={selectedIds} onDone={() => setSelection({})} />
    </div>
  );
}

function BulkReferDialog({ open, onOpenChange, ids, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; ids: string[]; onDone: () => void }) {
  const [user, setUser] = useState<UserLite | null>(null);
  const [reason, setReason] = useState("");
  const toast = useToast();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => post<{ results: { status: string }[] }>("/interactions/bulk-refer", { interaction_ids: ids, to_user_id: user?.id, reason, confirm: true }),
    onSuccess: (r) => {
      const ok = r.results.filter((x) => x.status === "OK").length;
      toast({ tone: ok === ids.length ? "success" : "info", title: `${faNum(ok)} از ${faNum(ids.length)} لید ارجاع شد`, body: ok < ids.length ? "برخی لیدها در محدوده مجاز شما برای ارجاع نبودند." : undefined });
      qc.invalidateQueries({ queryKey: ["leads"] });
      onDone();
      onOpenChange(false);
    },
    onError: (e: any) => toast({ tone: "error", title: "ارجاع گروهی ناموفق بود", body: e.message }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`ارجاع گروهی ${faNum(ids.length)} لید`} description="هر لید جداگانه بررسی مجوز می‌شود و در تاریخچه ثبت خواهد شد."
      footer={<><Button variant="secondary" onClick={() => onOpenChange(false)}>انصراف</Button><Button disabled={!user} loading={m.isPending} onClick={() => m.mutate()}>تأیید و ارجاع</Button></>}>
      <div className="space-y-4">
        <UserPicker value={user} onChange={setUser} />
        <Textarea aria-label="دلیل ارجاع" placeholder="دلیل یا توضیح ارجاع (اختیاری)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Dialog>
  );
}
