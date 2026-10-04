"""Run declared unittest fixtures without .env/provider/production access.

Loopback sockets remain available for Windows asyncio self-pipes/TestClient.
This is not a substitute for isolated PostgreSQL migration validation.
"""
import os
from pathlib import Path
import socket
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT / 'backend')
sys.path.insert(0, str(ROOT / 'backend'))
os.environ.update({
    'DATABASE_URL': 'postgresql+psycopg://test:test@127.0.0.1:9/isolated_tests',
    'SECRET_KEY': 'isolated-local-test-secret', 'APP_ENV': 'test', 'ENV': 'test',
    'AI_PROVIDER': 'disabled', 'AI_FALLBACK_PROVIDER': 'disabled',
    'DEEPSEEK_API_KEY': '', 'COHERE_API_KEY': '', 'OPENAI_API_KEY': '',
    # Match test_firebase_auth's signed-token fixtures before any router import.
    'FIREBASE_PROJECT_ID': 'exammind-509123',
    'GOOGLE_OAUTH_CLIENT_ID': 'web-client-id.apps.googleusercontent.com',
})
connect = socket.socket.connect
connect_ex = socket.socket.connect_ex


def guard(method):
    def guarded(sock, address):
        if isinstance(address, tuple) and address[0] in {'127.0.0.1', '::1', 'localhost'}:
            return method(sock, address)
        raise OSError('External network access disabled in local tests')
    return guarded


socket.socket.connect = guard(connect)
socket.socket.connect_ex = guard(connect_ex)
pattern = sys.argv[1] if len(sys.argv) > 1 else 'test_*.py'
suite = unittest.defaultTestLoader.discover('tests', pattern=pattern)
result = unittest.TextTestRunner(verbosity=2).run(suite)
raise SystemExit(0 if result.wasSuccessful() else 1)
