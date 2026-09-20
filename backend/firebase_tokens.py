"""Keyless verification for Firebase and Google identity tokens.

The API deliberately does not use the Firebase Admin SDK. Firebase publishes
the public certificates needed to verify ID-token signatures, and the cache
below honours the cache lifetime returned by Google's certificate endpoint.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Any, Mapping, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from jose import JWTError, jwt


logger = logging.getLogger(__name__)


FIREBASE_PROJECT_ID = os.getenv("FIREBASE_PROJECT_ID", "exammind-509123").strip()
FIREBASE_ISSUER = f"https://securetoken.google.com/{FIREBASE_PROJECT_ID}"
FIREBASE_CERTS_URL = os.getenv(
    "FIREBASE_CERTS_URL",
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
).strip()
GOOGLE_CERTS_URL = os.getenv(
    "GOOGLE_CERTS_URL", "https://www.googleapis.com/oauth2/v1/certs"
).strip()
GOOGLE_OAUTH_CLIENT_ID = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "").strip()
ALLOWED_SCHOOL_EMAIL_DOMAINS = {
    item.strip().lower()
    for item in os.getenv(
        "ALLOWED_SCHOOL_EMAIL_DOMAINS",
        "stu.cu.edu.ng,covenantuniversity.edu.ng",
    ).split(",")
    if item.strip()
}
CLOCK_SKEW_SECONDS = max(0, int(os.getenv("FIREBASE_CLOCK_SKEW_SECONDS", "60")))
CERT_FETCH_TIMEOUT_SECONDS = max(
    1, int(os.getenv("FIREBASE_CERT_FETCH_TIMEOUT_SECONDS", "10"))
)


class FirebaseTokenError(ValueError):
    """Raised for any invalid, untrusted, or incomplete identity token."""


@dataclass(frozen=True)
class _CertificateSet:
    certificates: dict[str, str]
    expires_at: float


class _CertificateCache:
    def __init__(self) -> None:
        self._items: dict[str, _CertificateSet] = {}
        self._lock = threading.Lock()

    def get(self, url: str, *, force_refresh: bool = False) -> dict[str, str]:
        url = validate_certificate_url(url)
        now = time.time()
        with self._lock:
            cached = self._items.get(url)
            if cached and not force_refresh and cached.expires_at > now:
                return cached.certificates

        try:
            request = Request(url, headers={"Accept": "application/json"})
            with urlopen(request, timeout=CERT_FETCH_TIMEOUT_SECONDS) as response:
                # urllib follows redirects; validate the final target too.
                validate_certificate_url(response.geturl() if hasattr(response, "geturl") else url)
                raw_body = response.read()
                headers = response.headers
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            logger.warning(
                "identity_certificate_fetch_failed error_type=%s",
                type(exc).__name__,
            )
            raise FirebaseTokenError("Identity verification is temporarily unavailable.") from exc
        except FirebaseTokenError:
            raise

        try:
            decoded = json.loads(raw_body.decode("utf-8"))
            if not isinstance(decoded, dict):
                raise ValueError("certificate response is not an object")
            certificates = {
                key: value.strip()
                for key, value in decoded.items()
                if (
                    isinstance(key, str)
                    and key
                    and isinstance(value, str)
                    and "-----BEGIN CERTIFICATE-----" in value
                    and "-----END CERTIFICATE-----" in value
                )
            }
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError) as exc:
            logger.warning(
                "identity_certificate_response_parse_failed format=x509_map error_type=%s",
                type(exc).__name__,
            )
            raise FirebaseTokenError("Identity verification is temporarily unavailable.") from exc
        except ValueError as exc:
            logger.warning(
                "identity_certificate_response_parse_failed format=x509_map reason=not_object",
            )
            raise FirebaseTokenError("Identity verification is temporarily unavailable.") from exc

        if not certificates:
            logger.warning(
                "identity_certificate_response_parse_failed format=x509_map reason=no_certificates",
            )
            raise FirebaseTokenError("Identity verification is temporarily unavailable.")

        expires_at = now + _cache_seconds(headers)
        with self._lock:
            self._items[url] = _CertificateSet(certificates, expires_at)
        return certificates


def _cache_seconds(headers: Any) -> int:
    cache_control = str(headers.get("Cache-Control", ""))
    match = re.search(r"(?:^|,)\s*max-age\s*=\s*(\d+)", cache_control, re.I)
    if match:
        return max(1, int(match.group(1)))

    expires = headers.get("Expires")
    if expires:
        try:
            seconds = int(parsedate_to_datetime(expires).timestamp() - time.time())
            return max(1, seconds)
        except (TypeError, ValueError, OverflowError):
            pass

    # A response without cache metadata is still cached briefly to prevent a
    # certificate request on every API call. The published endpoints normally
    # return max-age, so this is only a conservative fallback.
    return 300


_certificate_cache = _CertificateCache()


def validate_certificate_url(value: str) -> str:
    """Validate a certificate endpoint without exposing its value to clients."""
    if not isinstance(value, str) or not value.strip():
        raise FirebaseTokenError("Identity verification is not configured correctly.")

    candidate = value.strip()
    try:
        parsed = urlsplit(candidate)
        hostname = parsed.hostname
        # Accessing port forces urlsplit to reject malformed numeric ports.
        parsed.port
    except (TypeError, ValueError, AttributeError) as exc:
        raise FirebaseTokenError("Identity verification is not configured correctly.") from exc

    if (
        parsed.scheme != "https"
        or not parsed.netloc
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
        or any(character.isspace() for character in parsed.netloc)
    ):
        raise FirebaseTokenError("Identity verification is not configured correctly.")

    return candidate


def is_allowed_school_email(email: str) -> bool:
    value = email.strip().lower()
    local_part, separator, domain = value.rpartition("@")
    return bool(local_part and separator and domain in ALLOWED_SCHOOL_EMAIL_DOMAINS)


def _claim_int(claims: Mapping[str, Any], name: str) -> int:
    value = claims.get(name)
    if isinstance(value, bool) or not isinstance(value, int):
        raise FirebaseTokenError("Identity token claims are invalid.")
    return value


def _validate_common_claims(
    claims: Mapping[str, Any],
    *,
    audience: str,
    issuers: Sequence[str],
    require_auth_time: bool,
) -> dict[str, Any]:
    now = int(time.time())
    exp = _claim_int(claims, "exp")
    issued_at = _claim_int(claims, "iat")
    if exp <= now - CLOCK_SKEW_SECONDS or issued_at > now + CLOCK_SKEW_SECONDS:
        raise FirebaseTokenError("Identity token is expired or not yet valid.")
    if issued_at > exp:
        raise FirebaseTokenError("Identity token claims are invalid.")

    if require_auth_time:
        auth_time = _claim_int(claims, "auth_time")
        if auth_time > now + CLOCK_SKEW_SECONDS or auth_time > exp:
            raise FirebaseTokenError("Identity token claims are invalid.")

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject or len(subject) > 128:
        raise FirebaseTokenError("Identity token claims are invalid.")

    if claims.get("aud") != audience:
        raise FirebaseTokenError("Identity token audience is invalid.")
    if claims.get("iss") not in issuers:
        raise FirebaseTokenError("Identity token issuer is invalid.")
    return dict(claims)


def _verify_signed_token(
    token: str,
    *,
    audience: str,
    issuers: Sequence[str],
    certificates_url: str,
    require_auth_time: bool,
) -> dict[str, Any]:
    if not token or not isinstance(token, str):
        raise FirebaseTokenError("Identity token is invalid.")

    try:
        header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise FirebaseTokenError("Identity token is invalid.") from exc

    if header.get("alg") != "RS256" or not isinstance(header.get("kid"), str):
        raise FirebaseTokenError("Identity token header is invalid.")

    key_id = header["kid"]
    certificates = _certificate_cache.get(certificates_url)
    certificate = certificates.get(key_id)
    if certificate is None:
        # A cached certificate set can be briefly stale during key rotation.
        certificates = _certificate_cache.get(certificates_url, force_refresh=True)
        certificate = certificates.get(key_id)
    if certificate is None:
        raise FirebaseTokenError("Identity token signing key is invalid.")

    try:
        claims = jwt.decode(
            token,
            certificate,
            algorithms=["RS256"],
            options={
                "verify_exp": False,
                "verify_iat": False,
                "verify_aud": False,
                "verify_iss": False,
                "verify_sub": False,
                # ExamMind receives the Google ID token but does not receive
                # or use the matching Google access token. The ID token's
                # at_hash claim therefore cannot be checked here.
                "verify_at_hash": False,
            },
        )
    except JWTError as exc:
        raise FirebaseTokenError("Identity token signature is invalid.") from exc

    return _validate_common_claims(
        claims,
        audience=audience,
        issuers=issuers,
        require_auth_time=require_auth_time,
    )


def verify_firebase_id_token(token: str) -> dict[str, Any]:
    claims = _verify_signed_token(
        token,
        audience=FIREBASE_PROJECT_ID,
        issuers=(FIREBASE_ISSUER,),
        certificates_url=FIREBASE_CERTS_URL,
        require_auth_time=True,
    )
    if claims.get("email_verified") is not True:
        raise FirebaseTokenError("Email verification is required.")

    email = claims.get("email")
    if not isinstance(email, str) or not is_allowed_school_email(email):
        raise FirebaseTokenError("A Covenant University email is required.")
    claims["email"] = email.strip().lower()
    return claims


def verify_google_provider_token(token: str, *, expected_email: str) -> dict[str, Any]:
    if not GOOGLE_OAUTH_CLIENT_ID:
        raise FirebaseTokenError("Google sign-in is not configured.")

    claims = _verify_signed_token(
        token,
        audience=GOOGLE_OAUTH_CLIENT_ID,
        issuers=("https://accounts.google.com", "accounts.google.com"),
        certificates_url=GOOGLE_CERTS_URL,
        require_auth_time=False,
    )
    if claims.get("email_verified") is not True:
        raise FirebaseTokenError("Google email verification is required.")

    hosted_domain = claims.get("hd")
    if not isinstance(hosted_domain, str) or hosted_domain.strip().lower() not in ALLOWED_SCHOOL_EMAIL_DOMAINS:
        raise FirebaseTokenError("A Covenant University Google account is required.")

    provider_email = claims.get("email")
    if not isinstance(provider_email, str) or provider_email.strip().lower() != expected_email:
        raise FirebaseTokenError("Google account does not match the Firebase account.")
    return claims
