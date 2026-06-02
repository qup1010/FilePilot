import os
import shutil
import time
import unittest
import zipfile
from unittest import mock

import pandas as pd
from PIL import Image

from file_pilot.analysis.file_reader import list_local_files, read_local_file, read_local_files_batch
from file_pilot.analysis.image_describer import ImageDescriptionResult


class FileParserDirectoryListingTests(unittest.TestCase):
    def setUp(self):
        self.root_dir = "test_temp_list_dir"
        self.child_dir = os.path.join(self.root_dir, "nested")
        self.grandchild_dir = os.path.join(self.child_dir, "deep")
        os.makedirs(self.grandchild_dir, exist_ok=True)

        with open(os.path.join(self.root_dir, "root.txt"), "w", encoding="utf-8") as file:
            file.write("root")
        with open(os.path.join(self.child_dir, "child.md"), "w", encoding="utf-8") as file:
            file.write("child")
        with open(os.path.join(self.grandchild_dir, "deep.txt"), "w", encoding="utf-8") as file:
            file.write("deep")

    def tearDown(self):
        if os.path.exists(self.root_dir):
            shutil.rmtree(self.root_dir)

    def test_list_local_files_returns_one_level_directory_summary(self):
        result = list_local_files(self.root_dir)
        self.assertIn(f"{self.root_dir} | dir", result)
        self.assertIn(f"{self.root_dir}/root.txt | file | .txt", result)
        self.assertIn(f"{self.root_dir}/nested | dir", result)
        self.assertIn(f"{self.root_dir}/nested/child.md | file | .md", result)
        self.assertNotIn("deep.txt", result)

    def test_list_local_files_applies_total_character_limit(self):
        for index in range(30):
            with open(os.path.join(self.root_dir, f"very_long_filename_{index:02d}.txt"), "w", encoding="utf-8") as file:
                file.write("x")

        result = list_local_files(self.root_dir, char_limit=220)

        self.assertLessEqual(len(result), 220)
        self.assertIn("路径 | 类型 | 说明", result)
        self.assertIn("...[目录结果过长已截断]", result)

    def test_list_local_files_rejects_directories_outside_allowed_scope(self):
        result = list_local_files("../outside")
        self.assertIn("错误", result)


