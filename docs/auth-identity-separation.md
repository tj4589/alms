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

The CU-domain helper remains outside global Firebase token validation. The
explicit `/learning-spaces` flow uses it to provision one active CU membership
for an eligible account, idempotently. KSA access remains registry-claim based
and is deferred to the later authorization phase.

## Initialization backfill decision

The explicit `seed_learning_spaces(backfill_users=True)` compatibility path is
retained for existing CU accounts, but it now evaluates the configured CU
eligibility policy before creating a missing CU membership. It is idempotent,
does not remove memberships, and never assigns CU membership to a non-CU
identity. The authenticated `GET /learning-spaces` request is the separate,
user-facing CU entry trigger for eligible accounts. Firebase session creation
still never creates a membership.

The backfill remains an explicit initialization/administrative action rather
than an authentication side effect. A CU resource is also checked against its
approved contribution space: CU-scoped resources require an active CU
membership and the CU active-space context; a manually supplied active-space
ID cannot grant access. The no-membership user experience is handled later.
