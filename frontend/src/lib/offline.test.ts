import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { createOfflineQueue, type CapturePayload } from "./offline";

let n = 0;
function payload(over: Partial<CapturePayload> = {}): CapturePayload {
  return {
    client_record_id: crypto.randomUUID(),
    event_id: "evt-1",
    captured_at: new Date().toISOString(),
    captured_offline: true,
    contact_name: "مخاطب آفلاین",
    mobile: "09121234567",
    product_ids: ["p1"],
    quality: "FOLLOW_UP",
    ...over,
  };
}

function queue(send = vi.fn()) {
  const q = createOfflineQueue({ dbName: `test-${++n}`, send });
  q.setUser("user-1");
  return { q, send };
}

describe("offline queue", () => {
  it("persists records encrypted at rest", async () => {
    const { q } = queue();
    const p = payload();
    await q.enqueue(p, "E");
    const raw = await new Promise<any>((resolve) => {
      const req = indexedDB.open(`test-${n}`);
      req.onsuccess = () => {
        const tx = req.result.transaction("queue").objectStore("queue").get(p.client_record_id);
        tx.onsuccess = () => resolve(tx.result);
      };
    });
    expect(raw.event_id).toBe("evt-1");
    expect(JSON.stringify(raw)).not.toContain("مخاطب آفلاین");
    expect(JSON.stringify(raw)).not.toContain("09121234567");
    const items = await q.list();
    expect(items[0].payload?.contact_name).toBe("مخاطب آفلاین");
    expect(items[0].status).toBe("queued");
  });

  it("syncs, wipes payload, and is idempotent across retries", async () => {
    const send = vi.fn(async (records: CapturePayload[]) => ({
      results: records.map((r) => ({ client_record_id: r.client_record_id, status: "CREATED", interaction_id: "srv-" + r.client_record_id })),
    }));
    const { q } = queue(send);
    const p = payload();
    await q.enqueue(p, "E");
    await q.syncNow();
    await q.syncNow(); // nothing left to send
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0][0].client_record_id).toBe(p.client_record_id);
    expect(send.mock.calls[0][0][0].event_id).toBe("evt-1");
    const [item] = await q.list();
    expect(item.status).toBe("synced");
    expect(item.payload).toBeUndefined();
    expect(item.interaction_id).toBe("srv-" + p.client_record_id);
  });

  it("keeps records queued on network interruption and resends the same idempotency key", async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError(0, null)).mockImplementation(async (records: CapturePayload[]) => ({
      results: records.map((r) => ({ client_record_id: r.client_record_id, status: "DUPLICATE", interaction_id: "x" })),
    }));
    const { q } = queue(send);
    const p = payload();
    await q.enqueue(p, "E");
    await q.syncNow();
    expect((await q.list())[0].status).toBe("queued");
    await q.syncNow();
    expect(send.mock.calls[1][0][0].client_record_id).toBe(p.client_record_id);
    expect((await q.list())[0].status).toBe("synced");
  });

  it("marks quarantined records for review and rejected ones as failed with retry", async () => {
    const send = vi.fn(async (records: CapturePayload[]) => ({
      results: [
        { client_record_id: records[0].client_record_id, status: "QUARANTINED", reason: "EVENT_CLOSED_BEYOND_GRACE" },
        { client_record_id: records[1].client_record_id, status: "REJECTED", error: { product_ids: "invalid" } },
      ],
    }));
    const { q } = queue(send);
    await q.enqueue(payload(), "E");
    await new Promise((r) => setTimeout(r, 2));
    await q.enqueue(payload({ contact_name: "دوم" }), "E");
    await q.syncNow();
    const items = await q.list();
    expect(items.map((i) => i.status).sort()).toEqual(["failed", "review"]);
    const failed = items.find((i) => i.status === "failed")!;
    expect(failed.payload?.contact_name).toBe("دوم");
    await q.retry(failed.id);
    expect((await q.counts()).queued).toBe(1);
  });

  it("offline identity fallback expires with the session lifetime (shared devices)", async () => {
    const { q } = queue();
    await q.cacheContext("user-1", { user: { id: "user-1", full_name: "کاربر قبلی" } });
    expect((await q.cachedContext())?.user.full_name).toBe("کاربر قبلی");
    expect(await q.cachedContext(-1)).toBeNull();
    const realNow = Date.now;
    Date.now = () => realNow() + 13 * 3600 * 1000;
    try {
      expect(await q.cachedContext()).toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("isolates records per user and clears everything on logout", async () => {
    const { q } = queue();
    await q.enqueue(payload(), "E");
    q.setUser("user-2");
    expect(await q.list()).toHaveLength(0);
    q.setUser("user-1");
    expect(await q.pendingCount()).toBe(1);
    await q.clearAll();
    q.setUser("user-1");
    expect(await q.list()).toHaveLength(0);
  });
});
