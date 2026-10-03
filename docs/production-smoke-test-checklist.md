# ExamMind KSA MVP production smoke-test checklist

Status: preparation artifact only. Production execution is **NOT RUN**.

This checklist reproduces the exact 24-step workflow from the S16
`AUTHORIZED PRODUCTION SMOKE-TEST PLAN`. It is not a substitute workflow and
must not be run against production credentials until an authorized operator
approves the test window.

## Test boundary and prerequisites

### Targets

- **Local verification:** the local API and frontend, with isolated fixtures
  and a disposable validation database where database-backed behavior is
  required. Local results are recorded as `LOCAL VERIFIED` only.
- **Production smoke test:** the authorized Render frontend/API, current
  production Firebase project, the supported KSA self-claim/verification and
  administrator-recovery flow, and the current Neon database. A result is
  `PRODUCTION VERIFIED` only after the step is actually performed against
  that configuration. A preloaded KSA registry is not a prerequisite.

### Required accounts and roles

- A dedicated Google/Firebase student account with a valid, unused KSA ID.
- The same student account retained for the returning-login and persistence
  checks.
- A separate KSA moderator account with the documented active moderator
  membership.
- A separate global-admin account only for pre-test setup or recovery that
  requires global-admin authorization. It is not used to prove student access.
- No CU-only account is used as evidence that KSA access works.

### Required test materials

- A small, non-sensitive PDF with stable unique text on a known page.
- A small, non-sensitive PPTX with stable unique text on a known slide.
- A short, non-sensitive audio file whose spoken phrases map to expected
  transcript timestamps.
- A short study topic represented in the PDF/PPTX so Maxe, quiz generation and
  readiness evidence can be checked without fabricated content.
- A written record of expected page, slide and timestamp coordinates.

Do not upload student records, copyrighted material without permission,
credentials, private lecturer comments or real personal data for this test.

### Evidence rules

For every step record the UTC timestamp, environment, test account role,
resource/share/attempt identifier where available, HTTP/UI result, and a
redacted screenshot or response summary. Never record tokens, Firebase ID
tokens, credentials, raw provider responses or private content in the report.

Each step must be marked independently as `LOCAL VERIFIED`, `PRODUCTION
VERIFIED`, `BLOCKED`, or `NOT RUN`. A fixture response or mocked provider is
never production evidence.

## The exact 24-step workflow

1. **Real Google sign-in**
   - Target: authorized production Firebase configuration (local first with an
     isolated test project if available).
   - Expected: the dedicated student completes Google sign-in and ExamMind
     creates/loads the authenticated identity without exposing workspace data
     before access is established.
   - Evidence: redacted successful sign-in and landing state.
   - Data/cost/cleanup: creates or updates only the test identity; Firebase
     authentication and any provider costs are subject to the approved test
     window.

2. **KSA ID claim**
   - Target: KSA verification and membership flow.
   - Expected: the valid KSA ID is accepted once through the supported
     self-claim flow, the membership is created, and duplicate/claimed-ID
     protections remain effective. If an administrator must recover or release
     a claim, use the audited administrator flow; do not edit the database
     directly.
   - Evidence: redacted verification result, membership state, and audit event
     identifier if displayed.
   - Data/cost/cleanup: creates one test KSA membership; do not reuse or alter
     another student's claim.

3. **Returning login**
   - Target: sign out and sign in again with the same student account.
   - Expected: the verified KSA membership is recognized without repeating the
     claim, and the user is routed to the correct onboarding or dashboard
     state.
   - Evidence: before/after route and membership state.
   - Data/cost/cleanup: no new membership; stop if a second claim is required.

4. **PDF upload**
   - Target: authorized KSA workspace.
   - Expected: the test PDF uploads within configured limits and enters the
     documented processing/metadata review flow.
   - Evidence: resource identifier, processing state and safe filename.
   - Data/cost/cleanup: creates one test resource and storage record; remove it
     only through the supported test cleanup path after the workflow.

5. **PPTX upload**
   - Target: the same authorized KSA workspace.
   - Expected: the test PPTX uploads and preserves slide-aware extraction and
     metadata review.
   - Evidence: resource identifier and detected slide/document metadata.
   - Data/cost/cleanup: creates one test resource; no binary content belongs in
     evidence logs.

