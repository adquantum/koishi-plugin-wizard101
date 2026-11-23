"""Chinese metadata compatibility for Kimerith-WindHammer 3c24847d.

Adapted from bot/database.py and bot/extensions/{stats,pets,fish,spells,mobs}.py.
Upstream: Valentin B. / MajorPain1, GPL-3.0. Modified 2026-11-23.
This module has no Discord or network dependency.
"""
import gzip
import json
from pathlib import PurePosixPath
import unicodedata

REVISION = "3c24847d111387fc0b34772b548f74e80089599f"
SCHOOLS = ("全学派", "全学派", "火焰", "冰霜", "风暴", "神圣", "生命", "亡灵", "平衡", "星辰", "太阳", "月亮", "园艺", "暗影", "钓鱼", "场外魔咒", "城堡魔法", "旋转棋")
FLAGS = ("方形宝石", "圆形宝石", "宠物宝石", "三角宝石", "泪形宝石", "盾形别针", "剑形别针", "力量别针", "不可拍卖", "皇冠专用", "不可赠送", "立即生效", "不可在战斗中使用", "不可丢弃", "不可染色", "不可加入孵化亭", "不可用于 PvP", "不可出售", "不可粉碎", "不可交易", "仅用于 PvP", "竞技场积分专用", "蓝色竞技场积分专用")
PET_LEVELS = ("幼年", "少年", "成年", "远古", "史诗", "超级", "究极")
RARITIES = {-1: "未知", 0: "普通", 1: "罕见", 2: "稀有", 3: "极稀有", 4: "史诗"}
MONSTROLOGY = ("亡灵", "饕餮怪", "蝾螈人", "蜘蛛", "巨像", "独眼巨人", "魔像", "龙人", "树人", "小恶魔", "猪", "象", "飞龙", "恐龙", "鸟", "昆虫", "北极熊", "外星生物")
SOCKETS = ("unknown", "tear", "circle", "square", "triangle", "power_pin", "shield_pin", "sword_pin")
SPELL_TYPES = ("未知", "治疗", "伤害", "增益挂饰", "防护挂饰", "光环", "全场结界", "群体攻击", "窃取", "操控", "附魔", "变形", "负面挂饰", "陷阱", "变异", "隐匿", "暗影", "暗影生物", "暗影自身", "负面光环")
SPECIAL_TYPES = {12: ("生长", "除虫", "土壤", "园艺辅助", "保护"), 14: ("捕捉", "钓鱼辅助"), 15: ("咒语", "增益", "符印", "传送", "仪式")}


def flag_labels(value):
    value = int(value or 0)
    if value < 0:
        return ["未知负数标记：" + str(value)]
    labels = [label for bit, label in enumerate(FLAGS) if value & (1 << bit)]
    unknown = value & ~((1 << len(FLAGS)) - 1)
    if unknown:
        labels.append("未识别标记位：" + str(unknown))
    return labels


def requirement(value, weaving=False):
    value = int(value or 0) & 0xFFFFFFFF
    if value == 0:
        return ""
    code = value & 0x7FFFFFFF
    name = SCHOOLS[code] if code < len(SCHOOLS) else "未知学派 " + str(code)
    scope = "魔法编织" if weaving else "学派"
    return f"{scope}：除{name}之外均可" if value & (1 << 31) else f"{scope}：仅{name}"


def sockets(value):
    value = int(value or 0)
    if value < 0 or value.bit_length() > 128:
        raise ValueError("宝石插槽位字段超出可导入范围。")
    result = []
    while value:
        part = value & 15
        result.append({"shape": SOCKETS[part >> 1], "locked": bool(part & 1)})
        value >>= 4
    return result


def portrait_name(value):
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    if not value:
        return ""
    name = PurePosixPath(str(value).split("|")[-1].replace("\\", "/")).name.split(".")[0].replace(" ", "")
    if not name or name in (".", "..") or len(name) > 200 or any(ord(c) < 32 for c in name):
        return ""
    return name + ".png"


