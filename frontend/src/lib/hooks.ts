import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "./api";
import { offlineQueue, type QueueStatus } from "./offline";
import { useAuth } from "./auth";

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useQueueCounts() {
  const [counts, setCounts] = useState<Record<QueueStatus, number>>({ queued: 0, syncing: 0, failed: 0, synced: 0, review: 0 });
  useEffect(() => {
    let alive = true;
    const refresh = () => offlineQueue.counts().then((c) => alive && setCounts(c)).catch(() => undefined);
    refresh();
    const unsub = offlineQueue.subscribe(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  return counts;
}

export type WorkCounts = {
  referrals_incoming: number; referrals_returned: number; referrals_overdue: number; tasks_open: number; tasks_overdue: number;
  actions_open: number; notifications_unread: number;
};

export function useWorkCounts() {
  const { me } = useAuth();
  return useQuery({ queryKey: ["work-counts"], queryFn: () => get<WorkCounts>("/work-queue/counts"), enabled: !!me, refetchInterval: 60_000 });
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
