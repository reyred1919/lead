/**
 * Offline booth-capture queue.
 *
 * - Persistent IndexedDB storage; personal data is encrypted with AES-GCM using a
 *   NON-extractable per-user key that never leaves the browser's key store.
 * - Each record keeps its client idempotency key (client_record_id), event UUID,
 *   product UUIDs, capture timestamp and actor; the server re-checks membership
 *   and event policy on sync and never re-tags a record to another event.
 * - After a successful sync the encrypted payload is wiped (only status + server id remain).
 * - logout clears the queue and keys (shared-device safety).
 */
import { openDB, type IDBPDatabase } from "idb";
import { ApiError, post } from "./api";

export type QueueStatus = "queued" | "syncing" | "failed" | "synced" | "review";

export type CapturePayload = {
  client_record_id: string;
  event_id: string;
  captured_at: string;
  captured_offline: true;
  contact_name: string;
  mobile?: string;
  email?: string;
  org_name?: string;
  account_id?: string;
  contact_id?: string;
  product_ids: string[];
  quality: string;
  note?: string;
};

type StoredItem = {
  id: string;
  user_id: string;
  event_id: string;
  event_code: string;
  status: QueueStatus;
  created_at: string;
  updated_at: string;
  attempts: number;
  iv?: Uint8Array;
  cipher?: ArrayBuffer;
  error?: string;
  interaction_id?: string;
};

export type QueueItem = Omit<StoredItem, "iv" | "cipher"> & { payload?: CapturePayload };

export const STATUS_LABEL: Record<QueueStatus, string> = {
  queued: "در صف همگام‌سازی",
  syncing: "در حال ارسال",
  failed: "ناموفق",
  synced: "همگام‌شده",
  review: "در انتظار بازبینی مدیر",
};

type Listener = () => void;
type Sender = (records: CapturePayload[]) => Promise<{ results: any[] }>;

const SYNCED_TTL_MS = 24 * 3600 * 1000;

