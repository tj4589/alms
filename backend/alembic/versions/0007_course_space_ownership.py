"""Scope course catalogue rows to learning spaces.

The pre-space catalogue was the documented CU reference catalogue.  Those
known legacy rows are assigned to CU.  Any other pre-existing row remains
NULL and is intentionally fail-closed until a global administrator reviews
and assigns it; no row is deleted or guessed into KSA.
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_course_space"
down_revision = "0006_collaboration_space"
branch_labels = None
depends_on = None

# These are the reference rows created by backend/init_db.py before course
# ownership existed. Any other legacy row is intentionally left unassigned
# for global-admin review instead of being guessed into a learning space.
_KNOWN_CU_COURSE_CODES = (
    "CSC317",
    "CSC411",
    "CSC415",
    "MIS316",
    "MIS412",
    "MIS413",
    "MIS415",
    "MIS418",
)


def upgrade() -> None:
    op.add_column(
        "courses",
        sa.Column("learning_space_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_courses_learning_space",
        "courses",
        "learning_spaces",
        ["learning_space_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_courses_learning_space_id",
        "courses",
        ["learning_space_id"],
    )
    # init_db.py is the authoritative source for the original catalogue and
    # seeds it for CU. Do not infer ownership from users, uploads or creator
    # memberships. If CU has not been seeded yet, rows stay NULL and remain
    # restricted until an explicit assignment is made.
    op.execute(
        sa.text(
            """
            UPDATE courses AS course
            SET learning_space_id = space.id
            FROM learning_spaces AS space
            WHERE space.slug = 'cu'
              AND course.learning_space_id IS NULL
              AND course.code IN ({course_codes})
            """
            .format(course_codes=", ".join(f"'{code}'" for code in _KNOWN_CU_COURSE_CODES))
        )
    )


def downgrade() -> None:
    raise RuntimeError(
        "Course ownership is an authorization boundary; use a reviewed forward recovery."
    )
