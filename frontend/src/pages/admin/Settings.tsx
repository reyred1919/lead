import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ImageUp, Plus, RotateCcw } from "lucide-react";
import { ApiError, api, del, get, patch, post } from "@/lib/api";
import { bytes, faNum, relTime } from "@/lib/format";
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, LoadingRows, Ltr, PageHeader, Switch } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/overlay";
import { TagChip, TagColorPicker, type TagT } from "@/components/tags/Tags";
import { BrandLogo, type Branding } from "@/components/brand/BrandLogo";
import { useToast } from "@/components/ui/toast";

type AdminTag = TagT & { description: string; usage_count: number; version: number; sort_order: number };

export function TagsAdminPage() {
  const q = useQuery({ queryKey: ["tags"], queryFn: () => get<AdminTag[]>("/tags") });
  const [edit, setEdit] = useState<AdminTag | "new" | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const arch = useMutation({
    mutationFn: (t: AdminTag) => post(`/tags/${t.id}/${t.status === "ACTIVE" ? "archive" : "restore"}`, { version: t.version }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tags"] }); qc.invalidateQueries({ queryKey: ["tags-active"] }); },
    onError: (e: any) => toast({ tone: "error", title: e.message }),
  });
  return (
    <div className="max-w-4xl">
      <PageHeader title="برچسب‌های لید" subtitle="واژگان کنترل‌شده سراسری. برچسب بایگانی‌شده روی لیدهای قبلی باقی می‌ماند اما برای انتخاب جدید در دسترس نیست."
        actions={<Button onClick={() => setEdit("new")}><Plus className="size-4" />برچسب جدید</Button>} />
      <Card>
        {q.isLoading ? <LoadingRows /> : !q.data?.length ? <EmptyState title="هنوز برچسبی تعریف نشده" /> : (
          <ul className="divide-y divide-line-2">
            {q.data.map((t) => (
              <li key={t.id} className="px-5 py-2.5 flex flex-wrap items-center gap-3 min-h-14">
                <TagChip tag={t} />
                <span className="text-[12.5px] text-muted flex-1 min-w-[140px] truncate">{t.description}</span>
                <Ltr className="text-[11.5px] text-muted font-mono">{t.code}</Ltr>
                <span className="text-[12.5px] text-muted num w-20 text-end">{faNum(t.usage_count)} استفاده</span>
                <Button size="sm" variant="ghost" onClick={() => setEdit(t)}>ویرایش</Button>
                <Button size="sm" variant="ghost" onClick={() => arch.mutate(t)}>{t.status === "ACTIVE" ? <><Archive className="size-4" />بایگانی</> : <><RotateCcw className="size-4" />بازیابی</>}</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {edit && <TagDialog tag={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TagDialog({ tag, onClose }: { tag: AdminTag | null; onClose: () => void }) {
  const [v, setV] = useState({ name_fa: tag?.name_fa ?? "", name_en: tag?.name_en ?? "", description: tag?.description ?? "", color: tag?.color ?? "blue" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => (tag ? patch(`/tags/${tag.id}`, { ...v, version: tag.version }) : post("/tags", v)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tags"] }); qc.invalidateQueries({ queryKey: ["tags-active"] }); onClose(); },
    onError: (e: any) => e instanceof ApiError && setErrors(e.isConflict ? { name_fa: "هم‌زمان ویرایش شده؛ دوباره باز کنید." } : e.fieldErrors()),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={tag ? "ویرایش برچسب" : "برچسب جدید"} footer={<Button loading={m.isPending} onClick={() => m.mutate()}>ذخیره</Button>}>
      <div className="space-y-4">
        <div className="rounded-[14px] bg-canvas border border-line-2 p-4 flex items-center gap-2"><span className="text-[12.5px] text-muted">پیش‌نمایش:</span><TagChip tag={{ id: "p", code: "", name_fa: v.name_fa || "نام برچسب", name_en: v.name_en, color: v.color, status: "ACTIVE" }} /></div>
        <Field label="نام فارسی" required error={errors.name_fa}><Input value={v.name_fa} maxLength={60} onChange={(e) => setV({ ...v, name_fa: e.target.value })} /></Field>
        <Field label="نام انگلیسی (اختیاری)"><Input dir="ltr" className="text-left" value={v.name_en} onChange={(e) => setV({ ...v, name_en: e.target.value })} /></Field>
        <Field label="توضیح"><Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></Field>
        <Field label="رنگ" error={errors.color}><TagColorPicker value={v.color} onChange={(c) => setV({ ...v, color: c })} /></Field>
      </div>
    </Dialog>
  );
}

export function BrandingAdminPage() {
  const q = useQuery({ queryKey: ["branding"], queryFn: () => get<Branding & { footer_label: string }>("/branding") });
  const history = useQuery({ queryKey: ["brand-assets"], queryFn: () => get<any[]>("/branding/assets") });
  const qc = useQueryClient();
  const toast = useToast();
  const lightRef = useRef<HTMLInputElement>(null);
  const darkRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<any>(null);
  const s = q.data;
  const f = form ?? (s && { system_title: s.system_title, footer_label: s.footer_label, brand_label: s.brand_label, logo_alt: s.logo_alt, logo_scale: s.logo_scale, show_on_exports: (s as any).show_on_exports });
  const inv = () => { qc.invalidateQueries({ queryKey: ["branding"] }); qc.invalidateQueries({ queryKey: ["brand-assets"] }); };
  const upload = useMutation({
    mutationFn: ({ file, variant }: { file: File; variant: string }) => { const fd = new FormData(); fd.append("file", file); fd.append("variant", variant); return api("/branding/logo", { method: "POST", form: fd }); },
    onSuccess: () => { inv(); toast({ tone: "success", title: "نشان بارگذاری و پردازش امن شد" }); },
    onError: (e: any) => toast({ tone: "error", title: "فایل پذیرفته نشد", body: e.message }),
  });
  const reset = useMutation({ mutationFn: (variant: string) => del(`/branding/logo/${variant}`), onSuccess: inv });
  const save = useMutation({ mutationFn: () => patch("/branding", f), onSuccess: () => { setForm(null); inv(); toast({ tone: "success", title: "تنظیمات ذخیره شد" }); }, onError: (e: any) => toast({ tone: "error", title: e.message }) });
  if (q.isLoading || !s) return <Card><LoadingRows /></Card>;
  const pick = (variant: string) => (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) upload.mutate({ file, variant }); e.target.value = ""; };
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader title="هویت بصری" subtitle="نشان رسمی سازمان را بارگذاری کنید. PNG یا WebP (حداکثر ۲ مگابایت). SVG به دلیل محتوای فعال پذیرفته نمی‌شود؛ هر فایل بررسی محتوا و بازکدگذاری می‌شود." />
      {s.placeholder && <div className="rounded-[14px] bg-warning-soft text-warning px-4 py-3 text-[14px]">نشان رسمی هنوز بارگذاری نشده است؛ یک نشان موقت خنثی با برچسب «نشان موقت» نمایش داده می‌شود.</div>}
      <div className="grid md:grid-cols-2 gap-5">
        {(["LIGHT", "DARK"] as const).map((variant) => {
          const asset = variant === "LIGHT" ? s.light : s.dark;
          return (
            <Card key={variant}>
              <CardHeader title={variant === "LIGHT" ? "نشان برای زمینه روشن" : "نشان برای زمینه تیره"} subtitle={asset ? `${asset.width}×${asset.height}` : "بارگذاری نشده"} />
              <div className={variant === "LIGHT" ? "mx-5 rounded-[14px] bg-canvas border border-line-2 h-32 grid place-items-center" : "mx-5 rounded-[14px] bg-navy h-32 grid place-items-center"}>
                <BrandLogo variant={variant === "LIGHT" ? "light" : "dark"} height={40} />
              </div>
              <div className="p-5 flex gap-2">
                <input ref={variant === "LIGHT" ? lightRef : darkRef} type="file" accept="image/png,image/webp,image/jpeg" className="sr-only" aria-label="انتخاب فایل نشان" onChange={pick(variant)} />
                <Button variant="secondary" loading={upload.isPending && upload.variables?.variant === variant} onClick={() => (variant === "LIGHT" ? lightRef : darkRef).current?.click()}><ImageUp className="size-4" />{asset ? "جایگزینی" : "بارگذاری"}</Button>
                {asset && <Button variant="ghost" onClick={() => reset.mutate(variant)}><RotateCcw className="size-4" />بازگشت به پیش‌فرض</Button>}
              </div>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader title="عنوان و برچسب‌ها" subtitle="فقط متن ساده؛ HTML یا CSS پذیرفته نمی‌شود." />
        <div className="px-5 pb-5 grid sm:grid-cols-2 gap-4">
          <Field label="عنوان سامانه"><Input value={f.system_title} onChange={(e) => setForm({ ...f, system_title: e.target.value })} /></Field>
          <Field label="برچسب سازمان"><Input value={f.brand_label} onChange={(e) => setForm({ ...f, brand_label: e.target.value })} /></Field>
          <Field label="متن جایگزین نشان (alt)"><Input value={f.logo_alt} onChange={(e) => setForm({ ...f, logo_alt: e.target.value })} /></Field>
          <Field label="پانویس"><Input value={f.footer_label} onChange={(e) => setForm({ ...f, footer_label: e.target.value })} /></Field>
          <Field label={`مقیاس نمایش نشان (${faNum(f.logo_scale)})`}><input type="range" min={0.6} max={1.6} step={0.1} value={f.logo_scale} onChange={(e) => setForm({ ...f, logo_scale: +e.target.value })} className="accent-[var(--color-action)] h-11" aria-label="مقیاس نشان" /></Field>
          <div className="flex items-center justify-between min-h-11"><span className="text-[14px]">نمایش در سربرگ گزارش‌ها</span><Switch label="نمایش در گزارش" checked={!!f.show_on_exports} onChange={(x) => setForm({ ...f, show_on_exports: x })} /></div>
          <Button className="sm:col-span-2 justify-self-start" disabled={!form} loading={save.isPending} onClick={() => save.mutate()}>ذخیره</Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="تاریخچه نشان‌ها" />
        <ul className="divide-y divide-line-2">{(history.data ?? []).map((a) => (
          <li key={a.id} className="px-5 py-2.5 flex items-center gap-3 text-[13px]">
            <img src={a.thumb_url} alt="" className="h-8 w-auto max-w-[120px] object-contain bg-canvas rounded" />
            <span className="flex-1 truncate">{a.variant === "LIGHT" ? "روشن" : "تیره"} · {a.original_filename} · {bytes(a.size)}</span>
            <span className="text-muted">{relTime(a.created_at)}</span>
            <Badge tone={a.is_active ? "success" : "neutral"}>{a.is_active ? "فعال" : "بایگانی"}</Badge>
          </li>
        ))}</ul>
      </Card>
    </div>
  );
}
