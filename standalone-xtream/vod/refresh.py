"""Build and publish a VOD-only release using the existing private R2 bucket."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, build_opener

import boto3

ROOT = Path(__file__).resolve().parent
PREFIX = "vod/"
SEED = PREFIX + "approved.json"
POINTER = PREFIX + "current.json"
VOD_BUDGET = 250 * 1024**2
MAX_SUPPLIER_BYTES = 30 * 1024**2


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def inventory(action, id_field):
    origin = os.environ["LTV_VOD_SUPPLIER_ORIGIN"].rstrip("/")
    url = urlsplit(origin)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.path or url.query or url.fragment:
        raise RuntimeError("VOD inventory requires the authorised HTTPS supplier origin")
    params = urlencode({
        "username": os.environ["LTV_VOD_SUPPLIER_USERNAME"],
        "password": os.environ["LTV_VOD_SUPPLIER_PASSWORD"],
        "action": action,
    })
    try:
        with build_opener(NoRedirect()).open(f"{origin}/player_api.php?{params}", timeout=45) as response:
            raw = response.read(MAX_SUPPLIER_BYTES + 1)
    except HTTPError as exc:
        raise RuntimeError(f"Supplier {action} returned HTTP {exc.code}") from None
    except (URLError, TimeoutError):
        raise RuntimeError(f"Supplier {action} unavailable") from None
    if len(raw) > MAX_SUPPLIER_BYTES:
        raise RuntimeError(f"Supplier {action} exceeded the inventory size limit")
    try:
        values = json.loads(raw)
        if not isinstance(values, list):
            raise ValueError
        ids = {int(row[id_field]) for row in values}
    except (ValueError, TypeError, KeyError, OverflowError):
        raise RuntimeError(f"Supplier {action} returned an invalid inventory") from None
    if not ids or min(ids) < 1:
        raise RuntimeError(f"Supplier {action} returned no usable inventory")
    return ids


def with_inventory(seed):
    with ThreadPoolExecutor(max_workers=2) as pool:
        movies = pool.submit(inventory, "get_vod_streams", "stream_id")
        series = pool.submit(inventory, "get_series", "series_id")
        current = {"movies": movies.result(), "series": series.result()}
    result = {}
    for kind, ids in current.items():
        original = seed[kind]
        retained = [row for row in original if int(row["provider_item_id"]) in ids
                    and int(row["inventory_provider_item_id"]) in ids]
        if not original or len(retained) * 100 < len(original) * 98:
            raise RuntimeError(f"Supplier {kind} inventory lost more than 2% of approved items")
        result[kind] = retained
    parents = {row["external_id"] for row in result["series"]}
    result["episodes"] = [row for row in seed["episodes"] if row["series_external_id"] in parents]
    return result


def storage():
    return boto3.client("s3", endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")


def read(s3, bucket, key):
    try:
        return s3.get_object(Bucket=bucket, Key=key)
    except s3.exceptions.NoSuchKey:
        return None


def publish(s3, bucket, output, active):
    manifest = {}
    for file in sorted(output.rglob("*")):
        if file.is_file():
            with file.open("rb") as stream:
                manifest[file.relative_to(output).as_posix()] = hashlib.file_digest(stream, "sha256").hexdigest()
    raw = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    release = "v" + hashlib.sha256(raw).hexdigest()[:24]
    previous = json.load(active["Body"])["release"] if active else None
    if release == previous:
        print(f"Unchanged VOD release {release}")
        return
    prefix = f"{PREFIX}releases/{release}/"
    objects = {
        item["Key"]: item["Size"]
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX)
        for item in page.get("Contents", [])
    }
    bytes_to_add = sum((output / key).stat().st_size for key in manifest if prefix + key not in objects)
    if sum(objects.values()) + bytes_to_add + len(raw) + 512 > VOD_BUDGET:
        raise RuntimeError("VOD storage budget exhausted. Keep the active and rollback releases and archive older VOD versions.")
    for key, sha in manifest.items():
        body = (output / key).read_bytes()
        stored = read(s3, bucket, prefix + key)
        if not stored:
            s3.put_object(Bucket=bucket, Key=prefix + key, Body=body, IfNoneMatch="*")
            stored = read(s3, bucket, prefix + key)
        if not stored or hashlib.sha256(stored["Body"].read()).hexdigest() != sha:
            raise RuntimeError("VOD release readback check failed")
    if prefix + "manifest.json" not in objects:
        s3.put_object(Bucket=bucket, Key=prefix + "manifest.json", Body=raw, IfNoneMatch="*")
    condition = {"IfMatch": active["ETag"]} if active else {"IfNoneMatch": "*"}
    s3.put_object(Bucket=bucket, Key=POINTER, ContentType="application/json", CacheControl="no-store",
                  Body=json.dumps({"release": release, "previous_release": previous}).encode(), **condition)
    current = read(s3, bucket, POINTER)
    if not current or json.load(current["Body"])["release"] != release:
        raise RuntimeError("VOD pointer readback check failed")
    print(f"VOD release {release}, rollback {previous or 'disabled'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bootstrap", action="store_true", help="Build the existing approved snapshot without refreshing it")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    s3 = storage()
    bucket = os.environ["LTV_VOD_BUCKET"]
    active = read(s3, bucket, POINTER)
    if args.bootstrap and args.publish and active:
        raise RuntimeError("Bootstrap publication requires an empty VOD pointer")
    approved = read(s3, bucket, SEED)
    if not approved:
        raise RuntimeError("Approved private VOD snapshot has not been staged")
    seed = json.load(approved["Body"])
    snapshot = seed if args.bootstrap else with_inventory(seed)
    with tempfile.TemporaryDirectory() as temp:
        root = Path(temp)
        source = root / "snapshot.json"
        source.write_text(json.dumps(snapshot), encoding="utf-8")
        out = root / "release"
        completed = subprocess.run(["node", str(ROOT / "build.mjs"), str(source), str(out)],
                                   capture_output=True, text=True, check=False)
        if completed.returncode:
            raise RuntimeError("Approved VOD catalogue validation failed")
        print(completed.stdout.strip())
        if args.publish:
            publish(s3, bucket, out, active)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Third-party exception bodies can contain private URLs and credentials.
        message = str(error) if type(error) is RuntimeError else type(error).__name__
        raise SystemExit(message) from None
