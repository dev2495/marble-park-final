import contextlib
import datetime as dt
import fcntl
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("backup-retention.py")
spec = importlib.util.spec_from_file_location("retention", SCRIPT)
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve() / "app" / "backups"
        self.root.mkdir(parents=True)
        self.now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
        self.sets = []
        for days in range(6):
            stamp = (self.now - dt.timedelta(days=days, seconds=10)).strftime("%Y%m%dT%H%M%SZ")
            p = self.root / stamp
            p.mkdir()
            (p / "database.dump").write_bytes(b"db" + str(days).encode())
            (p / "assets.tar.gz").write_bytes(b"assets" + str(days).encode())
            # Cover old absolute manifests and new relative manifests together.
            (p / "SHA256SUMS").write_text("".join(
                f"{retention.digest(p / n)}  {str(p / n) if days % 2 else n}\n"
                for n in ("database.dump", "assets.tar.gz")))
            self.sets.append(p)

    def run_retention(self, apply=True):
        with contextlib.redirect_stdout(io.StringIO()):
            return retention.retain(self.root, apply, self.now)

    def test_dry_run_preserves_everything(self):
        self.assertGreater(self.run_retention(False), 0)
        self.assertTrue(all(p.exists() for p in self.sets))
        self.assertFalse((self.root / "database-history").exists())

    def test_three_full_and_all_recent_databases_with_repeat(self):
        special = self.root / "pre-release.dump"
        special.write_text("preserve")
        partial = self.root / ".partial-failed"
        partial.mkdir()
        self.run_retention()
        self.assertTrue(all(p.exists() for p in self.sets[:3]))
        self.assertFalse(any(p.exists() for p in self.sets[3:]))
        self.assertEqual(len(list((self.root / "database-history").glob("*.dump"))), 6)
        self.assertEqual(special.read_text(), "preserve")
        self.assertTrue(partial.exists())
        self.assertEqual(self.run_retention(), 0)

    def test_corrupt_retained_assets_fail_before_any_write(self):
        (self.sets[1] / "assets.tar.gz").write_text("corrupt")
        with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
            self.run_retention()
        self.assertTrue(all(p.exists() for p in self.sets))
        self.assertFalse((self.root / "database-history").exists())

    def test_corrupt_old_database_is_not_deleted(self):
        (self.sets[5] / "database.dump").write_text("corrupt")
        with self.assertRaises(ValueError):
            self.run_retention()
        self.assertTrue(all(p.exists() for p in self.sets))

    def test_stale_backup_refuses(self):
        self.now += dt.timedelta(days=3)
        with self.assertRaisesRegex(ValueError, "48 hours"):
            self.run_retention()

    def test_incomplete_backup_refuses(self):
        (self.sets[5] / "SHA256SUMS").unlink()
        with self.assertRaisesRegex(ValueError, "incomplete"):
            self.run_retention()

    def test_symlink_refuses(self):
        target = self.sets[5] / "assets.tar.gz"
        target.unlink()
        target.symlink_to(self.sets[0] / "assets.tar.gz")
        with self.assertRaisesRegex(ValueError, "regular file"):
            self.run_retention()

    def test_unsafe_manifest_refuses(self):
        p = self.sets[5] / "SHA256SUMS"
        p.write_text(p.read_text().replace(str(self.sets[5]), "/etc"))
        with self.assertRaisesRegex(ValueError, "Unsafe checksum"):
            self.run_retention()

    def test_minimum_three_required(self):
        for p in self.sets[2:]:
            for f in p.iterdir():
                f.unlink()
            p.rmdir()
        self.assertEqual(self.run_retention(), 0)
        self.assertTrue(self.sets[0].exists())

    def test_expired_history_removed_only_after_verification(self):
        history = self.root / "database-history"
        history.mkdir()
        old = (self.now - dt.timedelta(days=15)).strftime("%Y%m%dT%H%M%SZ")
        p = history / f"{old}.dump"
        p.write_bytes(b"old db")
        p.with_suffix(".sha256").write_text(retention.digest(p))
        self.run_retention()
        self.assertFalse(p.exists())
        self.assertFalse(p.with_suffix(".sha256").exists())

    def test_interrupted_history_checksum_is_repaired(self):
        history = self.root / "database-history"
        history.mkdir()
        p = history / f"{self.sets[5].name}.dump"
        p.write_bytes((self.sets[5] / "database.dump").read_bytes())
        self.run_retention()
        self.assertEqual(p.with_suffix(".sha256").read_text().strip(), retention.digest(p))

    def test_cli_lock_blocks_parallel_but_accepts_inherited_descriptor(self):
        with (self.root / ".backup.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            command = [sys.executable, str(SCRIPT), "--root", str(self.root)]
            blocked = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(blocked.returncode, 0)
            inherited = subprocess.run(command + ["--lock-fd", str(lock.fileno())],
                                       pass_fds=(lock.fileno(),), capture_output=True, text=True)
            self.assertEqual(inherited.returncode, 0, inherited.stderr)

    def test_symlink_root_and_broad_root_rejected(self):
        with self.assertRaises(ValueError):
            retention.retain(Path("/srv"), True, self.now)
        alias = self.root.parent.parent / "backups"
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            retention.retain(alias, True, self.now)


if __name__ == "__main__":
    unittest.main()
