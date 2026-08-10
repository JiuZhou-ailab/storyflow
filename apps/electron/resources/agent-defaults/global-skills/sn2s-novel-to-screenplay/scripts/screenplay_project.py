#!/usr/bin/env python3
# input: 本地小说文本或 DOCX 文件，以及剧本项目目录
# output: 确定性分集、校验报告、版本快照和合并剧本
# pos: Storyflow 小说转剧本 Skill 的本地标准库辅助脚本

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

MODES = ("compact", "aligned", "rich")
SUPPORTED_LANGUAGES = ("en", "es", "zh-Hans", "ja", "hu", "de", "pl")
LANGUAGE_ALIASES = {
    "zh": "zh-Hans",
    "zh-cn": "zh-Hans",
    "chinese": "zh-Hans",
    "simplified chinese": "zh-Hans",
    "english": "en",
    "spanish": "es",
    "german": "de",
    "japanese": "ja",
    "hungarian": "hu",
    "polish": "pl",
}
LANGUAGE_LAYOUTS = {
    "en": {
        "language": "en",
        "source_file": "source.txt",
        "metadata_file": "story-metadata.md",
        "continuity_file": "continuity.md",
        "full_screenplay": "full-screenplay.md",
        "episodes_dir": "episodes",
        "scripts_dir": "scripts",
        "versions_dir": "versions",
        "episode_source_suffix": "source",
    },
    "es": {
        "language": "es",
        "source_file": "fuente.txt",
        "metadata_file": "metadatos-historia.md",
        "continuity_file": "continuidad.md",
        "full_screenplay": "guion-completo.md",
        "episodes_dir": "episodios",
        "scripts_dir": "guiones",
        "versions_dir": "versiones",
        "episode_source_suffix": "fuente",
    },
    "zh-Hans": {
        "language": "zh-Hans",
        "source_file": "原文.txt",
        "metadata_file": "故事元数据.md",
        "continuity_file": "连续性台账.md",
        "full_screenplay": "完整剧本.md",
        "episodes_dir": "分集原文",
        "scripts_dir": "剧本",
        "versions_dir": "版本",
        "episode_source_suffix": "原文",
    },
    "ja": {
        "language": "ja",
        "source_file": "原文.txt",
        "metadata_file": "物語メタデータ.md",
        "continuity_file": "連続性台帳.md",
        "full_screenplay": "完全脚本.md",
        "episodes_dir": "エピソード",
        "scripts_dir": "脚本",
        "versions_dir": "バージョン",
        "episode_source_suffix": "原文",
    },
    "hu": {
        "language": "hu",
        "source_file": "forrás.txt",
        "metadata_file": "történet-metaadatok.md",
        "continuity_file": "folytonosság.md",
        "full_screenplay": "teljes-forgatókönyv.md",
        "episodes_dir": "epizódok",
        "scripts_dir": "forgatókönyvek",
        "versions_dir": "verziók",
        "episode_source_suffix": "forrás",
    },
    "de": {
        "language": "de",
        "source_file": "quelle.txt",
        "metadata_file": "story-metadaten.md",
        "continuity_file": "kontinuität.md",
        "full_screenplay": "vollständiges-drehbuch.md",
        "episodes_dir": "episoden",
        "scripts_dir": "drehbücher",
        "versions_dir": "versionen",
        "episode_source_suffix": "quelle",
    },
    "pl": {
        "language": "pl",
        "source_file": "źródło.txt",
        "metadata_file": "metadane-historii.md",
        "continuity_file": "ciągłość.md",
        "full_screenplay": "pełny-scenariusz.md",
        "episodes_dir": "odcinki",
        "scripts_dir": "scenariusze",
        "versions_dir": "wersje",
        "episode_source_suffix": "źródło",
    },
}
TEXT_SUFFIXES = {".txt", ".md", ".markdown"}
MAX_STRUCTURED_CHARS = 20_000
SUB_SPLIT_CHARS = 3_000
SUB_SPLIT_LINES = 50
PRONOUN_LABELS = {"我", "你", "他", "她", "它", "他们", "她们", "它们", "我们", "你们"}

