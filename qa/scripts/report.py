#!/usr/bin/env python3
"""Builds QA artifacts from real run outputs (no synthetic numbers).

Inputs (qa/results/):  playwright-<label>.json, matrix-*.jsonl, axe-*.jsonl, screenshots-*.jsonl
Outputs: qa/TEST-RESULTS-<label>.csv, qa/ROLE-DEVICE-MATRIX-<label>.csv, qa/screenshots/index-<sha>.md,
         qa/screenshots/manifest-<sha>.json, qa/screenshots/contact-sheets/<sha>/*.png, qa/results/summary-<label>.json

Usage: report.py <label> <sha>
"""
import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

QA = Path(__file__).resolve().parents[1]
RES = QA / "results"
BLOCKED_BROWSERS = [
    ("webkit-desktop", "WebKit binaries not present in /opt/pw-browsers; `playwright install` is prohibited in this sandbox"),
    ("webkit-mobile", "WebKit binaries not present in /opt/pw-browsers; `playwright install` is prohibited in this sandbox"),
    ("firefox-desktop", "Firefox binaries not present in /opt/pw-browsers; `playwright install` is prohibited in this sandbox"),
]


def walk(suite, path=()):
    for s in suite.get("suites", []):
        yield from walk(s, path + (s.get("title", ""),))
    for spec in suite.get("specs", []):
        for t in spec.get("tests", []):
            yield path, spec, t


def tests_csv(label):
    files = sorted(RES.glob(f"playwright-{label}-*.json")) or [RES / f"playwright-{label}.json"]
    rows = []
    for path, spec, t in (x for f in files for x in walk(json.loads(f.read_text()))):
        res = t["results"][-1] if t["results"] else {}
        status = {"passed": "PASS", "failed": "FAIL", "timedOut": "FAIL", "skipped": "SKIP", "interrupted": "BLOCKED"}.get(res.get("status", "skipped"), res.get("status"))
        if t.get("expectedStatus") == "skipped":
            status = "SKIP"
        meta = {}
        for a in t.get("annotations", []) + res.get("annotations", []):
            if a.get("type") == "case":
                try:
                    meta = json.loads(a["description"])
                except Exception:
                    pass
        err = ""
        if res.get("errors"):
            err = (res["errors"][0].get("message") or "").splitlines()[0][:300]
        if status == "SKIP":
            err = next((a.get("description", "") for a in t.get("annotations", []) + res.get("annotations", []) if a.get("type") == "skip"), "") or err
        attachments = [a.get("path", "") for a in res.get("attachments", []) if a.get("path")]
        rows.append({
            "case_id": meta.get("id") or spec["title"].split(" ")[0], "title": spec["title"], "file": spec.get("file"),
            "project": t.get("projectName"), "role": meta.get("role", ""), "route": meta.get("route", ""),
            "action": meta.get("action", ""), "expected": meta.get("expected", ""), "status": status,
            "duration_ms": res.get("duration", 0), "error": err.replace("\x1b", ""),
            "evidence": ";".join(str(Path(a).relative_to(QA)) if a.startswith(str(QA)) else a for a in attachments),
        })
    for name, reason in BLOCKED_BROWSERS:
        rows.append({"case_id": "ENV-BROWSER", "title": f"Run full suite on {name}", "file": "qa.config.ts", "project": name, "role": "*",
                     "route": "*", "action": "browser coverage", "expected": "suite executes", "status": "BLOCKED", "duration_ms": 0,
                     "error": reason, "evidence": "ls /opt/pw-browsers"})
    out = QA / f"TEST-RESULTS-{label}.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    return rows


def jsonl(prefix):
    rows = []
    for f in sorted(RES.glob(f"{prefix}-*.jsonl")):
        rows += [json.loads(l) for l in f.read_text().splitlines() if l.strip()]
    return rows


def matrix_csv(label):
    rows = jsonl("matrix")
    out = QA / f"ROLE-DEVICE-MATRIX-{label}.csv"
    fields = ["persona", "route", "viewport", "action", "expected", "observed", "menu", "overflow_px", "axe_violations", "result", "screenshot"]
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
    return rows


