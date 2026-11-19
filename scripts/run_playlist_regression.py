"""Run the checked-in synthetic contracts against local gateway source."""

import argparse
from datetime import datetime
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

from playlist_regression import check, differences, project, strict_json, summary
from restore_playlist_baseline import MANIFEST, restore

ROOT = MANIFEST.parents[2]
TESTS = ROOT / "tests/playlist_regression"
CLOCK = datetime.fromisoformat("2030-01-01T12:00:00+00:00")
TARGETS = {
    "nz-au": "n",
    "plus": "lounge-plus-qa",
    "regional-v4": "lounge-international-regional-qa",
}


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def existing_tests(functions, bundles):
    test_sources = [
        ("n", "index.ts", "plus-account-route.test.mjs"),
        ("n", "qa-sky-fhd-primary.mjs", "qa-sky-fhd-primary.test.mjs"),
        ("n", "qa-au-duplicates.mjs", "qa-au-duplicates.test.mjs"),
        ("lounge-plus-qa", "plus-categories.mjs", "plus-categories.test.mjs"),
        ("lounge-international-regional-qa", "qa-world-regions.mjs", "qa-world-regions.test.mjs"),
        ("lounge-international-regional-qa", "qa-sky-regional-preferred.mjs", "qa-sky-regional-preferred.test.mjs"),
    ]
    tests = [ROOT / "cloudflare/nuvio-qa-proxy.test.mjs"]
    worker_pin = functions["n"]["files"]["channel-priority.mjs"]["github"]["commit"]
    for name in ("nuvio-qa-custom-domain.mjs", "nuvio-qa-custom-domain.test.mjs"):
        path = bundles / name
        candidate = ROOT / "cloudflare" / name
        path.write_bytes(candidate.read_bytes() if candidate.is_file()
                         else git("show", f"{worker_pin}:cloudflare/{name}"))
    tests.append(bundles / "nuvio-qa-custom-domain.test.mjs")
    for slug, neighbour, name in test_sources:
        pin = functions[slug]["files"][neighbour]["github"]
        pinned_path = Path(pin["path"]).with_name(name).as_posix()
        test = bundles / slug / name
        test.write_bytes(git("show", f"{pin['commit']}:{pinned_path}"))
        tests.append(test)
    return tests


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh-synthetic", action="store_true",
                        help="Rebuild expected projections from the deterministic replay")
    parser.add_argument("--base-revision", help="PR base used to enforce protected fixture isolation")
    args = parser.parse_args()
    functions = strict_json(MANIFEST)["functions"]
    selected = {slug: functions[slug] for slug in TARGETS.values()}
    failed = False
    regional_only = False
    if args.base_revision:
        changed = git("diff", "--name-only", args.base_revision, "HEAD").decode().splitlines()
        base_fixtures = set(git("ls-tree", "-r", "--name-only", args.base_revision, "--",
                                "tests/playlist_regression").decode().splitlines())
        regional = "qa/international-master/"
        regional_only = "tests/playlist_regression/nz-au.expected.json" in base_fixtures and any(
            path.startswith(regional) or path == "tests/playlist_regression/regional-v4.expected.json"
            for path in changed
        ) and not any(
            path.startswith(("qa/lounge-plus-", "cloudflare/")) or
            (path.startswith("qa/") and not path.startswith(regional))
            for path in changed
        )
    with tempfile.TemporaryDirectory(prefix="playlist-regression-") as scratch:
        root = Path(scratch)
        bundles = root / "bundles"
        restored = restore(selected, ROOT, None, bundles)
        print(f"PASS Phase 1 reference integrity: {restored} source files across {len(selected)} bundles", flush=True)
        tests = existing_tests(selected, bundles)
        for slug, bundle in selected.items():
            for filename, file in bundle["files"].items():
                candidate = ROOT / file["github"]["path"]
                if candidate.is_file():
                    print(f"Candidate source: {slug}/{filename} from {candidate.relative_to(ROOT)}", flush=True)
                    shutil.copyfile(candidate, bundles / slug / filename)
        subprocess.run(["node", "--test", *tests], cwd=ROOT, check=True)
        output = root / "responses"
        subprocess.run(["node", TESTS / "replay.mjs", bundles, output], cwd=ROOT, check=True)
        for profile in TARGETS:
            actual = project(output / profile, profile, CLOCK, 503, "synthetic")
            expected_path = TESTS / f"{profile}.expected.json"
            issues = check(actual)
            if args.refresh_synthetic and not issues:
                expected_path.write_text(json.dumps(actual, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            elif not args.refresh_synthetic:
                issues.extend(differences(strict_json(expected_path), actual))
                if regional_only and profile != "regional-v4":
                    relative = expected_path.relative_to(ROOT).as_posix()
                    base_path = root / f"protected-{profile}.json"
                    base_path.write_bytes(git("show", f"{args.base_revision}:{relative}"))
                    issues.extend("Regional isolation: " + issue for issue in differences(strict_json(base_path), actual))
            failed |= bool(issues)
            print(f"{'FAIL' if issues else 'PASS'} {profile}: {len(actual['channels'])} channels, "
                  f"{len(actual['groups'])} categories, Xtream {actual['xtream']}")
            for line in [*summary(actual), *issues]:
                print("  " + line)
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
