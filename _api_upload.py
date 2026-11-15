# -*- coding: utf-8 -*-
"""通过 GitHub Contents API 上传项目文件（git 主站被墙时的兜底通道）"""
import base64, json, os, subprocess, sys, urllib.request

REPO = "hww26/forest-cabin-3d"
ROOT = r"C:\Users\胡维维\WorkBuddy\2026-11-14-22-30-22\forest-cabin"

def get_token():
    out = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True, text=True
    ).stdout
    for line in out.splitlines():
        if line.startswith("password="):
            return line.split("=", 1)[1]
    raise RuntimeError("无法获取 GitHub 凭据")

TOKEN = get_token()
api_root = "https://api.github.com"

def api(path, method="GET", payload=None):
    url = api_root + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "token " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode()
            return r.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

# 收集文件（排除 .git）
files = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d != ".git"]
    for fn in filenames:
        full = os.path.join(dirpath, fn)
        rel = os.path.relpath(full, ROOT).replace("\\", "/")
        files.append((rel, full))

ok, fail = [], []
for rel, full in files:
    size = os.path.getsize(full)
    if size > 1024 * 1024:
        fail.append((rel, "too large: %d bytes" % size))
        continue
    with open(full, "rb") as f:
        content = base64.b64encode(f.read()).decode()
    status, resp = api("/repos/%s/contents/%s" % (REPO, rel), "PUT", {
        "message": "upload " + rel,
        "content": content,
    })
    if status in (200, 201):
        ok.append(rel)
        print("OK  %-28s (%d B)" % (rel, size))
    else:
        fail.append((rel, resp.get("message", "HTTP %d" % status)))
        print("ERR %-28s %s" % (rel, resp.get("message", status)))

print("\n成功 %d / 失败 %d" % (len(ok), len(fail)))
if fail:
    for rel, why in fail:
        print("  失败:", rel, "->", why)
    sys.exit(1)
