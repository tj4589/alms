import os
import sys
import time
import unittest
from unittest.mock import MagicMock, patch

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jose import jwt


os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("FIREBASE_PROJECT_ID", "exammind-509123")
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_ID", "web-client-id.apps.googleusercontent.com")
os.environ.setdefault(
    "ALLOWED_SCHOOL_EMAIL_DOMAINS",
    "stu.cu.edu.ng,covenantuniversity.edu.ng",
)
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import auth  # noqa: E402
import firebase_tokens  # noqa: E402
import models  # noqa: E402
import schemas  # noqa: E402
from routers import auth as auth_router  # noqa: E402


PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PUBLIC_KEY = PRIVATE_KEY.public_key().public_bytes(
    serialization.Encoding.PEM,
    serialization.PublicFormat.SubjectPublicKeyInfo,
).decode("ascii")


def signed_token(claims: dict) -> str:
    return jwt.encode(claims, PRIVATE_KEY, algorithm="RS256", headers={"kid": "test-key"})


def firebase_claims(**overrides: object) -> dict:
    now = int(time.time())
    claims = {
        "sub": "firebase-user-123",
        "aud": "exammind-509123",
        "iss": "https://securetoken.google.com/exammind-509123",
        "exp": now + 300,
        "iat": now - 30,
        "auth_time": now - 30,
        "email": "student@stu.cu.edu.ng",
        "email_verified": True,
        "firebase": {"sign_in_provider": "password"},
    }
    claims.update(overrides)
    return claims