def enrich_entry(entry, row):
    """Preserve raw fields while adding the reference bot's display semantics."""
    kind = entry["type"]
    entry["kimerith_revision"] = REVISION
    if row.get("extra_flags") is not None:
        entry["flags"] = flag_labels(row["extra_flags"])
    if row.get("rarity") is not None:
        entry["rarity_label"] = RARITIES.get(row["rarity"], "未知 " + str(row["rarity"]))
    portrait = portrait_name(row.get("image_file") or row.get("image"))
    if portrait:
        entry["portrait"] = portrait
    if kind == "item":
        entry["requirements"] = [x for x in (requirement(row.get("equip_school")), requirement(row.get("equip_secondary"), True)) if x]
        if row.get("equip_level"):
            entry["requirements"].append(f"等级 {row['equip_level']} 及以上")
        if row.get("extra_flags", 0) & 4 and row.get("min_pet_level"):
            index = int(row["min_pet_level"]) - 1
            stage = PET_LEVELS[index] if 0 <= index < len(PET_LEVELS) else str(row["min_pet_level"])
            entry["requirements"].append("宠物成长阶段：" + stage + "及以上")
        if row.get("jewels"):
            entry["sockets"] = sockets(row["jewels"])
        if row.get("deck_school") is not None:
            code = int(row["deck_school"])
            entry["deck_school_label"] = SCHOOLS[code] if 0 <= code < len(SCHOOLS) else str(code)
    elif kind == "spell":
        school = int(row.get("school") or 0)
        form = int(row.get("form") or 0)
        choices = SPECIAL_TYPES.get(school, SPELL_TYPES)
        if school == 12 and form >= len(choices):
            choices = SPELL_TYPES
        entry["spell_kind_label"] = choices[form] if 0 <= form < len(choices) else f"未知类别 {form}"
        if school in SPECIAL_TYPES:
            entry["uses_energy"] = True
        pve, pvp = bool(row.get("pve")), bool(row.get("pvp"))
        entry["availability"] = "不可用于 PvP" if pve and not pvp else "仅用于 PvP" if pvp and not pve else "非战斗用途" if pvp and pve else "未设专用限制"
        entry["rank_label"] = "X" if row.get("x_pips") else str(row.get("rank", "未提供"))
    elif kind == "mob":
        bits = int(row.get("monstro") or 0)
        entry["extracts"] = [name for i, name in enumerate(MONSTROLOGY) if bits & (1 << i)]
        unknown = bits & ~((1 << len(MONSTROLOGY)) - 1)
        if unknown:
            entry["extracts"].append("未知采集种类位：" + str(unknown))
        # The upstream display adds this flag when the stored value is false.
        if row.get("stunnable") is not None:
            entry["stun_beguile_label"] = "可眩晕、可魅惑（按 Kimerith 标记解释）" if not row["stunnable"] else "未显示可眩晕／魅惑标记"
    elif kind == "fish":
        if all(isinstance(row.get(key), (float, int)) for key in ("base_length", "min_size", "max_size")):
            entry["min_length"] = round(row["base_length"] * row["min_size"], 2)
            entry["max_length"] = round(row["base_length"] * row["max_size"], 2)
    return entry


def separate_talents(entry):
    talents = entry.get("talents", [])
    # This is the source bot's layout contract, not a guessed semantic classifier.
    if talents:
        entry["talents"] = sorted(talents[:10], key=lambda t: t.get("priority", 0))
        entry["derby_talents"] = sorted(talents[10:], key=lambda t: t.get("priority", 0))
        entry["talent_layout"] = "按 Kimerith 约定：原始前 10 行为普通天赋，其余为竞速天赋，各自按 priority 排序。"


def load_translator(filename):
    if not filename:
        return lambda value, ref=None: value
    with open(filename, "rb") as stream:
        signature = stream.read(2)
    opener = gzip.open if signature == b"\x1f\x8b" else open
    with opener(filename, "rb") as stream:
        data = stream.read(256 * 1024 * 1024 + 1)
    if len(data) > 256 * 1024 * 1024:
        raise ValueError("中文词典解压后超过 256 MiB。")
    doc = json.loads(data)
    if doc.get("schemaVersion") != 1 or not isinstance(doc.get("entries"), list):
        raise ValueError("--locale 需要现有 Wizard101 中文词典 JSON/JSON.gz。")
    normalize = lambda value: unicodedata.normalize("NFKC", value).casefold().strip()
    translations = {}
    ambiguous = set()
    for entry in doc["entries"]:
        if isinstance(entry, list) and len(entry) == 4:
            en, zh = entry[2], entry[3]
        elif isinstance(entry, dict):
            en, zh = entry.get("en"), entry.get("zh")
        else:
            continue
        if not isinstance(en, str) or not isinstance(zh, str) or not en.strip() or not zh.strip():
            continue
        key = normalize(en)
        if key in translations and translations[key] != zh:
            ambiguous.add(key)
        else:
            translations[key] = zh
    for key in ambiguous:
        translations.pop(key, None)
    return lambda value, ref=None: translations.get(normalize(value), value) if isinstance(value, str) else value


def localize_names(value, translate):
    if isinstance(value, list):
        for child in value:
            localize_names(child, translate)
    elif isinstance(value, dict):
        if isinstance(value.get("name"), str):
            translated = translate(value["name"])
            if translated != value["name"]:
                value["zh"] = translated
        for key, child in list(value.items()):
            if key not in ("name", "zh", "effect_rows", "raw_stats"):
                localize_names(child, translate)
