import unittest
import os
import sys
from types import SimpleNamespace
from unittest.mock import patch

import fitz

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from routers import mvp


class ReaderPageEndpointTests(unittest.TestCase):
    def setUp(self):
        document = fitz.open()
        page = document.new_page(width=640, height=360)
        page.insert_text((48, 80), "Prospecting & Pipeline Generation")
        page.insert_text((48, 120), "Use targeted prospect lists and cold email.")
        self.pdf = document.tobytes()
        document.close()
        self.note = SimpleNamespace(file_data=self.pdf, file_mime="application/pdf", file_name="slides.pdf")

    def test_reader_exposes_pdf_pages_and_visual_page_response(self):
        with patch.object(mvp, "_pdf_lecture_note_or_404", return_value=self.note):
            pages = mvp.read_lecture_note_pages(7, db=None, current_user=SimpleNamespace(id=1))
            image = mvp.render_lecture_note_page(7, 1, db=None, current_user=SimpleNamespace(id=1))

        self.assertEqual(pages["page_count"], 1)
        self.assertIn("Prospecting & Pipeline Generation", pages["pages"][0]["text"])
        self.assertEqual(pages["pages"][0]["width"], 640.0)
        self.assertTrue(any("Prospecting" in span["text"] for span in pages["pages"][0]["spans"]))
        self.assertEqual(image.media_type, "image/png")
        self.assertTrue(image.body.startswith(b"\x89PNG"))

    def test_visual_page_endpoint_rejects_invalid_page_numbers(self):
        with patch.object(mvp, "_pdf_lecture_note_or_404", return_value=self.note):
            with self.assertRaises(mvp.HTTPException) as failure:
                mvp.render_lecture_note_page(7, 2, db=None, current_user=SimpleNamespace(id=1))

        self.assertEqual(failure.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