class FirebaseTokenTests(unittest.TestCase):
    def setUp(self) -> None:
        self.cert_patch = patch.object(
            firebase_tokens._certificate_cache,
            "get",
            return_value={"test-key": PUBLIC_KEY},
        )
        self.cert_patch.start()

    def tearDown(self) -> None:
        self.cert_patch.stop()

    def test_official_certificate_urls_are_accepted(self) -> None:
        self.assertEqual(
            firebase_tokens.validate_certificate_url(
                "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com"
            ),
            "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
        )
        self.assertEqual(
            firebase_tokens.validate_certificate_url("https://www.googleapis.com/oauth2/v3/certs"),
            "https://www.googleapis.com/oauth2/v3/certs",
        )

    def test_non_https_certificate_urls_are_rejected(self) -> None:
        for url in (
            "http://www.googleapis.com/certs",
            "https://",
            "https://[malformed",
            "https://user:password@www.googleapis.com/certs",
        ):
            with self.subTest(url=url), self.assertRaises(firebase_tokens.FirebaseTokenError):
                firebase_tokens.validate_certificate_url(url)

    def test_development_auth_token_cannot_bypass_application_authentication(self) -> None:
        with self.assertRaises(HTTPException):
            auth.get_current_user(
                token="exammind:local-development-session",
                db=MagicMock(),
            )

    def test_supported_and_unsupported_school_domains(self) -> None:
        self.assertTrue(firebase_tokens.is_allowed_school_email("student@stu.cu.edu.ng"))
        self.assertTrue(firebase_tokens.is_allowed_school_email("student@covenantuniversity.edu.ng"))
        self.assertFalse(firebase_tokens.is_allowed_school_email("student@gmail.com"))
        self.assertFalse(firebase_tokens.is_allowed_school_email("student@evil-stu.cu.edu.ng"))

    def test_successful_email_verification(self) -> None:
        claims = firebase_tokens.verify_firebase_id_token(signed_token(firebase_claims()))
        self.assertEqual(claims["sub"], "firebase-user-123")
        self.assertEqual(claims["email"], "student@stu.cu.edu.ng")

    def test_unverified_email_is_rejected(self) -> None:
        with self.assertRaises(firebase_tokens.FirebaseTokenError):
            firebase_tokens.verify_firebase_id_token(
                signed_token(firebase_claims(email_verified=False))
            )

    def test_expired_token_is_rejected(self) -> None:
        with self.assertRaises(firebase_tokens.FirebaseTokenError):
            firebase_tokens.verify_firebase_id_token(
                signed_token(firebase_claims(exp=int(time.time()) - 120))
            )

    def test_incorrect_audience_and_issuer_are_rejected(self) -> None:
        with self.assertRaises(firebase_tokens.FirebaseTokenError):
            firebase_tokens.verify_firebase_id_token(
                signed_token(firebase_claims(aud="another-project"))
            )
        with self.assertRaises(firebase_tokens.FirebaseTokenError):
            firebase_tokens.verify_firebase_id_token(
                signed_token(firebase_claims(iss="https://securetoken.google.com/another-project"))
            )

    def test_google_hosted_domain_token_is_accepted(self) -> None:
        claims = firebase_claims(
            email="student@covenantuniversity.edu.ng",
            firebase={"sign_in_provider": "google.com"},
        )
        firebase_tokens.verify_firebase_id_token(signed_token(claims))
        google_claims = {
            "sub": "google-user-123",
            "aud": "web-client-id.apps.googleusercontent.com",
            "iss": "https://accounts.google.com",
            "exp": int(time.time()) + 300,
            "iat": int(time.time()) - 30,
            "email": "student@covenantuniversity.edu.ng",
            "email_verified": True,
            "hd": "covenantuniversity.edu.ng",
        }
        verified = firebase_tokens.verify_google_provider_token(
            signed_token(google_claims),
            expected_email="student@covenantuniversity.edu.ng",
        )
        self.assertEqual(verified["hd"], "covenantuniversity.edu.ng")

    def test_google_hosted_domain_login_issues_application_session(self) -> None:
        firebase_claim = firebase_claims(
            email="student@covenantuniversity.edu.ng",
            firebase={"sign_in_provider": "google.com"},
        )
        user = models.User(
            id=42,
            name="Covenant Student",
            username="covenant_student",
            email="student@covenantuniversity.edu.ng",
            firebase_uid="firebase-user-123",
            role="student",
        )
        payload = schemas.FirebaseSessionRequest(
            firebase_id_token="firebase-token",
            google_id_token="google-token",
            provider="google",
        )
        with patch.object(auth_router, "verify_firebase_id_token", return_value=firebase_claim):
            with patch.object(auth_router, "verify_google_provider_token", return_value={"hd": "covenantuniversity.edu.ng"}):
                with patch.object(auth, "get_or_create_firebase_user", return_value=user):
                    response = auth_router.firebase_session(payload, MagicMock())

        self.assertEqual(response["token_type"], "bearer")
        self.assertTrue(response["access_token"])
        self.assertIs(response["user"], user)

    def test_personal_gmail_google_token_is_rejected(self) -> None:
        google_claims = {
            "sub": "google-user-123",
            "aud": "web-client-id.apps.googleusercontent.com",
            "iss": "https://accounts.google.com",
            "exp": int(time.time()) + 300,
            "iat": int(time.time()) - 30,
            "email": "student@gmail.com",
            "email_verified": True,
            "hd": "gmail.com",
        }
        with self.assertRaises(firebase_tokens.FirebaseTokenError):
            firebase_tokens.verify_google_provider_token(
                signed_token(google_claims), expected_email="student@gmail.com"
            )

    def test_existing_user_is_linked_by_verified_email(self) -> None:
        existing = models.User(
            name="Existing Student",
            username="existing_student",
            email="student@stu.cu.edu.ng",
            password_hash="legacy-hash",
            role="student",
        )
        query = MagicMock()
        query.filter.return_value = query
        query.first.side_effect = [None, existing]
        db = MagicMock()
        db.query.return_value = query

        result = auth.get_or_create_firebase_user(
            db,
            firebase_uid="firebase-user-123",
            email="student@stu.cu.edu.ng",
            claims=firebase_claims(),
            name="A different display name",
            username="new_name",
        )

        self.assertIs(result, existing)
        self.assertEqual(existing.firebase_uid, "firebase-user-123")
        self.assertEqual(existing.name, "Existing Student")
        self.assertEqual(existing.username, "existing_student")
        self.assertEqual(existing.password_hash, "legacy-hash")
        db.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
