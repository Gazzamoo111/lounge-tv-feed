"""Regression checks for resumable VOD-only R2 publication."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from botocore.exceptions import ClientError

SPEC = importlib.util.spec_from_file_location("vod_refresh", Path(__file__).resolve().parents[1] / "vod" / "refresh.py")
vod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vod)


def err(code, status):
    return ClientError({"Error": {"Code": code, "Message": "secret example"},
                        "ResponseMetadata": {"HTTPStatusCode": status}}, "test")


class FakeR2:
    def __init__(self):
        self.data = {"current.json": b"live", "vod/approved.json": b"seed"}
        self.writes = []
        self.fail = None
    def get_object(self, Bucket, Key):
        if Key not in self.data:
            raise err("NoSuchKey", 404)
        body = self.data[Key]
        return {"Body": io.BytesIO(body), "ETag": hashlib.md5(body).hexdigest()}
    def put_object(self, Bucket, Key, Body, **kwargs):
        if self.fail and self.fail(Key):
            raise err("AccessDenied", 403)
        if kwargs.get("IfNoneMatch") == "*" and Key in self.data:
            raise err("PreconditionFailed", 412)
        if "IfMatch" in kwargs and self.get_object(Bucket, Key)["ETag"] != kwargs["IfMatch"]:
            raise err("PreconditionFailed", 412)
        self.data[Key] = Body
        self.writes.append(Key)
    def get_paginator(self, operation):
        return self
    def paginate(self, Bucket, Prefix):
        return [{"Contents": [{"Key": k, "Size": len(v)} for k, v in self.data.items() if k.startswith(Prefix)]}]


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "one.json").write_bytes(b"one")
        (self.root / "two.json").write_bytes(b"two")
        self.s3 = FakeR2()
    def publish(self):
        vod.publish(self.s3, "bucket", self.root, vod.read(self.s3, "bucket", vod.POINTER), bootstrap=True)
    def test_resume_after_pointer_failure(self):
        self.s3.fail = lambda key: key == vod.POINTER
        with self.assertRaisesRegex(RuntimeError, "PutObject VOD pointer: HTTP 403"):
            self.publish()
        self.assertNotIn(vod.POINTER, self.s3.data)
        before = list(self.s3.writes)
        self.s3.fail = None
        self.publish()
        self.assertEqual(self.s3.writes[len(before):], [vod.POINTER])
        self.assertEqual(self.s3.data["current.json"], b"live")
        before = list(self.s3.writes)
        self.publish()
        self.assertEqual(self.s3.writes, before)
    def test_conflicting_immutable_is_not_overwritten(self):
        self.publish()
        self.s3.data.pop(vod.POINTER)
        key = next(k for k in self.s3.data if k.endswith("/one.json"))
        self.s3.data[key] = b"bad"
        with self.assertRaisesRegex(RuntimeError, "readback mismatch"):
            self.publish()
        self.assertEqual(self.s3.data[key], b"bad")
        self.assertNotIn(vod.POINTER, self.s3.data)
    def test_different_active_pointer_untouched(self):
        self.s3.data[vod.POINTER] = b'{"release":"vother"}'
        with self.assertRaisesRegex(RuntimeError, "different active"):
            self.publish()
        self.assertEqual(self.s3.writes, [])
    def test_conditional_conflict_accepts_identical_only(self):
        self.s3.data["vod/example"] = b"same"
        vod.immutable(self.s3, "bucket", "vod/example", b"same", False)
        with self.assertRaisesRegex(RuntimeError, "readback mismatch"):
            vod.immutable(self.s3, "bucket", "vod/example", b"different", False)
    def test_safe_error(self):
        self.assertNotIn("secret example", str(vod.r2_failure("GetObject", err("AccessDenied", 403))))
