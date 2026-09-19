# The API's image. It exists for one reason: pytesseract is a wrapper, not an
# OCR engine. It shells out to a system `tesseract` binary that Render's native
# Python runtime does not ship, and without it every scanned or photographed
# past paper comes back flagged `needs_clearer_file` -- which, for Nigerian
# past questions, is most of the real uploads. The code already degrades
# honestly there rather than crashing; this is what stops it having to.
#
# Pinned to 3.12.7, which is where render.yaml's PYTHON_VERSION used to hold
# it: the fastembed and onnxruntime wheels lag the newest Python.
FROM python:3.12.7-slim-bookworm

# tesseract-ocr is the engine; tesseract-ocr-eng is its English model, shipped
# as a separate package and the only language this ingests. pytesseract finds
# the binary on PATH, so TESSERACT_CMD does not need setting -- it stays
# available as an override for anyone running this elsewhere.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Requirements before source, so the dependency layer survives a source-only
# change. The install is the slow half of the build by a wide margin.
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY . .

# Not root, and the cache has to land somewhere this user can write: fastembed
# pulls ~130MB on first use, so a read-only home turns a slow first request
# into a hard runtime error.
RUN useradd --create-home --uid 10001 app && chown -R app:app /app
USER app
ENV FASTEMBED_CACHE_PATH=/home/app/.cache/fastembed \
    HF_HOME=/home/app/.cache/huggingface

# Render assigns $PORT and fails the health check against anything else. Shell
# form so it expands; the 8000 default is for running the image by hand.
EXPOSE 8000
CMD ["sh", "-c", "exec python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
