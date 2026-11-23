#!/usr/bin/env python3
"""Read a user-owned wizdb SQLite export into a Chinese Kimerith catalogue.

Compatibility modules adapt Kimerith-WindHammer 3c24847d under GPL-3.0.
See LICENSE and THIRD_PARTY_NOTICES.md. No game data is included.
"""

import argparse
from collections import Counter, defaultdict
from contextlib import closing
from datetime import datetime, timezone
import gzip
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parent))
from presentation import enrich_entry, separate_talents, load_translator, localize_names


MAX_ENTRIES = 100000
MAX_BYTES = 256 * 1024 * 1024
MAX_TEXT = 1024 * 1024
MAX_NODES = 131072
MAX_ARRAY = 512
MAX_SAFE_INTEGER = 9007199254740991
SCHOOLS = (
    "universal", "universal", "fire", "ice", "storm", "myth", "life", "death",
    "balance", "star", "sun", "moon", "gardening", "shadow", "fishing", "cantrips",
    "castlemagic", "whirlyburly",
)
ITEM_KINDS = ("hat", "robe", "shoes", "weapon", "athame", "amulet", "ring", "deck", "jewel", "mount")
SPELL_KINDS = ("unknown", "healing", "damage", "charm", "ward", "aura", "global", "aoe", "steal", "manipulation", "enchantment", "polymorph", "curse", "jinx", "mutate", "cloak", "shadow", "shadow_creature", "shadow_self", "aura_negative")
TYPE_TABLES = {"item": "items", "spell": "spells", "mob": "mobs", "pet": "pets", "fish": "fish", "statcaps": "statcaps"}
CAP_SCHOOLS = {"b": "balance", "d": "death", "f": "fire", "i": "ice", "l": "life", "m": "myth", "s": "storm"}
CAP_STATS = {"acc": ("accuracy", "percent"), "ap": ("pierce", "percent"), "block": ("block", "rating"), "crit": ("critical", "rating"), "damage": ("damage", "percent"), "pserve": ("pip_conversion", "rating"), "resist": ("resist", "percent")}


def canonical_hash(name):
    """Standard FNV-1a 64-bit, followed by wizdb's unsigned right shift."""
    value = 14695981039346656037
    for octet in name.encode("utf-8"):
        value = ((value ^ octet) * 1099511628211) & ((1 << 64) - 1)
    return value >> 1


def known_effects():
    # Canonical identifiers are data keys, generated independently here. Values
    # are already transformed by wizdb/stat_rules.py; never float-bit-decode b.
    result = {}
    suffixes = {
        "Damage": ("damage_percent", "percent"),
        "ReduceDamage": ("resist_percent", "percent"),
        "Accuracy": ("accuracy_percent", "percent"),
        "ArmorPiercing": ("pierce_percent", "percent"),
        "FlatDamage": ("flat_damage", "flat"),
        "FlatReduceDamage": ("flat_resist", "flat"),
        "CriticalHit": ("critical_rating", "rating"),
        "Block": ("block_rating", "rating"),
        "PipConversion": ("pip_conversion", "rating"),
        "DamageRating": ("damage_rating", "exported_rating"),
        "ReduceDamageRating": ("resist_rating", "exported_rating"),
        "AccuracyRating": ("accuracy_rating", "exported_rating"),
        "ArmorPiercingRating": ("pierce_rating", "exported_rating"),
    }
    for source_school in ("All", "Fire", "Ice", "Storm", "Myth", "Life", "Death", "Balance", "Shadow"):
        school_name = "universal" if source_school == "All" else source_school.lower()
        for suffix, (key, unit) in suffixes.items():
            result[canonical_hash(f"Canonical{source_school}{suffix}")] = ((school_name, key), unit)
    general = {
        "CanonicalMaxHealth": ("health", "flat"),
        "CanonicalMaxMana": ("mana", "flat"),
        "CanonicalMaxEnergy": ("energy", "flat"),
        "CanonicalPowerPip": ("power_pip_percent", "percent"),
        "CanonicalIncHealing": ("incoming_percent", "percent"),
        "CanonicalLifeHealing": ("outgoing_percent", "percent"),
        "CanonicalShadowPipRating": ("shadow_rating", "rating"),
        "CanonicalAllArchmastery": ("archmastery_rating", "rating"),
        "CanonicalAllPowerPipRating": ("power_pip_rating", "exported_rating"),
    }
    for source_name, (key, unit) in general.items():
        result[canonical_hash(source_name)] = ((key,), unit)
    return result


