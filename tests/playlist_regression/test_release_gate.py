import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from playlist_release import blockers, canonical, digest, plan, source_policy


class ReleaseGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.policy, _ = source_policy()
        cls.manifest = plan("nz-au", cls.policy["source_baseline"])
        cls.receipt = {"result": "pass", "observed_at": "2026-11-20T08:45:00+13:00",
                       "private_evidence_sha256": "a" * 64}

    def setUp(self):
        self.evidence = {
            "schema": 1, "manifest_sha256": digest(canonical(self.manifest)),
            "staging": {"project": "a" * 20,
                        "function_slugs": {"nz-au": "n", "plus": "lounge-plus-qa"}},
            "stage_approval": {"owner": "Gazzamoo111", "issue_comment_id": 1,
                               "approved_at": "2026-11-20T08:00:00+13:00"},
            "promotion_approval": {"owner": "Gazzamoo111", "issue_comment_id": 2,
                                   "approved_at": "2026-11-20T09:00:00+13:00"},
            "authenticated": {profile: self.receipt.copy() for profile in self.manifest["profiles"]},
            "device": {profile: self.receipt.copy() for profile in self.manifest["profiles"]},
            "rollback": {"mode": "isolated-runtime", "evidence": self.receipt.copy()},
            "runtime": self.receipt.copy(),
        }

    def blocked(self, action="promote"):
        return blockers(self.manifest, self.evidence, action, self.policy)

    def test_complete_records_are_structurally_accepted(self):
        self.assertEqual(self.blocked(), [])

    def test_stage_requires_authorization_and_isolation(self):
        self.assertEqual(self.blocked("stage"), [])
        self.evidence["staging"]["project"] = self.policy["project"]
        self.evidence["stage_approval"] = None
        self.assertEqual(len(self.blocked("stage")), 2)

    def test_rollback_must_run_in_isolated_runtime(self):
        self.evidence["rollback"]["mode"] = "offline"
        self.assertIn("A passing isolated-runtime rollback receipt is required", self.blocked())

    def test_missing_device_and_failed_authenticated_capture_block(self):
        self.evidence["device"].pop("plus")
        self.evidence["authenticated"]["nz-au"]["result"] = "fail"
        self.assertEqual(len(self.blocked()), 2)

    def test_evidence_cannot_be_reused_for_another_candidate(self):
        self.evidence["manifest_sha256"] = "b" * 64
        self.assertEqual(self.blocked(), ["Evidence must bind to this exact release manifest"])

    def test_production_approval_must_be_distinct_and_after_evidence(self):
        self.evidence["promotion_approval"] = self.evidence["stage_approval"].copy()
        self.assertTrue(self.blocked())
        self.evidence["promotion_approval"]["issue_comment_id"] = 2
        self.evidence["promotion_approval"]["approved_at"] = "2026-11-20T08:15:00+13:00"
        self.assertEqual(self.blocked(), ["Production approval must follow the recorded evidence"])

    def test_pre_staging_evidence_is_rejected(self):
        self.evidence["runtime"]["observed_at"] = "2026-11-20T07:59:00+13:00"
        self.assertEqual(self.blocked(), ["Release evidence must follow staging approval"])

    def test_regional_qa_does_not_supply_a_production_route(self):
        manifest = plan("international", self.policy["source_baseline"])
        self.assertIsNone(manifest["production_project"])
        self.assertEqual(manifest["rollback"]["functions"], ["lounge-international-regional-qa"])
        evidence = copy.deepcopy(self.evidence)
        evidence["manifest_sha256"] = digest(canonical(manifest))
        self.assertIn("This target has no verified production destination",
                      blockers(manifest, evidence, "promote", self.policy))

    def test_plan_pins_all_bundles(self):
        self.assertEqual({slug: function["observed_version"] for slug, function in self.manifest["functions"].items()},
                         {"n": 37, "lounge-plus-qa": 5, "lounge-international-regional-qa": 4})
        self.assertEqual(self.manifest["rollback"]["functions"], ["n", "lounge-plus-qa"])
        self.assertEqual(self.manifest["changes"], [])
