#!/usr/bin/env python3
"""Minimal raw-REST Daytona orchestration helper (no SDK install needed).

Drives https://app.daytona.io/api directly. Reads the API key from, in order:
  1. env var DAYTONA_API_KEY
  2. env/.env.local next to the repo root (searched upward from CWD)
  3. ./env/.env.local

Subcommands:
  list                         list all sandboxes (raw JSON)
  info   <sid>                 one sandbox's JSON
  create [k=v ...]             create a sandbox; extra args merged into the POST body
                               (values are JSON-parsed, e.g. autoStopInterval=0)
  exec   <sid> <cmd> [cwd]     run a shell command inside the sandbox (600s cap)
  preview <sid> <port>         get the public preview URL for a port
  delete <sid>                 force-delete a sandbox
  raw    <METHOD> <path> [json-body]   escape hatch to any API route

Sandbox facts (as of this skill): org runs target "us", sandboxClass "container",
base snapshot daytonaio/sandbox:0.8.0, sandbox user "daytona", HOME=/home/daytona
(writable; /root is NOT — you are not root), autoStopInterval defaults to 15 min.
Toolchain in the base image: node 25, npm 11, python 3.14, git 2.53, chromium at
/usr/bin/chromium (playwright browsers are installable from inside the sandbox).
"""
import json, os, sys, urllib.request, urllib.error
from pathlib import Path

BASE = "https://app.daytona.io/api"


def _key():
    k = os.environ.get("DAYTONA_API_KEY")
    if k:
        return k.strip()
    candidates = []
    here = Path.cwd()
    for d in [here, *here.parents]:
        candidates.append(d / "env" / ".env.local")
    candidates.append(Path("env/.env.local"))
    for p in candidates:
        try:
            for line in p.read_text().splitlines():
                if line.startswith("DAYTONA_API_KEY="):
                    return line.split("=", 1)[1].strip()
        except OSError:
            continue
    sys.exit("no DAYTONA_API_KEY (set env var or env/.env.local)")


KEY = _key()


def call(method, path, body=None, query="", timeout=120):
    url = BASE + path + query
    data = None
    headers = {"Authorization": f"Bearer {KEY}"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return -1, f"{type(e).__name__}: {e}"


def j(txt):
    try:
        return json.loads(txt)
    except Exception:
        return None


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit("usage: daytona_ctl.py <subcommand> ...")
    cmd = args[0]
    if cmd == "list":
        s, t = call("GET", "/sandbox")
        print(s); print(t)
    elif cmd == "info":
        s, t = call("GET", f"/sandbox/{args[1]}")
        print(s); print(t)
    elif cmd == "create":
        body = {}
        for a in args[1:]:
            k, v = a.split("=", 1)
            try:
                v = json.loads(v)
            except Exception:
                pass
            body[k] = v
        s, t = call("POST", "/sandbox", body)
        print(s); print(t)
    elif cmd == "exec":
        sid = args[1]; command = args[2]
        cwd = args[3] if len(args) > 3 else None
        payload = {"command": command, "timeout": 600}
        if cwd:
            payload["cwd"] = cwd
        s, t = call("POST", f"/toolbox/{sid}/toolbox/process/execute", payload, timeout=620)
        print("HTTP", s)
        o = j(t)
        if isinstance(o, dict):
            print("exitCode:", o.get("exitCode"))
            print("--- result ---")
            print(o.get("result", ""))
        else:
            print(t)
    elif cmd == "preview":
        sid = args[1]; port = args[2]
        s, t = call("GET", f"/sandbox/{sid}/ports/{port}/preview-url")
        print(s); print(t)
    elif cmd == "delete":
        s, t = call("DELETE", f"/sandbox/{args[1]}", query="?force=true")
        print(s); print(t)
    elif cmd == "raw":
        method = args[1]; path = args[2]
        body = json.loads(args[3]) if len(args) > 3 else None
        s, t = call(method, path, body)
        print(s); print(t)
    else:
        sys.exit(f"unknown cmd {cmd}")


if __name__ == "__main__":
    main()