EXPLICIT_HEADING = re.compile(
    r"^\s*(?:#{1,6}\s*)?(?:"
    r"第\s*[一二三四五六七八九十百千万零\d]+\s*[章集节回幕话卷部场](?:\s|$|[：:、.．\-])"
    r"|序章|楔子|引子|前言|尾声|后记|番外[一二三四五六七八九十百千万零\d]*"
    r"|(?:Chapter|Episode|Part|Act)\s+(?:\d+|[IVXLCDM]+)\b"
    r").*$",
    re.IGNORECASE | re.MULTILINE,
)
MARKDOWN_HEADING = re.compile(r"^\s*#{1,3}\s+\S.*$", re.MULTILINE)
SCRIPT_HEADER = re.compile(r"^#\s*第\s*(\d+)\s*集(?:\s*[｜|:：-]\s*(.+))?\s*$")
SCENE_HEADER = re.compile(
    r"^##\s*(\d+)-(\d+)\s+(.+?)\s+(内|外)\s+"
    r"(日|夜|晨|早|午|晚|昏|黄昏|凌晨|清晨|傍晚|连续)\s*$"
)
DIALOGUE = re.compile(
    r"^(?P<speaker>[^#▲【>\s][^：:\n]{0,40}?)"
    r"(?:（(?P<emotion>[^）]{1,12})）)?"
    r"(?:\s*\[(?P<voice>OS|VO)\])?[：:](?P<content>.+)$"
)


class ProjectError(Exception):
    pass


class ChineseArgumentParser(argparse.ArgumentParser):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs["add_help"] = False
        super().__init__(*args, **kwargs)
        self.add_argument("-h", "--help", action="help", help="显示帮助并退出")
        self._positionals.title = "位置参数"
        self._optionals.title = "选项"

    def format_usage(self) -> str:
        return super().format_usage().replace("usage:", "用法：", 1)

    def format_help(self) -> str:
        return super().format_help().replace("usage:", "用法：", 1)


def _resolve_language(value: str | None) -> str:
    normalized = (value or "zh-Hans").strip()
    exact = next(
        (language for language in SUPPORTED_LANGUAGES if language.lower() == normalized.lower()),
        None,
    )
    if exact:
        return exact

    alias = LANGUAGE_ALIASES.get(normalized.lower())
    if alias:
        return alias

    if normalized.lower().startswith("zh-"):
        return "zh-Hans"
    raise ProjectError(
        f"不支持的语言：{value}。可选值：{', '.join(SUPPORTED_LANGUAGES)}"
    )


def _layout_for_project(project: dict[str, Any]) -> dict[str, str]:
    if project.get("version") == 2:
        return dict(LANGUAGE_LAYOUTS[_resolve_language(str(project.get("language", "zh-Hans")))])

    raw_layout = project.get("layout")
    if isinstance(raw_layout, dict):
        return {str(key): str(value) for key, value in raw_layout.items()}

    # Version 1 projects used the English layout. Keep them readable and do
    # not silently move user files when a newer runtime opens the project.
    legacy = dict(LANGUAGE_LAYOUTS["en"])
    legacy["source_file"] = str(project.get("prepared_source", legacy["source_file"]))
    legacy["metadata_file"] = str(project.get("metadata_path", legacy["metadata_file"]))
    legacy["continuity_file"] = str(project.get("continuity_path", legacy["continuity_file"]))
    legacy["full_screenplay"] = str(project.get("full_screenplay", legacy["full_screenplay"]))
    return legacy


