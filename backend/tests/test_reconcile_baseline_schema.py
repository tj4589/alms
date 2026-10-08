import importlib.util
import unittest
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = BACKEND_ROOT / "reconcile_baseline_schema.py"


def load_reconciler():
    spec = importlib.util.spec_from_file_location("reconcile_baseline_schema", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class BaselineReconciliationTests(unittest.TestCase):
    def test_reconciliation_scope_is_explicit_and_data_preserving(self):
        reconciler = load_reconciler()
        source = SCRIPT_PATH.read_text(encoding="utf-8").upper()

        self.assertEqual(len(reconciler.MISSING_INDEXES), 8)
        self.assertEqual(len(reconciler.MISSING_UNIQUE_CONSTRAINTS), 2)
        self.assertEqual(len(reconciler.MISSING_FOREIGN_KEYS), 4)
        self.assertNotIn("DELETE FROM", source)
        self.assertNotIn("UPDATE ", source)
        self.assertNotIn("INSERT INTO", source)
        self.assertIn("ALEMBIC_VERSION", source)
        self.assertIn("TRANSACTION READ ONLY", source)

    def test_unique_email_index_is_explicitly_case_insensitive(self):
        reconciler = load_reconciler()
        email_index = next(
            item for item in reconciler.MISSING_INDEXES
            if item["name"] == "ix_users_email_lower"
        )
        self.assertTrue(email_index["unique"])
        self.assertEqual(email_index["expression"], "lower(email)")

    def test_all_foreign_key_preflight_targets_are_declared(self):
        reconciler = load_reconciler()
        self.assertEqual(
            {
                (item["table"], item["column"], item["target_table"], item["target_column"])
                for item in reconciler.MISSING_FOREIGN_KEYS
            },
            {
                ("discussion_threads", "group_id", "study_groups", "id"),
                ("lecture_notes", "version_of_id", "lecture_notes", "id"),
                ("past_questions", "version_of_id", "past_questions", "id"),
                ("users", "active_learning_space_id", "learning_spaces", "id"),
            },
        )


if __name__ == "__main__":
    unittest.main()
