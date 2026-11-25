"""Guarded provisioning release; no database or catalogue writes."""
import json
import os
import time
import urllib.error
import urllib.request

WORKER = "loungetv-xtream-production"
BASE = os.environ.get("LTV_TRIAL_BASE", "8a90126d-709e-4f18-bd6c-1b631ac05bc4")
CANDIDATE = os.environ.get("LTV_TRIAL_CANDIDATE", "")
ORIGIN = "https://tv.loungetv.nz"
EXPECTED_FLAGS = {}

def cf(path, data=None):
    url = f"https://api.cloudflare.com/client/v4/accounts/{os.environ['CLOUDFLARE_ACCOUNT_ID']}/workers/scripts/{WORKER}/{path}"
    request = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
        headers={"Authorization": f"Bearer {os.environ['CLOUDFLARE_API_TOKEN']}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"Cloudflare {path.split('/')[0]} HTTP {exc.code}") from None
    except urllib.error.URLError:
        raise RuntimeError("Cloudflare API unavailable") from None
    if not result.get("success"):
        raise RuntimeError("Cloudflare API rejected the operation")
    return result["result"]

def current():
    rows = cf("deployments")["deployments"][0]["versions"]
    return {r["version_id"]: r["percentage"] for r in rows}

def bindings(version):
    resources = cf("versions/" + version)["resources"]
    result = {r["name"]: r for r in resources["bindings"]}
    # Secret contents are never printed or persisted.
    return result, resources.get("script_runtime", {})

def verify_candidate():
    old, old_runtime = bindings(BASE)
    new, new_runtime = bindings(CANDIDATE)
    for name, value in EXPECTED_FLAGS.items():
        entry = new.pop(name, None)
        if not entry or entry.get("type") != "plain_text" or entry.get("text") != value:
            raise RuntimeError("Candidate VOD flag mismatch: " + name)
        old.pop(name, None)
    if set(old) != set(new):
        raise RuntimeError("Existing Worker binding names differ")
    for name in old:
        if old[name] != new[name]:
            raise RuntimeError("Existing Worker binding metadata differs")
    if old_runtime != new_runtime:
        raise RuntimeError("Worker runtime configuration differs")
    for name in ("DB", "ASSETS", "AUTH_PEPPER", "PROVIDER_AES_KEY_BASE64"):
        if name not in new:
            raise RuntimeError("Required protected binding missing")
    print("Verified existing bindings and runtime; no existing binding or runtime changes", flush=True)

def probe(path):
    request = urllib.request.Request(ORIGIN + path, headers={"User-Agent": "LoungeTV-release-check", "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            return response.status, json.loads(response.read(8192))
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read(8192))

def smoke(vod=False):
    code, body = probe("/health")
    if code != 200 or body.get("status") != "ok" or body.get("service") != "lounge-tv-xtream-standalone":
        raise RuntimeError("Health check failed")
    query = "?username=release_invalid_probe&password=release_invalid_probe"
    for action in ("get_live_categories", "get_live_streams", "get_short_epg",
                   "get_vod_categories", "get_vod_streams", "get_vod_info",
                   "get_series_categories", "get_series", "get_series_info"):
        code, body = probe("/player_api.php" + query + "&action=" + action)
        if code != 200 or body.get("user_info", {}).get("auth") != 0:
            raise RuntimeError("Authentication rejection failed")
    for path in ("/get.php" + query, "/xmltv.php" + query, "/live/release_invalid_probe/release_invalid_probe/1.ts"):
        if probe(path)[0] != 401:
            raise RuntimeError("Protected existing route check failed")
    if vod:
        for kind in ("movie", "series"):
            if probe(f"/{kind}/release_invalid_probe/release_invalid_probe/1.mp4")[0] != 401:
                raise RuntimeError("VOD playback authentication rejection failed")
    print("Public health and unauthorised-route checks passed", flush=True)

def deploy(version, message):
    cf("deployments", {"strategy": "percentage", "versions": [{"version_id": version, "percentage": 100}],
                       "annotations": {"workers/message": message}})
    if current() != {version: 100}:
        raise RuntimeError("Deployment readback mismatch")

def check_operator():
    url=ORIGIN+"/operator/provision"
    with urllib.request.urlopen(url, timeout=12) as r:
        if r.status!=200 or b"Register a customer" not in r.read(16000) or r.headers.get("Cache-Control")!="no-store":
            raise RuntimeError("Operator form response invalid")
    req=urllib.request.Request(url, data=b"{}",headers={"Content-Type":"application/json","Origin":ORIGIN,"Authorization":"Bearer invalid-probe"})
    try:
        with urllib.request.urlopen(req,timeout=12): pass
    except urllib.error.HTTPError as exc:
        if exc.code==401:
            print("Operator form available; unauthorised registration denied",flush=True)
            return
    raise RuntimeError("Operator authentication boundary failed")

def main():
    if not CANDIDATE or current()!={BASE:100}: raise RuntimeError("Active baseline changed")
    verify_candidate()
    smoke()
    try:
        deploy(CANDIDATE,"Owner-authorised locked customer provisioning interface")
        for attempt in range(3):
            try:
                time.sleep(8); smoke(); check_operator(); break
            except Exception:
                if attempt==2: raise
        print("PROVISIONING FORM ACTIVE; OPERATOR SECRET NOT YET CONFIGURED: "+CANDIDATE,flush=True)
    except Exception:
        if current()=={CANDIDATE:100}:
            deploy(BASE,"Rollback failed provisioning interface release")
            smoke()
            print("ROLLBACK VERIFIED: "+BASE,flush=True)
        raise

if __name__=="__main__":
    try: main()
    except Exception as exc: raise SystemExit(str(exc) if type(exc) is RuntimeError else type(exc).__name__) from None