def _project_path(project_dir: Path, value: Any, label: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ProjectError(f"项目状态中的 {label} 路径无效")
    relative = Path(value)
    if relative.is_absolute():
        raise ProjectError(f"项目状态中的 {label} 必须是相对路径")
    root = project_dir.resolve()
    resolved = (root / relative).resolve()
    if resolved != root and root not in resolved.parents:
        raise ProjectError(f"项目状态中的 {label} 越过项目目录：{value}")
    return resolved


def _metadata_template(language: str) -> str:
    templates = {
        "en": """# Story Metadata

## Title

## Story Premise

## Genre and Audience

## World Rules and Key Locations

## Main Characters

## Character Relationships
""",
        "es": """# Metadatos de la historia

## Título

## Premisa

## Género y público

## Reglas del mundo y lugares clave

## Personajes principales

## Relaciones entre personajes
""",
        "zh-Hans": """# 故事元数据

## 标题

## 故事梗概

## 题材与受众

## 世界观与关键规则

## 主要人物

## 人物关系
""",
        "ja": """# 物語メタデータ

## タイトル

## あらすじ

## ジャンルと対象読者

## 世界観と重要なルール

## 主要人物

## 人物関係
""",
        "hu": """# Történet metaadatai

## Cím

## Történet alapfelállása

## Műfaj és közönség

## Világszabályok és fontos helyszínek

## Főszereplők

## Szereplők kapcsolatai
""",
        "de": """# Story-Metadaten

## Titel

## Handlungskern

## Genre und Zielgruppe

## Weltregeln und wichtige Orte

## Hauptfiguren

## Beziehungen der Figuren
""",
        "pl": """# Metadane historii

## Tytuł

## Założenie fabuły

## Gatunek i odbiorcy

## Zasady świata i ważne miejsca

## Główne postacie

## Relacje między postaciami
""",
    }
    return templates[language]


def _continuity_template(language: str) -> str:
    templates = {
        "en": """# Continuity Ledger

## Confirmed Facts

## Character States and Relationship Changes

## Unresolved Setups and Hooks

## Episode Summaries
""",
        "es": """# Registro de continuidad

## Hechos confirmados

## Estados de los personajes y cambios de relaciones

## Cabos sueltos y ganchos sin resolver

## Resúmenes de episodios
""",
        "zh-Hans": """# 连续性台账

## 已确认事实

## 人物状态与关系变化

## 未回收伏笔与钩子

## 分集摘要
""",
        "ja": """# 連続性台帳

## 確定した事実

## 人物の状態と関係の変化

## 未回収の伏線とフック

## エピソード概要
""",
        "hu": """# Folytonossági napló

## Megerősített tények

## A szereplők állapota és a kapcsolatok változása

## Le nem zárt előkészítések és horgok

## Epizódszummárék
""",
        "de": """# Kontinuitätsprotokoll

## Bestätigte Fakten

## Figurenstatus und Beziehungsänderungen

## Offene Setups und Hooks

## Episodenzusammenfassungen
""",
        "pl": """# Rejestr ciągłości

## Potwierdzone fakty

## Stany postaci i zmiany relacji

## Nierozwiązane wątki i haczyki

## Streszczenia odcinków
""",
    }
    return templates[language]


def _episode_source_heading(language: str, index: int, title: str) -> str:
    labels = {
        "en": f"Episode {index} | {title}",
        "es": f"Episodio {index} | {title}",
        "zh-Hans": f"第 {index} 集｜{title}",
        "ja": f"第{index}話｜{title}",
        "hu": f"{index}. epizód | {title}",
        "de": f"Episode {index} | {title}",
        "pl": f"Odcinek {index} | {title}",
    }
    return labels[language]


def _read_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in TEXT_SUFFIXES:
        raw = path.read_bytes()
        if raw.startswith(b"\xff\xfe"):
            return raw.decode("utf-16-le")
        if raw.startswith(b"\xfe\xff"):
            return raw.decode("utf-16-be")
        if raw.startswith(b"\xef\xbb\xbf"):
            raw = raw[3:]
        for encoding in ("utf-8", "gbk", "gb18030"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        raise ProjectError(f"无法解码文本文件：{path}")
    if suffix == ".docx":
        return _read_docx(path)
    if suffix == ".pdf":
        raise ProjectError("请先用 Storyflow 的文档读取能力把 PDF 提取为 UTF-8 文本，再运行 prepare")
    raise ProjectError("仅支持 txt、md、markdown、docx；PDF 请先由 Storyflow 提取为文本")


def _read_docx(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile) as exc:
        raise ProjectError(f"DOCX 文件无效：{path}") from exc

    root = ElementTree.fromstring(xml)
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    paragraphs: list[str] = []
    for paragraph in root.iter(f"{namespace}p"):
        text = "".join(node.text or "" for node in paragraph.iter(f"{namespace}t")).strip()
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)


def _normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.lstrip().rstrip() for line in text.splitlines()]
    return "\n".join(lines).strip() + "\n"