export function createOfflineQueue(opts: { dbName?: string; send?: Sender } = {}) {
  const dbName = opts.dbName ?? "expo-leads-offline";
  const send: Sender = opts.send ?? ((records) => post("/interactions/sync", { records }));
  let dbp: Promise<IDBPDatabase> | null = null;
  let userId: string | null = null;
  let syncing = false;
  const listeners = new Set<Listener>();

  const db = () =>
    (dbp ??= openDB(dbName, 1, {
      upgrade(d) {
        d.createObjectStore("queue", { keyPath: "id" }).createIndex("user", "user_id");
        d.createObjectStore("keys");
        d.createObjectStore("context");
      },
    }));

  const emit = () => listeners.forEach((l) => l());

  async function key(uid: string): Promise<CryptoKey> {
    const d = await db();
    const existing = (await d.get("keys", uid)) as CryptoKey | undefined;
    if (existing) return existing;
    const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await d.put("keys", k, uid);
    return k;
  }

  async function encrypt(uid: string, data: unknown) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(uid), new TextEncoder().encode(JSON.stringify(data)));
    return { iv, cipher };
  }

  async function decrypt<T>(uid: string, iv: Uint8Array, cipher: ArrayBuffer): Promise<T> {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await key(uid), cipher);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  }

  async function mine(): Promise<StoredItem[]> {
    if (!userId) return [];
    return ((await (await db()).getAllFromIndex("queue", "user", userId)) as StoredItem[]).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async function save(item: StoredItem) {
    await (await db()).put("queue", item);
  }

  const api = {
    setUser(id: string) {
      userId = id;
      emit();
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async enqueue(payload: CapturePayload, eventCode: string) {
      if (!userId) throw new Error("no user");
      const now = new Date().toISOString();
      const { iv, cipher } = await encrypt(userId, payload);
      const item: StoredItem = {
        id: payload.client_record_id, user_id: userId, event_id: payload.event_id, event_code: eventCode,
        status: "queued", created_at: now, updated_at: now, attempts: 0, iv, cipher,
      };
      await save(item);
      emit();
      return item.id;
    },
    async list(): Promise<QueueItem[]> {
      const out: QueueItem[] = [];
      for (const it of await mine()) {
        const { iv, cipher, ...rest } = it;
        let payload: CapturePayload | undefined;
        if (iv && cipher && userId) {
          try {
            payload = await decrypt<CapturePayload>(userId, iv, cipher);
          } catch {
            payload = undefined;
          }
        }
        out.push({ ...rest, payload });
      }
      return out;
    },
    async counts() {
      const c: Record<QueueStatus, number> = { queued: 0, syncing: 0, failed: 0, synced: 0, review: 0 };
      for (const it of await mine()) c[it.status]++;
      return c;
    },
    async pendingCount() {
      const c = await api.counts();
      return c.queued + c.syncing + c.failed;
    },
    async discard(id: string) {
      const d = await db();
      const it = (await d.get("queue", id)) as StoredItem | undefined;
      if (it && it.user_id === userId) await d.delete("queue", id);
      emit();
    },
    async retry(id: string) {
      const d = await db();
      const it = (await d.get("queue", id)) as StoredItem | undefined;
      if (it && it.user_id === userId && it.status === "failed") {
        await save({ ...it, status: "queued", error: undefined, updated_at: new Date().toISOString() });
        emit();
      }
    },
    /** Upload queued records. Safe to call repeatedly; the server is idempotent on client_record_id. */
    async syncNow() {
      if (syncing || !userId) return { sent: 0 };
      syncing = true;
      let sent = 0;
      try {
        const uid = userId;
        const ready = (await mine()).filter((i) => i.status === "queued" || i.status === "syncing");
        for (let i = 0; i < ready.length; i += 25) {
          const batch = ready.slice(i, i + 25);
          const payloads: CapturePayload[] = [];
          for (const it of batch) {
            await save({ ...it, status: "syncing", updated_at: new Date().toISOString() });
            payloads.push(await decrypt<CapturePayload>(uid, it.iv!, it.cipher!));
          }
          emit();
          let results: any[];
          try {
            results = (await send(payloads)).results;
          } catch (e) {
            const network = e instanceof ApiError ? e.isNetwork || e.status >= 500 : true;
            for (const it of batch) {
              await save({ ...it, status: network ? "queued" : "failed", attempts: it.attempts + 1, error: network ? "network" : (e as Error).message, updated_at: new Date().toISOString() });
            }
            emit();
            break;
          }
          for (const it of batch) {
            const r = results.find((x) => x.client_record_id === it.id);
            const now = new Date().toISOString();
            if (!r) {
              await save({ ...it, status: "queued", updated_at: now });
            } else if (r.status === "CREATED" || r.status === "DUPLICATE") {
              // Wipe the personal payload once the server holds the record.
              await save({ id: it.id, user_id: it.user_id, event_id: it.event_id, event_code: it.event_code, status: "synced", created_at: it.created_at, updated_at: now, attempts: it.attempts + 1, interaction_id: r.interaction_id });
              sent++;
            } else if (r.status === "QUARANTINED") {
              await save({ id: it.id, user_id: it.user_id, event_id: it.event_id, event_code: it.event_code, status: "review", created_at: it.created_at, updated_at: now, attempts: it.attempts + 1, error: r.reason });
              sent++;
            } else {
              await save({ ...it, status: "failed", attempts: it.attempts + 1, error: typeof r.error === "string" ? r.error : JSON.stringify(r.error), updated_at: now });
            }
          }
          emit();
        }
        // Housekeeping: drop synced markers after a day.
        const d = await db();
        for (const it of await mine()) {
          if ((it.status === "synced" || it.status === "review") && Date.now() - Date.parse(it.updated_at) > SYNCED_TTL_MS) await d.delete("queue", it.id);
        }
      } finally {
        syncing = false;
        emit();
      }
      return { sent };
    },
    async cacheContext(uid: string, data: unknown) {
      const enc = await encrypt(uid, data);
      await (await db()).put("context", { uid, ...enc }, "me");
    },
    async cachedContext(): Promise<any | null> {
      const rec = (await (await db()).get("context", "me")) as { uid: string; iv: Uint8Array; cipher: ArrayBuffer } | undefined;
      if (!rec) return null;
      return decrypt(rec.uid, rec.iv, rec.cipher);
    },
    async cacheEvents(uid: string, events: unknown) {
      const enc = await encrypt(uid, events);
      await (await db()).put("context", { uid, ...enc }, "events");
    },
    async cachedEvents(): Promise<any[] | null> {
      const rec = (await (await db()).get("context", "events")) as { uid: string; iv: Uint8Array; cipher: ArrayBuffer } | undefined;
      if (!rec || rec.uid !== userId) return null;
      return decrypt(rec.uid, rec.iv, rec.cipher);
    },
    async clearAll(_discard?: boolean) {
      const d = await db();
      await d.clear("queue");
      await d.clear("keys");
      await d.clear("context");
      userId = null;
      emit();
    },
  };
  return api;
}

export const offlineQueue = createOfflineQueue();

export function newRecordId() {
  return crypto.randomUUID();
}

/** Starts automatic background sync: on reconnect, on an interval, and once at start. */
export function startAutoSync(queue = offlineQueue) {
  const tick = () => {
    if (navigator.onLine) queue.syncNow().catch(() => undefined);
  };
  window.addEventListener("online", tick);
  const timer = window.setInterval(tick, 20000);
  tick();
  return () => {
    window.removeEventListener("online", tick);
    window.clearInterval(timer);
  };
}
