import base64
import unittest
from unittest.mock import patch

from file_organizer.icon_workbench.client import IconWorkbenchImageClient
from file_organizer.icon_workbench.models import ModelConfig


class IconWorkbenchImageClientTests(unittest.TestCase):
    def setUp(self):
        self.client = IconWorkbenchImageClient()

    def test_generate_png_uses_openai_image_payload_and_reads_b64(self):
        config = ModelConfig(
            base_url="https://image.example/v1",
            api_key="image-key",
            model="gpt-image",
        )
        raw_png = b"fake-png"

        with patch("file_organizer.icon_workbench.client._post_json") as post_json:
            post_json.return_value = {
                "data": [
                    {
                        "b64_json": base64.b64encode(raw_png).decode("ascii"),
                    }
                ]
            }

            image_bytes = self.client.generate_png(config, "draw a folder", "512x512")

        self.assertEqual(image_bytes, raw_png)
        post_json.assert_called_once_with(
            "https://image.example/v1/images/generations",
            {
                "model": "gpt-image",
                "prompt": "draw a folder",
                "size": "512x512",
                "n": 1,
                "response_format": "b64_json",
            },
            "image-key",
        )

    def test_generate_png_uses_modelscope_async_flow_and_reads_output_image(self):
        config = ModelConfig(
            base_url="https://api-inference.modelscope.cn/v1",
            api_key="ms-key",
            model="black-forest-labs/FLUX.1-schnell",
        )

        with patch("file_organizer.icon_workbench.client._request_json") as request_json:
            with patch("file_organizer.icon_workbench.client.time.sleep") as sleep:
                with patch.object(self.client, "_read_remote_image", return_value=b"modelscope-png") as read_remote_image:
                    request_json.side_effect = [
                        {"task_id": "task-123"},
                        {
                            "task_id": "task-123",
                            "task_status": "RUNNING",
                        },
                        {
                            "task_id": "task-123",
                            "task_status": "SUCCEED",
                            "output_images": ["https://cdn.modelscope.cn/generated.png"],
                        },
                    ]

                    image_bytes = self.client.generate_png(config, "draw a folder", "1024x1024")

        self.assertEqual(image_bytes, b"modelscope-png")
        self.assertEqual(
            request_json.call_args_list,
            [
                unittest.mock.call(
                    "https://api-inference.modelscope.cn/v1/images/generations",
                    method="POST",
                    payload={
                        "model": "black-forest-labs/FLUX.1-schnell",
                        "prompt": "draw a folder",
                        "n": 1,
                        "size": "1024x1024",
                    },
                    api_key="ms-key",
                    extra_headers={"X-ModelScope-Async-Mode": "true"},
                ),
                unittest.mock.call(
                    "https://api-inference.modelscope.cn/v1/tasks/task-123",
                    method="GET",
                    api_key="ms-key",
                    extra_headers={"X-ModelScope-Task-Type": "image_generation"},
                ),
                unittest.mock.call(
                    "https://api-inference.modelscope.cn/v1/tasks/task-123",
                    method="GET",
                    api_key="ms-key",
                    extra_headers={"X-ModelScope-Task-Type": "image_generation"},
                ),
            ],
        )
        self.assertEqual(sleep.call_count, 2)
        read_remote_image.assert_called_once_with("https://cdn.modelscope.cn/generated.png")


if __name__ == "__main__":
    unittest.main()