def _heading_matches(text: str) -> tuple[list[re.Match[str]], str]:
    explicit = list(EXPLICIT_HEADING.finditer(text))
    if len(explicit) >= 2:
        return explicit, "author-headings"
    markdown = list(MARKDOWN_HEADING.finditer(text))
    if len(markdown) >= 2:
        return markdown, "markdown-headings"
    return [], "paragraph-chunks"


def _chunk_text(text: str, *, max_chars: int, max_lines: int) -> list[str]:
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    if not paragraphs:
        paragraphs = [line.strip() for line in text.splitlines() if line.strip()]

    chunks: list[str] = []
    current: list[str] = []
    current_chars = 0
    current_lines = 0

    def flush() -> None:
        nonlocal current, current_chars, current_lines
        if current:
            chunks.append("\n\n".join(current).strip())
        current = []
        current_chars = 0
        current_lines = 0

    for paragraph in paragraphs:
        paragraph_lines = max(1, paragraph.count("\n") + 1)
        if len(paragraph) > max_chars:
            flush()
            for start in range(0, len(paragraph), max_chars):
                chunks.append(paragraph[start : start + max_chars].strip())
            continue
        projected_chars = current_chars + len(paragraph) + (2 if current else 0)
        projected_lines = current_lines + paragraph_lines
        if current and (projected_chars > max_chars or projected_lines > max_lines):
            flush()
        current.append(paragraph)
        current_chars += len(paragraph) + (2 if len(current) > 1 else 0)
        current_lines += paragraph_lines
    flush()
    return [chunk for chunk in chunks if chunk]


def _title_from_heading(heading: str, fallback: str) -> str:
    title = re.sub(r"^\s*#{1,6}\s*", "", heading).strip()
    return title or fallback


def _split_episodes(text: str) -> tuple[list[dict[str, Any]], str]:
    matches, method = _heading_matches(text)
    raw_sections: list[tuple[str, str]] = []

    if matches:
        prefix = text[: matches[0].start()].strip()
        for index, match in enumerate(matches):
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            body = text[match.start() : end].strip()
            if index == 0 and prefix:
                body = f"{prefix}\n\n{body}"
            raw_sections.append((_title_from_heading(match.group(), f"第 {index + 1} 集"), body))
    else:
        for index, chunk in enumerate(
            _chunk_text(text, max_chars=SUB_SPLIT_CHARS, max_lines=SUB_SPLIT_LINES),
            start=1,
        ):
            raw_sections.append((f"第 {index} 集", chunk))

    episodes: list[dict[str, Any]] = []
    for title, body in raw_sections:
        parts = (
            _chunk_text(body, max_chars=SUB_SPLIT_CHARS, max_lines=SUB_SPLIT_LINES)
            if len(body) > MAX_STRUCTURED_CHARS
            else [body]
        )
        for part_index, part in enumerate(parts, start=1):
            part_title = title if len(parts) == 1 else f"{title}（{part_index}）"
            episodes.append(
                {
                    "index": len(episodes) + 1,
                    "title": part_title,
                    "content": part.strip(),
                }
            )

    if not episodes:
        raise ProjectError("分集失败：小说正文为空")
    return episodes, method


