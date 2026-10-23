import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, CheckCheck, Clock, Zap } from "lucide-react";
import { get, post, type Page } from "@/lib/api";
import { relTime } from "@/lib/format";
import { PRIORITY } from "@/lib/labels";
import { Badge, Button, Card, EmptyState, LoadingRows, PageHeader, Segmented, cn } from "@/components/ui/primitives";
import { ActionStatus } from "@/components/ui/status";

export function NotificationsPage() {
  const [filter, setFilter] = useState("all");
  const q = useQuery({ queryKey: ["notifications", filter], queryFn: () => get<Page<any>>(`/notifications?filter=${filter}&page_size=50`) });
  const qc = useQueryClient();
  const nav = useNavigate();
  const inv = () => { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["work-counts"] }); };
  const act = useMutation({ mutationFn: ({ id, action, hours }: { id: string; action: string; hours?: number }) => post(`/notifications/${id}/${action}`, hours ? { hours } : {}), onSuccess: inv });
  const all = useMutation({ mutationFn: () => post("/notifications/read-all"), onSuccess: inv });
  return (
    <div>
      <PageHeader title="اعلان‌ها" subtitle="اعلان‌ها اطلاع‌رسانی هستند و وضعیت ارجاع یا وظیفه را تغییر نمی‌دهند؛ اقدام‌ها در کارتابل انجام می‌شوند."
        actions={<Button variant="secondary" onClick={() => all.mutate()} loading={all.isPending}><CheckCheck className="size-4" />همه خوانده شد</Button>} />
      <Segmented label="فیلتر" value={filter} onChange={setFilter} className="mb-4" options={[{ value: "all", label: "همه" }, { value: "unread", label: "خوانده‌نشده" }, { value: "actions", label: "درخواست اقدام" }, { value: "snoozed", label: "به تعویق افتاده" }]} />
      <Card>
        {q.isLoading ? <LoadingRows /> : !q.data?.results.length ? <EmptyState icon={<BellOff className="size-6" />} title="اعلانی نیست" /> : (
          <ul className="divide-y divide-line-2">
            {q.data.results.map((n: any) => (
              <li key={n.id} className={cn("p-4 md:px-5 flex gap-3", !n.read_at && "bg-action-soft/40")}>
                <span className={cn("size-10 rounded-full grid place-items-center shrink-0", n.kind === "ACTION_REQUEST" ? "bg-warning-soft text-warning" : n.priority === "HIGH" || n.priority === "URGENT" ? "bg-danger-soft text-danger" : "bg-line-2 text-ink-2")}>
                  {n.kind === "ACTION_REQUEST" ? <Zap className="size-5" /> : <BellRing className="size-5" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.read_at && <span className="size-2 rounded-full bg-action" role="img" aria-label="خوانده‌نشده" />}
                    <span className="font-bold">{n.title}</span>
                    <Badge tone="neutral">{n.kind_label}</Badge>
                    {n.priority !== "NORMAL" && <Badge tone={n.priority === "LOW" ? "neutral" : "danger"}>اولویت {PRIORITY[n.priority]}</Badge>}
                    {n.action_status && <ActionStatus s={n.action_status} />}
                  </div>
                  {n.body && <p className="text-[14px] text-ink-2 mt-1 leading-7 whitespace-pre-wrap">{n.body}</p>}
                  <div className="text-[12.5px] text-muted mt-1">{n.source_label} · {relTime(n.created_at)}{n.snoozed_until && ` · تعویق تا ${relTime(n.snoozed_until)}`}</div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {n.link && <Button size="sm" variant="soft" onClick={() => { act.mutate({ id: n.id, action: "read" }); nav(n.link); }}>{n.kind === "ACTION_REQUEST" ? "رفتن به اقدام" : "مشاهده"}</Button>}
                    {n.read_at ? <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: n.id, action: "unread" })}>علامت خوانده‌نشده</Button>
                      : <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: n.id, action: "read" })}>خواندم</Button>}
                    <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: n.id, action: "snooze", hours: 4 })}><Clock className="size-4" />تعویق ۴ ساعت</Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
