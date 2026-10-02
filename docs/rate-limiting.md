# Distributed rate limiting

ExamMind uses `rate_limit_buckets` in the shared PostgreSQL/Neon database as
the counter store. Each request is an atomic PostgreSQL upsert, so multiple API
instances cannot independently reset or exceed the same bucket. The limiter
does not use `X-Forwarded-For` or other caller-controlled forwarding headers.

## Protected operations

| Operation | Identity | Default limit/window |
| --- | --- | --- |
| Firebase session creation | direct client address | 10 / 15 minutes |
| KSA verification | authenticated user | 5 / 15 minutes |
| Uploads | authenticated user | 20 / hour |
| Maxe/RAG chat | authenticated user | 30 / minute |
| Reading-room AI | authenticated user | 20 / minute |
| Quiz generation | authenticated user | 10 / 15 minutes |
| Share-link creation | authenticated user | 20 / hour |
| Downloads | authenticated user | 60 / hour |
| Exports | authenticated user | 30 / hour |
| Share-link reads | SHA-256 of the token | 120 / 15 minutes |
| Public feedback | direct client address | 5 / 15 minutes |

The raw share token is never stored as the limiter identity or logged. Direct
socket addresses are used transiently for unauthenticated abuse protection;
they are not written to application records.

## Responses and failure policy

Requests above a configured bucket receive HTTP `429` and a numeric
`Retry-After` header. A database-backed limiter outage fails closed with HTTP
`503`, `Retry-After: 60`, and the protected handler is not entered. This is a
deliberate safety decision: the API never silently switches to process-local
state or lets an unavailable shared store turn off protection.

For isolated local development only, set `RATE_LIMIT_ENABLED=false` explicitly
when a disposable PostgreSQL instance is not available. This disables the
limiter; it is not a distributed fallback and must not be used for a deployed
multi-instance API.

## Configuration

Every rule has `RATE_LIMIT_<NAME>_LIMIT` and
`RATE_LIMIT_<NAME>_WINDOW_SECONDS` settings. The full list is in
`backend/.env.example` and is included in `render.yaml`. Keep
`RATE_LIMIT_FAILURE_MODE=closed`. The `rate_limit_buckets` migration must be
applied before starting an API that has limiting enabled.

No token, credential, uploaded file, question body, or limiter identity is
logged by this feature.
