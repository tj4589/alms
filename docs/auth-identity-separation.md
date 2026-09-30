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
for an eligible account, idempotently. KSA MVP access is a separate unique-code
claim: an authenticated user may claim one unused canonical `KSA-##` value.

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

## KSA MVP claim model

KSA access is not backed by an official roster in this MVP. The existing
`ksa_member_registry` table is reused as the unique claim table; its
`ksa_id` and `claimed_by_user_id` database uniqueness constraints protect the
claim race and enforce one KSA ID per account. Valid input is exactly
`KSA-##`, where `##` is two decimal digits from `00` through `99`.

Surrounding whitespace is trimmed and the prefix is normalized to uppercase, so
` ksa-07 ` is stored as `KSA-07`; the separator and two-digit width remain
required. `KSA-00` is accepted because no business rule currently excludes it.

A successful claim creates or reuses an active KSA membership, stores the
canonical ID, sets the active space to KSA, and leaves KSA onboarding pending
until the existing onboarding endpoint completes. Repeating the same claim is
safe; attempting a different ID after setup is rejected. A competing account
receives a conflict without owner information. The admin import endpoint is
retained as optional legacy/future cohort metadata tooling and is not required
for normal MVP claims. Future official verification can add roster, invite or
approval checks without replacing the membership relationship.

## KSA claim administration and history

KSA claim administration is restricted to global ExamMind administrators
(`User.role == "admin"`). Ordinary members, moderators, learning-space admins,
and learning-space owners do not receive claim-administration authority merely
from their space role. The shared `require_global_admin` dependency is the
server-side authorization path for KSA claim administration.

The additive `0002_ksa_claim_audit` migration creates the append-only
`ksa_claim_audits` table. New successful claims record a `CLAIMED` event with
the canonical ID, claimant, actor, timestamp, reason, and source metadata.
Repeated idempotent verification does not create duplicate events. Existing
claims are not backfilled: their original actor and event time cannot be
reconstructed truthfully, so history begins with future claim transitions.
Claimant and administrator foreign keys use `SET NULL`, preserving the KSA ID,
action, timestamp, and reason if either account is later removed. Release and
reassignment events are representable in the model but are intentionally not
exposed until the later claim-recovery phase.

The KSA claim invariant is that an active claim's `KsaMember.ksa_id` matches
the active KSA membership's `external_member_id` when that membership exists.
Claim creation checks this invariant and fails safely rather than repairing
existing inconsistent data automatically.

## Controlled KSA claim release

Global administrators may release an incorrectly claimed KSA ID through the
admin-only release endpoint. Release is not reassignment: it clears the claim
owner, marks the claimant's KSA membership inactive, clears only a KSA active
space pointer, and leaves the ID available for a later normal claim. CU and
other learning-space memberships, resources, transcripts, conversations,
quizzes, progress, and contribution history are not touched.

The inactive membership row is retained for history, but its
`external_member_id` is cleared intentionally. The existing unique constraint
on `(learning_space_id, external_member_id)` would otherwise prevent another
user from reclaiming the released ID. A former claimant may reclaim the ID
later only through the normal KSA verification flow; the retained membership
row is reactivated safely and its onboarding state returns to pending. Each
successful release creates exactly one `RELEASED` audit event. Repeating a
release is rejected with a conflict and does not create another event.

## Global versus learning-space roles

`User.role` is the global application-level authority. `User.role == "admin"`
is the global administration boundary used for cross-space support operations.

`LearningSpaceMembership.role` is the scope-specific authority. Contribution
moderation is allowed for an active membership in the target learning space
whose role is `owner`, `admin`, or `moderator`. A plain `User.role ==
"moderator"` does not grant global or cross-space moderation access.

The additive `0003_learning_space_role_audit` migration provides append-only
history for future scoped role transitions. S5.1 adds the recording boundary;
promotion and demotion endpoints remain intentionally deferred.