def screenshots(sha):
    rows = [r for r in jsonl("screenshots") if f"/{sha}/" in "/" + r["file"]]
    seen = {}
    for r in rows:
        seen[r["file"]] = r
    rows = sorted(seen.values(), key=lambda r: (r["role"], r["device"], r["route"], r["state"]))
    (QA / "screenshots" / f"manifest-{sha}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    by = defaultdict(list)
    for r in rows:
        by[(r["role"], r["device"])].append(r)
    lines = [f"# Screenshot index — commit `{sha}`", "", f"{len(rows)} genuine Playwright full-page captures of the running app (Chromium emulation; no physical devices).",
             "Fixture data is synthetic. Naming: `qa/screenshots/{commit}/{role}/{device}/{route}__{state}.png`.", "",
             f"Contact sheets: `qa/screenshots/contact-sheets/{sha}/`", ""]
    for (role, dev), items in sorted(by.items()):
        lines.append(f"## {role} · {dev}")
        lines.append("")
        lines.append("| Route | State | Case | File |")
        lines.append("|---|---|---|---|")
        for r in items:
            rel = Path(r["file"]).relative_to("screenshots")
            lines.append(f"| `{r['route']}` | {r['state']} | {r.get('caseId', '')} | [{rel.name}]({rel}) |")
        lines.append("")
    (QA / "screenshots" / f"index-{sha}.md").write_text("\n".join(lines))
    return rows, by


def contact_sheets(sha, by):
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return 0
    out_dir = QA / "screenshots" / "contact-sheets" / sha
    out_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for (role, dev), items in sorted(by.items()):
        thumbs = []
        for r in items:
            p = QA / r["file"]
            if not p.exists():
                continue
            im = Image.open(p).convert("RGB")
            w = 240
            h = min(int(im.height * w / im.width), 420)
            im = im.resize((w, int(im.height * w / im.width))).crop((0, 0, w, h))
            canvas = Image.new("RGB", (w, h + 28), "white")
            canvas.paste(im, (0, 28))
            ImageDraw.Draw(canvas).text((4, 6), f"{r['route']} · {r['state']}"[:40], fill=(16, 41, 76))
            thumbs.append(canvas)
        if not thumbs:
            continue
        cols = 6
        rows = (len(thumbs) + cols - 1) // cols
        cell_h = max(t.height for t in thumbs)
        sheet = Image.new("RGB", (cols * 248 + 8, rows * (cell_h + 8) + 40), (238, 241, 246))
        ImageDraw.Draw(sheet).text((10, 12), f"{role} · {dev} · {sha}", fill=(16, 41, 76))
        for i, t in enumerate(thumbs):
            sheet.paste(t, (8 + (i % cols) * 248, 40 + (i // cols) * (cell_h + 8)))
        sheet.save(out_dir / f"{role}__{dev}.png", optimize=True)
        n += 1
    return n


def axe_summary(label):
    rows = jsonl("axe")
    agg = defaultdict(lambda: {"impact": "", "help": "", "nodes": 0, "routes": set(), "viewports": set(), "sample": ""})
    for r in rows:
        a = agg[r["id"]]
        a["impact"], a["help"] = r["impact"], r["help"]
        a["nodes"] += r["nodes"]
        a["routes"].add(r["route"])
        a["viewports"].add(r["viewport"])
        a["sample"] = a["sample"] or "; ".join(r["sample"])
    out = [{"rule": k, "impact": v["impact"], "help": v["help"], "nodes": v["nodes"], "routes": len(v["routes"]),
            "viewports": ",".join(sorted(v["viewports"])), "route_list": " ".join(sorted(v["routes"])), "sample": v["sample"][:300]}
           for k, v in sorted(agg.items(), key=lambda kv: -kv[1]["nodes"])]
    (QA / "results" / f"axe-summary-{label}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    return out


def main():
    label, sha = sys.argv[1], sys.argv[2]
    tests = tests_csv(label)
    matrix = matrix_csv(label)
    shots, by = screenshots(sha)
    sheets = contact_sheets(sha, by)
    axe = axe_summary(label)
    summary = {
        "label": label, "sha": sha,
        "tests": dict(Counter(r["status"] for r in tests)),
        "tests_by_project": {p: dict(Counter(r["status"] for r in tests if r["project"] == p)) for p in sorted({r["project"] for r in tests})},
        "matrix_rows": len(matrix), "matrix": dict(Counter(r.get("result") for r in matrix)),
        "screenshots": len(shots), "contact_sheets": sheets,
        "axe_rules_violated": len(axe), "axe_nodes": sum(a["nodes"] for a in axe),
        "failed_cases": sorted({f"{r['case_id']} [{r['project']}]" for r in tests if r["status"] == "FAIL"}),
        "matrix_failures": [f"{r['persona']} {r['route']} {r['viewport']}: exp {r['expected']} obs {r['observed']} menu {r.get('menu')} overflow {r.get('overflow_px')}" for r in matrix if r.get("result") == "FAIL"],
    }
    (RES / f"summary-{label}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1))
    print(json.dumps({k: v for k, v in summary.items() if k not in ("failed_cases", "matrix_failures")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
