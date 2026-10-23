import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ApiError, get, patch, post } from "@/lib/api";
import { faNum } from "@/lib/format";
import { Badge, Button, Card, EmptyState, Field, Input, LoadingRows, Ltr, PageHeader, Segmented, Select, Textarea } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";

export function CatalogPage() {
  const [tab, setTab] = useState<"products" | "plans">("products");
  const [status, setStatus] = useState("ACTIVE");
  const plans = useQuery({ queryKey: ["plans", "all"], queryFn: () => get<any[]>("/plans") });
  const products = useQuery({ queryKey: ["products", "all"], queryFn: () => get<any[]>("/products") });
  const [edit, setEdit] = useState<{ kind: "plan" | "product"; item: any | null } | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const arch = useMutation({
    mutationFn: ({ kind, item }: { kind: string; item: any }) => post(`/${kind}s/${item.id}/${item.status === "ACTIVE" ? "archive" : "restore"}`, { version: item.version }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["plans"] }); qc.invalidateQueries({ queryKey: ["products"] }); toast({ tone: "success", title: "وضعیت تغییر کرد؛ سوابق تاریخی حفظ می‌شود" }); },
    onError: (e: any) => toast({ tone: "error", title: e.message }),
  });
  const list = (tab === "products" ? products.data : plans.data)?.filter((x) => !status || x.status === status) ?? [];
  return (
    <div>
      <PageHeader title="طرح‌ها و محصولات" subtitle="کاتالوگ مرجع با کد پایدار. بایگانی به‌جای حذف: لیدهای تاریخی محصول و طرح خود را حفظ می‌کنند."
        actions={<Button onClick={() => setEdit({ kind: tab === "products" ? "product" : "plan", item: null })}><Plus className="size-4" />{tab === "products" ? "محصول جدید" : "طرح جدید"}</Button>} />
      <div className="flex flex-wrap gap-2 mb-4">
        <Segmented label="نوع" value={tab} onChange={setTab} options={[{ value: "products", label: "محصولات" }, { value: "plans", label: "طرح‌ها" }]} />
        <Segmented label="وضعیت" value={status} onChange={setStatus} options={[{ value: "ACTIVE", label: "فعال" }, { value: "ARCHIVED", label: "بایگانی" }, { value: "", label: "همه" }]} />
      </div>
      <Card>
        {(tab === "products" ? products.isLoading : plans.isLoading) ? <LoadingRows /> : !list.length ? <EmptyState title="موردی نیست" /> : (
          <ul className="divide-y divide-line-2">
            {list.map((x) => (
              <li key={x.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-semibold">{x.name_fa} {x.name_en && <span className="text-muted text-[13px] ltr">{x.name_en}</span>}</div>
                  <div className="text-[12.5px] text-muted"><Ltr className="font-mono">{x.code}</Ltr>{tab === "products" ? ` · ${x.plan_name ?? "بدون طرح"}${x.owners_detail.length ? ` · مالک: ${x.owners_detail.map((o: any) => o.full_name).join("، ")}` : ""}` : ` · ${faNum(x.product_count)} محصول`}</div>
                </div>
                {x.status !== "ACTIVE" && <Badge tone="neutral">بایگانی</Badge>}
                <Button size="sm" variant="ghost" onClick={() => setEdit({ kind: tab === "products" ? "product" : "plan", item: x })}>ویرایش</Button>
                <Button size="sm" variant={x.status === "ACTIVE" ? "danger-soft" : "secondary"} onClick={() => arch.mutate({ kind: tab === "products" ? "product" : "plan", item: x })}>{x.status === "ACTIVE" ? "بایگانی" : "بازیابی"}</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <CatalogDialog kind={edit.kind} item={edit.item} plans={plans.data ?? []} onClose={() => setEdit(null)} />}
    </div>
  );
}

function CatalogDialog({ kind, item, plans, onClose }: { kind: "plan" | "product"; item: any | null; plans: any[]; onClose: () => void }) {
  const [v, setV] = useState({ code: item?.code ?? "", name_fa: item?.name_fa ?? "", name_en: item?.name_en ?? "", description: item?.description ?? "", plan: item?.plan ?? "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const toast = useToast();
  const m = useMutation({
    mutationFn: () => {
      const body: any = { ...v, plan: v.plan || null };
      if (kind === "plan") delete body.plan;
      return item ? patch(`/${kind}s/${item.id}`, { ...body, code: item.code, version: item.version }) : post(`/${kind}s`, body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [kind === "plan" ? "plans" : "products"] }); toast({ tone: "success", title: "ذخیره شد" }); onClose(); },
    onError: (e: any) => { if (e instanceof ApiError) setErrors(e.fieldErrors()); toast({ tone: "error", title: e.message }); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`${item ? "ویرایش" : "ایجاد"} ${kind === "plan" ? "طرح" : "محصول"}`}
      footer={<Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button>}>
      <div className="space-y-4">
        <Field label="کد پایدار" required error={errors.code} hint={item ? "کد قابل تغییر نیست" : undefined}><Input dir="ltr" className="text-left font-mono" disabled={!!item} value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} /></Field>
        <Field label="نام فارسی" required error={errors.name_fa}><Input value={v.name_fa} onChange={(e) => setV({ ...v, name_fa: e.target.value })} /></Field>
        <Field label="نام انگلیسی"><Input dir="ltr" className="text-left" value={v.name_en} onChange={(e) => setV({ ...v, name_en: e.target.value })} /></Field>
        {kind === "product" && <Field label="طرح"><Select value={v.plan} onChange={(e) => setV({ ...v, plan: e.target.value })}><option value="">بدون طرح</option>{plans.filter((p) => p.status === "ACTIVE").map((p) => <option key={p.id} value={p.id}>{p.name_fa}</option>)}</Select></Field>}
        <Field label="توضیحات"><Textarea value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}


