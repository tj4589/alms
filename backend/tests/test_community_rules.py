import unittest

from community_rules import (
    can_leave_group,
    can_post_announcement,
    classify_discussion,
    contains_maxe_mention,
    next_attendance_status,
    safe_username,
    strip_maxe_mentions,
)


class CommunityRuleTests(unittest.TestCase):
    def test_discussions_are_classified_without_ai(self) -> None:
        self.assertEqual(classify_discussion("I am stuck on the exam formula"), ("academic", "stuck"))
        self.assertEqual(classify_discussion("Anyone around for a quick chat?"), ("casual", "conversation"))
        self.assertEqual(classify_discussion("I found a useful lecture note link"), ("academic", "resource"))

    def test_maxe_mentions_are_standalone_and_case_insensitive(self) -> None:
        self.assertTrue(contains_maxe_mention("@maxe explain this formula"))
        self.assertTrue(contains_maxe_mention("Can @MaXe help?"))
        self.assertTrue(contains_maxe_mention("@AI help me compare these ideas"))
        self.assertFalse(contains_maxe_mention("maxe is part of a normal word"))
        self.assertFalse(contains_maxe_mention("email@maxexamind.com"))
        self.assertEqual(strip_maxe_mentions("@maxe explain this formula"), "explain this formula")

    def test_onboarding_username_is_normalised(self) -> None:
        self.assertEqual(safe_username(" Ada Studies! "), "adastudies")

    def test_group_roles_protect_owner_and_announcements(self) -> None:
        self.assertFalse(can_leave_group("owner"))
        self.assertTrue(can_leave_group("member"))
        self.assertTrue(can_post_announcement("admin"))
        self.assertFalse(can_post_announcement("member"))

    def test_room_attendance_transitions_are_server_rules(self) -> None:
        self.assertEqual(next_attendance_status("left", "join"), "studying")
        self.assertEqual(next_attendance_status("studying", "break_start"), "on_break")
        self.assertEqual(next_attendance_status("on_break", "break_end"), "studying")
        self.assertEqual(next_attendance_status("studying", "timeout"), "left")


if __name__ == "__main__":
    unittest.main()
