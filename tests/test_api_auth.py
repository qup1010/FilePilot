import os
import shutil
import time
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from file_pilot.api.main import create_app
from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore


class ApiAuthTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_api_auth")
        if self.root.exists():
            shutil.rmtree(self.root)
        self.target_dir = self.root / "Inbox"
        self.target_dir.mkdir(parents=True, exist_ok=True)
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)
        self.token = "test-api-token"
        self.original_token = os.environ.get("FILE_PILOT_API_TOKEN")
        os.environ["FILE_PILOT_API_TOKEN"] = self.token
        self.client = TestClient(create_app(self.service))

    def tearDown(self):
        if self.original_token is None:
            os.environ.pop("FILE_PILOT_API_TOKEN", None)
        else:
            os.environ["FILE_PILOT_API_TOKEN"] = self.original_token
        if self.root.exists():
            last_error = None
            for _ in range(5):
                try:
                    shutil.rmtree(self.root)
                    return
                except PermissionError as exc:
                    last_error = exc
                    time.sleep(0.1)
            if last_error is not None:
                raise last_error

    def test_post_sessions_requires_auth(self):
        response = self.client.post(
            "/api/sessions",
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        )

        self.assertEqual(response.status_code, 401)

    def test_post_sessions_accepts_valid_bearer_token(self):
        response = self.client.post(
            "/api/sessions",
            headers={"Authorization": f"Bearer {self.token}"},
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_snapshot"]["stage"], "draft")

    def test_post_sessions_accepts_file_pilot_header_token(self):
        response = self.client.post(
            "/api/sessions",
            headers={"x-file-pilot-token": self.token},
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_snapshot"]["stage"], "draft")

    def test_legacy_file_organizer_header_is_not_accepted(self):
        original_legacy = os.environ.get("FILE_ORGANIZER_API_TOKEN")
        try:
            os.environ["FILE_ORGANIZER_API_TOKEN"] = "legacy-token"
            client = TestClient(create_app(self.service))

            response = client.post(
                "/api/sessions",
                headers={"x-file-organizer-token": "legacy-token"},
                json={"target_dir": str(self.target_dir), "resume_if_exists": False},
            )
        finally:
            if original_legacy is None:
                os.environ.pop("FILE_ORGANIZER_API_TOKEN", None)
            else:
                os.environ["FILE_ORGANIZER_API_TOKEN"] = original_legacy

        self.assertEqual(response.status_code, 401)

    def test_events_endpoint_requires_auth(self):
        created = self.client.post(
            "/api/sessions",
            headers={"Authorization": f"Bearer {self.token}"},
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with self.client.stream(
            "GET",
            f"/api/sessions/{created['session_id']}/events",
            headers={"x-file-pilot-once": "1"},
        ) as response:
            body = "".join(chunk for chunk in response.iter_text() if chunk)

        self.assertEqual(response.status_code, 401)
        self.assertNotIn("text/event-stream", response.headers.get("content-type", ""))
        self.assertNotIn("session.snapshot", body)

    def test_events_endpoint_accepts_access_token_query(self):
        created = self.client.post(
            "/api/sessions",
            headers={"Authorization": f"Bearer {self.token}"},
            json={"target_dir": str(self.target_dir), "resume_if_exists": False},
        ).json()

        with self.client.stream(
            "GET",
            f"/api/sessions/{created['session_id']}/events?access_token={self.token}",
            headers={"x-file-pilot-once": "1"},
        ) as response:
            body = "".join(chunk for chunk in response.iter_text() if chunk)

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: session.snapshot", body)

    def test_settings_routes_require_auth_when_token_enabled(self):
        get_response = self.client.get("/api/settings")
        patch_response = self.client.patch("/api/settings", json={"global_config": {"DEBUG_MODE": True}})
        test_response = self.client.post("/api/settings/test", json={"family": "text"})

        self.assertEqual(get_response.status_code, 401)
        self.assertEqual(patch_response.status_code, 401)
        self.assertEqual(test_response.status_code, 401)

    def test_health_and_options_remain_public(self):
        health = self.client.get("/api/health")
        options = self.client.options(
            "/api/sessions",
            headers={
                "Origin": "http://127.0.0.1:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,authorization",
            },
        )

        self.assertEqual(health.status_code, 200)
        self.assertEqual(options.status_code, 200)


if __name__ == "__main__":
    unittest.main()
