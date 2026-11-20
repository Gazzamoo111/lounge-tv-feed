"""Add the shared XMLTV opt-in to verified gateway and renderer bundles."""
import hashlib
import sys
from pathlib import Path


SCOPE = "shared-nz-au-plus"
GATEWAY_PINS = {
    "n": "1449d4a2181c5abadaa97175cb998526bfb1d1862c084870992ab72b7f91d7bf",
    "lounge-plus-qa": "75bc6e3d872ea10b931dfee5b334a6412b25be0ce34d4fe2dfc701787289a294",
}
RENDERER_PIN = "8c037fb060473eaffaa09c985fdd2dc13e0d45ac8ecc1ddaa17fe16c0d8bef1b"


def replace_once(path, digest, old, new):
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest or data.count(old) != 1:
        raise ValueError(f"Unexpected source revision for {path.parent.name}")
    return path, data.replace(old, new, 1)


def scope(bundles):
    changes = [
        replace_once(
            bundles / slug / "index.ts", digest,
            b"async function xmltv(){\n  try{\n    const r=await fetch(LIVE_XMLTV_URL,",
            ('async function xmltv(){\n  try{\n    const r=await fetch(LIVE_XMLTV_URL+"?scope='
             + SCOPE + '",').encode(),
        )
        for slug, digest in GATEWAY_PINS.items()
    ]
    changes.append(replace_once(
        bundles / "lounge-core-live-xmltv" / "index.ts", RENDERER_PIN,
        b"    const bulk=await publishedBulkGuide(req.method);",
        ('    const bulk=new URL(req.url).searchParams.get("scope")==="' + SCOPE
         + '"?await publishedBulkGuide(req.method):null;').encode(),
    ))
    for path, data in changes:
        path.write_bytes(data)
        print(f"{path.parent.name}/index.ts SHA-256 {hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    scope(Path(sys.argv[1]))