6. **Audio upload**
   - Target: the same authorized KSA workspace.
   - Expected: the short audio file uploads, remains retained during processing,
     and displays the supported processing state.
   - Evidence: resource identifier, audio metadata and processing state.
   - Data/cost/cleanup: may create storage and transcription-provider cost;
     preserve the original only as required by the documented policy, then use
     supported cleanup.

7. **Real transcription**
   - Target: authorized transcription provider configuration.
   - Expected: the audio receives a timestamped transcript, or the product
     reports unavailable transcription without claiming success or deleting
     the source audio.
   - Evidence: safe provider status, transcript state and one redacted segment
     coordinate; never record the API response body or key.
   - Data/cost/cleanup: this is the step most likely to incur a paid provider
     call; obtain explicit approval and set a cost limit before running it.

8. **Reader opening**
   - Target: the KSA student Reader.
   - Expected: the student can open each authorized test resource and sees the
     appropriate PDF, slide or audio reading surface.
   - Evidence: resource title/type, route and screenshot at desktop/mobile
     widths.
   - Data/cost/cleanup: read-only access; stop on cross-space or private-content
     exposure.

9. **Page citation**
   - Target: PDF Reader and a grounded Maxe/source result where applicable.
   - Expected: the page citation opens the test PDF at the expected page and
     does not point to a different resource.
   - Evidence: citation label, target resource ID and page number.
   - Data/cost/cleanup: read-only; no additional provider call unless the
     approved Maxe step requires it.

10. **Slide citation**
    - Target: PPTX Reader and source citation.
    - Expected: the slide citation opens the expected slide in the test deck.
    - Evidence: citation label, target resource ID and slide number.
    - Data/cost/cleanup: read-only; stop if page coordinates are incorrectly
      presented as slide coordinates.

11. **Timestamp citation**
    - Target: audio Reader/transcript.
    - Expected: the timestamp citation opens or seeks to the expected segment
      and preserves valid start/end bounds.
    - Evidence: citation label, resource ID and timestamp range.
    - Data/cost/cleanup: read-only; stop if an invented timestamp or another
      user's transcript is displayed.

12. **Maxe grounded answer**
    - Target: authenticated KSA student, source mode.
    - Expected: Maxe answers from resources the student is authorized to access
      and includes verified citations to the test material.
    - Evidence: redacted question, answer status, citation IDs/coordinates and
      provider status. Do not record credentials or full private source text.
    - Data/cost/cleanup: may incur an AI-provider call; use one bounded prompt
      and record the provider/cost according to the approved window.

13. **Knowledge gap**
    - Target: the same Maxe source mode with a question not supported by the
      test material.
    - Expected: Maxe clearly states that the available sources do not establish
      the answer and does not fabricate a citation or fact.
    - Evidence: redacted response and absence of unsupported citation.
    - Data/cost/cleanup: may incur one provider call; do not convert the result
      into learning evidence.

14. **Beyond Materials**
    - Target: the same authenticated student with Beyond Materials enabled.
    - Expected: the mode is visibly distinct, uses its documented provider and
      does not present external/general content as source-grounded material.
    - Evidence: mode indicator, safe response state and any disclosed source
      status.
    - Data/cost/cleanup: may incur one provider call; no citation should be
      fabricated for unsupported material.

15. **Quiz generation**
    - Target: a resource-specific or authorized workspace/topic quiz.
    - Expected: questions are generated only from accessible material and each
      question retains source provenance.
    - Evidence: quiz ID, question count, difficulty/type and source IDs.
    - Data/cost/cleanup: may incur an AI-provider call; creates a quiz record
      and should be removed through supported cleanup if policy permits.

16. **Quiz submission**
    - Target: the student quiz attempt.
    - Expected: answers submit once, grading/review is shown, and a retake does
      not overwrite the original attempt.
    - Evidence: attempt IDs, graded/ungraded result state and review screen.
    - Data/cost/cleanup: creates private learning evidence owned by the student;
      do not expose it to moderator or other-student accounts.

