"""Check every relative Markdown link / <img src> in the pack resolves to an existing file (and anchors to an existing heading)."""
import os, re, sys, unicodedata
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
repo = os.path.dirname(os.path.dirname(root))
def slug(h):
    h = h.strip().lower()
    h = "".join(c for c in h if c in " -_" or unicodedata.category(c)[0] in "LNM")
    return h.replace(" ", "-")
bad = total = 0
for dp, _, fs in os.walk(root):
    for f in fs:
        if not f.endswith(".md"): continue
        p = os.path.join(dp, f); s = open(p, encoding="utf-8").read()
        s_nocode = re.sub(r"```.*?```", "", s, flags=re.S)
        for m in re.finditer(r"\]\(([^)\s]+)\)|<img src=\"([^\"]+)\"", s_nocode):
            t = m.group(1) or m.group(2)
            if re.match(r"[a-z]+:", t): continue
            total += 1
            path, _, anchor = t.partition("#")
            tgt = os.path.normpath(os.path.join(dp, path)) if path else p
            if not os.path.exists(tgt):
                bad += 1; print("MISSING", os.path.relpath(p, root), t); continue
            if anchor and tgt.endswith(".md"):
                heads = {slug(h) for h in re.findall(r"^#+\s+(.*)$", open(tgt, encoding="utf-8").read(), re.M)}
                if anchor not in heads: bad += 1; print("ANCHOR", os.path.relpath(p, root), t)
# manifest outputs exist
import yaml
m = yaml.safe_load(open(os.path.join(root, "manifest.yaml"), encoding="utf-8"))
for i in m["screenshots"]:
    total += 1
    if not os.path.exists(os.path.join(root, i["output"])): bad += 1; print("MANIFEST MISSING", i["output"])
    src = i["source_path"]
    if src.startswith("qa/") and "نگهداری نشده" not in src:
        total += 1
        if not os.path.exists(os.path.join(repo, src.split()[0])): bad += 1; print("SOURCE MISSING", src)
on_disk = {os.path.relpath(os.path.join(dp, f), root) for dp, _, fs in os.walk(os.path.join(root, "screenshots")) for f in fs}
listed = {i["output"] for i in m["screenshots"]}
for x in on_disk ^ listed: bad += 1; print("UNLISTED/EXTRA", x)
print(f"links+files checked: {total}, problems: {bad}")
sys.exit(1 if bad else 0)
