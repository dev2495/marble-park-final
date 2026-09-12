#!/usr/bin/env python3
"""Fail-closed local retention. Dry-run by default; never follows symlinks."""
import argparse
import datetime as dt
import fcntl
import hashlib
import os
from pathlib import Path
import re
import shutil
import stat
import sys

STAMP = re.compile(r"\d{8}T\d{6}Z")
FILES = {"database.dump", "assets.tar.gz", "SHA256SUMS"}
UTC = dt.timezone.utc


def stamp_time(name):
    return dt.datetime.strptime(name, "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)


def regular(path):
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError(f"Not a regular file: {path}")


def digest(path):
    regular(path)
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def manifest(directory):
    regular(directory / "SHA256SUMS")
    result = {}
    for line in (directory / "SHA256SUMS").read_text().splitlines():
        checksum, filename = line.split(maxsplit=1)
        filename = filename.lstrip("*")
        name = Path(filename).name
        if (name not in FILES - {"SHA256SUMS"} or name in result
                or filename not in (name, str(directory / name))
                or not re.fullmatch(r"[0-9a-f]{64}", checksum)):
            raise ValueError(f"Unsafe checksum manifest: {directory}")
        result[name] = checksum
    if set(result) != FILES - {"SHA256SUMS"}:
        raise ValueError(f"Incomplete checksum manifest: {directory}")
    return result


def checked(path, expected):
    if digest(path) != expected:
        raise ValueError(f"Checksum mismatch: {path}")


def retain(root, apply=False, now=None):
    now = now or dt.datetime.now(UTC)
    if (not root.is_absolute() or root.name != "backups"
            or root.resolve() != root or len(root.parts) < 4):
        raise ValueError("Expected a canonical absolute application backups directory")
    if not stat.S_ISDIR(root.lstat().st_mode):
        raise ValueError("Backup root must be a real directory")
    sets = []
    for entry in root.iterdir():
        if not STAMP.fullmatch(entry.name):
            continue  # Special pre-release files and partials are not retention targets.
        if not stat.S_ISDIR(entry.lstat().st_mode):
            raise ValueError(f"Not a real backup directory: {entry}")
        if stamp_time(entry.name) > now:
            raise ValueError(f"Future-dated backup: {entry}")
        if {p.name for p in entry.iterdir()} != FILES:
            raise ValueError(f"Unexpected or incomplete backup contents: {entry}")
        for name in FILES:
            regular(entry / name)
        sets.append(entry)
    sets.sort(key=lambda p: p.name, reverse=True)
    if len(sets) < 3:
        print(f"NO CLEANUP: {len(sets)} complete sets; three are required")
        return 0
    if now - stamp_time(sets[0].name) > dt.timedelta(hours=48):
        raise ValueError("Newest backup is over 48 hours old; refusing cleanup")

    # Validate every database before preserving history, and all retained assets
    # before deleting any older recovery set. Do not silently skip a corrupt set.
    manifests = {p.name: manifest(p) for p in sets}
    for p in sets:
        checked(p / "database.dump", manifests[p.name]["database.dump"])
    for p in sets[:3]:
        checked(p / "assets.tar.gz", manifests[p.name]["assets.tar.gz"])
        print(f"KEEP VERIFIED FULL {p.name}")

    history = root / "database-history"
    if history.exists() or history.is_symlink():
        if not stat.S_ISDIR(history.lstat().st_mode):
            raise ValueError("Database history must be a real directory")
    cutoff = now.date() - dt.timedelta(days=13)
    expired = []
    if history.exists():
        for p in history.iterdir():
            if p.suffix != ".dump" or not STAMP.fullmatch(p.stem):
                continue
            regular(p)
            checksum_file = p.with_suffix(".sha256")
            if not checksum_file.exists() and not checksum_file.is_symlink() and p.stem in manifests:
                checked(p, manifests[p.stem]["database.dump"])
                continue  # Repair a copy interrupted before writing its checksum.
            regular(checksum_file)
            checked(p, checksum_file.read_text().strip())
            if stamp_time(p.stem).date() < cutoff:
                expired.append(p)

    for p in sets:
        if stamp_time(p.name).date() < cutoff:
            continue
        target = history / f"{p.name}.dump"
        checksum_file = target.with_suffix(".sha256")
        checksum = manifests[p.name]["database.dump"]
        if target.exists() or target.is_symlink():
            checked(target, checksum)
        if checksum_file.exists() or checksum_file.is_symlink():
            regular(checksum_file)
            if checksum_file.read_text().strip() != checksum:
                raise ValueError(f"History checksum conflict: {checksum_file}")

    reclaimed = sum((p / name).stat().st_size for p in sets[3:] for name in FILES)
    for p in sets[3:]:
        print(f"{'REMOVE' if apply else 'WOULD REMOVE'} FULL {p.name}")
    for p in expired:
        print(f"{'REMOVE' if apply else 'WOULD REMOVE'} EXPIRED DATABASE {p.name}")
    print(f"Full-backup bytes eligible: {reclaimed}; database history: 14 calendar days")
    if not apply:
        return reclaimed

    history.mkdir(mode=0o700, exist_ok=True)
    # Copy/verify first. Interrupted history writes can be repaired on retry.
    for p in sets:
        if stamp_time(p.name).date() < cutoff:
            continue
        target = history / f"{p.name}.dump"
        checksum = manifests[p.name]["database.dump"]
        if not target.exists():
            staging = history / f".{p.name}.{os.getpid()}.partial"
            with staging.open("xb") as out, (p / "database.dump").open("rb") as src:
                os.chmod(staging, 0o600)
                shutil.copyfileobj(src, out)
                out.flush()
                os.fsync(out.fileno())
            checked(staging, checksum)
            staging.rename(target)
        checksum_file = target.with_suffix(".sha256")
        if not checksum_file.exists():
            with checksum_file.open("x") as out:
                os.chmod(checksum_file, 0o600)
                out.write(checksum + "\n")
                out.flush()
                os.fsync(out.fileno())
        checked(target, checksum)

    # Explicit files only, no recursive deletion. Rename atomically first so an
    # interrupted deletion cannot masquerade as a valid full backup on next run.
    for p in sets[3:]:
        removal = root / f".pruning-{p.name}"
        if removal.exists() or removal.is_symlink():
            raise ValueError(f"Inspect interrupted cleanup before retry: {removal}")
        p.rename(removal)
        for name in sorted(FILES):
            regular(removal / name)
            (removal / name).unlink()
        removal.rmdir()
    for p in expired:
        p.unlink()
        p.with_suffix(".sha256").unlink()
    return reclaimed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--lock-fd", type=int, help="Inherited backup.sh flock descriptor")
    args = parser.parse_args()
    root = args.root
    if root.resolve() != root or root.name != "backups" or len(root.parts) < 4:
        raise ValueError("Unsafe backup root")
    lockpath = root / ".backup.lock"
    fd = args.lock_fd
    own_lock = fd is None
    if own_lock:
        fd = os.open(lockpath, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        if (os.fstat(fd).st_dev, os.fstat(fd).st_ino) != (
                lockpath.lstat().st_dev, lockpath.lstat().st_ino):
            raise ValueError("Incorrect inherited backup lock")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        retain(root, args.apply)
    finally:
        if own_lock:
            os.close(fd)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as exc:
        print(f"RETENTION FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
