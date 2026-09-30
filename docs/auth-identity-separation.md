# Global identity and learning-space eligibility

S3.1 separates ExamMind identity from institution-specific authorization.

## Identity

Firebase verification establishes a global ExamMind identity after the token's
signature, project, issuer, audience, timing, subject, email and verification
claims pass validation. A verified email does not need to belong to a CU domain
to create or restore an ExamMind user.

Google's `hd` claim is not used for global identity validation. When Google
sign-in is used, the Google ID token still requires valid signature, issuer,
audience, verified email, and agreement with the Firebase account email.

## Learning-space access

Firebase session creation does not create CU or KSA membership. A new identity
may have no memberships and a null `active_learning_space_id`. Existing
memberships remain authoritative and are not removed by initialization.

The CU-domain helper remains available for the later CU authorization phase; it
is not part of global Firebase token validation. KSA access remains registry-
claim based and is deferred to the later authorization phase.

## Initialization backfill decision

The explicit `seed_learning_spaces(backfill_users=True)` compatibility path is
retained for existing CU accounts, but it now evaluates the configured CU
eligibility policy before creating a missing CU membership. It is idempotent,
does not remove memberships, and never assigns CU membership to a non-CU
identity. Normal `/learning-spaces` reads no longer lazily create membership.

The backfill remains an explicit initialization/administrative action rather
than an authentication side effect. CU authorization and the no-membership
user experience are handled in S3.2 and later phases.
