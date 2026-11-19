"""Prepare and validate a single-target playlist release. Commands are local and never deploy."""

import argparse
from contextlib import contextmanager
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

from playlist_regression import require, strict_json
from restore_playlist_baseline import MANIFEST, restore

ROOT = MANIFEST.parents[2]
POLICY_PATH = ROOT / "ops/phase-3/targets.json"
SHA = r"[a-f0-9]{40}"
DIGEST = r"[a-f0-9]{64}"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def matching(pattern, value):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def source_policy():
    policy = strict_json(POLICY_PATH)
    require(MANIFEST.read_bytes() == git("show", f"{policy['source_baseline']}:ops/phase-1/release-manifest.json"),
            "Phase 1 baseline manifest differs from the pinned copy")
    return policy, strict_json(MANIFEST)["functions"]


def inventory(slugs, bundles):
    return {
        slug: {path.relative_to(bundles / slug).as_posix(): digest(path.read_bytes())
               for path in sorted((bundles / slug).rglob("*")) if path.is_file()}
        for slug in slugs
    }


def tracked_paths(revision):
    entries = git("ls-tree", "-rz", revision).decode().split("\0")
    return {path: metadata.split()[0] for entry in entries if entry
            for metadata, path in [entry.split("\t", 1)]}


def plan(target, revision):
    policy, functions = source_policy()
    base = policy["source_baseline"]
    require(matching(SHA, revision) and git("cat-file", "-t", revision).strip() == b"commit",
            "Candidate must be a full commit SHA")
    require(subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", base, revision]).returncode == 0,
            "Candidate must descend from the pinned regression baseline")
    config = policy["targets"][target]
    profiles = config["profiles"]
    owned = {source["github"]["path"] for slug in profiles.values() for source in functions[slug]["files"].values()}
    allowed = owned | {f"tests/playlist_regression/{profile}.expected.json" for profile in profiles}
    changes = set(git("diff", "--no-renames", "--name-only", "-z", base, revision).decode().split("\0")) - {""}
    require(changes <= allowed,
            f"Out-of-scope change ({len(changes - allowed)} paths). Use a separate reviewed change for config, shared code or new file layouts")
    tracked = tracked_paths(revision)
    require(all(tracked.get(path) == "100644" for path in changes), "Candidate removes a file or changes its type")
    effective = {}
    for scope in policy["targets"].values():
        for slug in scope["profiles"].values():
            function = functions[slug]
            files = {}
            for path, source in function["files"].items():
                overlay = source["github"]["path"]
                # Match Phase 2 precedence exactly and bind the result to this commit.
                files[path] = digest(git("show", f"{revision}:{overlay}")) if overlay in tracked else source["sha256"]
                if slug not in profiles.values():
                    require(files[path] == source["sha256"], "Protected peer bundle differs from its baseline")
            effective[slug] = {
                "observed_version": function["version"],
                "observed_bundle_sha256": function["bundle_sha256"],
                "entrypoint": function["entrypoint"],
                "verify_jwt": function["verify_jwt"],
                "import_map": function["import_map"],
                "candidate_files_sha256": files,
            }
    dependencies = {
        slug: {key: functions[slug][key] for key in ("version", "bundle_sha256", "verify_jwt", "import_map")}
        for slug in config["edge_dependencies"]
    }
    return {
        "schema": 1, "issue": policy["issue"], "target": target, "source_commit": revision,
        "regression_base": base, "production_project": config["promotion_project"],
        "current_routes": config["current_routes"], "profiles": profiles,
        "dependencies": config["dependencies"], "edge_dependencies": dependencies,
        "targets_config_sha256": digest(POLICY_PATH.read_bytes()),
        "rollback": {"revision": base, "manifest_sha256": digest(MANIFEST.read_bytes()),
                     "functions": list(profiles.values())},
        "functions": effective, "changes": sorted(changes),
    }


@contextmanager
def candidate_checkout(revision):
    with TemporaryDirectory(prefix="playlist-release-") as scratch:
        checkout = Path(scratch) / "source"
        # Use a clean detached worktree so untracked overlays cannot enter the replay.
        git("worktree", "add", "--quiet", "--detach", str(checkout), revision)
        try:
            yield checkout
        finally:
            git("worktree", "remove", "--force", str(checkout))