KNOWN_EFFECTS = known_effects()


class CatalogError(Exception):
    pass


def text(value, label, limit=MAX_TEXT):
    if value is None:
        return ""
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8")
        except UnicodeDecodeError as error:
            raise CatalogError(f"{label} 不是有效 UTF-8 文本。") from error
    if not isinstance(value, str):
        value = str(value)
    if len(value) > limit:
        raise CatalogError(f"{label} 超过 {limit} 字符上限。")
    return value


def identifier(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, str, bytes)):
        raise CatalogError(f"{label} 必须是完整十进制整数，不能使用浮点 ID。")
    value = text(value, label, 40)
    if not re.fullmatch(r"[0-9]{1,40}", value):
        raise CatalogError(f"{label} 必须是 1–40 位非负十进制整数。")
    return str(int(value))


def scalar(value, label):
    if value is None:
        return None
    if isinstance(value, int):
        return value if abs(value) <= MAX_SAFE_INTEGER else str(value)
    if isinstance(value, float):
        if not math.isfinite(value) or (value.is_integer() and abs(value) > MAX_SAFE_INTEGER):
            raise CatalogError(f"{label} 含无效或已失去精度的浮点数。")
        return value
    return text(value, label)


def integer(value, label):
    if isinstance(value, bool) or not isinstance(value, int):
        raise CatalogError(f"{label} 必须是整数。")
    return value


def stat_integer(value, label):
    # SQLite may return an integral float when an older schema declares b REAL.
    if isinstance(value, float) and math.isfinite(value) and value.is_integer() and abs(value) <= MAX_SAFE_INTEGER:
        value = int(value)
    value = integer(value, label)
    if abs(value) > MAX_SAFE_INTEGER:
        raise CatalogError(f"{label} 超过可安全表示的属性数值范围。")
    return value


def add_stat(entry, keys, value, unit):
    target = entry.setdefault("stats", {})
    for key in keys[:-1]:
        target = target.setdefault(key, {})
    path = ".".join(keys)
    units = entry.setdefault("stat_units", {})
    if path in units and units[path] != unit:
        raise CatalogError(f"{entry['type']}:{entry['id']} 的 {path} 单位冲突，无法合并。")
    counts = entry.setdefault("stat_record_counts", {})
    counts[path] = counts.get(path, 0) + 1
    total = target.get(keys[-1], 0) + value
    if abs(total) > MAX_SAFE_INTEGER:
        raise CatalogError("累计属性值超过可安全表示的范围。")
    target[keys[-1]] = total
    units[path] = unit
    if counts[path] > 1:
        note(entry, "重复属性记录按同一路径的原始加成求和，stat_record_counts 保留条数；未模拟装备条件、套装触发或运行时规则。")
    if unit == "exported_rating":
        note(entry, "带 Rating 的不确定字段保留导出数值及 exported_rating 单位；不把这些字段当百分比，也不再次换算。")


def note(entry, message):
    if message not in entry.setdefault("notes", []):
        entry["notes"].append(message)


def append_bounded(entry, key, value):
    values = entry.setdefault(key, [])
    if len(values) >= MAX_ARRAY:
        raise CatalogError(f"{entry['type']}:{entry['id']} 的 {key} 超过 {MAX_ARRAY} 项，请拆分资料或检查数据库。")
    values.append(value)


def open_db(filename):
    path = Path(filename).expanduser().resolve(strict=True)
    if not path.is_file():
        raise CatalogError("输入必须是 SQLite 文件。")
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    connection.execute("PRAGMA trusted_schema = OFF")
    return connection


class Reader:
    def __init__(self, connection):
        self.connection = connection
        self.tables = {}
        for row in connection.execute("SELECT name, sql FROM sqlite_master WHERE type = 'table'"):
            if row[0] in set(TYPE_TABLES.values()) | {"locale_en", "set_bonuses", "talents", "pet_cards", "item_stats", "mob_stats", "mob_items", "deck", "effects", "spell_effects"}:
                if "CREATE VIRTUAL TABLE" in str(row[1]).upper():
                    raise CatalogError(f"不接受虚拟表 {row[0]}，请使用标准 wizdb SQLite 导出。")
                self.tables[row[0]] = {item[1] for item in connection.execute(f'PRAGMA table_info("{row[0]}")')}

    def rows(self, table, required=(), optional=True, order=None):
        if table not in self.tables:
            if optional:
                return iter(())
            raise CatalogError(f"缺少必要数据表 {table}。")
        missing = sorted(set(required) - self.tables[table])
        if missing:
            raise CatalogError(f"数据表 {table} 缺少必要列：{', '.join(missing)}。请核对 wizdb 版本。")
        suffix = f' ORDER BY "{order}"' if order in self.tables[table] else ""
        return (dict(row) for row in self.connection.execute(f'SELECT * FROM "{table}"{suffix}'))