def _atomic_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    _atomic_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def _project_file(project_dir: Path) -> Path:
    return project_dir / "project.json"


def _load_project(project_dir: Path) -> dict[str, Any]:
    path = _project_file(project_dir)
    if not path.is_file():
        raise ProjectError(f"找不到项目状态：{path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ProjectError(f"项目状态不是有效 JSON：{path}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("episodes"), list):
        raise ProjectError(f"项目状态结构无效：{path}")
    layout = _layout_for_project(data)
    for key in (
        "source_file",
        "metadata_file",
        "continuity_file",
        "full_screenplay",
        "episodes_dir",
        "scripts_dir",
        "versions_dir",
    ):
        _project_path(project_dir, layout.get(key), f"layout.{key}")
    for index, episode in enumerate(data["episodes"], start=1):
        if not isinstance(episode, dict):
            raise ProjectError(f"项目状态中的第 {index} 个分集结构无效")
        _project_path(project_dir, episode.get("source_path"), f"episodes[{index}].source_path")
        _project_path(project_dir, episode.get("script_path"), f"episodes[{index}].script_path")
    return data


def _episode(project: dict[str, Any], episode_index: int) -> dict[str, Any]:
    for item in project["episodes"]:
        if item.get("index") == episode_index:
            return item
    raise ProjectError(f"项目中不存在第 {episode_index} 集")


def prepare(
    source: Path,
    project_dir: Path,
    mode: str,
    language: str = "zh-Hans",
) -> dict[str, Any]:
    if not source.is_file():
        raise ProjectError(f"找不到小说文件：{source}")
    if project_dir.exists() and not project_dir.is_dir():
        raise ProjectError(f"输出路径不是目录：{project_dir}")
    if project_dir.exists() and any(project_dir.iterdir()):
        raise ProjectError(f"输出目录不是空目录，拒绝覆盖：{project_dir}")

    resolved_language = _resolve_language(language)
    layout = dict(LANGUAGE_LAYOUTS[resolved_language])

    text = _normalize(_read_text(source))
    if len(text.strip()) < 100:
        raise ProjectError("小说正文不足 100 字")
    episodes, method = _split_episodes(text)

    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / layout["episodes_dir"]).mkdir(exist_ok=True)
    (project_dir / layout["scripts_dir"]).mkdir(exist_ok=True)
    (project_dir / layout["versions_dir"]).mkdir(exist_ok=True)
    _atomic_text(project_dir / layout["source_file"], text)

    entries: list[dict[str, Any]] = []
    for episode in episodes:
        index = episode["index"]
        source_name = f"{index:03d}-{layout['episode_source_suffix']}.md"
        script_name = f"{index:03d}.md"
        content = episode["content"]
        _atomic_text(
            project_dir / layout["episodes_dir"] / source_name,
            f"# {_episode_source_heading(resolved_language, index, episode['title'])}\n\n{content}\n",
        )
        entries.append(
            {
                "index": index,
                "title": episode["title"],
                "source_path": f"{layout['episodes_dir']}/{source_name}",
                "script_path": f"{layout['scripts_dir']}/{script_name}",
                "source_chars": len(re.sub(r"\s+", "", content)),
                "status": "pending",
                "diagnostics": [],
            }
        )

    _atomic_text(project_dir / layout["metadata_file"], _metadata_template(resolved_language))
    _atomic_text(project_dir / layout["continuity_file"], _continuity_template(resolved_language))

    project = {
        "version": 2,
        "title": source.stem,
        "source_file": str(source.resolve()),
        "language": resolved_language,
        "layout": layout,
        "prepared_source": layout["source_file"],
        "mode": mode,
        "split_method": method,
        "metadata_path": layout["metadata_file"],
        "continuity_path": layout["continuity_file"],
        "full_screenplay": layout["full_screenplay"],
        "episodes": entries,
    }
    _atomic_json(_project_file(project_dir), project)
    return {
        "project_dir": str(project_dir.resolve()),
        "language": resolved_language,
        "mode": mode,
        "split_method": method,
        "episode_count": len(entries),
        "project_file": str(_project_file(project_dir).resolve()),
    }


