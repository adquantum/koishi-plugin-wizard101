#!/usr/bin/env python3
"""Convert locally supplied Wizard101 DDS/TGA icons into a bounded PNG catalog."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import warnings
import zipfile

try:
    from PIL import Image
except ImportError:
    raise SystemExit("需要 Pillow：python -m pip install Pillow")

MAX_FILES = 4096
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_TOTAL_BYTES = 128 * 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 1024 * 1024
# Keep the published catalog within lib/cards.cjs runtime budgets. Input archive
# limits are intentionally separate: conversion can change size and add aliases.
MAX_ICON_ENTRIES = 2048
MAX_ICON_BYTES = 1024 * 1024
MAX_ICON_TOTAL = 16 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
FORMATS = {".dds", ".tga", ".png"}
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
warnings.simplefilter("error", Image.DecompressionBombWarning)


def safe_name(name: str) -> str:
    name = name.replace("\\", "/")
    parts = PurePosixPath(name)
    if (not name or parts.is_absolute() or ".." in parts.parts
            or any(":" in part for part in parts.parts)
            or any(ord(char) < 32 for char in name)):
        raise ValueError("输入中存在不安全的相对路径")
    return str(parts)


def inputs(source: Path):
    """Yield validated names and bounded bytes without extracting ZIP paths."""
    count = 0
    total = 0
    seen: set[str] = set()
    if source.is_file():
        if source.stat().st_size > MAX_ARCHIVE_BYTES:
            raise ValueError("ZIP 超过 64 MiB 上限")
        with zipfile.ZipFile(source) as archive:
            members = archive.infolist()
            if len(members) > MAX_FILES:
                raise ValueError("ZIP 条目超过 4096 上限")
            for member in members:
                name = safe_name(member.filename)
                mode = member.external_attr >> 16
                if stat.S_ISLNK(mode):
                    raise ValueError("ZIP 不允许符号链接")
                if member.is_dir():
                    continue
                if name.casefold() in seen:
                    raise ValueError("ZIP 存在重复路径")
                seen.add(name.casefold())
                total += member.file_size
                if total > MAX_TOTAL_BYTES or member.file_size > MAX_FILE_BYTES:
                    raise ValueError("ZIP 展开大小超过限制")
                if member.flag_bits & 1:
                    raise ValueError("不支持加密 ZIP")
                if member.file_size > member.compress_size * 1000 + 65536:
                    raise ValueError("ZIP 压缩比例异常")
                if Path(name).suffix.lower() not in FORMATS:
                    continue
                with archive.open(member) as handle:
                    raw = handle.read(MAX_FILE_BYTES + 1)
                if len(raw) > MAX_FILE_BYTES or len(raw) != member.file_size:
                    raise ValueError("ZIP 条目大小不一致或超限")
                yield name, raw
        return
    if not source.is_dir() or source.is_symlink():
        raise ValueError("输入必须是 ZIP 文件或普通目录")
    for directory, subdirs, files in os.walk(source, followlinks=False):
        for subdir in subdirs:
            if (Path(directory) / subdir).is_symlink():
                raise ValueError("输入目录不允许符号链接")
        for filename in files:
            file = Path(directory) / filename
            count += 1
            if count > MAX_FILES:
                raise ValueError("目录文件数超过 4096 上限")
            if file.is_symlink() or not file.is_file():
                raise ValueError("输入中存在非普通文件")
            name = safe_name(file.relative_to(source).as_posix())
            if name.casefold() in seen:
                raise ValueError("目录存在大小写冲突的路径")
            seen.add(name.casefold())
            size = file.stat().st_size
            total += size
            if total > MAX_TOTAL_BYTES or size > MAX_FILE_BYTES:
                raise ValueError("输入文件大小超过限制")
            if file.suffix.lower() in FORMATS:
                raw = file.read_bytes()
                if len(raw) > MAX_FILE_BYTES:
                    raise ValueError("读取的文件大小超过限制")
                yield name, raw


def semantic_names() -> dict[str, str]:
    names = {
        "stat.health": "Type_MaxHealth", "stat.mana": "Type_MaxMana",
        "stat.energy": "Type_MaxEnergy", "stat.damage": "Type_Damage",
        "stat.flat_damage": "Type_Damage_Flat", "stat.resist": "Type_Resist",
        "stat.flat_resist": "Type_Resist_Flat", "stat.accuracy": "Icon_Accuracy",
        "stat.critical": "Icon_CriticalRating", "stat.block": "Icon_BlockRating",
        "stat.pierce": "Icon_Armor_Penetration", "stat.archmastery": "Icon_Archmastery",
        "stat.pip_conversion": "Icon_Pip_Conversion", "stat.power_pip": "Type_PowerPips",
        "stat.heal": "Type_Heal", "stat.incoming": "Icon_Incoming",
        "stat.outgoing": "Icon_Outgoing", "stat.stun_resist": "Type_Stun_Resist",
        "stat.speed": "Type_Speed_Effect", "pip.normal": "Type_Pip",
        "pip.power": "Type_PowerPips", "pip.shadow": "Icon_Shadow_Pip",
        "school.universal": "Icon_All", "school.elemental": "Icon_Elemental",
        "school.spirit": "Icon_Spirit", "spell.blade": "Type_Blade",
        "spell.shield": "Type_Ward", "spell.trap": "Type_Trap",
        "spell.weakness": "Icon_Weakness", "spell.aura": "Type_Aura",
        "spell.global": "Type_Global", "spell.dot": "Type_DamageOverTime",
        "spell.hot": "Type_HealOverTime", "spell.damage": "Type_Damage",
        "spell.heal": "Type_Heal", "spell.absorb": "Type_Absorb",
        "spell.enchant": "Type_Enchantment", "spell.dispel": "Icons_Dispel",
        "spell.stun": "Icons_Stun", "spell.aoe": "Type_AOE",
        "spell.minion": "Icons_Minion", "spell.polymorph": "Type_Polymorph",
        "target.self": "Icon_Self", "target.enemies": "Icons_All_Enemies",
        "target.friends": "Icons_All_Friends", "misc.recipe": "Icon_Recipe",
        "misc.reagent": "Icon_Reagent", "misc.fishing": "Icon_Fishing",
        "misc.gardening": "Icon_Gardening", "misc.drop": "Icon_WorldDrop",
    }
    for school in ("fire", "ice", "storm", "myth", "life", "death", "balance", "sun", "moon", "star", "shadow"):
        names[f"school.{school}"] = f"Icon_{school.title()}"
    for school in ("fire", "ice", "storm", "myth", "life", "death", "balance"):
        names[f"pip.{school}"] = f"pip_{school}_no_glow"
    for shape in ("circle", "square", "triangle", "octagon"):
        names[f"socket.{shape}"] = f"Gem_{shape.title()}"
        names[f"socket.{shape}.locked"] = f"Gem_{shape.title()}Locked"
    for attr in ("strength", "intellect", "agility", "will", "power"):
        names[f"pet.{attr}"] = f"Icon_Pet_{attr.title()}"
    for flag in ("NoAuction", "NoTrade", "NoSell", "NoDrop", "NoDye", "NoPVP", "PVPOnly", "CrownsOnly"):
        names[f"flag.{flag.lower()}"] = f"Icon_Flag_{flag}"
    return names


def convert(source: Path, target: Path) -> dict:
    if source.is_dir() and target.resolve().is_relative_to(source.resolve()):
        raise ValueError("输出目录不能放在输入目录内")
    if target.exists() and (target.is_symlink() or not target.is_dir() or any(target.iterdir())):
        raise ValueError("输出目录必须不存在或为空；请使用新的目录，避免覆盖已有数据")
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".icons-import-", dir=target.parent))
    try:
        (temporary / "png").mkdir()
        records = []
        by_stem = {}
        raw_icons = {}
        png_total = 0
        for name, raw in inputs(source):
            with Image.open(io.BytesIO(raw)) as image:
                if (image.width <= 0 or image.height <= 0 or image.width > 1024
                        or image.height > 1024 or image.width * image.height > MAX_PIXELS):
                    raise ValueError("图像尺寸超过 1024×1024 上限")
                if image.format not in {"DDS", "TGA", "PNG"}:
                    raise ValueError("扩展名与支持的图像内容不匹配")
                image.load()
                # Preserve original RGB and alpha, including opaque jewel backgrounds.
                image = image.convert("RGBA")
                slug = re.sub(r"[^a-z0-9_-]", "-", Path(name).stem.lower())[:70] or "icon"
                digest = hashlib.sha256(name.encode("utf-8")).hexdigest()[:12]
                relative = f"png/{slug}-{digest}.png"
                output = temporary / relative
                if output.exists():
                    raise ValueError("转换后的 PNG 文件名发生冲突")
                image.save(output, format="PNG", optimize=True)
                png = output.read_bytes()
                if len(png) > MAX_ICON_BYTES:
                    raise ValueError(f"转换后的单个 PNG 超过渲染器上限 {MAX_ICON_BYTES} 字节")
                png_total += len(png)
                if png_total > MAX_ICON_TOTAL:
                    raise ValueError(f"转换后的 PNG 总量超过渲染器上限 {MAX_ICON_TOTAL} 字节")
                item = {"file": relative, "width": image.width, "height": image.height,
                        "sha256": hashlib.sha256(png).hexdigest()}
                records.append({**item, "source": name})
                extension = Path(name).suffix.lower().lstrip(".")
                raw_key = f"asset.{slug}.{extension}"
                if raw_key in raw_icons:
                    raw_key += "." + digest
                raw_icons[raw_key] = item
                stem = Path(name).stem.lower()
                priority = (image.width * image.height, extension == "dds")
                if stem not in by_stem or priority > by_stem[stem][0]:
                    by_stem[stem] = (priority, item)
        if not records:
            raise ValueError("没有找到可转换的 DDS、TGA 或 PNG 图标")
        icons = dict(raw_icons)
        semantic_count = 0
        for key, stem in semantic_names().items():
            if stem.lower() in by_stem:
                icons[key] = by_stem[stem.lower()][1]
                semantic_count += 1
        if len(icons) > MAX_ICON_ENTRIES:
            raise ValueError(f"清单图标键数超过渲染器上限 {MAX_ICON_ENTRIES}（含原文件键与语义键）")
        manifest = {"schemaVersion": 1, "source": {"kind": "user-supplied", "fileCount": len(records)},
                    "semanticIconCount": semantic_count, "icons": dict(sorted(icons.items())), "files": records}
        manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if len(manifest_bytes) > MAX_MANIFEST_BYTES:
            raise ValueError(f"manifest.json 超过渲染器上限 {MAX_MANIFEST_BYTES} 字节")
        (temporary / "manifest.json").write_bytes(manifest_bytes)
        if target.exists():
            target.rmdir()  # Only an empty directory passed the check above.
        temporary.rename(target)
        return {"files": len(records), "semanticIcons": semantic_count, "manifest": str(target / "manifest.json")}
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="本地 Icons.zip 或图标目录")
    parser.add_argument("--output", required=True, help="新的 PNG 及 manifest.json 输出目录")
    args = parser.parse_args()
    try:
        result = convert(Path(args.input).expanduser(), Path(args.output).expanduser())
    except (OSError, ValueError, zipfile.BadZipFile, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        print("图标导入失败：" + str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
