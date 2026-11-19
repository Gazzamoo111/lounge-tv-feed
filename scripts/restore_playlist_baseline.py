"""Reassemble and verify an Edge Function source baseline without deploying it."""

import argparse
from contextlib import ExitStack
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
from zipfile import ZipFile

MANIFEST = Path(__file__).resolve().parents[1] / "ops/phase-1/release-manifest.json"
RELATIVE_IMPORT = re.compile(r"""(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']""")


def safe_path(value):
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or not path.parts or "\\" in value:
        raise ValueError(f"Invalid manifest path: {value}")
    return path


def restore(functions, repo, archive, output):
    if output.exists():
        raise ValueError("Output must be a new directory")
    needs_archive = any(
        "github" not in source
        for function in functions.values()
        for source in function["files"].values()
    )
    if needs_archive and archive is None:
        raise ValueError("Supply --archive for functions with private source")
    output.parent.mkdir(parents=True, exist_ok=True)
    with ExitStack() as stack:
        private_source = stack.enter_context(ZipFile(archive)) if needs_archive else None
        staging = stack.enter_context(tempfile.TemporaryDirectory(dir=output.parent))
        root = Path(staging) / "functions"
        root.mkdir()
        for slug, function in functions.items():
            bundle = root / safe_path(slug)
            declared = set(function["files"])
            if function["entrypoint"] not in declared:
                raise ValueError(f"{slug} entrypoint is absent")
            for filename, source in function["files"].items():
                path = bundle / safe_path(filename)
                if "github" in source:
                    result = subprocess.run(
                        ["git", "-C", str(repo), "cat-file", "blob", source["git_blob"]],
                        capture_output=True,
                        check=False,
                    )
                    if result.returncode:
                        pin = source["github"]
                        raise ValueError(f"Fetch {pin['branch']} at {pin['commit']} for {slug}/{filename}")
                    data = result.stdout
                else:
                    data = private_source.read(f"{slug}/{filename}")
                if hashlib.sha256(data).hexdigest() != source["sha256"]:
                    raise ValueError(f"SHA-256 mismatch for {slug}/{filename}")
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            for filename in declared:
                path = bundle / filename
                if path.suffix not in {".ts", ".js", ".mjs", ".mts"}:
                    continue
                for specifier in RELATIVE_IMPORT.findall(path.read_text(encoding="utf-8")):
                    dependency = (path.parent / specifier).resolve()
                    if not dependency.is_relative_to(bundle.resolve()) or not dependency.is_file():
                        raise ValueError(f"Missing relative import in {slug}/{filename}: {specifier}")
        root.rename(output)
    return sum(len(function["files"]) for function in functions.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=MANIFEST)
    parser.add_argument("--repo", type=Path, required=True, help="Local Git object store with pinned blobs")
    parser.add_argument("--archive", type=Path, help="Private unmatched-source ZIP")
    parser.add_argument("--function", help="Restore a single function by slug")
    parser.add_argument("--output", type=Path, required=True, help="New directory for the verified bundles")
    args = parser.parse_args()
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        functions = manifest["functions"]
        if args.function:
            functions = {args.function: functions[args.function]}
        count = restore(functions, args.repo, args.archive, args.output)
    except (OSError, ValueError, KeyError) as exc:
        parser.exit(1, f"Restore failed: {exc}\n")
    print(f"Verified and restored {count} files across {len(functions)} functions")


if __name__ == "__main__":
    main()
