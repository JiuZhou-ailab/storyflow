#!/usr/bin/env python3
# input: Bundled local screenplay project helper
# output: Runnable checks for splitting, validation, versioning, and merge
# pos: Minimal regression test for the self-contained Storyflow workflow

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("screenplay_project.py")
SPEC = importlib.util.spec_from_file_location("screenplay_project", MODULE_PATH)
assert SPEC and SPEC.loader
screenplay_project = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(screenplay_project)


def valid_script(episode: int, title: str, dialogue: str) -> str:
    return f"""# 第 {episode} 集｜{title}

> 本集概要：测试概要。

## {episode}-1 庭院 外 夜

人物：林夏、周远

▲ 林夏停在门前，攥紧钥匙。

林夏（低声）：{dialogue}

周远：门一直给你留着。
"""


class ScreenplayProjectTest(unittest.TestCase):
    def test_prepare_validate_checkpoint_restore_and_merge(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "novel.txt"
            source.write_text(
                "第一章 归来\n\n" + "林夏在雨夜回到旧宅。周远等在门口。" * 30
                + "\n\n第二章 真相\n\n" + "两人发现旧信，关系发生变化。" * 30,
                encoding="utf-8",
            )
            project_dir = root / "screenplay"

            prepared = screenplay_project.prepare(source, project_dir, "compact")
            self.assertEqual(prepared["episode_count"], 2)
            project = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
            self.assertEqual(project["split_method"], "author-headings")

            for episode in (1, 2):
                script_path = project_dir / f"scripts/{episode:03d}.md"
                script_path.write_text(
                    valid_script(episode, project["episodes"][episode - 1]["title"], "我回来了。"),
                    encoding="utf-8",
                )
                result = screenplay_project.validate_episode(project_dir, episode)
                self.assertEqual(result["status"], "valid")

            snapshot = screenplay_project.checkpoint(project_dir, 1)
            first_script = project_dir / "scripts/001.md"
            first_script.write_text(valid_script(1, "改坏的版本", "错误版本。"), encoding="utf-8")
            restored = screenplay_project.restore(
                project_dir,
                1,
                Path(snapshot["version"]),
                yes=True,
            )
            self.assertEqual(restored["validation"]["status"], "valid")
            self.assertIn("我回来了", first_script.read_text(encoding="utf-8"))

            merged = screenplay_project.merge(project_dir)
            output = Path(merged["output"])
            self.assertTrue(output.is_file())
            self.assertIn("第 1 集", output.read_text(encoding="utf-8"))
            self.assertIn("第 2 集", output.read_text(encoding="utf-8"))

    def test_validation_rejects_pronoun_speaker_and_bad_scene_number(self) -> None:
        markdown = """# 第 3 集｜错误示例

## 2-1 客厅 内 夜

人物：林夏

我：不能这样写。
"""
        result = screenplay_project.validate_text(
            markdown,
            episode_index=3,
            source_chars=500,
            mode="compact",
        )
        self.assertEqual(result["status"], "invalid")
        self.assertTrue(any("场号不属于" in error for error in result["errors"]))
        self.assertTrue(any("不能使用代词" in error for error in result["errors"]))

    def test_restore_requires_confirmation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "novel.md"
            source.write_text("# 第一章\n\n" + "正文。" * 100, encoding="utf-8")
            project_dir = root / "screenplay"
            screenplay_project.prepare(source, project_dir, "aligned")
            script = project_dir / "scripts/001.md"
            script.write_text(valid_script(1, "第一章", "测试。"), encoding="utf-8")
            version = Path(screenplay_project.checkpoint(project_dir, 1)["version"])
            with self.assertRaises(screenplay_project.ProjectError):
                screenplay_project.restore(project_dir, 1, version, yes=False)

    def test_prepare_rejects_file_as_project_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "novel.txt"
            source.write_text("第一章\n" + "开端。" * 100, encoding="utf-8")
            project_path = root / "not-a-directory"
            project_path.write_text("occupied", encoding="utf-8")

            with self.assertRaisesRegex(screenplay_project.ProjectError, "不是目录"):
                screenplay_project.prepare(source, project_path, "compact")

    def test_cli_prepare_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "novel.txt"
            source.write_text("正文。" * 100, encoding="utf-8")
            result = screenplay_project.execute(
                Namespace(
                    command="prepare",
                    source=str(source),
                    project_dir=str(root / "project"),
                    mode="rich",
                )
            )
            self.assertEqual(result["mode"], "rich")
            self.assertGreaterEqual(result["episode_count"], 1)


if __name__ == "__main__":
    unittest.main()
