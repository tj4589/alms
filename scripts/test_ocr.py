import argparse
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from routers.ingest import (  # noqa: E402
    _ocr_pdf,
    _score_ocr_text,
    _useful_word_count,
    infer_metadata_fallback,
    ocr_health,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run ExamMind OCR against a local PDF.")
    parser.add_argument("pdf", help="Path to a scanned PDF")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}")
        return 2

    warnings: list[str] = []
    text, failure_reason = _ocr_pdf(pdf_path.read_bytes(), 0, warnings)
    metadata = infer_metadata_fallback(pdf_path.name, text)

    print("OCR health:", ocr_health())
    print("Failure reason:", failure_reason)
    print("Warnings:", warnings)
    print("Chars:", len(text.strip()))
    print("Useful words:", _useful_word_count(text))
    print("Score:", _score_ocr_text(text))
    print("Metadata:", metadata)
    print("\nPreview:\n", text[:1500])
    return 0 if text.strip() else 1


if __name__ == "__main__":
    raise SystemExit(main())
