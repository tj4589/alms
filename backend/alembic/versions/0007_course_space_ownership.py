"""Scope course catalogue rows to learning spaces.

Known legacy catalogue rows are assigned to CU.  Any other pre-existing row
remains NULL and is intentionally restricted until a global administrator
reviews it; no ownership is inferred from a user or upload.
"""

from alembic import op
import sqlalchemy as sa


revision = "0007_course_space"
down_revision = "0006_collaboration_space"
branch_labels = None
depends_on = None

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
    op.add_column("courses", sa.Column("learning_space_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_courses_learning_space",
        "courses",
        "learning_spaces",
        ["learning_space_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_courses_learning_space_id", "courses", ["learning_space_id"])
    op.execute(
        sa.text(
            """
            UPDATE courses AS course
            SET learning_space_id = space.id
            FROM learning_spaces AS space
            WHERE space.slug = 'cu'
              AND course.learning_space_id IS NULL
              AND course.code IN ('CSC317', 'CSC411', 'CSC415', 'MIS316', 'MIS412', 'MIS413', 'MIS415', 'MIS418')
            """
        )
    )


def downgrade() -> None:
    raise RuntimeError(
        "Course ownership is an authorization boundary; use a reviewed forward recovery."
    )