def run_regression(manifest):
    with candidate_checkout(manifest["source_commit"]) as checkout:
        for args in (["-m", "unittest", "discover", "-s", "tests/playlist_regression", "-v"],
                     ["scripts/run_playlist_regression.py", "--base-revision", manifest["regression_base"]]):
            subprocess.run([sys.executable, *args], cwd=checkout, check=True)


def export_bundles(manifest, output):
    require(not output.exists() and not output.resolve().is_relative_to(ROOT),
            "Bundle output must be a new directory outside the repository")
    _, functions = source_policy()
    selected = {slug: functions[slug] for slug in manifest["profiles"].values()}
    with TemporaryDirectory(prefix="playlist-bundle-", dir=output.parent) as scratch:
        bundles = Path(scratch) / "source"
        restore(selected, ROOT, None, bundles)
        revision = manifest["source_commit"]
        tracked = tracked_paths(revision)
        for slug, function in selected.items():
            for filename, source in function["files"].items():
                overlay = source["github"]["path"]
                if overlay in tracked:
                    (bundles / slug / filename).write_bytes(git("show", f"{revision}:{overlay}"))
        expected = {slug: manifest["functions"][slug]["candidate_files_sha256"] for slug in selected}
        require(inventory(selected, bundles) == expected, "Bundle files differ from the release manifest")
        output.mkdir(mode=0o700)
        for slug in selected:
            shutil.move(bundles / slug, output / slug)
    print(f"Verified and exported {len(selected)} candidate bundles")


def rehearsal():
    from run_playlist_regression import TESTS

    policy, functions = source_policy()
    slugs = {slug for config in policy["targets"].values() for slug in config["profiles"].values()}
    selected = {slug: functions[slug] for slug in sorted(slugs)}
    # Reuse the actual gateway replay with its stubbed HTTP and storage dependencies.
    with TemporaryDirectory(prefix="playlist-rollback-") as scratch:
        root = Path(scratch)
        baseline = root / "baseline"
        count = restore(selected, ROOT, None, baseline)
        expected = inventory(slugs, baseline)
        subprocess.run(["node", TESTS / "replay.mjs", baseline, root / "before"], check=True)
        for target, config in policy["targets"].items():
            active = root / target
            restore(selected, ROOT, None, active)
            affected = set(config["profiles"].values())
            for slug in affected:
                with (active / slug / selected[slug]["entrypoint"]).open("ab") as candidate:
                    candidate.write(b"\n// Isolated rollback rehearsal candidate\n")
            changed = inventory(slugs, active)
            require({slug for slug in slugs if changed[slug] != expected[slug]} == affected,
                    "Rehearsal did not isolate candidate scope")
            subprocess.run(["node", TESTS / "replay.mjs", active, root / f"{target}-candidate"], check=True)
            restored = root / f"{target}-restored"
            restore({slug: selected[slug] for slug in sorted(affected)}, ROOT, None, restored)
            for slug in affected:
                (active / slug).rename(root / f"{target}-{slug}-previous")
                (restored / slug).rename(active / slug)
            require(inventory(slugs, active) == expected, "Rehearsal did not restore byte-identical bundles")
            after = root / f"{target}-after"
            subprocess.run(["node", TESTS / "replay.mjs", active, after], check=True)
            responses = inventory(["before", after.name], root)
            require(responses["before"] == responses[after.name],
                    "Gateway responses changed after restore")
            print(f"PASS {target}: scoped restore, unaffected peer and identical gateway responses ({count} total files)")
    print("Offline rehearsal only. Isolated runtime rollback is still required for promotion.")


def exact_keys(value, keys):
    return isinstance(value, dict) and value.keys() == set(keys.split())


def timestamp(value):
    return isinstance(value, str) and datetime.fromisoformat(value).utcoffset() is not None


def approval(value, owner):
    return exact_keys(value, "owner issue_comment_id approved_at") and value["owner"] == owner and (
        type(value["issue_comment_id"]) is int and value["issue_comment_id"] > 0 and timestamp(value["approved_at"])
    )


def receipt(value):
    return exact_keys(value, "result observed_at private_evidence_sha256") and (
        value["result"] == "pass" and timestamp(value["observed_at"])
        and matching(DIGEST, value["private_evidence_sha256"])
    )


