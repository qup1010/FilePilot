import unittest
from unittest import mock

import file_pilot.__main__ as package_main
import file_pilot.rollback.__main__ as rollback_main


class PackageEntrypointTests(unittest.TestCase):
    def test_python_m_file_pilot_runs_api(self):
        with mock.patch.object(package_main, "run_api") as run_api_mock:
            package_main.main()

        run_api_mock.assert_called_once_with()

    def test_python_m_file_pilot_rollback_reports_removed(self):
        with self.assertRaises(SystemExit) as raised:
            rollback_main.main(["D:/demo"])

        self.assertIn("removed", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
