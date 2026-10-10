#!/usr/bin/env python3
"""Prepare and publish a verified, versioned metadata release to PRIVATE R2."""
import argparse, hashlib, json, re, shutil, subprocess
from pathlib import Path

HERE=Path(__file__).resolve().parent
def run(args,stdin=None):
    p=subprocess.run(args,input=stdin,text=True,capture_output=True)
    if p.returncode: raise RuntimeError((p.stderr or p.stdout)[-400:])
    return p.stdout
def main():
    a=argparse.ArgumentParser()
    a.add_argument("release",type=Path,help="Sanitised JSON, never a supplier playlist")
    a.add_argument("--out",type=Path,default=Path.cwd()/"lounge-v1-release")
    a.add_argument("--publish",action="store_true")
    a.add_argument("--confirm-authorised",action="store_true")
    a.add_argument("--remote",default="",help="Private R2, e.g. s3:loungetv-content")
    args=a.parse_args()
    source=args.release.read_text(encoding="utf8")
    validator="import {validateRelease} from "+json.dumps((HERE/"validate.mjs").as_uri())+";"+"let s='';for await(const x of process.stdin)s+=x;try{console.log(JSON.stringify(validateRelease(JSON.parse(s))));}catch(e){console.error(e.message);process.exit(1);}"
    stats=json.loads(run(["node","--input-type=module","-e",validator],source))
    data=json.loads(source)
    revision=data["revision"]
    folder=args.out/"releases"/revision
    if folder.exists():raise RuntimeError("Revision folder already exists; use new revision")
    folder.mkdir(parents=True)
    docs={
      "manifest.json":{"schema":1,"revision":revision,"generated_at":data["generated_at"],"counts":stats},
      "live.json":data["live"],"vod.json":data["vod"],"epg.json":data["epg"]
    }
    for name,record in docs.items():
        (folder/name).write_text(json.dumps(record,separators=(",",":"),ensure_ascii=False)+"\n")
    pointer=args.out/"current.json"
    pointer.write_text(json.dumps({"schema":1,"revision":revision})+"\n")
    print("PASS: sanitised release",stats)
    if not args.publish:
        print("DRY RUN: No remote changes made")
        return
    if not args.confirm_authorised:raise RuntimeError("Explicit --confirm-authorised required")
    if not re.fullmatch(r"[A-Za-z0-9_-]+:[A-Za-z0-9._-]+",args.remote):raise RuntimeError("Specify private bucket remote")
    if "artwork" in args.remote.lower():raise RuntimeError("Never use public artwork bucket")
    if not shutil.which("rclone"):raise RuntimeError("rclone missing")
    root=args.remote+"/shared/v1"
    for name in docs:
        remote=root+"/releases/"+revision+"/"+name
        run(["rclone","copyto",str(folder/name),remote,"--no-traverse"])
        actual=run(["rclone","cat",remote])
        if hashlib.sha256(actual.encode()).digest()!=hashlib.sha256((folder/name).read_bytes()).digest():
            raise RuntimeError("Upload mismatch; pointer unchanged: "+name)
    run(["rclone","copyto",str(pointer),root+"/current.json","--no-traverse"])
    print("PUBLISHED: "+revision+" (prior releases kept)")
if __name__=="__main__":
    try:main()
    except (RuntimeError,OSError,ValueError) as exc:raise SystemExit("STOP: "+str(exc))
