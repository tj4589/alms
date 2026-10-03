# Object-storage follow-up

ExamMind currently keeps the original upload in the `file_data` binary column
on `lecture_notes` or `past_questions`. S13 deliberately prepares that design
for growth; it does not migrate existing data or change retention policy.

## Current safeguards

- `MAX_UPLOAD_BYTES` is enforced by the API while reading the multipart file in
  bounded chunks. A request over the limit is rejected with HTTP 413.
- The API accepts only the supported extensions and checks the supplied MIME
  type plus the file's container/signature. Generic browser MIME values are
  resolved from the detected type; a conflicting explicit MIME is rejected.
- Failed analysis does not create a resource row. FastAPI owns the temporary
  multipart file; persisted audio failures retain the original bytes and are
  marked unavailable for search.
- Metadata, list, search, quiz-source and Maxe-source queries defer
  `file_data`. Authorized download endpoints are the intentional exception.
- A future maintenance job may mark private audio rows that have remained in
  `processing` beyond `ABANDONED_PROCESSING_AGE_SECONDS` as failed. It is
  bounded, skips active/non-private/approved resources, and never deletes the
  retained source bytes.

The bounded maintenance entry point is `python -m run_storage_cleanup` from
`backend`. It should be scheduled explicitly by the deployment operator after
reviewing the age and batch settings; S13 does not add an automatic live cron.

## Migration plan

When database growth justifies object storage, introduce a versioned migration
and a dual-read/dual-write rollout:

1. Add an opaque object key, provider, checksum, size and content type to the
   resource records. Do not store public bucket URLs or credentials in API
   payloads.
2. Write new files to a private bucket and keep the database bytes as a
   temporary fallback until an integrity-checked backfill completes.
3. Backfill approved/shared and private resources in bounded, resumable batches;
   verify checksum and authorization before deleting any database bytes.
4. Serve downloads through short-lived authorized responses or signed URLs.
   Keep share-link revocation and learning-space checks in the API boundary.
5. Monitor failed copies and provide an operator rollback before removing the
   `file_data` column in a later migration.

The future bucket must use private-by-default access, encryption at rest,
bounded download responses, lifecycle rules that do not delete approved/shared
resources, and an explicit deletion/audit policy. S13 does not create the
bucket, migrate live data, or change who can access a resource.
