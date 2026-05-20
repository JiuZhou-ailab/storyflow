#!/usr/bin/env python3
# input: Per-architecture latest-mac YAML files emitted by electron-builder and target architecture metadata
# output: A merged latest-mac.yml containing arm64 and x64 update file entries
# pos: Release workflow helper preserving macOS auto-update metadata across matrix builds

from __future__ import annotations

import re
import sys
from pathlib import Path

KNOWN_ARCHES = {"arm64", "x64"}


def infer_arch(path: Path, file_url: str, explicit_arch: str | None) -> str:
    if explicit_arch:
        if explicit_arch not in KNOWN_ARCHES:
            raise SystemExit(f"Unsupported macOS architecture in {path}: {explicit_arch}")
        return explicit_arch

    for value in KNOWN_ARCHES:
        if value in path.name or value in file_url:
            return value

    raise SystemExit(f"Unable to infer macOS architecture for {file_url} from {path}")


def read_manifest(path: Path, explicit_arch: str | None = None) -> dict[str, object]:
    text = path.read_text()
    version = re.search(r"^version:\s*(.+)$", text, re.M)
    release_date = re.search(r"^releaseDate:\s*(.+)$", text, re.M)
    path_value = re.search(r"^path:\s*(.+)$", text, re.M)
    sha512 = re.search(r"^sha512:\s*(.+)$", text, re.M)
    files: list[dict[str, str]] = []
    current: dict[str, str] = {}

    for line in text.splitlines():
        url = re.match(r"^\s*-\s*url:\s*(.+)$", line)
        if url:
            if current:
                files.append(current)
            current = {"url": url.group(1).strip()}
            continue

        field = re.match(r"^\s*(sha512|arch):\s*(.+)$", line)
        if field and current:
            current[field.group(1)] = field.group(2).strip()

    if current:
        files.append(current)

    if not version or not release_date or not path_value or not sha512 or not files:
        raise SystemExit(f"Unable to parse update manifest: {path}")

    for file in files:
        file["arch"] = infer_arch(path, file["url"], explicit_arch or file.get("arch"))

    return {
        "version": version.group(1).strip(),
        "releaseDate": release_date.group(1).strip(),
        "files": files,
    }


def merge_manifests(inputs: list[tuple[Path, str | None]], output: Path) -> None:
    manifests = [read_manifest(path, explicit_arch) for path, explicit_arch in inputs]
    versions = {manifest["version"] for manifest in manifests}
    if len(versions) != 1:
        raise SystemExit(f"Mismatched macOS manifest versions: {versions}")

    files: list[dict[str, str]] = []
    for manifest in manifests:
        files.extend(manifest["files"])  # type: ignore[arg-type]

    missing_arch = [file for file in files if "arch" not in file]
    if missing_arch:
        raise SystemExit(f"Missing arch in macOS manifest file entries: {missing_arch}")

    primary = next((file for file in files if file.get("arch") == "arm64"), files[0])
    lines = [
        f"version: {manifests[0]['version']}",
        "files:",
    ]

    for file in files:
        lines.extend([
            f"  - url: {file['url']}",
            f"    sha512: {file['sha512']}",
            f"    arch: {file['arch']}",
        ])

    lines.extend([
        f"path: {primary['url']}",
        f"sha512: {primary['sha512']}",
        f"releaseDate: {manifests[0]['releaseDate']}",
        "",
    ])
    output.write_text("\n".join(lines))


def main(argv: list[str]) -> None:
    if len(argv) < 4:
        raise SystemExit(
            "Usage: merge-macos-update-manifests.py <output.yml> [arch=]<input.yml> [...]"
        )

    output = Path(argv[1])
    inputs: list[tuple[Path, str | None]] = []
    for arg in argv[2:]:
        if "=" in arg:
            arch, path = arg.split("=", 1)
            if arch not in KNOWN_ARCHES:
                raise SystemExit(f"Unsupported macOS architecture: {arch}")
            inputs.append((Path(path), arch))
        else:
            inputs.append((Path(arg), None))
    merge_manifests(inputs, output)


if __name__ == "__main__":
    main(sys.argv)
