import unittest

from file_pilot.app.session_constants import (
    SESSION_STAGE_CONFLICT,
    STAGE_ABANDONED,
    STAGE_COMPLETED,
    STAGE_DRAFT,
    STAGE_EXECUTING,
    STAGE_PLANNING,
    STAGE_SCANNING,
    STAGE_STALE,
    ensure_stage,
    ensure_stage_in,
    is_locked_stage,
    is_planning_mutable_stage,
    is_reclaimable_lock_stage,
    is_recovery_stage,
    is_stage,
    is_stage_in,
    is_terminal_stage,
    normalize_stage,
)


class SessionConstantsTests(unittest.TestCase):
    def test_normalize_stage_handles_blank_and_case(self):
        self.assertEqual(normalize_stage(None), "")
        self.assertEqual(normalize_stage("  COMPLETED  "), STAGE_COMPLETED)

    def test_stage_predicates_normalize_input(self):
        self.assertTrue(is_stage(" Planning ", STAGE_PLANNING))
        self.assertTrue(is_stage_in(" DRAFT ", {STAGE_DRAFT, STAGE_PLANNING}))
        self.assertTrue(is_locked_stage(" scanning "))
        self.assertTrue(is_locked_stage(STAGE_EXECUTING))
        self.assertTrue(is_terminal_stage("COMPLETED"))
        self.assertTrue(is_recovery_stage(STAGE_STALE))
        self.assertTrue(is_reclaimable_lock_stage(STAGE_ABANDONED))
        self.assertTrue(is_planning_mutable_stage(STAGE_PLANNING))
        self.assertFalse(is_terminal_stage(STAGE_SCANNING))

    def test_ensure_stage_raises_standard_conflict(self):
        ensure_stage(" planning ", STAGE_PLANNING)

        with self.assertRaises(RuntimeError) as context:
            ensure_stage(STAGE_DRAFT, STAGE_PLANNING)

        self.assertEqual(context.exception.args, (SESSION_STAGE_CONFLICT,))

    def test_ensure_stage_in_raises_standard_conflict(self):
        ensure_stage_in(" PLANNING ", {STAGE_DRAFT, STAGE_PLANNING})

        with self.assertRaises(RuntimeError) as context:
            ensure_stage_in(STAGE_SCANNING, {STAGE_DRAFT, STAGE_PLANNING})

        self.assertEqual(context.exception.args, (SESSION_STAGE_CONFLICT,))


if __name__ == "__main__":
    unittest.main()
