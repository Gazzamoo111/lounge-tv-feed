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
from botocore.config import Config
from botocore.exceptions import ClientError

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
                        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto",
                        config=Config(max_pool_connections=12, retries={"mode": "standard", "total_max_attempts": 6},
                                      request_checksum_calculation="when_required", response_checksum_validation="when_required",
                                      connect_timeout=10, read_timeout=60))


def error_status(exc):
    return exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")


def r2_failure(operation, exc):
    # Never emit response bodies, object contents, request URLs or headers.
    code = exc.response.get("Error", {}).get("Code", "")
    safe_codes = {"AccessDenied", "NoSuchKey", "NoSuchBucket", "PreconditionFailed",
                  "SlowDown", "TooManyRequests", "InternalError", "ServiceUnavailable",
                  "InvalidRequest", "InvalidArgument", "SignatureDoesNotMatch",
                  "BadDigest", "RequestTimeout", "OperationAborted", "ObjectLockedByBucketPolicy"}
    status = error_status(exc)
    return RuntimeError(f"R2 {operation}: HTTP {status if isinstance(status, int) else 'unknown'} "
                        f"({code if code in safe_codes else 'other'})")


def read(s3, bucket, key):
    try:
        return s3.get_object(Bucket=bucket, Key=key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "NoSuchKey":
            return None
        raise r2_failure("GetObject", exc) from None


def read_bytes(s3, bucket, key):
    obj = read(s3, bucket, key)
    if obj is None:
        return None
    try:
        return obj["Body"].read()
    finally:
        obj["Body"].close()


def immutable(s3, bucket, key, body, known):
    if not known:
        try:
            s3.put_object(Bucket=bucket, Key=key, Body=body, IfNoneMatch="*")
        except ClientError as exc:
            # A previous attempt or a lost successful response can leave the object.
            if error_status(exc) != 412:
                raise r2_failure("PutObject immutable", exc) from None
    actual = read_bytes(s3, bucket, key)
    if actual is None or hashlib.sha256(actual).digest() != hashlib.sha256(body).digest():
        raise RuntimeError("VOD immutable object readback mismatch")


def publish(s3, bucket, output, active, bootstrap=False):
    manifest = {}
    for file in sorted(output.rglob("*")):
        if file.is_file():
            with file.open("rb") as stream:
                manifest[file.relative_to(output).as_posix()] = hashlib.file_digest(stream, "sha256").hexdigest()
    raw = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    release = "v" + hashlib.sha256(raw).hexdigest()[:24]
    previous = None
    if active:
        try:
            previous = json.load(active["Body"])["release"]
        finally:
            active["Body"].close()
    if bootstrap and previous and previous != release:
        raise RuntimeError("Bootstrap refuses to replace a different active VOD release")
    prefix = f"{PREFIX}releases/{release}/"
    try:
        objects = {
            item["Key"]: item["Size"]
            for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX)
            for item in page.get("Contents", [])
        }
    except ClientError as exc:
        raise r2_failure("ListObjectsV2", exc) from None
    missing = [key for key in manifest if prefix + key not in objects]
    bytes_to_add = sum((output / key).stat().st_size for key in missing)
    bytes_to_add += len(raw) if prefix + "manifest.json" not in objects else 0
    print(f"VOD release {release}: {len(manifest)} objects, {len(missing)} missing, "
          f"{sum(objects.values())} existing bytes, {bytes_to_add} additional bytes", flush=True)
    if sum(objects.values()) + bytes_to_add + 512 > VOD_BUDGET:
        raise RuntimeError("VOD storage budget exhausted. Keep active and rollback releases.")
    def verify(key):
        body = (output / key).read_bytes()
        if hashlib.sha256(body).hexdigest() != manifest[key]:
            raise RuntimeError("Local VOD object changed during publication")
        immutable(s3, bucket, prefix + key, body, prefix + key in objects)
    # Bounded concurrency; never overwrite existing immutable objects.
    with ThreadPoolExecutor(max_workers=8) as pool:
        for index, _ in enumerate(pool.map(verify, manifest), 1):
            if index % 250 == 0 or index == len(manifest):
                print(f"Verified {index}/{len(manifest)} VOD objects", flush=True)
    immutable(s3, bucket, prefix + "manifest.json", raw, prefix + "manifest.json" in objects)
    if previous == release:
        print(f"Verified existing VOD release {release}; pointer unchanged", flush=True)
        return
    condition = {"IfMatch": active["ETag"]} if active else {"IfNoneMatch": "*"}
    try:
        s3.put_object(Bucket=bucket, Key=POINTER, ContentType="application/json", CacheControl="no-store",
                      Body=json.dumps({"release": release, "previous_release": previous}).encode(), **condition)
    except ClientError as exc:
        if error_status(exc) != 412:
            raise r2_failure("PutObject VOD pointer", exc) from None
    current = read_bytes(s3, bucket, POINTER)
    if not current or json.loads(current) != {"release": release, "previous_release": previous}:
        raise RuntimeError("VOD pointer readback check failed; refusing to overwrite")
    print(f"VOD release {release}, rollback {previous or 'disabled'}", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bootstrap", action="store_true", help="Build the existing approved snapshot without refreshing it")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    s3 = storage()
    bucket = os.environ["LTV_VOD_BUCKET"]
    active = read(s3, bucket, POINTER)
    approved = read(s3, bucket, SEED)
    if not approved:
        raise RuntimeError("Approved private VOD snapshot has not been staged")
    try:
        seed = json.load(approved["Body"])
    finally:
        approved["Body"].close()
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
        print(completed.stdout.strip(), flush=True)
        if args.publish:
            publish(s3, bucket, out, active, bootstrap=args.bootstrap)


if __name__ == "__main__":
    try:
        main()
    except ClientError as error:
        raise SystemExit(str(r2_failure("request", error))) from None
    except Exception as error:
        # Third-party exception bodies can contain private URLs and credentials.
        message = str(error) if type(error) is RuntimeError else type(error).__name__
        raise SystemExit(message) from None