17. **Readiness**
    - Target: the student's learning profile/readiness view.
    - Expected: insufficient evidence remains a progress message; supported
      completed attempts show only the explainable formula and evidence used.
    - Evidence: threshold progress, topic coverage, attempt recency and
      readiness state. No IQ or predicted exam-performance claim.
    - Data/cost/cleanup: creates private learning data; retain or remove only
      through the documented student data policy.

18. **KSA contribution**
    - Target: the student contribution flow for an approved test resource.
    - Expected: explicit contribution consent and metadata are submitted to the
      KSA moderation queue without making the resource public automatically.
    - Evidence: contribution ID, visibility/approval state and consent record.
    - Data/cost/cleanup: creates a moderation item; stop if private content is
      published without explicit confirmation.

19. **Moderator approval**
    - Target: separate KSA moderator account.
    - Expected: the moderator can review and approve the permitted contribution;
      non-moderators cannot perform the transition.
    - Evidence: moderation result, actor role and audit event, with identifiers
      redacted as needed.
    - Data/cost/cleanup: changes test-resource visibility/state; reverse through
      supported moderation controls, not direct database edits.

20. **Resource share link**
    - Target: authorized owner/resource sharing UI.
    - Expected: a supported share policy creates a link, the newly created token
      can be copied, and listing remains tokenless for older links.
    - Evidence: link status, expiry and redacted URL shape; never record a live
      token in the report.
    - Data/cost/cleanup: creates a share-link record; revoke it in step 21.

21. **Revoke share link**
    - Target: the resource owner or authorized role.
    - Expected: revocation succeeds once, the displayed state refreshes, and
      the revoked link cannot retrieve protected content.
    - Evidence: revocation response and isolated retrieval denial.
    - Data/cost/cleanup: revokes the step-20 link; do not delete another user's
      link.

22. **Authorized download**
    - Target: an authorized student/resource download or export action.
    - Expected: the supported format downloads with the safe server-provided
      filename and content matching the authorized test resource; denied users
      do not receive an error body as a file.
    - Evidence: status, content type, filename and checksum/size of the test
      artifact without storing its private contents.
    - Data/cost/cleanup: creates a local download only; remove local copies
      after review.

23. **Logout**
    - Target: the student browser session.
    - Expected: logout clears the active authenticated session and protected
      workspace content is no longer available through the UI.
    - Evidence: post-logout route and denied protected request state.
    - Data/cost/cleanup: no resource mutation; clear local browser profile after
      evidence capture.

24. **Login persistence**
    - Target: a fresh browser load followed by login with the same student.
    - Expected: the account returns to the correct KSA state, retains permitted
      resource/learning context, and does not expose another user's active
      space or private data.
    - Evidence: fresh-load route, active-space state and protected access check.
    - Data/cost/cleanup: final test-state review; remove only explicitly
      disposable test records and retain required audit/provenance records.

## Stop conditions and recovery

Stop immediately and record the step if any of the following occurs:

- a user can access another learning space, private resource, transcript,
  quiz attempt or readiness evidence;
- a citation resolves to a different resource/coordinate or is fabricated;
- a private upload becomes public without explicit consent;
- an unauthorized role can approve, share, download, export, revoke or delete;
- a provider returns a false success, exposes a secret, or exceeds the approved
  timeout/cost boundary;
- a migration, health check or deployment state is unclear;
- a 5xx, CORS failure, blank route, runtime error or horizontal overflow blocks
  the workflow.

Do not repeatedly retry a destructive or billable operation. Preserve the
redacted request/result identifiers, revoke any test share link, sign out test
accounts, and contact the authorized operator. Do not reset, recreate, stamp or
delete a production database as recovery. Use the existing migration
verification/stamp procedure and supported account/resource cleanup only after
the operator approves it.

## Evidence ledger

| Step | Local result | Production result | Evidence reference | Cleanup/cost note |
| --- | --- | --- | --- | --- |
| 1–24 | NOT RUN until isolated fixtures are selected | NOT RUN | — | Record each step separately; no production execution in this review |

This document is intentionally left uncommitted for review with S16.
