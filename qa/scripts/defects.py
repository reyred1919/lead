#!/usr/bin/env python3
"""Renders qa/defects.md and qa/defects.csv from qa/defects-data.json (single source of truth)."""
import csv
import json
from collections import Counter
from pathlib import Path

QA = Path(__file__).resolve().parents[1]
items = json.loads((QA / "defects-data.json").read_text())
fields = ["id", "severity", "priority", "category", "scenario", "env", "steps", "expected", "actual",
          "evidence", "code", "root_cause", "fix", "retest"]
with (QA / "defects.csv").open("w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    for d in items:
        w.writerow({k: d.get(k, "") for k in fields})

sev = Counter(d["severity"] for d in items)
out = ["# Defect register", "",
       f"Total: {len(items)} — " + ", ".join(f"{s}: {sev.get(s, 0)}" for s in ("P0", "P1", "P2", "P3")) + " (IDs QA-D-13..15 unused)", "",
       "| ID | Sev | Category | Summary | Fix | Retest |", "|---|---|---|---|---|---|"]
for d in items:
    out.append(f"| {d['id']} | {d['severity']} | {d['category']} | {d['actual']} | {d['fix']} | {d['retest']} |")
for d in items:
    out += ["", f"## {d['id']} — {d['category']} ({d['severity']}, priority {d['priority']})", ""]
    for k in fields[4:]:
        out.append(f"- **{k.replace('_', ' ').title()}:** {d.get(k, '')}")
(QA / "defects.md").write_text("\n".join(out) + "\n", encoding="utf-8")
print(dict(sev))