def _visible_chars(markdown: str) -> int:
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", markdown)
    text = re.sub(r"(?m)^\s*>\s*", "", text)
    text = text.replace("**", "").replace("__", "").replace("`", "")
    return len(re.sub(r"\s+", "", text))


def _length_budget(mode: str, source_chars: int) -> tuple[int, int, int]:
    if mode == "compact":
        minimum = max(120, int(source_chars * 0.25))
        target_max = max(minimum, int(source_chars * 0.35))
        hard_max = max(target_max, int(source_chars * 0.40))
    elif mode == "aligned":
        minimum = max(300, int(source_chars * 0.55))
        target_max = max(minimum, int(source_chars * 0.65))
        hard_max = max(target_max, int(source_chars * 0.70))
    else:
        minimum = min(1_000, source_chars)
        target_max = max(minimum, source_chars)
        hard_max = max(target_max, int(source_chars * 1.20))
    return minimum, target_max, hard_max


def validate_text(
    markdown: str,
    *,
    episode_index: int,
    source_chars: int,
    mode: str,
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    lines = markdown.splitlines()

    header = next((SCRIPT_HEADER.match(line.strip()) for line in lines if line.strip()), None)
    if not header:
        errors.append("缺少“# 第 N 集｜标题”集标题")
    elif int(header.group(1)) != episode_index:
        errors.append(f"集标题编号应为 {episode_index}")

    scenes: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    flashback_depth = 0
    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line:
            continue
        scene_match = SCENE_HEADER.match(line)
        if scene_match:
            current = {
                "number": f"{scene_match.group(1)}-{scene_match.group(2)}",
                "characters": [],
                "content_count": 0,
                "line": line_number,
            }
            scenes.append(current)
            if int(scene_match.group(1)) != episode_index:
                errors.append(f"第 {line_number} 行场号不属于第 {episode_index} 集")
            continue
        if line.startswith("人物：") or line.startswith("人物:"):
            if current is None:
                errors.append(f"第 {line_number} 行人物表位于场景外")
                continue
            raw_characters = re.split(r"[、,，/]", line.split("：", 1)[-1].split(":", 1)[-1])
            current["characters"] = [item.strip() for item in raw_characters if item.strip()]
            continue
        if line == "【闪回】":
            flashback_depth += 1
            if current:
                current["content_count"] += 1
            continue
        if line == "【闪出】":
            flashback_depth -= 1
            if flashback_depth < 0:
                errors.append(f"第 {line_number} 行出现未配对的【闪出】")
                flashback_depth = 0
            if current:
                current["content_count"] += 1
            continue
        if line.startswith("▲"):
            if current is None:
                errors.append(f"第 {line_number} 行动作位于场景外")
            else:
                current["content_count"] += 1
            continue

        dialogue = DIALOGUE.match(line)
        if dialogue and not line.startswith(("本集概要：", "本集概要:")):
            if current is None:
                errors.append(f"第 {line_number} 行对白位于场景外")
                continue
            speaker = dialogue.group("speaker").strip()
            if speaker in PRONOUN_LABELS:
                errors.append(f"第 {line_number} 行说话人不能使用代词“{speaker}”")
            if current["characters"] and speaker not in current["characters"]:
                errors.append(f"第 {line_number} 行说话人“{speaker}”不在本场人物表")
            if not dialogue.group("content").strip():
                errors.append(f"第 {line_number} 行对白为空")
            current["content_count"] += 1

    if not scenes:
        errors.append("剧本没有任何“## N-M 地点 内/外 时间”场景")
    for expected, scene in enumerate(scenes, start=1):
        expected_number = f"{episode_index}-{expected}"
        if scene["number"] != expected_number:
            errors.append(f"场号应连续：期望 {expected_number}，实际 {scene['number']}")
        if not scene["characters"]:
            errors.append(f"场景 {scene['number']} 缺少人物表")
        if scene["content_count"] == 0:
            errors.append(f"场景 {scene['number']} 没有动作或对白")
    if flashback_depth:
        errors.append("【闪回】与【闪出】数量不匹配")

    visible_chars = _visible_chars(markdown)
    minimum, target_max, hard_max = _length_budget(mode, source_chars)
    if visible_chars < minimum:
        warnings.append(f"可见文本 {visible_chars} 字，低于当前模式建议下限 {minimum} 字")
    if visible_chars > target_max:
        warnings.append(f"可见文本 {visible_chars} 字，高于当前模式建议上限 {target_max} 字")
    if visible_chars > hard_max:
        errors.append(f"可见文本 {visible_chars} 字，超过当前模式硬上限 {hard_max} 字")

    return {
        "status": "valid" if not errors else "invalid",
        "episode_index": episode_index,
        "visible_chars": visible_chars,
        "target": {"min": minimum, "max": target_max, "hard_max": hard_max},
        "errors": errors,
        "warnings": warnings,
    }


def validate_episode(project_dir: Path, episode_index: int) -> dict[str, Any]:
    project = _load_project(project_dir)
    entry = _episode(project, episode_index)
    script_path = _project_path(project_dir, entry["script_path"], "script_path")
    if not script_path.is_file():
        raise ProjectError(f"找不到第 {episode_index} 集剧本：{script_path}")
    result = validate_text(
        script_path.read_text(encoding="utf-8"),
        episode_index=episode_index,
        source_chars=int(entry["source_chars"]),
        mode=str(project["mode"]),
    )
    entry["status"] = result["status"]
    entry["diagnostics"] = result["errors"] + result["warnings"]
    _atomic_json(_project_file(project_dir), project)
    return result


def checkpoint(project_dir: Path, episode_index: int) -> dict[str, Any]:
    project = _load_project(project_dir)
    entry = _episode(project, episode_index)
    script_path = _project_path(project_dir, entry["script_path"], "script_path")
    if not script_path.is_file():
        raise ProjectError(f"找不到第 {episode_index} 集剧本：{script_path}")
    layout = _layout_for_project(project)
    version_dir = _project_path(
        project_dir,
        f"{layout['versions_dir']}/{episode_index:03d}",
        "versions_dir",
    )
    version_dir.mkdir(parents=True, exist_ok=True)
    version_path = version_dir / f"{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}.md"
    shutil.copy2(script_path, version_path)
    return {"episode_index": episode_index, "version": str(version_path.resolve())}


def restore(project_dir: Path, episode_index: int, version: Path, *, yes: bool) -> dict[str, Any]:
    if not yes:
        raise ProjectError("恢复版本会覆盖当前剧本；确认后使用 --yes")
    project = _load_project(project_dir)
    entry = _episode(project, episode_index)
    layout = _layout_for_project(project)
    version_root = _project_path(
        project_dir,
        f"{layout['versions_dir']}/{episode_index:03d}",
        "versions_dir",
    )
    version_path = version.expanduser().resolve()
    if not version_path.is_file() or version_root not in version_path.parents:
        raise ProjectError(f"版本文件必须位于：{version_root}")
    current_checkpoint = checkpoint(project_dir, episode_index)
    script_path = _project_path(project_dir, entry["script_path"], "script_path")
    shutil.copy2(version_path, script_path)
    result = validate_episode(project_dir, episode_index)
    return {
        "episode_index": episode_index,
        "restored_version": str(version_path),
        "previous_current": current_checkpoint["version"],
        "validation": result,
    }


def merge(project_dir: Path, output: Path | None = None) -> dict[str, Any]:
    project = _load_project(project_dir)
    scripts: list[str] = []
    failures: list[dict[str, Any]] = []
    for entry in project["episodes"]:
        script_path = _project_path(project_dir, entry["script_path"], "script_path")
        if not script_path.is_file():
            failures.append({"episode": entry["index"], "errors": ["剧本文件不存在"]})
            continue
        result = validate_text(
            script_path.read_text(encoding="utf-8"),
            episode_index=int(entry["index"]),
            source_chars=int(entry["source_chars"]),
            mode=str(project["mode"]),
        )
        entry["status"] = result["status"]
        entry["diagnostics"] = result["errors"] + result["warnings"]
        if result["status"] != "valid":
            failures.append({"episode": entry["index"], "errors": result["errors"]})
        scripts.append(script_path.read_text(encoding="utf-8").strip())
    _atomic_json(_project_file(project_dir), project)
    if failures:
        raise ProjectError(f"存在未通过格式校验的分集：{json.dumps(failures, ensure_ascii=False)}")

    output_path = output or _project_path(
        project_dir,
        _layout_for_project(project)["full_screenplay"],
        "full_screenplay",
    )
    if output_path.exists():
        raise ProjectError(f"拒绝覆盖已有合并文件：{output_path}")
    _atomic_text(output_path, "\n\n---\n\n".join(scripts) + "\n")
    return {
        "episode_count": len(scripts),
        "output": str(output_path.resolve()),
        "bytes": output_path.stat().st_size,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = ChineseArgumentParser(description="管理本地 Storyflow 小说转剧本项目。")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare", help="规范化本地小说并确定性分集。")
    prepare_parser.add_argument("source")
    prepare_parser.add_argument("project_dir")
    prepare_parser.add_argument("--mode", choices=MODES, default="compact")
    prepare_parser.add_argument(
        "--language",
        default="zh-Hans",
        help="用户选定的语言代码；默认 zh-Hans。新建的可见文件和目录会使用该语言。",
    )

    validate_parser = subparsers.add_parser("validate", help="校验一个已生成分集。")
    validate_parser.add_argument("project_dir")
    validate_parser.add_argument("episode", type=int)

    checkpoint_parser = subparsers.add_parser("checkpoint", help="为一个分集剧本创建快照。")
    checkpoint_parser.add_argument("project_dir")
    checkpoint_parser.add_argument("episode", type=int)

    restore_parser = subparsers.add_parser("restore", help="恢复一个本地分集版本。")
    restore_parser.add_argument("project_dir")
    restore_parser.add_argument("episode", type=int)
    restore_parser.add_argument("version")
    restore_parser.add_argument("--yes", action="store_true")

    merge_parser = subparsers.add_parser("merge", help="校验并合并全部分集。")
    merge_parser.add_argument("project_dir")
    merge_parser.add_argument("--output")
    return parser


def execute(args: argparse.Namespace) -> dict[str, Any]:
    if args.command == "prepare":
        return prepare(
            Path(args.source).expanduser().resolve(),
            Path(args.project_dir).expanduser().resolve(),
            args.mode,
            getattr(args, "language", "zh-Hans"),
        )
    if args.command == "validate":
        return validate_episode(Path(args.project_dir).expanduser().resolve(), args.episode)
    if args.command == "checkpoint":
        return checkpoint(Path(args.project_dir).expanduser().resolve(), args.episode)
    if args.command == "restore":
        return restore(
            Path(args.project_dir).expanduser().resolve(),
            args.episode,
            Path(args.version),
            yes=args.yes,
        )
    if args.command == "merge":
        return merge(
            Path(args.project_dir).expanduser().resolve(),
            Path(args.output).expanduser().resolve() if args.output else None,
        )
    raise ProjectError(f"未知命令：{args.command}")


def main() -> int:
    args = build_parser().parse_args()
    try:
        result = execute(args)
        print(json.dumps({"success": True, "operation": args.command, "data": result}, ensure_ascii=False))
        return 0
    except ProjectError as exc:
        print(
            json.dumps(
                {
                    "success": False,
                    "operation": getattr(args, "command", "unknown"),
                    "error": str(exc),
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
