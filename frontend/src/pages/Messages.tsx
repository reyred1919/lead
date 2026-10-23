import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Send, X } from "lucide-react";
import { ApiError, get, post, type Page } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { faNum, fmtDateTime } from "@/lib/format";
import { ACTION_STATUS, ACTION_TYPES, CHANNEL, JOB_STATUS } from "@/lib/labels";
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, EmptyState, Field, Input, LoadingRows, PageHeader, Segmented, Select, Textarea } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlay";
import { JalaliDatePicker } from "@/components/ui/datepicker";
import { UserPicker, type UserLite } from "@/components/ui/pickers";
import { useToast } from "@/components/ui/toast";

export function MessagesPage() {
  const { me } = useAuth();
  const [kind, setKind] = useState<"INFORMATION" | "ACTION_REQUEST">("INFORMATION");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [actionType, setActionType] = useState("REVIEW");
  const [priority, setPriority] = useState("NORMAL");
  const [channels, setChannels] = useState<string[]>(["IN_APP"]);
  const [users, setUsers] = useState<UserLite[]>([]);
  const [eventId, setEventId] = useState("");
  const [roleCodes, setRoleCodes] = useState<string[]>([]);
  const [due, setDue] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [confirm, setConfirm] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => get<any[]>("/roles") });
  const toast = useToast();
  const qc = useQueryClient();
  const payload = () => ({
    kind, subject, body, priority, channels, action_type: kind === "ACTION_REQUEST" ? actionType : "",
    targeting: { user_ids: users.map((u) => u.id), event_id: eventId || undefined, role_codes: roleCodes.length ? roleCodes : undefined },
    due_at: kind === "ACTION_REQUEST" ? due : null, scheduled_at: scheduled, idempotency_key: key,
  });
  const pv = useMutation({ mutationFn: () => post("/campaigns/preview", payload()), onSuccess: (d) => { setPreview(d); setConfirm(true); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  const send = useMutation({
    mutationFn: () => post("/campaigns", { ...payload(), confirm_broad: preview?.requires_confirmation }),
    onSuccess: (c: any) => {
      setConfirm(false); toast({ tone: "success", title: c.status === "SCHEDULED" ? "پیام زمان‌بندی شد" : `برای ${faNum(c.recipient_count)} نفر ارسال شد` });
      setSubject(""); setBody(""); setUsers([]); setKey(crypto.randomUUID()); qc.invalidateQueries({ queryKey: ["campaigns"] });
    },
    onError: (e: any) => toast({ tone: "error", title: "ارسال نشد", body: e instanceof ApiError ? e.message : String(e) }),
  });
  const list = useQuery({ queryKey: ["campaigns"], queryFn: () => get<Page<any>>("/campaigns") });
  const cancel = useMutation({ mutationFn: (id: string) => post(`/campaigns/${id}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }) });

  return (
    <div>
      <PageHeader title="پیام و درخواست اقدام" subtitle="پیام دستی یا درخواست اقدام برای همکاران در محدوده مجاز شما. پیامک/ایمیل فقط خلاصه و لینک امن دارد؛ اقدام در سامانه انجام می‌شود. ارسال به مشتریان در این فاز غیرفعال است." />
      <div className="grid lg:grid-cols-[1fr_420px] gap-5">
        <Card className="p-5 space-y-5">
          <Segmented label="نوع پیام" value={kind} onChange={setKind} options={[{ value: "INFORMATION", label: "اطلاع‌رسانی" }, { value: "ACTION_REQUEST", label: "درخواست اقدام" }]} />
          <Field label="موضوع" required htmlFor="m-subject"><Input id="m-subject" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
          <Field label="متن / دستورالعمل" required htmlFor="m-body"><Textarea id="m-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          {kind === "ACTION_REQUEST" && (
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="نوع اقدام"><Select value={actionType} onChange={(e) => setActionType(e.target.value)}>{Object.entries(ACTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="مهلت (اختیاری)"><JalaliDatePicker value={due} onChange={setDue} /></Field>
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="اولویت"><Select value={priority} onChange={(e) => setPriority(e.target.value)}><option value="LOW">کم</option><option value="NORMAL">عادی</option><option value="HIGH">زیاد</option><option value="URGENT">فوری</option></Select></Field>
            <Field label="زمان ارسال" hint="خالی = ارسال فوری"><JalaliDatePicker value={scheduled} onChange={setScheduled} placeholder="ارسال فوری" /></Field>
          </div>
          <Field label="کانال‌ها" hint="اعلان درون‌برنامه همیشه ارسال می‌شود.">
            <div className="flex flex-wrap gap-x-5">
              {["IN_APP", "SMS", "EMAIL"].map((c) => <Checkbox key={c} id={`ch-${c}`} label={CHANNEL[c]} checked={channels.includes(c)} onChange={(v) => c !== "IN_APP" && setChannels(v ? [...channels, c] : channels.filter((x) => x !== c))} />)}
            </div>
          </Field>
          <div className="border-t border-line-2 pt-5 space-y-4">
            <h3 className="font-bold">گیرندگان</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="تیم رویداد"><Select value={eventId} onChange={(e) => setEventId(e.target.value)}><option value="">—</option>{me?.events.map((e) => <option key={e.id} value={e.id}>{e.display_name}</option>)}</Select></Field>
              <Field label="نقش">
                <Select value="" onChange={(e) => e.target.value && !roleCodes.includes(e.target.value) && setRoleCodes([...roleCodes, e.target.value])}>
                  <option value="">افزودن نقش…</option>{roles.data?.map((r) => <option key={r.code} value={r.code}>{r.name_fa}</option>)}
                </Select>
              </Field>
            </div>
            {!!roleCodes.length && <div className="flex flex-wrap gap-1.5">{roleCodes.map((c) => <Badge key={c} tone="action" size="md">{roles.data?.find((r) => r.code === c)?.name_fa}<button aria-label="حذف" onClick={() => setRoleCodes(roleCodes.filter((x) => x !== c))}><X className="size-3" /></button></Badge>)}</div>}
            <Field label="افراد مشخص">
              <UserPicker value={null} onChange={(u) => u && !users.some((x) => x.id === u.id) && setUsers([...users, u])} excludeIds={users.map((u) => u.id)} />
            </Field>
            {!!users.length && <div className="flex flex-wrap gap-1.5">{users.map((u) => <Badge key={u.id} size="md">{u.full_name}<button aria-label={`حذف ${u.full_name}`} onClick={() => setUsers(users.filter((x) => x.id !== u.id))}><X className="size-3" /></button></Badge>)}</div>}
          </div>
          <Button size="lg" className="w-full" disabled={!subject || !body || (!users.length && !eventId && !roleCodes.length)} loading={pv.isPending} onClick={() => pv.mutate()}><Send className="size-5" />پیش‌نمایش و ارسال</Button>
        </Card>
        <Card>
          <CardHeader title="ارسال‌های اخیر" />
          {list.isLoading ? <LoadingRows rows={3} /> : !list.data?.results.length ? <EmptyState icon={<Megaphone className="size-6" />} title="هنوز پیامی ارسال نکرده‌اید" /> : (
            <ul className="divide-y divide-line-2">
              {list.data.results.map((c: any) => (
                <li key={c.id} className="px-5 py-3 text-[13.5px] space-y-1">
                  <div className="flex items-center justify-between gap-2"><b className="truncate">{c.subject}</b><Badge tone={c.status === "SENT" ? "success" : c.status === "SCHEDULED" ? "info" : "neutral"}>{c.status_label}</Badge></div>
                  <div className="text-muted">{c.kind_label} · {faNum(c.recipient_count)} گیرنده · {fmtDateTime(c.sent_at ?? c.scheduled_at ?? c.created_at)}</div>
                  {c.kind === "ACTION_REQUEST" && <div className="flex flex-wrap gap-1">{Object.entries(c.action_status_counts as Record<string, number>).map(([s, n]) => <Badge key={s} tone="neutral">{ACTION_STATUS[s]}: {faNum(n)}</Badge>)}</div>}
                  <div className="flex flex-wrap gap-1">{Object.entries(c.delivery_counts as Record<string, Record<string, number>>).map(([ch, st]) => Object.entries(st).map(([s, n]) => <Badge key={ch + s} tone={s === "SIMULATED" ? "warning" : s === "DEAD" ? "danger" : "neutral"}>{CHANNEL[ch]}: {JOB_STATUS[s]} {faNum(n)}</Badge>))}</div>
                  {c.status === "SCHEDULED" && <Button size="sm" variant="danger-soft" onClick={() => cancel.mutate(c.id)}>لغو</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={preview?.requires_confirmation ? "تأیید ارسال گسترده" : "تأیید ارسال"} loading={send.isPending} confirmLabel={scheduled ? "زمان‌بندی" : "ارسال"} onConfirm={() => send.mutate()}
        body={preview && (
          <div className="space-y-3">
            <p>تعداد گیرندگان: <b className="num">{faNum(preview.recipient_count)}</b>{preview.out_of_scope_ignored > 0 && <span className="text-warning"> ({faNum(preview.out_of_scope_ignored)} نفر خارج از محدوده شما حذف شدند)</span>}</p>
            <p>کانال‌ها: {preview.channels.map((c: string) => CHANNEL[c]).join("، ")}{preview.channels.includes("SMS") && ` · قابل‌دسترس با پیامک: ${faNum(preview.sms_reachable)}`}</p>
            <p className="text-muted text-[13px]">هزینه تخمینی: سرویس‌دهنده هزینه گزارش نمی‌کند.</p>
            <div className="flex flex-wrap gap-2">{preview.sample.map((u: any) => <span key={u.id} className="inline-flex items-center gap-1.5 text-[13px]"><Avatar name={u.name} size={22} />{u.name}</span>)}</div>
          </div>
        )} />
    </div>
  );
}
