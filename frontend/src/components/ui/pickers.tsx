import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import { get, qs, type Page } from "@/lib/api";
import { Avatar, cn } from "./primitives";

export type UserLite = { id: string; full_name: string; title?: string; username?: string };

/** Async user search (server limits results to active users; scope enforced on action). */
export function UserPicker({ value, onChange, eventId, placeholder = "جست‌وجوی نام کاربر…", excludeIds = [] }: {
  value: UserLite | null; onChange: (u: UserLite | null) => void; eventId?: string; placeholder?: string; excludeIds?: string[];
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 220);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["user-picker", debounced, eventId],
    queryFn: () => get<Page<UserLite>>(`/users${qs({ q: debounced, event_id: eventId, status: "ACTIVE", page_size: 12 })}`),
  });
  const users = (data?.results ?? []).filter((u) => !excludeIds.includes(u.id));
  return (
    <div className="border border-line rounded-[14px] overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-11 border-b border-line-2 bg-canvas">
        <Search className="size-4 text-muted" />
        <input aria-label="جست‌وجوی کاربر" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="flex-1 bg-transparent outline-none text-[14.5px]" />
        {isFetching && <span className="text-[12px] text-muted">…</span>}
      </div>
      <ul role="listbox" aria-label="کاربران" className="max-h-60 overflow-y-auto scrollbar-thin p-1">
        {users.map((u) => (
          <li key={u.id}>
            <button type="button" role="option" aria-selected={value?.id === u.id} onClick={() => onChange(value?.id === u.id ? null : u)}
              className={cn("w-full flex items-center gap-3 px-2.5 py-2 rounded-[10px] text-start min-h-12", value?.id === u.id ? "bg-action-soft" : "hover:bg-line-2")}>
              <Avatar name={u.full_name} size={32} />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-[14px] truncate">{u.full_name}</span>
                {u.title && <span className="block text-[12.5px] text-muted truncate">{u.title}</span>}
              </span>
              {value?.id === u.id && <Check className="size-4 text-action" />}
            </button>
          </li>
        ))}
        {!users.length && !isFetching && <li className="text-center text-[13px] text-muted py-6">کاربری یافت نشد.</li>}
      </ul>
    </div>
  );
}
