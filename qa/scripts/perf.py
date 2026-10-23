#!/usr/bin/env python3
"""API latency probe against the local QA stack (Django runserver, single process, local PostgreSQL).
These are LOCAL DEVELOPMENT measurements, not production capacity numbers."""
import json
import statistics
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.cookiejar import CookieJar

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001"
BUDGET_P95_MS = {"GET /auth/me": 150, "GET /interactions": 400, "GET /dashboard": 800, "GET /referrals?box=incoming": 300, "POST /interactions": 500, "GET /events/mine": 200}


def session(user):
    jar = CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    op.open(f"{BASE}/api/v1/auth/csrf").read()
    token = next(c.value for c in jar if c.name == "csrftoken")
    req = urllib.request.Request(f"{BASE}/api/v1/auth/login", data=json.dumps({"username": user, "password": "Demo@Expo1405"}).encode(),
                                 headers={"Content-Type": "application/json", "X-CSRFToken": token, "Referer": BASE})
    op.open(req).read()
    token = next(c.value for c in jar if c.name == "csrftoken")
    return op, token


def timed(op, method, path, body=None, token=""):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{BASE}/api/v1{path}", data=data, method=method, headers={"Content-Type": "application/json", "X-CSRFToken": token, "Referer": BASE})
    t = time.perf_counter()
    with op.open(req) as r:
        r.read()
        status = r.status
    return (time.perf_counter() - t) * 1000, status


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def main():
    out = {"base": BASE, "note": "local dev server (manage.py runserver), not production", "serial": {}, "concurrent": {}}
    op, token = session("mdm")
    events = json.loads(op.open(f"{BASE}/api/v1/events/mine").read())
    tech = next(e for e in events if e["code"] == "DEMO-TECH-1405")
    import uuid

    cases = [("GET /auth/me", "GET", "/auth/me", None), ("GET /events/mine", "GET", "/events/mine", None),
             ("GET /interactions", "GET", "/interactions?page_size=25", None), ("GET /dashboard", "GET", "/dashboard", None),
             ("GET /referrals?box=incoming", "GET", "/referrals?box=incoming", None)]
    for name, m, p, b in cases:
        timed(op, m, p, b, token)  # warm-up
        xs = [timed(op, m, p, b, token)[0] for _ in range(40)]
        out["serial"][name] = {"n": len(xs), "p50_ms": round(statistics.median(xs), 1), "p95_ms": round(pct(xs, 95), 1), "budget_p95_ms": BUDGET_P95_MS[name]}
    xs = []
    for i in range(30):
        body = {"event_id": tech["id"], "client_record_id": str(uuid.uuid4()), "contact_name": f"پرف {i}", "mobile": f"0912{8000000 + i}", "product_ids": [tech["products"][0]["id"]]}
        xs.append(timed(op, "POST", "/interactions", body, token)[0])
    out["serial"]["POST /interactions"] = {"n": 30, "p50_ms": round(statistics.median(xs), 1), "p95_ms": round(pct(xs, 95), 1), "budget_p95_ms": BUDGET_P95_MS["POST /interactions"]}
    # 10 concurrent clients on the lead list (single-process dev server → serialization expected)
    sessions = [session(u) for u in ["specialist1", "specialist2", "planmgr", "dg", "mdm", "owner", "qa_dual", "admin", "evmgr", "specialist3"]]
    def burst(s):
        return [timed(s[0], "GET", "/interactions?page_size=25", None, s[1])[0] for _ in range(10)]
    with ThreadPoolExecutor(10) as ex:
        allx = [x for r in ex.map(burst, sessions) for x in r]
    out["concurrent"]["GET /interactions x10 clients"] = {"n": len(allx), "p50_ms": round(statistics.median(allx), 1), "p95_ms": round(pct(allx, 95), 1)}
    for v in out["serial"].values():
        v["within_budget"] = v["p95_ms"] <= v["budget_p95_ms"]
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
