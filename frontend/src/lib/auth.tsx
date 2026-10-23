import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, SESSION_EXPIRED_EVENT, get, post } from "./api";
import { offlineQueue } from "./offline";

export type EventCtx = {
  id: string;
  code: string;
  display_name: string;
  status: string;
  city: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  roles: { code: string; name_fa: string }[];
  can_capture: boolean;
};

export type Me = {
  user: { id: string; username: string; full_name: string; first_name: string; last_name: string; title: string; mobile: string; email: string; must_change_password: boolean };
  authz: {
    global: string[];
    global_roles: string[];
    events: Record<string, { capabilities: string[]; roles: string[]; product_scope: string[] | null; event_status: string }>;
  };
  events: EventCtx[];
  capture_events: EventCtx[];
  demo_mode: boolean;
};

type AuthState = {
  me: Me | null;
  loading: boolean;
  login: (u: string, p: string) => Promise<void>;
  logout: (opts?: { discardQueue?: boolean }) => Promise<void>;
  refresh: () => Promise<void>;
  /** UI convenience only — the server re-checks every action. */
  can: (cap: string, eventId?: string) => boolean;
  activeEventId: string | null;
  setActiveEventId: (id: string) => void;
};

const Ctx = createContext<AuthState | null>(null);

/** Caches event/product context right after login so booth capture works offline even if the
 *  capture page was never opened online on this device (QA-D-19). */
function prefetchCaptureContext(userId: string) {
  get("/events/mine").then((events) => offlineQueue.cacheEvents(userId, events)).catch(() => undefined);
}
const EVENT_KEY = "expo.activeEvent";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeEventId, setActive] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(EVENT_KEY);
    } catch {
      return null;
    }
  });
  const qc = useQueryClient();

  const load = useCallback(async () => {
    try {
      const data = await get<Me>("/auth/me");
      setMe(data);
      offlineQueue.setUser(data.user.id);
      offlineQueue.cacheContext(data.user.id, data).catch(() => undefined);
      prefetchCaptureContext(data.user.id);
    } catch (e) {
      if (e instanceof ApiError && e.isNetwork) {
        // Offline start: use the last cached identity so booth capture keeps working.
        const cached = await offlineQueue.cachedContext().catch(() => null);
        setMe(cached ?? null);
        if (cached) offlineQueue.setUser(cached.user.id);
      } else setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Session expired mid-use: drop identity so <Protected> redirects to /login?next=… (offline queue is kept).
  useEffect(() => {
    const onExpired = () => {
      qc.clear();
      setMe(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [qc]);

  // Event context rules: single active capture membership → locked default.
  useEffect(() => {
    if (!me) return;
    const ids = me.capture_events.map((e) => e.id);
    if (activeEventId && ids.includes(activeEventId)) return;
    if (ids.length >= 1) setActiveEventId(ids[0]);
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const setActiveEventId = (id: string) => {
    setActive(id);
    try {
      sessionStorage.setItem(EVENT_KEY, id);
    } catch {
      /* private mode */
    }
  };

  const can = useCallback(
    (cap: string, eventId?: string) => {
      if (!me) return false;
      if (cap !== "interaction.create" && me.authz.global.includes(cap)) return true;
      if (eventId) return !!me.authz.events[eventId]?.capabilities.includes(cap);
      return Object.values(me.authz.events).some((e) => e.capabilities.includes(cap));
    },
    [me],
  );

  const value = useMemo<AuthState>(
    () => ({
      me,
      loading,
      can,
      activeEventId,
      setActiveEventId,
      refresh: load,
      login: async (username, password) => {
        const data = await post<Me>("/auth/login", { username, password });
        setMe(data);
        offlineQueue.setUser(data.user.id);
        offlineQueue.cacheContext(data.user.id, data).catch(() => undefined);
      prefetchCaptureContext(data.user.id);
        qc.clear();
      },
      logout: async (opts) => {
        try {
          await post("/auth/logout");
        } catch {
          /* already logged out or offline */
        }
        // Shared-device safety: clear encrypted offline storage on logout.
        await offlineQueue.clearAll(!!opts?.discardQueue).catch(() => undefined);
        try {
          sessionStorage.removeItem(EVENT_KEY);
        } catch {
          /* ignore */
        }
        qc.clear();
        setMe(null);
      },
    }),
    [me, loading, can, activeEventId, load, qc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}