def staging(value, project, profiles):
    return exact_keys(value, "project function_slugs") and (
        value["project"] == "local" or (
            matching(r"[a-z0-9]{20}", value["project"]) and value["project"] != project
        )
    ) and value["function_slugs"] == profiles


def blockers(manifest, evidence, action, policy):
    if not exact_keys(evidence, "schema manifest_sha256 staging stage_approval promotion_approval authenticated device rollback runtime"):
        return ["Complete the local evidence record"]
    if type(evidence["schema"]) is not int or evidence["schema"] != 1 or evidence["manifest_sha256"] != digest(canonical(manifest)):
        return ["Evidence must bind to this exact release manifest"]
    issues = []
    profiles = manifest["profiles"]
    if not staging(evidence["staging"], policy["project"], profiles):
        issues.append("A separate, isolated staging project and per-profile function routes are required")
    if not approval(evidence["stage_approval"], policy["approval_owner"]):
        issues.append("Explicit owner staging approval is required")
    if action == "stage":
        return issues
    if not manifest["production_project"]:
        issues.append("This target has no verified production destination")
    if not approval(evidence["promotion_approval"], policy["approval_owner"]):
        issues.append("Explicit owner production approval is required")
    elif approval(evidence["stage_approval"], policy["approval_owner"]) and (
        evidence["promotion_approval"]["issue_comment_id"] == evidence["stage_approval"]["issue_comment_id"]
        or datetime.fromisoformat(evidence["promotion_approval"]["approved_at"])
        <= datetime.fromisoformat(evidence["stage_approval"]["approved_at"])
    ):
        issues.append("Production approval must be a distinct, later approval")
    for kind in ("authenticated", "device"):
        records = evidence[kind]
        if not isinstance(records, dict) or records.keys() != profiles.keys() or not all(map(receipt, records.values())):
            issues.append(f"Passing {kind} evidence is required for each target profile")
    rollback = evidence["rollback"]
    if not exact_keys(rollback, "mode evidence") or rollback["mode"] != "isolated-runtime" or not receipt(rollback["evidence"]):
        issues.append("A passing isolated-runtime rollback receipt is required")
    if not receipt(evidence["runtime"]):
        issues.append("A passing pre-promotion runtime inventory and rollback parity receipt is required")
    # The final approval must be for the evidence actually reviewed, after validation and rehearsal.
    if not issues:
        verified = [*evidence["authenticated"].values(), *evidence["device"].values(),
                    rollback["evidence"], evidence["runtime"]]
        approved_at = datetime.fromisoformat(evidence["promotion_approval"]["approved_at"])
        if any(datetime.fromisoformat(item["observed_at"]) > approved_at for item in verified):
            issues.append("Production approval must follow the recorded evidence")
        staged_at = datetime.fromisoformat(evidence["stage_approval"]["approved_at"])
        if any(datetime.fromisoformat(item["observed_at"]) < staged_at for item in verified):
            issues.append("Release evidence must follow staging approval")
    return issues


def canonical(value):
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("plan")
    prepare.add_argument("target", choices=("nz-au", "international"))
    prepare.add_argument("revision")
    commands.add_parser("rehearse")
    for command in ("validate", "bundle", "stage", "promote"):
        options = commands.add_parser(command)
        options.add_argument("manifest", type=Path)
        if command == "bundle":
            options.add_argument("output", type=Path)
        elif command != "validate":
            options.add_argument("evidence", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "plan":
            print(canonical(plan(args.target, args.revision)).decode(), end="")
        elif args.command == "rehearse":
            rehearsal()
        else:
            manifest = strict_json(args.manifest)
            require(canonical(manifest) == canonical(plan(manifest["target"], manifest["source_commit"])),
                    "Manifest differs from pinned source, target configuration or rollback reference")
            run_regression(manifest)
            print(f"PASS automated validation for {manifest['target']} at {manifest['source_commit']}", flush=True)
            if args.command == "validate":
                return
            if args.command == "bundle":
                export_bundles(manifest, args.output)
                return
            issues = blockers(manifest, strict_json(args.evidence), args.command, strict_json(POLICY_PATH))
            require(not issues, "\n".join(issues))
            print("Required records present. Verify evidence and GitHub approvals as documented before acting.")
    except (KeyError, TypeError, ValueError, OSError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"Release blocked: {exc}\n")


if __name__ == "__main__":
    main()
