"""
ExamMind smoke test — runs against a live local server.
Start the server first: python -m uvicorn main:app --reload --host 127.0.0.1 --port 8001
Or run this script with --start to launch it automatically.
"""

import os
import sys
import time
import json
import urllib.request
import urllib.error
import urllib.parse
import subprocess

BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = os.getenv("BACKEND_PORT", "8001")
BASE = f"http://{BACKEND_HOST}:{BACKEND_PORT}"
PASS = []
FAIL = []


# ── Helpers ────────────────────────────────────────────────────────────────────

def req(method, path, body=None, token=None, form=False):
    url = BASE + path
    headers = {"Content-Type": "application/json"}
    if form:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None
    if body:
        if form:
            data = urllib.parse.urlencode(body).encode()
        else:
            data = json.dumps(body).encode()
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
    except Exception as e:
        return 0, {"error": str(e)}


def check(label, status, body, expect_status=200, check_fn=None):
    ok = status == expect_status
    if ok and check_fn:
        ok = check_fn(body)
    symbol = "PASS" if ok else "FAIL"
    detail = ""
    if not ok:
        detail = f" | got {status}: {str(body)[:120]}"
    print(f"  [{symbol}] {label}{detail}")
    (PASS if ok else FAIL).append(label)
    return body if ok else None


# ── Server start ───────────────────────────────────────────────────────────────