class FileReaderEncodingTests(unittest.TestCase):
    def setUp(self):
        self.root_dir = "test_temp_file_reader"
        os.makedirs(self.root_dir, exist_ok=True)

        self.utf8_sig_path = os.path.join(self.root_dir, "bom.txt")
        self.gbk_path = os.path.join(self.root_dir, "gbk.txt")
        self.utf16_path = os.path.join(self.root_dir, "utf16.txt")
        self.zip_path = os.path.join(self.root_dir, "bundle.zip")
        self.image_path = os.path.join(self.root_dir, "screen.png")
        self.mp3_path = os.path.join(self.root_dir, "song.mp3")
        self.mp4_path = os.path.join(self.root_dir, "clip.mp4")
        self.csv_path = os.path.join(self.root_dir, "records.csv")
        self.xlsx_path = os.path.join(self.root_dir, "records.xlsx")
        self.long_text_path = os.path.join(self.root_dir, "long.txt")

        with open(self.utf8_sig_path, "w", encoding="utf-8-sig") as file:
            file.write("带 BOM 的文本")
        with open(self.gbk_path, "w", encoding="gbk") as file:
            file.write("旧版编码内容")
        with open(self.utf16_path, "w", encoding="utf-16") as file:
            file.write("宽字符文本")
        with zipfile.ZipFile(self.zip_path, "w") as archive:
            archive.writestr("docs/readme.md", "hello")
            archive.writestr("images/cover.png", "image")
        Image.new("RGB", (12, 8), color="white").save(self.image_path)
        with open(self.mp3_path, "wb") as file:
            file.write(b"\x00\x01binary-audio")
        with open(self.mp4_path, "wb") as file:
            file.write(b"\x00\x00\x00\x18ftypmp42")
        dataframe = pd.DataFrame(
            [
                {"name": "alpha", "amount": 10},
                {"name": "beta", "amount": 20},
                {"name": "gamma", "amount": 30},
            ]
        )
        dataframe.to_csv(self.csv_path, index=False)
        dataframe.to_excel(self.xlsx_path, index=False)
        with open(self.long_text_path, "w", encoding="utf-8") as file:
            file.write("开头关键信息 " + ("中间内容" * 80) + " 结尾总结信息")

    def tearDown(self):
        if os.path.exists(self.root_dir):
            shutil.rmtree(self.root_dir)

    def test_read_local_file_supports_common_windows_encodings(self):
        utf8_sig_result = read_local_file(self.utf8_sig_path)
        gbk_result = read_local_file(self.gbk_path)
        utf16_result = read_local_file(self.utf16_path)

        self.assertIn("带 BOM 的文本", utf8_sig_result)
        self.assertIn("旧版编码内容", gbk_result)
        self.assertIn("宽字符文本", utf16_result)
        self.assertNotIn("非 UTF-8 编码", gbk_result)
        self.assertNotIn("非 UTF-8 编码", utf16_result)

    def test_read_local_file_routes_zip_to_archive_index_preview(self):
        result = read_local_file(self.zip_path)

        self.assertIn("bundle.zip", result)
        self.assertIn("docs/readme.md", result)
        self.assertIn("文件数", result)
        self.assertNotIn("非 UTF-8 编码", result)

    def test_read_local_file_routes_images_to_isolated_summary(self):
        with mock.patch(
            "file_pilot.analysis.file_reader.describe_image",
            return_value=ImageDescriptionResult(
                status="ok",
                summary="这是一张聊天截图，主要在讨论付款安排。",
            ),
        ) as describe_image_mock:
            result = read_local_file(self.image_path)

        self.assertIn("聊天截图", result)
        self.assertIn("图片系统信息", result)
        self.assertIn("尺寸：12x8", result)
        describe_image_mock.assert_called_once_with(self.image_path)
        self.assertNotIn("非 UTF-8 编码", result)

    def test_read_local_file_returns_basic_info_for_known_binary_without_text_decoding(self):
        with mock.patch("file_pilot.analysis.file_reader._read_text_with_fallback") as text_reader:
            result = read_local_file(self.mp3_path)

        text_reader.assert_not_called()
        self.assertIn("系统信息", result)
        self.assertIn("扩展名：.mp3", result)
        self.assertIn("音频元数据", result)
        self.assertNotIn("非 UTF-8 编码", result)

    def test_read_local_file_returns_basic_info_for_video_without_text_decoding(self):
        with mock.patch("file_pilot.analysis.file_reader._read_text_with_fallback") as text_reader, mock.patch(
            "file_pilot.analysis.file_reader.shutil.which",
            return_value=None,
        ):
            result = read_local_file(self.mp4_path)

        text_reader.assert_not_called()
        self.assertIn("系统信息", result)
        self.assertIn("扩展名：.mp4", result)
        self.assertIn("视频元数据", result)
        self.assertIn("未找到 ffprobe", result)
        self.assertNotIn("非 UTF-8 编码", result)

    def test_read_local_file_uses_head_tail_preview_for_long_text(self):
        result = read_local_file(self.long_text_path, max_len=120)

        self.assertIn("开头关键信息", result)
        self.assertIn("结尾总结信息", result)
        self.assertIn("中间内容已省略", result)

    def test_read_local_file_includes_csv_shape_and_columns(self):
        result = read_local_file(self.csv_path, max_len=1000)

        self.assertIn("CSV 表格", result)
        self.assertIn("总行数: 3", result)
        self.assertIn("总列数: 2", result)
        self.assertIn("列名: name, amount", result)

    def test_read_local_file_includes_excel_shape_and_columns(self):
        result = read_local_file(self.xlsx_path, max_len=1000)

        self.assertIn("Sheet:", result)
        self.assertIn("总行数: 3", result)
        self.assertIn("总列数: 2", result)
        self.assertIn("列名: name, amount", result)

    def test_read_local_files_batch_keeps_input_order_when_parallelized(self):
        def fake_read(filename, max_len=300, allowed_base_dir=None):
            if filename.endswith("2.txt"):
                time.sleep(0.03)
            if filename.endswith("1.txt"):
                time.sleep(0.01)
            return f"result:{os.path.basename(filename)}"

        with mock.patch("file_pilot.analysis.file_reader.read_local_file", side_effect=fake_read):
            result = read_local_files_batch(["a2.txt", "a1.txt", "a3.txt"])

        parts = result.split("\n\n")
        self.assertEqual(parts, ["result:a2.txt", "result:a1.txt", "result:a3.txt"])


if __name__ == "__main__":
    unittest.main()