def school(entry, value, key="school"):
    if value is None:
        return
    code = integer(value, key)
    if 0 <= code < len(SCHOOLS):
        entry[key] = SCHOOLS[code]
    else:
        entry[key] = "unknown"
        entry[f"{key}_raw"] = scalar(code, key)
        note(entry, "学派值含未知编码或高位排除限制；保留原值，未猜测成普通学派。")


def copy_values(entry, row, fields):
    for key in fields:
        if row.get(key) is not None:
            entry[key] = scalar(row[key], key)


def build_catalog(reader, version, decks_reader=None, selected_types=None, translate=None):
    selected_types = set(selected_types or TYPE_TABLES)
    translate = translate or (lambda value, ref=None: value)
    locales = {}
    for row in reader.rows("locale_en", ("id", "data"), optional=False):
        if len(locales) >= 1000000:
            raise CatalogError("locale_en 超过 1000000 条上限。")
        locales[identifier(row["id"], "locale_en.id")] = text(row["data"], "locale_en.data")

    def localized(key, label, required=False):
        result = locales.get(identifier(key, label), "") if key is not None else ""
        if required and not result:
            raise CatalogError(f"{label} 引用的英文名称不存在或为空。")
        return result

    sets = {identifier(row["id"], "set_bonuses.id"): localized(row["name"], "set_bonuses.name") for row in reader.rows("set_bonuses", ("id", "name"))}
    entries, by_type, seen = [], defaultdict(dict), set()
    spell_objects, spell_ids, item_objects = {}, {}, {}
    from spell_effects import SpellEffectRenderer
    effect_renderer = SpellEffectRenderer(reader.connection, translate=translate)
    if "spell" in selected_types:
        effect_renderer.preload_effects()
    combat_item_cache = {}
    missing_tables = []

    def add(entry):
        pair = (entry["type"], entry["id"])
        if pair in seen:
            raise CatalogError(f"重复类型与 ID：{pair[0]}:{pair[1]}。导出已停止，不覆盖变体。")
        seen.add(pair)
        by_type[entry["type"]][entry["id"]] = entry
        if entry["type"] in selected_types:
            if len(entries) >= MAX_ENTRIES:
                raise CatalogError("超过 100000 条资料上限，请用 --types 分类别导出。")
            entries.append(entry)

    for type_name, table in TYPE_TABLES.items():
        reference_needed = (type_name == "spell" and bool(selected_types & {"item", "pet", "mob"})) or (type_name == "item" and "mob" in selected_types)
        if type_name not in selected_types and not reference_needed:
            continue
        if table not in reader.tables:
            if type_name in selected_types:
                missing_tables.append(table)
            continue
        required = ("level", "school") if type_name == "statcaps" else ("id", "name", "real_name")
        if type_name == "spell":
            required += ("template_id",)
        for row_index, row in enumerate(reader.rows(table, required)):
            if row_index >= MAX_ENTRIES:
                raise CatalogError(f"数据表 {table} 超过 100000 行上限。")
            if type_name == "statcaps":
                level, code = integer(row["level"], "statcaps.level"), integer(row["school"], "statcaps.school")
                if not (0 <= level <= 10000 and 0 <= code < len(SCHOOLS)):
                    raise CatalogError("statcaps 的等级或学派编码不在可导入范围。")
                entry = {"type": type_name, "id": str(9000000000 + code * 100000 + level), "name": f"{SCHOOLS[code]} level {level} stat caps", "level": level, "school": SCHOOLS[code], "local_only": True, "id_scope": "local-statcaps"}
                copy_values(entry, row, ("max_pips", "max_power_pips", "hp", "mana", "ppc", "shad_rating", "archmastery", "outgoing", "incoming"))
                entry["units"] = {"ppc": "percent", "shad_rating": "rating", "archmastery": "rating", "outgoing": "percent", "incoming": "percent"}
                stats = {}
                for prefix, school_name in CAP_SCHOOLS.items():
                    values = {}
                    for suffix, (name, unit) in CAP_STATS.items():
                        if row.get(f"{prefix}_{suffix}") is not None:
                            values[name] = {"value": scalar(row[f"{prefix}_{suffix}"], "statcaps stat"), "unit": unit}
                    if values:
                        stats[school_name] = values
                entry["stats"] = stats
                note(entry, "ID 是 9000000000 + 学派编码 × 100000 + 等级生成的本地索引，不能发送给远程 API。")
                add(entry)
                continue

            identity = identifier(row["template_id"] if type_name == "spell" else row["id"], f"{table}.id")
            name = localized(row["name"], f"{table}.name", required=True)
            if len(name) > 400:
                raise CatalogError(f"{table} 的条目名称超过 400 字符。")
            object_name = text(row["real_name"], f"{table}.real_name")
            entry = {"type": type_name, "id": identity, "name": name, "object_name": object_name}
            if type_name not in selected_types:
                if type_name == "spell":
                    spell_objects[object_name] = entry
                    spell_ids[identity] = entry
                elif type_name == "item":
                    item_objects[identity] = object_name
                continue
            if type_name == "item":
                school(entry, row.get("equip_school"))
                school(entry, row.get("equip_secondary"), "secondary_school")
                copy_values(entry, row, ("equip_level", "rarity", "jewels", "extra_flags", "min_pet_level", "max_spells", "max_copies", "max_school_copies", "max_tcs", "archmastery_points"))
                if row.get("equip_level") is not None:
                    entry["level"] = scalar(row["equip_level"], "equip_level")
                if row.get("kind") is not None:
                    bits = integer(row["kind"], "items.kind")
                    entry["kind_raw"] = scalar(bits, "items.kind")
                    kinds = [kind for index, kind in enumerate(ITEM_KINDS) if bits >= 0 and bits & (1 << index)]
                    entry["kinds"] = kinds
                    entry["kind"] = kinds[0] if len(kinds) == 1 and not bits & ~1023 else "unknown"
                    if entry["kind"] == "unknown":
                        note(entry, "装备 kind 位标记含多类别、未知位或空值；kinds 保留能确认的位，不猜唯一槽位。")
                item_objects[identity] = object_name
            elif type_name == "spell":
                school(entry, row.get("school"))
                entry["row_id"] = identifier(row["id"], "spells.row_id")
                copy_values(entry, row, ("accuracy", "energy", "rank", "levelreq", "x_pips", "shadow_pips", "fire_pips", "ice_pips", "storm_pips", "myth_pips", "life_pips", "death_pips", "balance_pips"))
                if row.get("levelreq") is not None:
                    entry["level"] = scalar(row["levelreq"], "levelreq")
                if row.get("form") is not None:
                    form = integer(row["form"], "spells.form")
                    entry["form_raw"] = scalar(form, "form")
                    # Upstream filtering always compares the numeric form,
                    # including gardening/fishing/cantrips. Presentation uses
                    # that school's separate labels in spell_kind_label.
                    if 0 <= form < len(SPELL_KINDS):
                        entry["kind"] = SPELL_KINDS[form]
                for flag in ("pve", "pvp"):
                    if row.get(flag) is not None:
                        entry[f"{flag}_raw"] = scalar(row[flag], flag)
                if row.get("description") is not None:
                    entry["description"] = localized(row["description"], "spells.description")
                spell_details = effect_renderer.render_spell_details(row)
                entry.update(spell_details)
                spell_objects[object_name] = entry
                spell_ids[identity] = entry
            elif type_name == "mob":
                school(entry, row.get("primary_school"))
                entry["stats_scope"] = "base_only"
                school(entry, row.get("secondary_school"), "secondary_school")
                copy_values(entry, row, ("rank", "hp", "max_shadow", "has_cheats", "intelligence", "selfishness", "aggressiveness", "monstro"))
                if row.get("title") is not None:
                    entry["kind"] = text(row["title"], "mobs.title").lower()
                if row.get("stunnable") is not None:
                    entry["stunnable_raw"] = scalar(row["stunnable"], "stunnable")
                note(entry, "has_cheats 仅为数据库标记，不包含 Boss 机制攻略。")
            elif type_name == "pet":
                school(entry, row.get("school"))
                copy_values(entry, row, ("rarity", "extra_flags", "wow_factor", "exclusive"))
                entry["stats"] = {key: scalar(row[key], key) for key in ("strength", "intellect", "agility", "will", "power") if row.get(key) is not None}
                if row.get("egg_name") is not None:
                    entry["egg"] = localized(row["egg_name"], "pets.egg_name")
            elif type_name == "fish":
                school(entry, row.get("school"))
                copy_values(entry, row, ("rank", "base_length", "min_size", "max_size", "speed", "bite_seconds", "initial_bite_chance", "incremental_bite_chance", "is_sentinel"))
                entry["units"] = {"min_size": "base_length multiplier", "max_size": "base_length multiplier", "bite_seconds": "seconds"}
                note(entry, "min_size/max_size 是基础长度倍率；咬钩机会保留数据库原值，不猜测为 0–1 或百分比。")
            if row.get("bonus_set") not in (None, 0, "0"):
                set_id = identifier(row["bonus_set"], "bonus_set")
                entry["set_bonus"] = {"id": set_id, "name": sets.get(set_id, "")}
                if not sets.get(set_id):
                    note(entry, "套装名称未解析，保留套装 ID。")
            enrich_entry(entry, row)
            add(entry)

    for row in reader.rows("talents", ("id", "priority", "pet", "talent"), order="id"):
        owner = by_type["pet"].get(identifier(row["pet"], "talents.pet"))
        if owner:
            append_bounded(owner, "talents", {"id": identifier(row["id"], "talents.id"), "name": localized(row["talent"], "talents.talent"), "priority": scalar(row["priority"], "priority")})
    for pet in by_type["pet"].values():
        separate_talents(pet)

    def spell_reference(value):
        object_name = text(value, "spell reference")
        resolved = spell_objects.get(object_name) or spell_ids.get(object_name)
        result = {"name": resolved["name"] if resolved else object_name, "object_name": resolved["object_name"] if resolved else object_name}
        if resolved:
            result["id"] = resolved["id"]
        return result

    for row in reader.rows("pet_cards", ("pet", "spell")):
        owner = by_type["pet"].get(identifier(row["pet"], "pet_cards.pet"))
        if owner:
            append_bounded(owner, "cards", spell_reference(row["spell"]))

    for table, type_name, foreign_key in (("item_stats", "item", "item"), ("mob_stats", "mob", "mob")):
        if not by_type[type_name]:
            continue
        if table not in reader.tables:
            for entry in by_type[type_name].values():
                note(entry, f"数据库缺少 {table}，没有导出这部分属性；缺失不代表数值为零。")
            continue
        for row in reader.rows(table, (foreign_key, "kind", "a", "b"), order="id"):
            owner = by_type[type_name].get(identifier(row[foreign_key], table))
            if not owner:
                continue
            kind = integer(row["kind"], f"{table}.kind")
            parsed = True
            if kind == 1:
                category = int(identifier(row["a"], f"{table}.a"))
                if category in KNOWN_EFFECTS:
                    keys, unit = KNOWN_EFFECTS[category]
                    add_stat(owner, keys, stat_integer(row["b"], f"{table}.b"), unit)
                else:
                    parsed = False
            elif kind == 2:
                pips, power = stat_integer(row["a"], "starting pips"), stat_integer(row["b"], "starting power pips")
                if pips < 0 or power < 0:
                    raise CatalogError("起手豆数量不能为负数。")
                add_stat(owner, ("pips",), pips, "count")
                add_stat(owner, ("power_pips",), power, "count")
            elif kind in (3, 4):
                spell_id = identifier(row["a"], "item spell template ID")
                card = {**spell_reference(spell_id), "id": spell_id}
                if spell_id not in spell_ids:
                    card["unresolved"] = True
                    note(owner, "部分法术引用未关联到名称，保留模板 ID，不猜测卡片效果。")
                if kind == 3:
                    count = stat_integer(row["b"], "item card count")
                    if not 0 <= count <= 1000000:
                        raise CatalogError("自带卡数量必须在 0–1000000 之间。")
                    card["count"] = count
                    append_bounded(owner, "cards", card)
                else:
                    description_key = stat_integer(row["b"], "Maycast description ID") if isinstance(row["b"], float) else row["b"]
                    description_id = identifier(description_key, "Maycast description ID")
                    card["description_id"] = description_id
                    card["description"] = localized(description_id, "Maycast description")
                    if not card["description"]:
                        note(owner, "部分 Maycast 描述未解析，保留原始描述引用。")
                    append_bounded(owner, "maycasts", card)
            elif kind == 5:
                value = scalar(row["a"], "speed multiplier")
                if not isinstance(value, (int, float)):
                    raise CatalogError("速度倍率必须是有限数值。")
                append_bounded(owner, "speed_multipliers", value)
                note(owner, "速度记录为原始 m_speedMultiplier，未转成百分比，未推断多条速度效果如何叠加。")
            elif kind == 6:
                count = stat_integer(row["a"], "mount passengers")
                if not 0 <= count <= 1000000:
                    raise CatalogError("坐骑座位数必须在 0–1000000 之间。")
                append_bounded(owner, "passenger_counts", count)
            else:
                parsed = False
            if parsed:
                owner["parsed_stats"] = owner.get("parsed_stats", 0) + 1
            else:
                owner["unparsed_stats"] = owner.get("unparsed_stats", 0) + 1
                note(owner, "旧简化字段仍有未映射的属性哈希或记录种类，unparsed_stats 仅统计该旧格式；完整原生属性另行解析，未把缺失属性补零。")
        for entry in by_type[type_name].values():
            if entry.get("parsed_stats"):
                note(entry, "Canonical 数值直接使用 wizdb 已换算并 round 的整数；百分比不再次乘 100，数据不按浮点位串解包。")
            if len(entry.get("speed_multipliers", [])) == 1:
                entry["speed_multiplier"] = entry["speed_multipliers"][0]
                del entry["speed_multipliers"]
            if len(entry.get("passenger_counts", [])) == 1:
                entry["passengers"] = entry["passenger_counts"][0]
                del entry["passenger_counts"]
            elif len(entry.get("passenger_counts", [])) > 1:
                note(entry, "存在多条座位数记录，保留 passenger_counts，不推断有效总座位数。")

    deck_sources = []
    for deck_reader in (reader, decks_reader):
        if not deck_reader:
            continue
        index = defaultdict(list)
        for row in deck_reader.rows("deck", ("name", "spell", "count")):
            key = text(row["name"], "deck.name")
            if len(index[key]) >= MAX_ARRAY:
                raise CatalogError("单个 deck 超过 512 条记录。")
            count = integer(row["count"], "deck.count")
            if not 0 <= count <= 1000000:
                raise CatalogError("deck.count 必须是 0–1000000 的整数。")
            index[key].append({**spell_reference(row["spell"]), "count": count})
        deck_sources.append(index)
    mob_item_names = defaultdict(list)
    for row in reader.rows("mob_items", ("mob", "item")):
        mob_id = identifier(row["mob"], "mob_items.mob")
        item_name = item_objects.get(identifier(row["item"], "mob_items.item"))
        if item_name and item_name not in mob_item_names[mob_id]:
            if len(mob_item_names[mob_id]) >= MAX_ARRAY:
                raise CatalogError("单个怪物装备关联超过 512 条。")
            mob_item_names[mob_id].append(item_name)
    for entry in by_type["mob"].values():
        keys = list(dict.fromkeys(mob_item_names[entry["id"]]))
        rows = [card for key in keys for card in (deck_sources[0].get(key, []) if deck_sources else [])]
        if not rows and len(deck_sources) > 1:
            rows = [card for key in keys for card in deck_sources[1].get(key, [])]
        # Kimerith falls back as a group for equipment decks, then appends the
        # mob's own deck from items.db only. Per-key fallback changes its output.
        rows += deck_sources[0].get(entry["object_name"], []) if deck_sources else []
        for card in rows:
            append_bounded(entry, "deck", card)
        if entry.get("deck"):
            note(entry, "牌组按 Kimerith 规则：装备牌组整体优先 items.db；全空时才回退 decks.db；再加入 items.db 中怪物自身的牌组。")
        from combat import build_mob_combat
        entry["combat"] = build_mob_combat(reader.connection, entry["id"], entry["object_name"], item_cache=combat_item_cache)
        # Keep the legacy top-level dictionary honestly scoped. Full native
        # aggregation, including ratings, lives in combat and is consumed by
        # the Kimerith calculation route only.
        entry["stats_scope"] = "base_only"

    from combat import read_entity_stats
    for entry in by_type["item"].values():
        if "item_stats" in reader.tables:
            entry["native_stats"] = read_entity_stats(reader.connection, "item_stats", "item", entry["id"])
        else:
            note(entry, "数据库缺少 item_stats，未提供装备属性；没有把缺失属性当作零。")
    for entry in entries:
        localize_names(entry, translate)

    return {"kind": "wizard101.catalog", "schemaVersion": 1, "source": {"name": "wizdb 本地导出", "version": version, "url": "https://github.com/MajorPain1/wizdb", "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}, "entries": entries, "importNotes": ["缺少的数据表：" + ", ".join(missing_tables)] if missing_tables else []}


def save_catalog(document, output):
    for entry in document["entries"]:
        nodes = 0

        def inspect(value, depth=0, field=""):
            nonlocal nodes
            nodes += 1
            if nodes > MAX_NODES or depth > 10:
                raise CatalogError(f"{entry['type']}:{entry['id']} 超过单条 {MAX_NODES} 字段节点或 10 层嵌套上限。")
            if isinstance(value, str) and len(value.encode("utf-16-le")) // 2 > MAX_TEXT:
                raise CatalogError("资料单字段文字超过 1048576 个 UTF-16 单元。")
            if isinstance(value, dict):
                for key, child in value.items():
                    inspect(child, depth + 1, key)
            elif isinstance(value, list):
                maximum = 8192 if field == "effect_warnings" else 4096 if field in ("effect_unparsed", "effect_rows") else MAX_ARRAY
                if len(value) > maximum:
                    raise CatalogError(f"资料单字段数组超过 {maximum} 项。")
                for child in value:
                    inspect(child, depth + 1)

        inspect(entry)
    payload = json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(payload) > MAX_BYTES:
        raise CatalogError("资料包解压后超过 256 MiB，请用 --types 分类别导出。")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".catalog-", delete=False) as stream:
            temporary = Path(stream.name)
            if output.name.endswith(".gz"):
                with gzip.GzipFile(fileobj=stream, mode="wb", mtime=0) as compressed:
                    compressed.write(payload)
            else:
                stream.write(payload)
        os.replace(temporary, output)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def main(argv=None):
    parser = argparse.ArgumentParser(description="以只读方式从自有 wizdb 数据库导出 Wizard101 本地资料包。")
    parser.add_argument("--input", required=True, help="items.db 路径")
    parser.add_argument("--output", required=True, help="输出 catalog.json 或 catalog.json.gz")
    parser.add_argument("--decks", help="可选 decks.db 路径")
    parser.add_argument("--locale", help="可选中文词典 JSON/JSON.gz；用于名称与法术原始说明模板的中文化")
    parser.add_argument("--version", default="未标注", help="用户提供的游戏/资料版本标识，不会自动猜测")
    parser.add_argument("--types", default=",".join(TYPE_TABLES), help="逗号分隔的 item,spell,mob,pet,fish,statcaps 子集")
    args = parser.parse_args(argv)
    try:
        selected = {part.strip() for part in args.types.split(",") if part.strip()}
        if not selected or not selected <= set(TYPE_TABLES):
            raise CatalogError("--types 只能包含 item,spell,mob,pet,fish,statcaps。")
        version = text(args.version, "资料版本", 100)
        if not version.strip():
            version = "未标注"
        input_path = Path(args.input).expanduser().resolve(strict=True)
        deck_path = Path(args.decks).expanduser().resolve(strict=True) if args.decks else None
        output_path = Path(args.output).expanduser().resolve()
        if output_path == input_path or output_path == deck_path:
            raise CatalogError("输出不能覆盖输入数据库。")
        if not (output_path.name.endswith(".json") or output_path.name.endswith(".json.gz")):
            raise CatalogError("输出扩展名须为 .json 或 .json.gz。")
        translate = load_translator(args.locale)
        with closing(open_db(input_path)) as connection:
            reader = Reader(connection)
            if deck_path:
                with closing(open_db(deck_path)) as decks_connection:
                    document = build_catalog(reader, version, Reader(decks_connection), selected, translate)
            else:
                document = build_catalog(reader, version, selected_types=selected, translate=translate)
        save_catalog(document, output_path)
        print(json.dumps({"ok": True, "entries": len(document["entries"]), "types": dict(Counter(entry["type"] for entry in document["entries"])), "version": version, "notes": document["importNotes"]}, ensure_ascii=False))
        return 0
    except (CatalogError, sqlite3.Error, OSError, ValueError, OverflowError) as error:
        print(f"导入失败：{error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