def wait_for_server(timeout=120):
    print("Waiting for server (fastembed model may download on first start ~130 MB)...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(BASE + "/", timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(2)
    return False


proc = None
if "--start" in sys.argv:
    print("Starting uvicorn...")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", BACKEND_HOST, "--port", BACKEND_PORT],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )

if not wait_for_server(120):
    print("ERROR: Server did not start in time.")
    if proc:
        proc.terminate()
    sys.exit(1)

print("Server is up.\n")

# ── Tests ──────────────────────────────────────────────────────────────────────

TEST_EMAIL = "smoketest@stu.cu.edu.ng"
TEST_USERNAME = "smoketest99"
TEST_PASSWORD = "testpass123"
token = None

print("── Auth ──────────────────────────────────────────────────────")

# Health
s, b = req("GET", "/")
check("GET /  (health)", s, b, check_fn=lambda b: b.get("status") == "ok")

# Register
s, b = req("POST", "/auth/register", {
    "name": "Smoke Test",
    "username": TEST_USERNAME,
    "email": TEST_EMAIL,
    "password": TEST_PASSWORD,
    "role": "student",
})
# 200 = created, 400 = already exists (both acceptable)
check("POST /auth/register", s, b, expect_status=s if s in (200, 400) else 200,
      check_fn=lambda b: "id" in b or "already" in str(b).lower())

# Login
s, b = req("POST", "/auth/login",
           {"username": TEST_EMAIL, "password": TEST_PASSWORD}, form=True)
r = check("POST /auth/login", s, b, check_fn=lambda b: "access_token" in b)
if r:
    token = r["access_token"]

# /auth/me
if token:
    s, b = req("GET", "/auth/me", token=token)
    check("GET /auth/me", s, b, check_fn=lambda b: b.get("email") == TEST_EMAIL)

print("\n── Courses & past questions ──────────────────────────────────")

s, b = req("GET", "/courses", token=token)
check("GET /courses", s, b, check_fn=lambda b: isinstance(b, list))

s, b = req("GET", "/past-questions", token=token)
check("GET /past-questions", s, b, check_fn=lambda b: isinstance(b, list))

print("\n── Study Groups ──────────────────────────────────────────────")

s, b = req("GET", "/study-groups", token=token)
check("GET /study-groups", s, b, check_fn=lambda b: isinstance(b, list))

s, b = req("POST", "/study-groups", {
    "name": "Smoke Test Group",
    "description": "Auto-created by smoke test",
    "topic": "Testing",
}, token=token)
group_id = check("POST /study-groups", s, b, check_fn=lambda b: "id" in b)
group_id = group_id["id"] if group_id else None

if group_id:
    s, b = req("POST", f"/study-groups/{group_id}/join", {}, token=token)
    check(f"POST /study-groups/{group_id}/join", s, b, check_fn=lambda b: "member_count" in b)

    s, b = req("POST", f"/study-groups/{group_id}/leave", {}, token=token)
    check(f"POST /study-groups/{group_id}/leave", s, b, check_fn=lambda b: "member_count" in b)

print("\n── Reading Rooms (Study Sessions) ────────────────────────────")

s, b = req("GET", "/study-sessions", token=token)
check("GET /study-sessions", s, b, check_fn=lambda b: isinstance(b, list))

s, b = req("POST", "/study-sessions", {
    "title": "Smoke Test Room",
    "topic": "Testing",
    "exam_goal": "Verify the API works end to end",
}, token=token)
session = check("POST /study-sessions", s, b, check_fn=lambda b: "id" in b)
session_id = session["id"] if session else None

if session_id:
    s, b = req("GET", f"/study-sessions/{session_id}", token=token)
    check(f"GET /study-sessions/{session_id}", s, b, check_fn=lambda b: b.get("id") == session_id)

    s, b = req("POST", f"/study-sessions/{session_id}/heartbeat", {}, token=token)
    check("POST /heartbeat", s, b)

    s, b = req("POST", f"/study-sessions/{session_id}/break", {}, token=token)
    check("POST /break", s, b)

    s, b = req("POST", f"/study-sessions/{session_id}/back", {}, token=token)
    check("POST /back", s, b)

    s, b = req("POST", f"/study-sessions/{session_id}/messages", {"content": "Hello smoke test"}, token=token)
    check("POST /messages", s, b, check_fn=lambda b: "id" in b)

    s, b = req("GET", f"/study-sessions/{session_id}/messages", token=token)
    check("GET /messages", s, b, check_fn=lambda b: isinstance(b, list) and len(b) > 0)

    s, b = req("GET", f"/study-sessions/{session_id}/ai-board", token=token)
    check("GET /ai-board", s, b, check_fn=lambda b: isinstance(b, list))

print("\n── Discussion Threads ────────────────────────────────────────")

s, b = req("GET", "/threads", token=token)
check("GET /threads", s, b, check_fn=lambda b: isinstance(b, list))

s, b = req("POST", "/threads", {"title": "Smoke test thread"}, token=token)
thread = check("POST /threads", s, b, check_fn=lambda b: "id" in b)
thread_id = thread["id"] if thread else None

if thread_id:
    s, b = req("POST", f"/threads/{thread_id}/message", {"content": "Test message"}, token=token)
    check("POST /threads message", s, b, check_fn=lambda b: "id" in b)

print("\n── Smart Search ──────────────────────────────────────────────")

s, b = req("GET", "/search?q=algorithm", token=token)
check("GET /search?q=algorithm", s, b,
      check_fn=lambda b: all(k in b for k in ("past_questions", "threads", "study_groups", "study_sessions")))

print("\n── AI (DeepSeek + fastembed) ─────────────────────────────────")
print("  (first run downloads fastembed model — may take 30-60s)")

s, b = req("POST", "/rag/ask", {
    "question": "What is a binary search tree?",
    "course_id": None,
}, token=token)
check("POST /rag/ask", s, b,
      expect_status=s if s in (200, 503) else 200,
      check_fn=lambda b: "answer" in b or "detail" in b)
if s == 200:
    ans = b.get("answer", "")
    print(f"  AI answer preview: {ans[:120]}...")

if session_id:
    s, b = req("POST", f"/study-sessions/{session_id}/ask-ai", {
        "question": "What is dynamic programming?",
    }, token=token)
    check("POST /ask-ai (room board)", s, b,
          expect_status=s if s in (200, 503) else 200,
          check_fn=lambda b: "answer" in b or "detail" in b)

print("\n── Cleanup: leave room ───────────────────────────────────────")
if session_id:
    s, b = req("POST", f"/study-sessions/{session_id}/leave", {}, token=token)
    check("POST /leave", s, b)

# ── Summary ────────────────────────────────────────────────────────────────────

total = len(PASS) + len(FAIL)
print(f"\n{'─'*55}")
print(f"Results: {len(PASS)}/{total} passed")
if FAIL:
    print("Failed:")
    for f in FAIL:
        print(f"  ✗ {f}")
else:
    print("All tests passed.")

if proc:
    proc.terminate()

sys.exit(0 if not FAIL else 1)
