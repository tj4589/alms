import os
import sys
import unittest

from sqlalchemy.dialects import sqlite

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from routers.search import _resource_chunk_filter  # noqa: E402


class SearchFallbackTests(unittest.TestCase):
    def test_canonical_chunk_keyword_fallback_builds_a_sql_predicate(self):
        predicate = _resource_chunk_filter(["graph", "traversal"])
        sql = str(predicate.compile(dialect=sqlite.dialect()))

        self.assertIn("resource_chunks.chunk_text", sql)
        self.assertIn("resource_chunks.topic", sql)
        self.assertIn("resource_chunks.metadata_json", sql)


if __name__ == "__main__":
    unittest.main()
