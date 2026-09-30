import importlib.util
import ast
import os
import subprocess
import sys
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
MIGRATION_PATH = BACKEND_ROOT / "alembic" / "versions" / "0001_initial_schema.py"
KSA_AUDIT_MIGRATION_PATH = BACKEND_ROOT / "alembic" / "versions" / "0002_ksa_claim_audit.py"
ROLE_AUDIT_MIGRATION_PATH = BACKEND_ROOT / "alembic" / "versions" / "0003_learning_space_role_audit.py"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


def load_baseline_module():
    spec = importlib.util.spec_from_file_location("exam_baseline_migration", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class MigrationSystemTests(unittest.TestCase):
    def test_alembic_configuration_and_head_exist(self):
        self.assertTrue((BACKEND_ROOT / "alembic.ini").exists())
        self.assertTrue((BACKEND_ROOT / "alembic" / "env.py").exists())
        self.assertTrue(MIGRATION_PATH.exists())
        migration = load_baseline_module()
        self.assertEqual(migration.revision, "0001_initial_schema")
        self.assertIsNone(migration.down_revision)

    def test_baseline_covers_current_model_tables(self):
        migration = load_baseline_module()
        table_names = {table["name"] for table in migration._TABLES}
        self.assertEqual(len(table_names), 41)
        self.assertIn("ksa_member_registry", table_names)
        self.assertIn("learning_spaces", table_names)
        self.assertIn("resource_chunks", table_names)
        self.assertIn("audio_transcript_segments", table_names)
        self.assertIn("material_contributions", table_names)
        self.assertIn("moderation_audits", table_names)
        self.assertIn("secure_share_links", table_names)

    def test_baseline_matches_current_model_table_and_column_names(self):
        os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
        import models  # noqa: F401
        from database import Base

        migration = load_baseline_module()
        baseline = {
            table["name"]: {column["name"] for column in table["columns"]}
            for table in migration._TABLES
        }
        models_by_name = {
            table.name: {column.name for column in table.columns}
            for table in Base.metadata.sorted_tables
            if table.name not in {"ksa_claim_audits", "learning_space_role_audits"}
        }
        self.assertEqual(set(baseline), set(models_by_name))
        for table_name, columns in models_by_name.items():
            self.assertEqual(baseline[table_name], columns, table_name)

    def test_ksa_claim_audit_revision_is_additive_and_reversible(self):
        spec = importlib.util.spec_from_file_location("ksa_claim_audit_migration", KSA_AUDIT_MIGRATION_PATH)
        migration = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(migration)

        self.assertEqual(migration.revision, "0002_ksa_claim_audit")
        self.assertEqual(migration.down_revision, "0001_initial_schema")
        source = KSA_AUDIT_MIGRATION_PATH.read_text(encoding="utf-8")
        self.assertIn('op.create_table(\n        "ksa_claim_audits"', source)
        self.assertIn('ondelete="SET NULL"', source)
        self.assertIn('op.drop_table("ksa_claim_audits")', source)

    def test_learning_space_role_audit_revision_is_additive_and_reversible(self):
        spec = importlib.util.spec_from_file_location("role_audit_migration", ROLE_AUDIT_MIGRATION_PATH)
        migration = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(migration)

        self.assertEqual(migration.revision, "0003_learning_space_role_audit")
        self.assertEqual(migration.down_revision, "0002_ksa_claim_audit")
        source = ROLE_AUDIT_MIGRATION_PATH.read_text(encoding="utf-8")
        self.assertIn('op.create_table(\n        "learning_space_role_audits"', source)
        self.assertEqual(source.count('ondelete="SET NULL"'), 4)
        self.assertIn('op.drop_table("learning_space_role_audits")', source)

    def test_full_migration_chain_renders_role_audit_upgrade_and_downgrade_sql(self):
        env = os.environ.copy()
        env["DATABASE_URL"] = "postgresql+psycopg://migration:check@127.0.0.1:65432/exammind"
        upgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head", "--sql"],
            cwd=BACKEND_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(upgrade.returncode, 0, upgrade.stderr)
        self.assertIn('CREATE TABLE ksa_claim_audits', upgrade.stdout)
        self.assertIn('CREATE TABLE learning_space_role_audits', upgrade.stdout)
        self.assertIn('ON DELETE SET NULL', upgrade.stdout)

        downgrade = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "downgrade", "0003_learning_space_role_audit:0001_initial_schema", "--sql"],
            cwd=BACKEND_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(downgrade.returncode, 0, downgrade.stderr)
        self.assertIn('DROP TABLE learning_space_role_audits', downgrade.stdout)
        self.assertIn('DROP TABLE ksa_claim_audits', downgrade.stdout)

    def test_schema_drift_items_are_represented(self):
        migration = load_baseline_module()
        by_table = {table["name"]: table for table in migration._TABLES}
        users = {column["name"] for column in by_table["users"]["columns"]}
        self.assertIn("username", users)
        self.assertIn("embedding", {column["name"] for column in by_table["past_questions"]["columns"]})
        self.assertIn("embedding", {column["name"] for column in by_table["study_materials"]["columns"]})
        self.assertIn("embedding", {column["name"] for column in by_table["lecture_note_chunks"]["columns"]})
        indexes = {
            index["name"]
            for table in migration._TABLES
            for index in table["indexes"]
        }
        self.assertIn("ix_users_email", indexes)
        source = MIGRATION_PATH.read_text(encoding="utf-8")
        self.assertIn('op.create_index("ix_users_email_lower"', source)

    def test_startup_and_legacy_scripts_do_not_mutate_schema(self):
        main = (BACKEND_ROOT / "main.py").read_text(encoding="utf-8")
        migrate = (BACKEND_ROOT / "migrate.py").read_text(encoding="utf-8")
        init_db = (BACKEND_ROOT / "init_db.py").read_text(encoding="utf-8")
        self.assertNotIn("Base.metadata.create_all", main)
        self.assertNotIn("ALTER TABLE", main)
        self.assertNotIn("CREATE INDEX", main)
        self.assertNotIn("backfill_resource_chunks", main)
        self.assertNotIn("Base.metadata.create_all", migrate)
        self.assertNotIn("ALTER TABLE", migrate)
        self.assertNotIn("CREATE EXTENSION", migrate)
        self.assertNotIn("create_all", init_db)
        self.assertIn("command.upgrade(config, \"head\")", migrate)

    def test_migration_helpers_are_read_only_and_cover_critical_objects(self):
        from migration_checks import (
            REQUIRED_COLUMNS,
            REQUIRED_FOREIGN_KEYS,
            REQUIRED_INDEXES,
            REQUIRED_TABLES,
            REQUIRED_UNIQUE_CONSTRAINTS,
        )

        self.assertGreaterEqual(len(REQUIRED_TABLES), 41)
        self.assertIn("firebase_uid", REQUIRED_COLUMNS["users"])
        self.assertIn("embedding", REQUIRED_COLUMNS["resource_chunks"])
        self.assertIn("ix_users_email_lower", REQUIRED_INDEXES)
        self.assertEqual(len(REQUIRED_FOREIGN_KEYS), 76)
        self.assertEqual(len(REQUIRED_UNIQUE_CONSTRAINTS), 11)
        source = (BACKEND_ROOT / "migration_checks.py").read_text(encoding="utf-8")
        self.assertNotIn("INSERT ", source.upper())
        self.assertNotIn("UPDATE ", source.upper())
        self.assertNotIn("DELETE ", source.upper())

    def test_initial_downgrade_is_explicitly_irreversible(self):
        source = MIGRATION_PATH.read_text(encoding="utf-8")
        tree = ast.parse(source)
        downgrade = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "downgrade")
        self.assertTrue(any(isinstance(node, ast.Raise) for node in ast.walk(downgrade)))

    def test_baseline_renders_postgresql_sql_without_connecting(self):
        env = os.environ.copy()
        env["DATABASE_URL"] = "postgresql+psycopg://migration:check@127.0.0.1:65432/exammind"
        result = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head", "--sql"],
            cwd=BACKEND_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CREATE EXTENSION IF NOT EXISTS vector", result.stdout)
        self.assertIn("VECTOR(384)", result.stdout)
        self.assertIn("INSERT INTO alembic_version", result.stdout)


if __name__ == "__main__":
    unittest.main()
