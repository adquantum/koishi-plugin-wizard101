# SPDX-License-Identifier: GPL-3.0-only
"""Chinese, Discord-free port of Kimerith-WindHammer's spell explanation.

Original algorithm: MajorPain1 and Kimerith-WindHammer contributors,
https://github.com/MajorPain1/Kimerith-WindHammer, commit 3c24847d.
The effect switch, recursive cases, description variables, duplicate condenser,
and chromatic condenser below are adapted from bot/extensions/spells.py;
the enum and icon mappings come from bot/database.py. GPL-3.0.

Added here: synchronous sqlite3 access, Chinese terminology, guarded references,
explicit unknown values, exact template-ID joins, complete target-count variants,
cycle/depth/size guards, and a JSON-compatible export API. No Discord dependency.

Public API:
  renderer = SpellEffectRenderer(connection, translate=None)
  renderer.render_spell_details(spell_or_template_id, num_targets=None)
  render_spell_details(connection, spell_or_template_id, **options)

translate is optional: callable(original_text, locale_reference) -> str | None.
locale_reference is "locale_en:<id>" when available. A one-argument callable,
or a mapping keyed by locale_reference / exact original text, is also accepted.
Only SELECT and read-only PRAGMA table_info statements are issued.
"""

from __future__ import annotations

from collections import defaultdict
from enum import Enum
import inspect
import json
import math
import re
import sqlite3
from types import SimpleNamespace


UPSTREAM_COMMIT = "3c24847d"
MAX_EFFECT_ROWS = 4096
MAX_EFFECT_DEPTH = 64
MAX_VARIANTS = 128
MAX_TEXT_LENGTH = 1024 * 1024
MAX_SAFE_INTEGER = 9007199254740991
EFFECT_FIELDS = (
    "id", "spell_id", "parent_id", "idx", "effect_class", "param", "disposition",
    "target", "type", "heal_modifier", "rounds", "pip_num", "protected", "rank",
    "school", "num_targets", "condition",
)


TERM_ZH = {
    "UNIVERSAL": "通用", "FIRE": "火焰", "ICE": "冰霜", "STORM": "风暴",
    "MYTH": "神圣", "LIFE": "生命", "DEATH": "亡灵", "BALANCE": "平衡",
    "STAR": "星", "SUN": "日", "MOON": "月", "GARDENING": "园艺",
    "SHADOW": "暗影", "FISHING": "钓鱼", "CANTRIPS": "场外魔咒",
    "CASTLEMAGIC": "城堡魔法", "WHIRLYBURLY": "WhirlyBurly",
    "WEAVING_CASTER": "施法者编织学派", "WEAVING_TARGET": "目标编织学派",
    "HEART": "治疗", "HEALTH": "生命值", "MANA": "法力", "ENERGY": "能量",
    "DAMAGE": "伤害", "FLAT_DAMAGE": "固定伤害", "RESIST": "抗性",
    "FLAT_RESIST": "固定减伤", "ACCURACY": "命中", "CRIT": "暴击",
    "BLOCK": "暴击格挡", "PIERCE": "穿透", "INCOMING": "受到",
    "OUTGOING": "造成", "STUN_BLOCK": "免晕盾", "PIP_CONVERSION": "魔豆返还",
    "ARCHMASTERY": "学派精通", "SPEED": "移动速度", "PIP": "魔豆",
    "POWER_PIP": "超级魔豆", "SHADOW_PIP": "暗影魔豆", "SHADOW_PIP_STAT": "暗影魔豆",
    "FIRE_PIP": "火焰魔豆", "ICE_PIP": "冰霜魔豆", "STORM_PIP": "风暴魔豆",
    "MYTH_PIP": "神圣魔豆", "LIFE_PIP": "生命魔豆", "DEATH_PIP": "亡灵魔豆",
    "BALANCE_PIP": "平衡魔豆", "NONE": "无", "CHARM": "正面咒符",
    "WARD": "正面护符", "AURA": "正面光环", "GLOBAL": "全场结界",
    "AOE": "群体效果", "STEAL": "吸血", "MANIPULATION": "操控",
    "ENCHANTMENT": "附魔卡", "AURA_NEGATIVE": "负面光环", "BLADE": "刃",
    "CURSE": "负面咒符", "DOT": "持续伤害", "BOMB": "延迟伤害",
    "HOT": "持续治疗", "JINX": "负面护符", "MUTATE": "变异",
    "PABSORB": "受保护吸收盾", "PBLADE": "受保护刃", "PCHARM": "受保护正面咒符",
    "PCURSE": "受保护负面咒符", "PDOT": "受保护持续伤害", "PBOMB": "受保护延迟伤害",
    "PHOT": "受保护持续治疗", "PJINX": "受保护负面护符", "POLYMORPH": "变身",
    "PTRAP": "受保护陷阱", "PWARD": "受保护正面护符", "RANDOM": "随机",
    "TRAP": "陷阱", "THREAT": "仇恨", "STUN": "眩晕", "DISPEL": "禁咒",
    "MINION": "随从", "ROUNDS": "回合", "SPIRIT": "精神系", "ELEMENTAL": "元素系",
    "ALL_ENEMIES": "单个敌人", "ALL_FRIENDS": "单个队友",
    "ALL_ENEMIES_SQUARE": "全体敌人", "ALL_FRIENDS_SQUARE": "全体队友",
    "ALL_ENEMIES_SELECT": "选定多个敌人", "ALL_FRIENDS_SELECT": "选定多个队友",
    "AFTERLIFE": "来世效果", "ABSORB": "吸收盾", "DAMAGE_OR_DRAIN": "伤害或吸血",
    "SELF": "自身", "CLOAK": "隐藏效果", "CHROMATIC_CASTER": "随施法者学派变化",
    "CHROMATIC_TARGET": "随目标学派变化", "SHIELD": "盾", "WEAKNESS": "虚弱",
    "NEGATIVE_AFTERLIFE": "负面来世效果", "PACIFY": "安抚", "SHADOW_SELF": "暗影契约",
    "SHADOW_CREATURE": "暗影生物", "SHADOW_MINION": "暗影随从",
    "GROWING": "种植", "PEST": "除虫", "SOIL": "土壤", "G_UTILITY": "园艺辅助",
    "PROTECTION": "保护", "CATCHING": "捕捉", "FS_UTILITY": "钓鱼辅助",
    "INCANTATION": "咒文", "BENEFICIAL": "增益", "SIGIL": "法阵",
    "TELEPORTATION": "传送", "RITUAL": "仪式",
}
emojis = SimpleNamespace(**{name: f"【{text}】" for name, text in TERM_ZH.items()})
SCHOOL_NAMES = (
    "UNIVERSAL", "UNIVERSAL", "FIRE", "ICE", "STORM", "MYTH", "LIFE", "DEATH",
    "BALANCE", "STAR", "SUN", "MOON", "GARDENING", "SHADOW", "FISHING", "CANTRIPS",
    "CASTLEMAGIC", "WHIRLYBURLY",
)


def school_text(value):
    if isinstance(value, int) and 0 <= value < len(SCHOOL_NAMES):
        return getattr(emojis, SCHOOL_NAMES[value])
    return f"【未知学派 {value}】"


class _PrismSchools(dict):
    def __missing__(self, key):
        return f"【未知转换学派 {key}】"


PRISM_SCHOOLS = _PrismSchools({
    72777: emojis.ICE, 78483: emojis.SUN, 2330892: emojis.LIFE, 2343174: emojis.FIRE,
    2625203: emojis.STAR, 2448141: emojis.MYTH, 2504141: emojis.MOON,
    78318724: emojis.DEATH, 83375795: emojis.STORM, 1027491821: emojis.BALANCE,
    1429009101: emojis.SHADOW,
})


def _text(value):
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return str(value)


def _json_value(value):
    if isinstance(value, int) and abs(value) > MAX_SAFE_INTEGER:
        return str(value)
    if isinstance(value, float) and not math.isfinite(value):
        return repr(value)
    if isinstance(value, bytes):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return {"encoding": "hex", "data": value.hex()}
    return value


def _integer(value, label):
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, str) and re.fullmatch(r"-?\d+", value):
        return int(value)
    raise ValueError(f"{label} 必须为整数，收到 {value!r}")


# The following enums, icon map and _UpstreamSpellAlgorithms methods preserve
# the upstream 3c24847d switch branches. Async I/O is adapted to synchronous I/O.


class SpellEffects(Enum):
    invalid_spell_effect = 0
    damage = 1
    damage_no_crit = 2
    heal = 3
    heal_percent = 4
    steal_health = 5
    reduce_over_time = 6
    detonate_over_time = 7
    push_charm = 8
    steal_charm = 9
    push_ward = 10
    steal_ward = 11
    push_over_time = 12
    steal_over_time = 13
    remove_charm = 14
    remove_ward = 15
    remove_over_time = 16
    remove_aura = 17
    swap_all = 18
    swap_charm = 19
    swap_ward = 20
    swap_over_time = 21
    minion_rank_damage = 22
    modify_incoming_damage = 23
    maximum_incoming_damage = 24
    modify_incoming_heal = 25
    modify_incoming_damage_type = 26
    modify_incoming_armor_piercing = 27
    modify_outgoing_damage = 28
    modify_outgoing_heal = 29
    modify_outgoing_damage_type = 30
    modify_outgoing_armor_piercing = 31
    modify_outgoing_steal_health = 32
    modify_incoming_steal_health = 33
    bounce_next = 34
    bounce_previous = 35
    bounce_back = 36
    bounce_all = 37
    absorb_damage = 38
    absorb_heal = 39
    modify_accuracy = 40
    dispel = 41
    confusion = 42
    cloaked_charm = 43
    cloaked_ward = 44
    stun_resist = 45
    pip_conversion = 46
    crit_boost = 47
    crit_block = 48
    polymorph = 49
    delay_cast = 50
    modify_card_cloak = 51
    modify_card_damage = 52
    modify_card_heal = 53
    modify_card_accuracy = 54
    modify_card_mutation = 55
    modify_card_rank = 56
    modify_card_armor_piercing = 57
    modify_card_charm = 58
    modify_card_ward = 59
    modify_card_outgoing_damage = 60
    modify_card_outgoing_accuracy = 61
    modify_card_outgoing_heal = 62
    modify_card_outgoing_armor_piercing = 63
    modify_card_incoming_damage = 64
    modify_card_absorb_damage = 65
    summon_creature = 66
    teleport_player = 67
    stun = 68
    dampen = 69
    reshuffle = 70
    mind_control = 71
    modify_pips = 72
    modify_power_pips = 73
    modify_shadow_pips = 74
    modify_hate = 75
    damage_over_time = 76
    heal_over_time = 77
    modify_power_pip_chance = 78
    modify_rank = 79
    stun_block = 80
    reveal_cloak = 81
    instant_kill = 82
    after_life = 83
    deferred_damage = 84
    damage_per_total_pip_power = 85
    cloaked_ward_no_remove = 87
    add_combat_trigger_list = 88
    remove_combat_trigger_list = 89
    backlash_damage = 90
    modify_backlash = 91
    intercept = 92
    shadow_self = 93
    shadow_creature = 94
    modify_shadow_creature_level = 95
    select_shadow_creature_attack_target = 96
    shadow_decrement_turn = 97
    crit_boost_school_specific = 98
    spawn_creature = 99
    un_polymorph = 100
    power_pip_conversion = 101
    protect_card_beneficial = 102
    protect_card_harmful = 103
    protect_beneficial = 104
    protect_harmful = 105
    divide_damage = 106
    collect_essence = 107
    kill_creature = 108
    dispel_block = 109
    confusion_block = 110
    modify_pip_round_rate = 111
    clue = 112
    max_health_damage = 113
    set_heal_percent = 114
    untargetable = 115
    make_targetable = 116
    force_targetable = 117
    remove_stun_block = 118
    modify_incoming_heal_flat = 119
    modify_incoming_damage_flat = 120
    modify_outgoing_heal_flat = 121
    modify_outgoing_damage_flat = 122
    exit_combat = 123
    suspend_pips = 124
    resume_pips = 125
    auto_pass = 126
    stop_auto_pass = 127
    vanish = 128
    stop_vanish = 129
    max_health_heal = 130
    heal_by_ward = 131
    taunt = 132
    pacify = 133
    remove_target_restriction = 134
    convert_hanging_effect = 135
    add_spell_to_deck = 136
    add_spell_to_hand = 137
    modify_incoming_damage_over_time = 138
    modify_incoming_heal_over_time = 139
    modify_card_damage_by_rank = 140
    push_converted_charm = 141
    steal_converted_charm = 142
    push_converted_ward = 143
    steal_converted_ward = 144
    push_converted_over_time = 145
    steal_converted_over_time = 146
    remove_converted_charm = 147
    remove_converted_ward = 148
    remove_converted_over_time = 149
    modify_over_time_duration = 150
    modify_school_pips = 151
    shadow_pact = 152


class EffectTarget(Enum):
    invalid_target = 0
    spell = 1
    specific_spells = 2
    target_global = 3
    enemy_team = 4
    enemy_team_all_at_once = 5
    friendly_team = 6
    friendly_team_all_at_once = 7
    enemy_single = 8
    friendly_single = 9
    minion = 10
    friendly_minion = 17
    enemy_minion = 18
    caster_minion = 19
    target_minion = 20
    self = 11
    at_least_one_enemy = 13
    preselected_enemy_single = 12
    multi_target_enemy = 14
    multi_target_friendly = 15
    friendly_single_not_me = 16


ICON_TERMS = {'Damage_image': 'DAMAGE', 'Heal_image': 'HEART', 'Accuracy_image': 'ACCURACY', 'Afterlife_image': 'AFTERLIFE', 'All_Enemies_Square_image': 'ALL_ENEMIES_SQUARE', 'All_Friends_Square_image': 'ALL_FRIENDS_SQUARE', 'Armor_Penetration_image': 'PIERCE', 'BlockRating_image': 'BLOCK', 'CriticalRating_image': 'CRIT', 'Damage_or_drain_image': 'DAMAGE_OR_DRAIN', 'Elemental_image': 'ELEMENTAL', 'MoonSchoolIcon': 'MOON', 'FireSchoolIcon': 'FIRE', 'IceSchoolIcon': 'ICE', 'StormSchoolIcon': 'STORM', 'BalanceSchoolIcon': 'BALANCE', 'LifeSchoolIcon': 'LIFE', 'DeathSchoolIcon': 'DEATH', 'MythSchoolIcon': 'MYTH', 'ShadowSchoolIcon': 'SHADOW', 'ElementalSchoolIcon': 'ELEMENTAL', 'SpiritSchoolIcon': 'SPIRIT', 'Incoming_image': 'INCOMING', 'Outgoing_image': 'OUTGOING', 'Self_image': 'SELF', 'ShadowPips_image': 'SHADOW_PIP_STAT', 'ShadowPips02_image': 'SHADOW_PIP_STAT', 'All_Enemies_image': 'ALL_ENEMIES', 'All_Enemies_Wide_image': 'ALL_ENEMIES_SQUARE', 'All_Friends_image': 'ALL_FRIENDS', 'All_Friends_Wide_image': 'ALL_FRIENDS_SQUARE', 'Dispel_image': 'DISPEL', 'Minion_image': 'MINION', 'Rounds_image': 'ROUNDS', 'Stun_image': 'STUN', 'Threat_image': 'THREAT', 'Absorb_image': 'ABSORB', 'Aura_Pos_image': 'AURA', 'Aura_Neg_image': 'AURA_NEGATIVE', 'Blade_image': 'BLADE', 'Curse_image': 'CURSE', 'Damage_Flat_image': 'FLAT_DAMAGE', 'OT_Damage_image': 'DOT', 'DeferredDamage_image': 'BOMB', 'pDeferredDamage_image': 'PBOMB', 'Global_image': 'GLOBAL', 'OT_Heal_image': 'HOT', 'Jinx_image': 'JINX', 'pAbsorb_image': 'PABSORB', 'pBlade_image': 'PBLADE', 'pCharm_image': 'PCHARM', 'pCurse_image': 'PCURSE', 'pOT_Damage_image': 'PDOT', 'pOT_Heal_image': 'PHOT', 'Pips_image': 'PIP', 'pJinx_image': 'PJINX', 'Polymorph_image': 'POLYMORPH', 'PowerPips_image': 'POWER_PIP', 'pTrap_image': 'PTRAP', 'pWard_image': 'PWARD', 'Random_image': 'RANDOM', 'Resist_image': 'RESIST', 'Resist_Flat_image': 'FLAT_RESIST', 'Steal_image': 'STEAL', 'StunResist_image': 'STUN_BLOCK', 'Trap_image': 'TRAP', 'Ward_image': 'WARD', 'Charm_image': 'CHARM', 'Block_image': 'BLOCK', 'All_Enemies_Wide': 'ALL_ENEMIES_SQUARE', 'All_Friends_Wide': 'ALL_FRIENDS_SQUARE', 'All_Enemies_Select': 'ALL_ENEMIES_SELECT', 'All_Friends_Select': 'ALL_FRIENDS_SELECT', 'Chromatic_Caster_image': 'CHROMATIC_CASTER', 'Chromatic_Target_image': 'CHROMATIC_TARGET', 'Shield_image': 'SHIELD', 'Weakness_image': 'WEAKNESS', 'ShadowPact': 'SHADOW_SELF', 'FirePips_image': 'FIRE_PIP', 'IcePips_image': 'ICE_PIP', 'StormPips_image': 'STORM_PIP', 'MythPips_image': 'MYTH_PIP', 'LifePips_image': 'LIFE_PIP', 'DeathPips_image': 'DEATH_PIP', 'BalancePips_image': 'BALANCE_PIP', 'WeavingChromatic_Target_image': 'WEAVING_TARGET', 'WeavingChromatic_Caster_image': 'WEAVING_CASTER', 'Pacify_image': 'PACIFY', 'Afterlife_Neg_image': 'NEGATIVE_AFTERLIFE'}


def icon_text(name):
    token = ICON_TERMS.get(name)
    return getattr(emojis, token) if token else name


database = SimpleNamespace(SpellEffects=SpellEffects, EffectTarget=EffectTarget, translate_school=school_text, school_prism_values=PRISM_SCHOOLS, translate_type_emoji=icon_text)


class _UpstreamSpellAlgorithms:

    def _upstream_replace_condition_with_emojis(self, string, use_blade_trap=False):
        target_full_pattern = '(?i)\\bnot Target School (Death|Fire|Ice|Life|Myth|Storm)\\b(?: and not Target School (?!\\1)(Death|Fire|Ice|Life|Myth|Storm))(?: and not Target School (?!\\1|\\2)(Death|Fire|Ice|Life|Myth|Storm))(?: and not Target School (?!\\1|\\2|\\3)(Death|Fire|Ice|Life|Myth|Storm))(?: and not Target School (?!\\1|\\2|\\3|\\4)(Death|Fire|Ice|Life|Myth|Storm))(?: and not Target School (?!\\1|\\2|\\3|\\4|\\5)(Death|Fire|Ice|Life|Myth|Storm))'
        string = re.sub(target_full_pattern, f'{emojis.BALANCE}', string)
        caster_full_pattern = '(?i)\\bnot Caster School (Death|Fire|Ice|Life|Myth|Storm)\\b(?: and not Caster School (?!\\1)(Death|Fire|Ice|Life|Myth|Storm))(?: and not Caster School (?!\\1|\\2)(Death|Fire|Ice|Life|Myth|Storm))(?: and not Caster School (?!\\1|\\2|\\3)(Death|Fire|Ice|Life|Myth|Storm))(?: and not Caster School (?!\\1|\\2|\\3|\\4)(Death|Fire|Ice|Life|Myth|Storm))(?: and not Caster School (?!\\1|\\2|\\3|\\4|\\5)(Death|Fire|Ice|Life|Myth|Storm))'
        string = re.sub(caster_full_pattern, f'{emojis.SELF}{emojis.BALANCE}', string)
        string = string.replace(' Caster Secondary', f' {emojis.WEAVING_CASTER}')
        string = string.replace(' Target Secondary', f' {emojis.WEAVING_TARGET}')
        string = string.replace(' School Fire', f' {emojis.FIRE}').replace(' School Storm', f' {emojis.STORM}').replace(' School Ice', f' {emojis.ICE}').replace(' School Myth', f' {emojis.MYTH}').replace(' School Life', f' {emojis.LIFE}').replace(' School Death', f' {emojis.DEATH}').replace(' School Balance', f' {emojis.BALANCE}')
        string = string.replace(' School', '')
        string = string.replace(' Shield', f' {emojis.WARD}').replace(' Weakness', f' {emojis.CURSE}').replace(' DOT', f' {emojis.DOT}').replace(' HOT', f' {emojis.HOT}').replace(' Negative Aura', f' {emojis.AURA_NEGATIVE}').replace(' Aura', f' {emojis.AURA}')
        if not use_blade_trap:
            string = string.replace(' Blade', f' {emojis.CHARM}').replace(' Trap', f' {emojis.JINX}')
        else:
            string = string.replace(' Blade', f' {emojis.BLADE}').replace(' Trap', f' {emojis.TRAP}')
        string = string.replace(' DamageOverTime', f' {emojis.DOT}').replace(' HealOverTime', f' {emojis.HOT}')
        string = string.replace(' Charm', f' {emojis.CHARM}/{emojis.CURSE}').replace(' Ward', f' {emojis.WARD}/{emojis.JINX}').replace(' OT', f' {emojis.DOT}/{emojis.HOT}')
        return string.replace(' on', '').replace(' has', '')

    def _upstream_replace_consecutive_duplicates(self, input_string):
        lines = input_string.splitlines()
        result = []
        i = 0
        while i < len(lines):
            current_line = lines[i]
            count = 1
            while i + 1 < len(lines) and lines[i + 1] == current_line:
                count += 1
                i += 1
            if count > 1 and current_line.strip() != '':
                result.append(f'{current_line} x{count}')
            else:
                result.append(current_line)
            i += 1
        return '\n'.join(result)

    def _upstream_remove_index_from_string(self, text, index):
        return text[:index] + '@' + text[index + 1:]

    def _upstream_condense_conditionals(self, text):

        def normalize(section):
            return section.replace(f'{emojis.DEATH}', '@').replace(f'{emojis.FIRE}', '@').replace(f'{emojis.ICE}', '@').replace(f'{emojis.LIFE}', '@').replace(f'{emojis.MYTH}', '@').replace(f'{emojis.STORM}', '@').lstrip('\n')
        sections = text.split('\n\n')
        conditionals = {}
        for section in sections:
            section: str
            raw_string = normalize(section)
            if raw_string in conditionals:
                conditionals[raw_string] = conditionals[raw_string] + 1
            else:
                conditionals[raw_string] = 1
        indices_to_remove = []
        keys_seen = set()
        for i, section in enumerate(sections):
            raw_string = normalize(section)
            if conditionals[raw_string] >= 6:
                if raw_string in keys_seen:
                    indices_to_remove.append(i)
                else:
                    keys_seen.add(raw_string)
                    sections[i] = raw_string
        result = [value for idx, value in enumerate(sections) if idx not in indices_to_remove]
        reconstruct = []
        for section in result:
            if 'Target @' in section:
                section = section.replace('Target @', f'{emojis.ELEMENTAL}/{emojis.SPIRIT}').replace('@', f'{emojis.CHROMATIC_TARGET}')
            if 'Caster @' in section:
                section = section.replace(f'{emojis.SELF} @', f'{emojis.SELF} {emojis.ELEMENTAL}/{emojis.SPIRIT}').replace('@', f'{emojis.CHROMATIC_CASTER}')
            reconstruct.append(section.replace(' Caster', '').replace(' Target', '').replace('@', f'{emojis.CHROMATIC_TARGET}'))
        return '\n\n'.join(reconstruct)

    def _upstream_get_string_from_effect(self, effect, parent_is_x_pip=False, parent_is_convert=False):
        effect_id = effect[0]
        spell_id = effect[1]
        effect_class = effect[4]
        param = effect[5]
        disposition = effect[6]
        target = database.EffectTarget(effect[7])
        effect_type = database.SpellEffects(effect[8])
        heal_modifier = effect[9]
        rounds = effect[10]
        pip_num = effect[11]
        protected = bool(effect[12])
        rank = effect[13]
        school = database.translate_school(effect[14])
        condition = effect[16]
        new_line: str = ''
        if parent_is_x_pip:
            new_line += f'{rank} {emojis.PIP}: '
        elif parent_is_convert and rank != 0:
            new_line += f'{rank}: '
        match effect_type:
            case database.SpellEffects.absorb_damage:
                if protected:
                    new_line += f'{param} {school}{emojis.PABSORB}'
                else:
                    new_line += f'{param} {school}{emojis.ABSORB}'
            case database.SpellEffects.absorb_heal:
                if protected:
                    new_line += f'{param} {emojis.HEART}{emojis.PABSORB}'
                else:
                    new_line += f'{param} {emojis.HEART}{emojis.ABSORB}'
            case database.SpellEffects.add_combat_trigger_list:
                new_line += f'Add to Combat Trigger List'
            case database.SpellEffects.add_spell_to_deck:
                object_name = self.fetch_object_name_from_id(param)[0][3].decode('utf-8').replace('_', '\\_')
                new_line += f'Add {object_name} To Deck'
            case database.SpellEffects.add_spell_to_hand:
                object_name = self.fetch_object_name_from_id(param)[0][3].decode('utf-8').replace('_', '\\_')
                new_line += f'Add {object_name} To Hand'
            case database.SpellEffects.after_life:
                new_line += f'{param} {school}{emojis.HEART} {emojis.AFTERLIFE}'
            case database.SpellEffects.auto_pass:
                new_line += f'Auto Pass'
            case database.SpellEffects.backlash_damage:
                new_line += f'{school} Backlash'
            case database.SpellEffects.cloaked_charm:
                if protected:
                    new_line += f'{param}% {emojis.CLOAK}{school}{emojis.PCHARM}'
                else:
                    new_line += f'{param}% {emojis.CLOAK}{school}{emojis.CHARM}'
            case database.SpellEffects.cloaked_ward:
                if protected:
                    new_line += f'{param}% {emojis.CLOAK}{school}{emojis.PWARD}'
                else:
                    new_line += f'{param}% {emojis.CLOAK}{school}{emojis.WARD}'
            case database.SpellEffects.cloaked_ward_no_remove:
                if protected:
                    new_line += f'{param}% {emojis.CLOAK}{school}{emojis.PWARD} No Remove'
                else:
                    new_line += f'{param}% {emojis.CLOAK}{school}{emojis.WARD} No Remove'
            case database.SpellEffects.clue:
                new_line += f'Spy {param}{emojis.ROUNDS}'
            case database.SpellEffects.collect_essence:
                new_line += f'Extract'
            case database.SpellEffects.confusion:
                new_line += f'{param}% Confuse'
            case database.SpellEffects.crit_block:
                new_line += f'{param}% {school}{emojis.BLOCK}'
            case database.SpellEffects.crit_boost | database.SpellEffects.crit_boost_school_specific:
                new_line += f'{param}% {school}{emojis.CRIT}'
            case database.SpellEffects.damage:
                new_line += f'{param} {school}{emojis.DAMAGE}'
            case database.SpellEffects.damage_no_crit:
                new_line += f'{param} {school}{emojis.DAMAGE} No Crit'
            case database.SpellEffects.damage_over_time:
                if protected:
                    new_line += f'{param} {school}{emojis.PDOT}'
                else:
                    new_line += f'{param} {school}{emojis.DOT}'
            case database.SpellEffects.damage_per_total_pip_power:
                new_line += f'{rounds} {school}{emojis.DAMAGE} per {emojis.ALL_ENEMIES}{emojis.PIP}'
            case database.SpellEffects.dampen:
                new_line += f'Max {param} {emojis.PIP}'
            case database.SpellEffects.deferred_damage:
                if protected:
                    new_line += f'{param} {school}{emojis.PBOMB}'
                else:
                    new_line += f'{param} {school}{emojis.BOMB}'
            case database.SpellEffects.detonate_over_time:
                match disposition:
                    case 0:
                        new_line += f'Detonate {int(heal_modifier * 100)}% {param} {emojis.DOT}/{emojis.HOT}'
                    case 1:
                        new_line += f'Activate {int(heal_modifier * 100)}% {param} {emojis.HOT}'
                    case 2:
                        new_line += f'Detonate {int(heal_modifier * 100)}% {param} {emojis.DOT}'
            case database.SpellEffects.dispel:
                new_line += f'{emojis.DISPEL}{school}'
            case database.SpellEffects.dispel_block:
                new_line += f'{emojis.DISPEL} Block'
            case database.SpellEffects.divide_damage:
                new_line += f'Divide {param} {school}{emojis.DAMAGE}'
            case database.SpellEffects.exit_combat:
                new_line += f'Exit Combat'
            case database.SpellEffects.force_targetable:
                new_line += f'Force Targetable'
            case database.SpellEffects.heal | database.SpellEffects.heal_by_ward:
                new_line += f'{param} {school}{emojis.HEART}'
            case database.SpellEffects.heal_over_time:
                new_line += f'{param} {school}{emojis.HOT}'
            case database.SpellEffects.heal_percent | database.SpellEffects.max_health_heal:
                new_line += f'{param}% {school}{emojis.HEART}'
            case database.SpellEffects.instant_kill:
                new_line += f'{param} {school} Instant Kill'
            case database.SpellEffects.invalid_spell_effect:
                new_line += f'Invalid Spell Effect'
            case database.SpellEffects.kill_creature:
                mob_name = self.fetch_mob_object_name_from_id(param)[0][2].decode('utf-8')
                new_line += f'Kill {mob_name}'
            case database.SpellEffects.make_targetable:
                new_line += f'Make Targetable'
            case database.SpellEffects.max_health_damage:
                new_line += f'{param}% Max HP {school}{emojis.DAMAGE}'
            case database.SpellEffects.maximum_incoming_damage:
                new_line += f'{param} Equalize'
            case database.SpellEffects.mind_control:
                new_line += f'Beguile {param}{emojis.ROUNDS}'
            case database.SpellEffects.modify_accuracy | database.SpellEffects.modify_card_accuracy | database.SpellEffects.modify_card_outgoing_accuracy:
                new_line += f'{param}% {school}{emojis.ACCURACY}'
            case database.SpellEffects.modify_card_armor_piercing | database.SpellEffects.modify_card_outgoing_armor_piercing:
                new_line += f'+{param}% {school}{emojis.PIERCE}'
            case database.SpellEffects.modify_card_cloak:
                new_line += f'{emojis.CLOAK}'
            case database.SpellEffects.modify_card_damage:
                new_line += f'+{param} {emojis.DAMAGE}'
            case database.SpellEffects.modify_card_damage_by_rank:
                new_line += f'+{param} per {emojis.PIP} (MAX: {rounds})'
            case database.SpellEffects.modify_card_heal:
                new_line += f'+{param} {emojis.HEART}'
            case database.SpellEffects.modify_card_incoming_damage:
                match disposition:
                    case 0 | 1:
                        new_line += f'{param}% {emojis.WARD}'
                    case 2:
                        new_line += f'+{param}% {emojis.TRAP}'
            case database.SpellEffects.modify_card_mutation:
                object_name = self.fetch_object_name_from_id(param)[0][3].decode('utf-8')
                new_line += f'Mutate to {object_name}'
            case database.SpellEffects.modify_card_rank:
                new_line += f'Modify Rank by {param} {emojis.PIP}'
            case database.SpellEffects.modify_hate:
                if param > 0:
                    new_line += f'+{param} Hate'
                elif param < 0:
                    new_line += f'{param} Hate'
                else:
                    new_line += f'Devour'
            case database.SpellEffects.modify_incoming_armor_piercing:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.PIERCE}{emojis.TRAP}'
                    else:
                        new_line += f'{param}% {school}{emojis.PIERCE}{emojis.WARD}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.PIERCE}{emojis.AURA_NEGATIVE}'
                    else:
                        new_line += f'{param}% {school}{emojis.PIERCE}{emojis.AURA}'
                elif param >= 0:
                    new_line += f'+{param}% {school}{emojis.PIERCE}'
                else:
                    new_line += f'{param}% {school}{emojis.PIERCE}'
            case database.SpellEffects.modify_incoming_damage:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.TRAP}'
                    else:
                        new_line += f'{param}% {school}{emojis.SHIELD}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.AURA_NEGATIVE}'
                    else:
                        new_line += f'{param}% {school}{emojis.AURA}'
                elif param >= 0:
                    new_line += f'+{param}% {school}{emojis.DAMAGE}'
                else:
                    new_line += f'{param}% {school}{emojis.DAMAGE}'
            case database.SpellEffects.modify_incoming_damage_flat:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param} {school}{emojis.TRAP}'
                    else:
                        new_line += f'{param} {school}{emojis.SHIELD}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param} {school}{emojis.AURA_NEGATIVE}'
                    else:
                        new_line += f'{param} {school}{emojis.AURA}'
                elif param >= 0:
                    new_line += f'+{param} {school}{emojis.FLAT_DAMAGE}'
                else:
                    new_line += f'{param} {school}{emojis.FLAT_DAMAGE}'
            case database.SpellEffects.modify_incoming_damage_over_time:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.DOT}{emojis.JINX}'
                    else:
                        new_line += f'{param}% {school}{emojis.DOT}{emojis.WARD}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.DOT}{emojis.AURA_NEGATIVE}'
                    else:
                        new_line += f'{param}% {school}{emojis.DOT}{emojis.AURA}'
                elif param >= 0:
                    new_line += f'+{param}% {school}{emojis.DOT}{emojis.DAMAGE}'
                else:
                    new_line += f'{param}% {school}{emojis.DOT}{emojis.DAMAGE}'
            case database.SpellEffects.modify_incoming_damage_type:
                new_line += f'Convert {school} to {database.school_prism_values[param]} {emojis.JINX}'
            case database.SpellEffects.modify_incoming_heal:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.HEART}{emojis.JINX}'
                    else:
                        new_line += f'{param}% {school}{emojis.HEART}{emojis.JINX}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.HEART}{emojis.AURA}'
                    else:
                        new_line += f'{param}% {school}{emojis.HEART}{emojis.AURA_NEGATIVE}'
                elif param >= 0:
                    new_line += f'+{param}% {school}{emojis.HEART}'
                else:
                    new_line += f'{param}% {school}{emojis.HEART}'
            case database.SpellEffects.modify_incoming_heal_flat:
                if rounds == 0:
                    if param >= 0:
                        new_line += f'+{param} {school}{emojis.HEART}'
                    else:
                        new_line += f'{param} {school}{emojis.HEART}'
                elif param >= 0:
                    new_line += f'+{param} {school}{emojis.HEART}{emojis.AURA}'
                else:
                    new_line += f'{param} {school}{emojis.HEART}{emojis.AURA_NEGATIVE}'
            case database.SpellEffects.modify_incoming_heal_over_time:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.HOT}{emojis.JINX}'
                    else:
                        new_line += f'{param}% {school}{emojis.HOT}{emojis.JINX}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.HOT}{emojis.AURA}'
                    else:
                        new_line += f'{param}% {school}{emojis.HOT}{emojis.AURA_NEGATIVE}'
                elif param >= 0:
                    new_line += f'+{param}% {school}{emojis.HOT}'
                else:
                    new_line += f'{param}% {school}{emojis.HOT}'
            case database.SpellEffects.modify_outgoing_armor_piercing:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.PIERCE}{emojis.CHARM}'
                    else:
                        new_line += f'{param}% {school}{emojis.PIERCE}{emojis.CURSE}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.PIERCE}{emojis.AURA}'
                    else:
                        new_line += f'{param}% {school}{emojis.PIERCE}{emojis.AURA_NEGATIVE}'
                elif param >= 0:
                    new_line += f'+{param}% {school}{emojis.PIERCE}'
                else:
                    new_line += f'{param}% {school}{emojis.PIERCE}'
            case database.SpellEffects.modify_outgoing_damage:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.BLADE}'
                    else:
                        new_line += f'{param}% {school}{emojis.WEAKNESS}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.DAMAGE}{emojis.AURA}'
                    else:
                        new_line += f'{param}% {school}{emojis.DAMAGE}{emojis.AURA_NEGATIVE}'
                elif param >= 0:
                    new_line += f'+{param}% {school}{emojis.DAMAGE}'
                else:
                    new_line += f'{param}% {school}{emojis.DAMAGE}'
            case database.SpellEffects.modify_outgoing_steal_health:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.STEAL}{emojis.BLADE}'
                    else:
                        new_line += f'{param}% {school}{emojis.STEAL}{emojis.WEAKNESS}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.STEAL}{emojis.AURA}'
                    else:
                        new_line += f'{param}% {school}{emojis.STEAL}{emojis.AURA_NEGATIVE}'
                elif param >= 0:
                    new_line += f'+{param}% {school}{emojis.STEAL}'
                else:
                    new_line += f'{param}% {school}{emojis.STEAL}'
            case database.SpellEffects.modify_outgoing_damage_flat:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param} {school}{emojis.BLADE}'
                    else:
                        new_line += f'{param} {school}{emojis.WEAKNESS}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param} {school}{emojis.DAMAGE}{emojis.AURA}'
                    else:
                        new_line += f'{param} {school}{emojis.DAMAGE}{emojis.AURA_NEGATIVE}'
                elif param >= 0:
                    new_line += f'+{param} {school}{emojis.FLAT_DAMAGE}'
                else:
                    new_line += f'{param} {school}{emojis.FLAT_DAMAGE}'
            case database.SpellEffects.modify_outgoing_damage_type:
                new_line += f'Convert {school} to {database.school_prism_values[param]} {emojis.CHARM}'
            case database.SpellEffects.modify_outgoing_heal:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.HEART}{emojis.CHARM}'
                    else:
                        new_line += f'{param}% {school}{emojis.HEART}{emojis.CURSE}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param}% {school}{emojis.HEART}{emojis.AURA}'
                    else:
                        new_line += f'{param}% {school}{emojis.HEART}{emojis.AURA_NEGATIVE}'
                elif param >= 0:
                    new_line += f'+{param}% {school}{emojis.HEART}'
                else:
                    new_line += f'{param}% {school}{emojis.HEART}'
            case database.SpellEffects.modify_outgoing_heal_flat:
                if rounds == 0 and target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param} {school}{emojis.HEART}{emojis.CHARM}'
                    else:
                        new_line += f'{param} {school}{emojis.HEART}{emojis.CURSE}'
                elif target != database.EffectTarget.target_global:
                    if param >= 0:
                        new_line += f'+{param} {school}{emojis.HEART}{emojis.AURA}'
                    else:
                        new_line += f'{param} {school}{emojis.HEART}{emojis.AURA_NEGATIVE}'
                elif param >= 0:
                    new_line += f'+{param} {school}{emojis.HEART}'
                else:
                    new_line += f'{param} {school}{emojis.HEART}'
            case database.SpellEffects.modify_over_time_duration:
                match disposition:
                    case 0 | 1:
                        new_line += f'Add {emojis.HOT}'
                    case 2:
                        new_line += f'Add {emojis.DOT}'
            case database.SpellEffects.modify_pip_round_rate:
                if param >= 0:
                    new_line += f'+{param} {emojis.PIP} Gain Per Round'
                else:
                    new_line += f'{param} {emojis.PIP} Gain Per Round'
            case database.SpellEffects.modify_pips:
                if param >= 0:
                    new_line += f'+{param} {emojis.PIP}'
                else:
                    new_line += f'{param} {emojis.PIP}'
            case database.SpellEffects.modify_power_pip_chance:
                if param >= 0:
                    new_line += f'+{param}% {emojis.POWER_PIP} Chance'
                else:
                    new_line += f'{param}% {emojis.POWER_PIP} Chance'
            case database.SpellEffects.modify_power_pips:
                if param >= 0:
                    new_line += f'+{param} {emojis.POWER_PIP}'
                else:
                    new_line += f'{param} {emojis.POWER_PIP}'
            case database.SpellEffects.modify_rank:
                if param >= 0:
                    new_line += f'+{param} {school} Rank'
                else:
                    new_line += f'{param} {school} Rank'
            case database.SpellEffects.modify_school_pips:
                school_pip_emoji = None
                match school:
                    case emojis.FIRE:
                        school_pip_emoji = emojis.FIRE_PIP
                    case emojis.ICE:
                        school_pip_emoji = emojis.ICE_PIP
                    case emojis.STORM:
                        school_pip_emoji = emojis.STORM_PIP
                    case emojis.MYTH:
                        school_pip_emoji = emojis.MYTH_PIP
                    case emojis.LIFE:
                        school_pip_emoji = emojis.LIFE_PIP
                    case emojis.DEATH:
                        school_pip_emoji = emojis.DEATH_PIP
                    case emojis.BALANCE:
                        school_pip_emoji = emojis.BALANCE_PIP
                if param >= 0:
                    new_line += f'+{param} {school_pip_emoji}'
                else:
                    new_line += f'{param} {school_pip_emoji}'
            case database.SpellEffects.modify_shadow_creature_level:
                if param >= 0:
                    new_line += f'+{param} Shadow Creature Level'
                else:
                    new_line += f'{param} Shadow Creature Level'
            case database.SpellEffects.modify_shadow_pips:
                if param >= 0:
                    new_line += f'+{param} {emojis.SHADOW_PIP}'
                else:
                    new_line += f'{param} {emojis.SHADOW_PIP}'
            case database.SpellEffects.pacify:
                new_line += f'Pacify'
            case database.SpellEffects.pip_conversion:
                if param >= 0:
                    new_line += f'+{param} {emojis.PIP} from Incoming Rank {pip_num} Spells'
                else:
                    new_line += f'{param} {emojis.PIP} from Incoming Rank {pip_num} Spells'
            case database.SpellEffects.polymorph:
                new_line += f'Polymorph into {param}'
            case database.SpellEffects.power_pip_conversion:
                if param >= 0:
                    new_line += f'+{param} {emojis.POWER_PIP} from Incoming Rank {pip_num} Spells'
                else:
                    new_line += f'{param} {emojis.POWER_PIP} from Incoming Rank {pip_num} Spells'
            case database.SpellEffects.protect_card_beneficial:
                new_line += f'Protect {emojis.CHARM}'
            case database.SpellEffects.protect_card_harmful:
                new_line += f'Protect {emojis.JINX}'
            case database.SpellEffects.push_charm:
                new_line += f'Push {param} {emojis.CURSE}'
            case database.SpellEffects.push_over_time:
                new_line += f'Push {param} {emojis.DOT}'
            case database.SpellEffects.push_ward:
                new_line += f'Push {param} {emojis.JINX}'
            case database.SpellEffects.reduce_over_time:
                new_line += f'{param} {emojis.DOT}{emojis.ROUNDS}'
            case database.SpellEffects.remove_aura:
                new_line += f'Remove {emojis.AURA}'
            case database.SpellEffects.remove_charm:
                match disposition:
                    case 0 | 1:
                        new_line += f'Remove {param} {emojis.CHARM}'
                    case 2:
                        new_line += f'Remove {param} {emojis.CURSE}'
            case database.SpellEffects.remove_combat_trigger_list:
                new_line += 'Remove Combat Trigger List'
            case database.SpellEffects.remove_over_time:
                match disposition:
                    case 0 | 1:
                        new_line += f'Remove {param} {emojis.HOT}'
                    case 2:
                        new_line += f'Remove {param} {emojis.DOT}'
            case database.SpellEffects.remove_stun_block:
                new_line += f'Remove {emojis.STUN_BLOCK}'
            case database.SpellEffects.remove_ward:
                match disposition:
                    case 0 | 1:
                        new_line += f'Remove {param} {emojis.WARD}'
                    case 2:
                        new_line += f'Remove {param} {emojis.JINX}'
            case database.SpellEffects.reshuffle:
                new_line += 'Reshuffle'
            case database.SpellEffects.resume_pips:
                new_line += 'Resume Pips'
            case database.SpellEffects.select_shadow_creature_attack_target:
                new_line += 'Select Shadow Creature Attack Target'
            case database.SpellEffects.shadow_decrement_turn:
                new_line += 'Shadow Decrement Turn'
            case database.SpellEffects.spawn_creature | database.SpellEffects.summon_creature:
                mob_name = self.fetch_mob_object_name_from_id(param)[0][2].decode('utf-8').replace('_', '\\_')
                new_line += f'Summon {mob_name}'
            case database.SpellEffects.steal_charm:
                match disposition:
                    case 0 | 1:
                        new_line += f'Steal {param} {emojis.CHARM}'
                    case 2:
                        new_line += f'Push {param} {emojis.CURSE}'
            case database.SpellEffects.steal_health:
                new_line += f'{param} {school}{emojis.STEAL} ({heal_modifier * 100}%)'
            case database.SpellEffects.steal_over_time:
                match disposition:
                    case 0 | 1:
                        new_line += f'Steal {param} {emojis.HOT}'
                    case 2:
                        new_line += f'Push {param} {emojis.DOT}'
            case database.SpellEffects.steal_ward:
                match disposition:
                    case 0 | 1:
                        new_line += f'Steal {param} {emojis.WARD}'
                    case 2:
                        new_line += f'Push {param} {emojis.JINX}'
            case database.SpellEffects.stop_auto_pass:
                new_line += 'Stop Auto Pass'
            case database.SpellEffects.stop_vanish:
                new_line += 'Stop Vanish'
            case database.SpellEffects.stun:
                new_line += f'{emojis.STUN} {param}{emojis.ROUNDS}'
            case database.SpellEffects.stun_block:
                new_line += f'{param} {emojis.STUN_BLOCK}'
            case database.SpellEffects.suspend_pips:
                new_line += 'Suspend Pips'
            case database.SpellEffects.swap_all:
                new_line += 'Swap All'
            case database.SpellEffects.swap_charm:
                match disposition:
                    case 0:
                        new_line += f'Swap {emojis.CHARM}/{emojis.CURSE}'
                    case 1:
                        new_line += f'Swap {emojis.CHARM}'
                    case 2:
                        new_line += f'Swap {emojis.CURSE}'
            case database.SpellEffects.swap_over_time:
                match disposition:
                    case 0:
                        new_line += f'Swap {emojis.DOT}/{emojis.HOT}'
                    case 1:
                        new_line += f'Swap {emojis.HOT}'
                    case 2:
                        new_line += f'Swap {emojis.DOT}'
            case database.SpellEffects.swap_ward:
                match disposition:
                    case 0:
                        new_line += f'Swap {emojis.WARD}/{emojis.JINX}'
                    case 1:
                        new_line += f'Swap {emojis.WARD}'
                    case 2:
                        new_line += f'Swap {emojis.JINX}'
            case database.SpellEffects.taunt:
                new_line += f'Taunt'
            case database.SpellEffects.un_polymorph:
                new_line += f'Unpolymorph'
            case database.SpellEffects.untargetable:
                new_line += f'Untargetable'
            case database.SpellEffects.vanish:
                new_line += f'Vanish'
            case database.SpellEffects.shadow_pact:
                match param:
                    case 0:
                        new_line += f'{emojis.WARD}'
                    case 1:
                        new_line += f'{emojis.JINX}'
                    case 2:
                        new_line += f'{emojis.CHARM}'
                    case 3:
                        new_line += f'{emojis.CURSE}'
                    case 4:
                        new_line += f'{emojis.DOT}'
                    case 5:
                        new_line += f'{emojis.HOT}'
                new_line += f'{emojis.SHADOW_SELF}'
            case database.SpellEffects.minion_rank_damage:
                new_line += f'Sap {param}'
        no_round_list = [database.SpellEffects.max_health_damage, database.SpellEffects.damage_no_crit, database.SpellEffects.damage, database.SpellEffects.clue, database.SpellEffects.damage_per_total_pip_power, database.SpellEffects.detonate_over_time, database.SpellEffects.heal_by_ward, database.SpellEffects.mind_control, database.SpellEffects.modify_card_damage_by_rank, database.SpellEffects.stun]
        if rounds > 0 and (not effect_type in no_round_list):
            new_line += f' {rounds}{emojis.ROUNDS}'
        remove_all_list = [database.SpellEffects.push_charm, database.SpellEffects.push_converted_charm, database.SpellEffects.push_converted_over_time, database.SpellEffects.push_converted_ward, database.SpellEffects.push_over_time, database.SpellEffects.push_ward, database.SpellEffects.remove_aura, database.SpellEffects.remove_charm, database.SpellEffects.remove_converted_charm, database.SpellEffects.remove_converted_over_time, database.SpellEffects.remove_converted_ward, database.SpellEffects.remove_over_time, database.SpellEffects.remove_stun_block, database.SpellEffects.remove_ward, database.SpellEffects.steal_charm, database.SpellEffects.steal_converted_charm, database.SpellEffects.steal_converted_over_time, database.SpellEffects.steal_converted_ward, database.SpellEffects.steal_ward, database.SpellEffects.steal_over_time, database.SpellEffects.detonate_over_time, database.SpellEffects.minion_rank_damage]
        if param == -1 and effect_type in remove_all_list:
            new_line = new_line.replace('-1', 'all')
        if parent_is_convert and rank == 0:
            new_line = new_line.replace('+', '1: ')
            new_line = new_line.replace('% ', f'% of effect to ')
        match target:
            case database.EffectTarget.enemy_team_all_at_once | database.EffectTarget.enemy_team:
                new_line += f' {emojis.ALL_ENEMIES_SQUARE}'
            case database.EffectTarget.spell | database.EffectTarget.specific_spells:
                new_line += f' {emojis.ENCHANTMENT}'
            case database.EffectTarget.self:
                new_line += f' {emojis.SELF}'
            case database.EffectTarget.enemy_single:
                new_line += f' {emojis.ALL_ENEMIES}'
            case database.EffectTarget.friendly_team | database.EffectTarget.friendly_team_all_at_once:
                new_line += f' {emojis.ALL_FRIENDS_SQUARE}'
            case database.EffectTarget.friendly_single:
                new_line += f' {emojis.ALL_FRIENDS}'
            case database.EffectTarget.target_global:
                new_line += f' {emojis.GLOBAL}'
            case database.EffectTarget.minion:
                new_line += f' {emojis.MINION}'
            case database.EffectTarget.multi_target_enemy:
                new_line += f' {emojis.ALL_ENEMIES_SELECT}'
            case database.EffectTarget.multi_target_friendly:
                new_line += f' {emojis.ALL_FRIENDS_SELECT}'
            case database.EffectTarget.friendly_minion:
                new_line += f' {emojis.ALL_FRIENDS_SQUARE}{emojis.MINION}'
            case database.EffectTarget.enemy_minion:
                new_line += f' {emojis.ALL_ENEMIES_SQUARE}{emojis.MINION}'
            case database.EffectTarget.target_minion:
                new_line += f' {emojis.ALL_ENEMIES}{emojis.MINION}'
            case database.EffectTarget.caster_minion:
                new_line += f' {emojis.ALL_FRIENDS}{emojis.MINION}'
        if effect_type != 0:
            return new_line
        else:
            return ''

    def _upstream_recursive_generate_effect_string(self, spell_effects, effect_string, nested_level=0, parent_is_x_pip=False, parent_is_convert=False, parent_id=-1):
        for effect in spell_effects:
            if effect[2] != parent_id:
                continue
            effect_id = effect[0]
            effect_class = effect[4]
            effect_type = database.SpellEffects(effect[8])
            condition = effect[16]
            if effect_class == 7 or (effect_type != database.SpellEffects.invalid_spell_effect and effect_type != database.SpellEffects.shadow_self and (effect_type != database.SpellEffects.convert_hanging_effect)):
                new_line = self.get_string_from_effect(effect, parent_is_x_pip=parent_is_x_pip, parent_is_convert=parent_is_convert)
                effect_string.append(f'{new_line}\n')
            match effect_class:
                case 0:
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level + 1, parent_id=effect_id)
                case 3 | 5 | 7:
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level, parent_id=effect_id)
                case 1:
                    effect_string.append(f'\nRandom:\n')
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level + 1, parent_id=effect_id)
                    effect_string.append('\n')
                case 2:
                    effect_string.append(f'\nVariable:\n')
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level + 1, parent_is_x_pip=True, parent_id=effect_id)
                    effect_string.append('\n')
                case 4:
                    effect_string.append(f'\n{self.replace_condition_with_emojis(condition)}:\n')
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level + 1, parent_id=effect_id)
                    effect_string.append('\n')
                case 6:
                    effect_string.append(f'\n{self.replace_condition_with_emojis(condition, use_blade_trap=True)}:\n')
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level + 1, parent_is_convert=True, parent_id=effect_id)
                    effect_string.append('\n')

    def _upstream_generate_spell_effects_description(self, spell_effects):
        ret_list = []
        self.recursive_generate_effect_string(spell_effects, ret_list)
        return ''.join(ret_list)

    def _upstream_parse_description(self, description, effects):
        description = re.sub('#-?\\d+:', '', description)
        description = re.sub('<[^>]*>', '', description)
        description = re.sub('\\{[^{}]*\\}', '', description)
        description = re.sub('%%', '%', description)
        for variable in re.findall('\\$([\\w:]+?)(\\d*)\\$', description):
            markdown_variable = variable[0]
            index = variable[1]
            actual = variable[0] + variable[1]
            if index:
                index = int(index) - 1
            else:
                index = 0
            if index > len(effects):
                index = len(effects) - 1
            match markdown_variable:
                case 'eA' | 'eAPerPip' | 'eAPerPipAll':
                    if actual == 'eA1':
                        description = description.replace(f'${actual}$', '')
                    elif index >= len(effects):
                        description = description.replace(f'${actual}$', '')
                    else:
                        description = description.replace(f'${actual}$', f'{effects[index][0]}')
                case 'eAMul':
                    description = description.replace(f'${actual}$', f'50')
                case 'eAMax':
                    description = description.replace(f'${actual}$', f'{effects[index][2]}')
                case 'eABonus':
                    description = description.replace(f'${actual}$', '').lstrip()
                case 'eAExtra':
                    description = description.replace(f'\\n+${actual}$', '')
                case 'eARounds':
                    if index >= len(effects):
                        description = description.replace(f'${actual}$', '')
                    else:
                        description = description.replace(f'${actual}$', f'{effects[index][2]}')
                case 'dT_image':
                    if index >= len(effects):
                        description = description.replace(f'${actual}$', f'')
                    else:
                        description = description.replace(f'${actual}$', f'{effects[index][1]}')
                case ':':
                    description = description.replace(f'$:$', f'->')
                case _:
                    description = description.replace(f'${actual}$', f'{database.translate_type_emoji(markdown_variable)}')
        return description.replace('\\n', '\n').replace('\\r', '\r').replace('$', '')


UPSTREAM_EXPLICIT_EFFECTS = frozenset(['absorb_damage', 'absorb_heal', 'add_combat_trigger_list', 'add_spell_to_deck', 'add_spell_to_hand', 'after_life', 'auto_pass', 'backlash_damage', 'cloaked_charm', 'cloaked_ward', 'cloaked_ward_no_remove', 'clue', 'collect_essence', 'confusion', 'crit_block', 'crit_boost', 'crit_boost_school_specific', 'damage', 'damage_no_crit', 'damage_over_time', 'damage_per_total_pip_power', 'dampen', 'deferred_damage', 'detonate_over_time', 'dispel', 'dispel_block', 'divide_damage', 'exit_combat', 'force_targetable', 'heal', 'heal_by_ward', 'heal_over_time', 'heal_percent', 'instant_kill', 'invalid_spell_effect', 'kill_creature', 'make_targetable', 'max_health_damage', 'max_health_heal', 'maximum_incoming_damage', 'mind_control', 'minion_rank_damage', 'modify_accuracy', 'modify_card_accuracy', 'modify_card_armor_piercing', 'modify_card_cloak', 'modify_card_damage', 'modify_card_damage_by_rank', 'modify_card_heal', 'modify_card_incoming_damage', 'modify_card_mutation', 'modify_card_outgoing_accuracy', 'modify_card_outgoing_armor_piercing', 'modify_card_rank', 'modify_hate', 'modify_incoming_armor_piercing', 'modify_incoming_damage', 'modify_incoming_damage_flat', 'modify_incoming_damage_over_time', 'modify_incoming_damage_type', 'modify_incoming_heal', 'modify_incoming_heal_flat', 'modify_incoming_heal_over_time', 'modify_outgoing_armor_piercing', 'modify_outgoing_damage', 'modify_outgoing_damage_flat', 'modify_outgoing_damage_type', 'modify_outgoing_heal', 'modify_outgoing_heal_flat', 'modify_outgoing_steal_health', 'modify_over_time_duration', 'modify_pip_round_rate', 'modify_pips', 'modify_power_pip_chance', 'modify_power_pips', 'modify_rank', 'modify_school_pips', 'modify_shadow_creature_level', 'modify_shadow_pips', 'pacify', 'pip_conversion', 'polymorph', 'power_pip_conversion', 'protect_card_beneficial', 'protect_card_harmful', 'push_charm', 'push_over_time', 'push_ward', 'reduce_over_time', 'remove_aura', 'remove_charm', 'remove_combat_trigger_list', 'remove_over_time', 'remove_stun_block', 'remove_ward', 'reshuffle', 'resume_pips', 'select_shadow_creature_attack_target', 'shadow_decrement_turn', 'shadow_pact', 'spawn_creature', 'steal_charm', 'steal_health', 'steal_over_time', 'steal_ward', 'stop_auto_pass', 'stop_vanish', 'stun', 'stun_block', 'summon_creature', 'suspend_pips', 'swap_all', 'swap_charm', 'swap_over_time', 'swap_ward', 'taunt', 'un_polymorph', 'untargetable', 'vanish'])
UPSTREAM_CASE_COUNTS = {'effect_case_groups': 112, 'explicit_effect_types': 119, 'effect_match_cases': 167, 'effect_if_nodes': 88, 'enum_types': 152, 'effect_classes': 8}


# Only fixed UI/action phrases are translated here. Proper names are resolved
# through locale_en + the optional caller dictionary, never machine-guessed.
_LITERAL_ZH = {
    'Add to Combat Trigger List': '加入战斗触发列表',
    'Remove Combat Trigger List': '移除战斗触发列表',
    'Select Shadow Creature Attack Target': '选择暗影生物攻击目标',
    'Shadow Decrement Turn': '减少暗影效果回合',
    'Shadow Creature Level': '暗影生物等级',
    'from Incoming Rank': '当受到以下费用法术时获得：',
    'of effect to': '原效果转化为',
    'Invalid Spell Effect': '无效法术效果',
    'Gain Per Round': '每回合获得',
    'Force Targetable': '强制可选为目标',
    'Make Targetable': '设为可选目标',
    'Modify Rank by': '调整魔豆费用：',
    'Polymorph into': '变身为',
    'Stop Auto Pass': '停止自动跳过',
    'Auto Pass': '自动跳过',
    'Stop Vanish': '解除消失',
    'Suspend Pips': '暂停产豆',
    'Resume Pips': '恢复产豆',
    'Exit Combat': '退出战斗',
    'Instant Kill': '立即击败',
    'No Remove': '不会移除',
    'No Crit': '不能暴击',
    'Max HP': '最大生命值',
    'To Deck': '加入牌库',
    'To Hand': '加入手牌',
    'Mutate to': '变异为',
    'Shadow Pips': '暗影魔豆',
    'Caster Minion': '施法者随从',
    'Target Minion': '目标随从',
    'DamageOverTime': '持续伤害',
    'HealOverTime': '持续治疗',
    'Negative Aura': '负面光环',
    'Pip Suspended': '暂停产豆状态',
    'Untargetable': '无法被选为目标',
    'Unpolymorph': '解除变身',
    'Reshuffle': '重新洗牌',
    'Detonate': '引爆',
    'Activate': '立即结算',
    'Confuse': '混乱',
    'Equalize': '伤害均衡上限',
    'Backlash': '反噬伤害',
    'Beguile': '魅惑',
    'Protect': '保护',
    'Extract': '提取精魄',
    'Summon': '召唤',
    'Devour': '吞噬',
    'Pacify': '安抚',
    'Taunt': '嘲讽',
    'Vanish': '消失',
    'Convert': '转换',
    'Remove': '移除',
    'Divide': '分摊',
    'Random': '随机分支',
    'Variable': '按魔豆数量变化',
    'Steal': '夺取',
    'Push': '转移',
    'Swap': '交换',
    'Add': '增加',
    'Kill': '击败',
    'Spy': '侦察',
    'Sap': '削减随从等级',
    'Hate': '仇恨',
    'Block': '抵挡',
    'Chance': '概率',
    'Spells': '法术',
    'Pips': '魔豆',
    'Minion': '随从',
    'Caster': '施法者',
    'Target': '目标',
    'Secondary': '编织学派',
    'Global': '全场结界',
    'Alive': '存活',
    'Dead': '已倒下',
    'Defeated': '已被击败',
    'Stunned': '眩晕状态',
    'Stun': '眩晕',
    'Confused': '混乱状态',
    'Beguiled': '魅惑状态',
    'Polymorphed': '变身状态',
    'None': '无',
    'Rank': '等级',
    'MAX': '上限',
    'Max': '上限',
    'Any': '任意效果',
    'all': '全部',
    'All': '全部',
    'per': '每',
    'to': '转为',
    'If': '若',
    'not': '不满足',
    'and': '且',
    'or': '或',
    'above': '高于',
    'below': '低于',
    'between': '介于',
    'has': '拥有',
    'on': '作用于',
    'HP': '生命值',
    'PvP': '玩家对战',
    'PvE': '玩家对怪物',
}
EFFECT_NAMES_ZH = {
    'invalid_spell_effect': '无效法术效果', 'damage': '伤害', 'damage_no_crit': '不可暴击伤害',
    'heal': '治疗', 'heal_percent': '百分比治疗', 'steal_health': '吸血',
    'reduce_over_time': '缩短持续效果', 'detonate_over_time': '引爆持续效果',
    'push_charm': '转移咒符', 'steal_charm': '夺取咒符', 'push_ward': '转移护符',
    'steal_ward': '夺取护符', 'push_over_time': '转移持续效果', 'steal_over_time': '夺取持续效果',
    'remove_charm': '移除咒符', 'remove_ward': '移除护符', 'remove_over_time': '移除持续效果',
    'remove_aura': '移除光环', 'swap_all': '交换全部效果', 'swap_charm': '交换咒符',
    'swap_ward': '交换护符', 'swap_over_time': '交换持续效果', 'minion_rank_damage': '削减随从等级',
    'modify_incoming_damage': '调整受到的伤害', 'maximum_incoming_damage': '受到伤害的上限',
    'modify_incoming_heal': '调整受到的治疗', 'modify_incoming_damage_type': '转换受到的伤害学派',
    'modify_incoming_armor_piercing': '调整受到的穿透', 'modify_outgoing_damage': '调整造成的伤害',
    'modify_outgoing_heal': '调整造成的治疗', 'modify_outgoing_damage_type': '转换造成的伤害学派',
    'modify_outgoing_armor_piercing': '调整造成的穿透', 'modify_outgoing_steal_health': '调整造成的吸血',
    'modify_incoming_steal_health': '调整受到的吸血', 'bounce_next': '反弹至下一目标',
    'bounce_previous': '反弹至上一目标', 'bounce_back': '反弹回施法者', 'bounce_all': '全部反弹',
    'absorb_damage': '吸收伤害', 'absorb_heal': '吸收治疗', 'modify_accuracy': '调整命中',
    'dispel': '禁咒', 'confusion': '混乱', 'cloaked_charm': '隐藏咒符', 'cloaked_ward': '隐藏护符',
    'stun_resist': '眩晕抗性', 'pip_conversion': '魔豆返还', 'crit_boost': '暴击增益',
    'crit_block': '暴击格挡', 'polymorph': '变身', 'delay_cast': '延迟施法',
    'modify_card_cloak': '调整卡牌隐藏效果', 'modify_card_damage': '调整卡牌伤害',
    'modify_card_heal': '调整卡牌治疗', 'modify_card_accuracy': '调整卡牌命中',
    'modify_card_mutation': '卡牌变异', 'modify_card_rank': '调整卡牌费用',
    'modify_card_armor_piercing': '调整卡牌穿透', 'modify_card_charm': '调整卡牌咒符',
    'modify_card_ward': '调整卡牌护符', 'modify_card_outgoing_damage': '调整卡牌造成的伤害',
    'modify_card_outgoing_accuracy': '调整卡牌施法命中', 'modify_card_outgoing_heal': '调整卡牌造成的治疗',
    'modify_card_outgoing_armor_piercing': '调整卡牌造成的穿透', 'modify_card_incoming_damage': '调整卡牌受到的伤害',
    'modify_card_absorb_damage': '调整卡牌伤害吸收', 'summon_creature': '召唤生物',
    'teleport_player': '传送玩家', 'stun': '眩晕', 'dampen': '限制魔豆上限', 'reshuffle': '重新洗牌',
    'mind_control': '魅惑', 'modify_pips': '调整魔豆', 'modify_power_pips': '调整超级魔豆',
    'modify_shadow_pips': '调整暗影魔豆', 'modify_hate': '调整仇恨', 'damage_over_time': '持续伤害',
    'heal_over_time': '持续治疗', 'modify_power_pip_chance': '调整超级魔豆概率', 'modify_rank': '调整等级',
    'stun_block': '免晕盾', 'reveal_cloak': '揭示隐藏效果', 'instant_kill': '立即击败',
    'after_life': '来世效果', 'deferred_damage': '延迟伤害', 'damage_per_total_pip_power': '按总魔豆威力造成伤害',
    'cloaked_ward_no_remove': '不会移除的隐藏护符', 'add_combat_trigger_list': '加入战斗触发列表',
    'remove_combat_trigger_list': '移除战斗触发列表', 'backlash_damage': '反噬伤害',
    'modify_backlash': '调整反噬', 'intercept': '拦截', 'shadow_self': '暗影形态',
    'shadow_creature': '暗影生物', 'modify_shadow_creature_level': '调整暗影生物等级',
    'select_shadow_creature_attack_target': '选择暗影生物攻击目标', 'shadow_decrement_turn': '减少暗影回合',
    'crit_boost_school_specific': '特定学派暴击增益', 'spawn_creature': '生成生物',
    'un_polymorph': '解除变身', 'power_pip_conversion': '超级魔豆返还',
    'protect_card_beneficial': '保护卡牌正面效果', 'protect_card_harmful': '保护卡牌负面效果',
    'protect_beneficial': '保护正面效果', 'protect_harmful': '保护负面效果', 'divide_damage': '分摊伤害',
    'collect_essence': '提取精魄', 'kill_creature': '击败生物', 'dispel_block': '抵挡禁咒',
    'confusion_block': '抵挡混乱', 'modify_pip_round_rate': '调整每回合产豆', 'clue': '侦察',
    'max_health_damage': '按最大生命值伤害', 'set_heal_percent': '设置治疗百分比',
    'untargetable': '无法被选为目标', 'make_targetable': '设为可选目标', 'force_targetable': '强制可选目标',
    'remove_stun_block': '移除免晕盾', 'modify_incoming_heal_flat': '调整受到的固定治疗',
    'modify_incoming_damage_flat': '调整受到的固定伤害', 'modify_outgoing_heal_flat': '调整造成的固定治疗',
    'modify_outgoing_damage_flat': '调整造成的固定伤害', 'exit_combat': '退出战斗',
    'suspend_pips': '暂停产豆', 'resume_pips': '恢复产豆', 'auto_pass': '自动跳过',
    'stop_auto_pass': '停止自动跳过', 'vanish': '消失', 'stop_vanish': '解除消失',
    'max_health_heal': '按最大生命值治疗', 'heal_by_ward': '按护符治疗', 'taunt': '嘲讽', 'pacify': '安抚',
    'remove_target_restriction': '移除目标限制', 'convert_hanging_effect': '转换悬挂效果',
    'add_spell_to_deck': '将法术加入牌库', 'add_spell_to_hand': '将法术加入手牌',
    'modify_incoming_damage_over_time': '调整受到的持续伤害',
    'modify_incoming_heal_over_time': '调整受到的持续治疗', 'modify_card_damage_by_rank': '按魔豆费用调整卡牌伤害',
    'push_converted_charm': '转移转换后的咒符', 'steal_converted_charm': '夺取转换后的咒符',
    'push_converted_ward': '转移转换后的护符', 'steal_converted_ward': '夺取转换后的护符',
    'push_converted_over_time': '转移转换后的持续效果', 'steal_converted_over_time': '夺取转换后的持续效果',
    'remove_converted_charm': '移除转换后的咒符', 'remove_converted_ward': '移除转换后的护符',
    'remove_converted_over_time': '移除转换后的持续效果', 'modify_over_time_duration': '调整持续效果回合',
    'modify_school_pips': '调整学派魔豆', 'shadow_pact': '暗影契约',
}
_LITERAL_ZH.update({name.replace('_', ' ').title(): label for name, label in EFFECT_NAMES_ZH.items()})
_LITERAL_PATTERN = re.compile(r'(?<![\w])(?:' + '|'.join(re.escape(key) for key in sorted(_LITERAL_ZH, key=len, reverse=True)) + r')(?![\w])')


def localize_output(text):
    """Translate structural vocabulary; preserve unknown game prose verbatim."""
    return _LITERAL_PATTERN.sub(lambda match: _LITERAL_ZH[match.group()], text).replace('\\_', '_').strip()


class SpellEffectRenderer(_UpstreamSpellAlgorithms):
    """Reusable reader. Reuse one instance while importing a whole catalogue."""

    def __init__(self, connection, translate=None, *, max_effects=MAX_EFFECT_ROWS, max_depth=MAX_EFFECT_DEPTH):
        if not isinstance(connection, sqlite3.Connection):
            raise TypeError('connection must be a sqlite3.Connection')
        self.connection = connection
        self.translate = translate
        self.max_effects = _integer(max_effects, 'max_effects')
        self.max_depth = _integer(max_depth, 'max_depth')
        if not 1 <= self.max_effects <= 100000 or not 1 <= self.max_depth <= 256:
            raise ValueError('无效的法术效果读取上限')
        self.tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.columns = {}
        for table in ('spells', 'mobs', 'locale_en', 'effects', 'spell_effects'):
            if table in self.tables:
                self.columns[table] = [row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')]
        self._locale_cache = {}
        self._reference_cache = {}
        self._warnings = []
        self._unknown = {}
        self._visited = set()
        self._active = set()
        self._children = None
        self._render_steps = 0
        self._preloaded_simple = None
        self._preloaded_real = None

    def preload_effects(self, *, max_total_rows=1000000, max_condition_characters=64 * 1024 * 1024):
        """Optional one-pass grouping for whole-catalogue imports.

        wizdb does not create indexes on these foreign-key columns. A full
        import can call this once to avoid one table scan per spell. Budgets
        fail explicitly before replacing the current caches; no DB writes occur.
        """
        max_total_rows = _integer(max_total_rows, 'max_total_rows')
        max_condition_characters = _integer(max_condition_characters, 'max_condition_characters')
        if max_total_rows < 1 or max_condition_characters < 1:
            raise ValueError('预加载预算必须大于零')
        simple, real = defaultdict(list), defaultdict(list)
        total_rows, condition_characters = 0, 0
        if 'effects' in self.tables:
            if not {'spell', 'indx', 'param', 'damage', 'rounds'} <= set(self.columns['effects']):
                raise ValueError('effects 表字段不符合 wizdb 格式')
            for row in self.connection.execute('SELECT spell, indx, param, damage, rounds FROM effects ORDER BY spell, indx'):
                total_rows += 1
                if total_rows > max_total_rows:
                    raise ValueError('效果预加载超过总行数预算，未截断数据')
                identity = _integer(row[0], 'effects.spell')
                simple[identity].append((row[2], school_text(row[3]), row[4]))
                if len(simple[identity]) > self.max_effects:
                    raise ValueError('单法术 effects 行数超过上限，未截断数据')
        if 'spell_effects' in self.tables:
            if not set(EFFECT_FIELDS) <= set(self.columns['spell_effects']):
                raise ValueError('spell_effects 表缺少标准 17 列，未按未知布局猜测')
            for row in self.connection.execute('SELECT ' + ','.join(EFFECT_FIELDS) + ' FROM spell_effects ORDER BY id'):
                total_rows += 1
                condition_characters += len(_text(row[16]))
                if total_rows > max_total_rows or condition_characters > max_condition_characters:
                    raise ValueError('效果预加载超过总行数或条件文本预算，未截断数据')
                identity = _integer(row[1], 'spell_effects.spell_id')
                real[identity].append(tuple(row))
                if len(real[identity]) > self.max_effects:
                    raise ValueError('单法术 spell_effects 行数超过上限，未截断数据')
        self._preloaded_simple = {key: tuple(rows) for key, rows in simple.items()}
        self._preloaded_real = {key: tuple(rows) for key, rows in real.items()}
        return {'rows': total_rows, 'simple_spells': len(simple), 'effect_spells': len(real)}

    def _warn(self, message):
        if message not in self._warnings:
            self._warnings.append(message)

    def _translation(self, original, reference=None):
        if self.translate is None:
            return original, False
        if isinstance(self.translate, dict):
            result = self.translate.get(reference, self.translate.get(original))
        elif callable(self.translate):
            try:
                signature = inspect.signature(self.translate)
                signature.bind(original, reference)
            except (TypeError, ValueError):
                result = self.translate(original)
            else:
                result = self.translate(original, reference)
        else:
            raise TypeError('translate 必须是函数或映射')
        if isinstance(result, dict):
            result = result.get('text') if result.get('translated', True) else None
        if result is None or result == '':
            return original, False
        if not isinstance(result, str):
            raise TypeError('translate 必须返回字符串、None 或带 text 的字典')
        if len(result) > MAX_TEXT_LENGTH:
            raise ValueError('翻译结果超过文本长度上限')
        return result, result != original

    def _locale(self, reference):
        if reference is None:
            return ''
        # Accept an explicitly supplied raw template as well as a locale ID.
        if isinstance(reference, str) and not re.fullmatch(r'-?\d+', reference):
            return reference
        key = str(reference)
        if key in self._locale_cache:
            return self._locale_cache[key]
        if 'locale_en' not in self.tables:
            self._warn('数据库缺少 locale_en，原始本地化引用未解析。')
            return ''
        row = self.connection.execute('SELECT data FROM locale_en WHERE id = ?', (reference,)).fetchone()
        result = _text(row[0]) if row else ''
        if len(self._locale_cache) >= 20000:
            self._locale_cache.pop(next(iter(self._locale_cache)))
        self._locale_cache[key] = result
        return result

    def _lookup_reference(self, kind, identifier):
        key = (kind, str(identifier))
        if key in self._reference_cache:
            return self._reference_cache[key]
        table = 'spells' if kind == 'spell' else 'mobs'
        id_field = 'template_id' if kind == 'spell' else 'id'
        result = None
        if table in self.tables and {id_field, 'name', 'real_name'} <= set(self.columns[table]):
            row = self.connection.execute(f'SELECT name, real_name FROM {table} WHERE {id_field} = ?', (identifier,)).fetchone()
            if row:
                original = self._locale(row[0]) or _text(row[1])
                result, _ = self._translation(original, f'locale_en:{row[0]}')
        if not result:
            result = f'未解析{"法术" if kind == "spell" else "生物"} ID={identifier}'
            self._warn(result)
        if len(self._reference_cache) >= 10000:
            self._reference_cache.pop(next(iter(self._reference_cache)))
        self._reference_cache[key] = result
        return result

    def fetch_object_name_from_id(self, identifier):
        return [(None, identifier, None, self._lookup_reference('spell', identifier).encode('utf-8'))]

    def fetch_mob_object_name_from_id(self, identifier):
        return [(identifier, None, self._lookup_reference('mob', identifier).encode('utf-8'))]

    def _spell_row(self, spell):
        if isinstance(spell, sqlite3.Row):
            row = dict(spell)
        elif isinstance(spell, dict):
            row = dict(spell)
        elif isinstance(spell, (tuple, list)):
            if 'spells' not in self.columns:
                raise ValueError('无法识别法术行：数据库缺少 spells')
            row = dict(zip(self.columns['spells'], spell))
        else:
            if 'spells' not in self.tables or 'template_id' not in self.columns['spells']:
                raise ValueError('数据库缺少 spells.template_id')
            identifier = _integer(spell, '法术模板 ID')
            cursor = self.connection.execute('SELECT * FROM spells WHERE template_id = ?', (identifier,))
            data = cursor.fetchone()
            if data is None:
                raise LookupError(f'找不到法术模板 ID={identifier}')
            row = dict(zip([column[0] for column in cursor.description], data))
        if 'template_id' not in row:
            raise ValueError('法术行必须包含 template_id；不能把数据库自增 id 当作模板 ID')
        row['template_id'] = _integer(row['template_id'], 'spells.template_id')
        return row

    def fetch_spell_effects(self, template_id):
        if 'effects' not in self.tables:
            self._warn('数据库缺少 effects，描述模板中的动态变量保留为未解析。')
            return []
        if self._preloaded_simple is not None:
            return self._preloaded_simple.get(_integer(template_id, '法术模板 ID'), ())
        required = {'spell', 'indx', 'param', 'damage', 'rounds'}
        if not required <= set(self.columns['effects']):
            raise ValueError('effects 表字段不符合 wizdb 格式')
        cursor = self.connection.execute('SELECT param, damage, rounds FROM effects WHERE spell = ? ORDER BY indx', (template_id,))
        rows = cursor.fetchmany(self.max_effects + 1)
        if len(rows) > self.max_effects:
            raise ValueError('单法术 effects 行数超过上限，未截断数据')
        return [(row[0], school_text(row[1]), row[2]) for row in rows]

    def _all_real_effects(self, template_id):
        if 'spell_effects' not in self.tables:
            self._warn('数据库缺少 spell_effects，无法展开底层效果树。')
            return []
        if self._preloaded_real is not None:
            return self._preloaded_real.get(_integer(template_id, '法术模板 ID'), ())
        if not set(EFFECT_FIELDS) <= set(self.columns['spell_effects']):
            raise ValueError('spell_effects 表缺少标准 17 列，未按未知布局猜测')
        cursor = self.connection.execute('SELECT ' + ','.join(EFFECT_FIELDS) + ' FROM spell_effects WHERE spell_id = ? ORDER BY id', (template_id,))
        rows = [tuple(row) for row in cursor.fetchmany(self.max_effects + 1)]
        if len(rows) > self.max_effects:
            raise ValueError('单法术 spell_effects 行数超过上限，未截断数据')
        return rows

    def fetch_real_spell_effects(self, template_id, num_targets=1):
        num_targets = _integer(num_targets, 'num_targets')
        return [row for row in self._all_real_effects(template_id) if row[15] in (0, num_targets)]

    def _unknown_effect(self, effect, reason):
        key = json.dumps([_json_value(value) for value in effect], ensure_ascii=False, separators=(',', ':'))
        try:
            name = SpellEffects(effect[8]).name
        except (ValueError, TypeError):
            name = f'unknown_{effect[8]}'
        if key not in self._unknown:
            self._unknown[key] = {
                'id': _json_value(effect[0]), 'type': _json_value(effect[8]), 'type_name': name,
                'reason': reason, 'raw': [_json_value(value) for value in effect],
            }
        self._warn(reason)
        label = EFFECT_NAMES_ZH.get(name, '未知效果')
        return f'未解释效果 {label} / {name}（类型={effect[8]}，参数={effect[5]}，目标={effect[7]}，回合={effect[10]}）；原字段已保留'

    def get_string_from_effect(self, effect, parent_is_x_pip=False, parent_is_convert=False):
        if len(effect) != len(EFFECT_FIELDS):
            raise ValueError('法术效果记录必须有 17 个字段')
        try:
            kind = SpellEffects(effect[8])
        except (ValueError, TypeError):
            return self._unknown_effect(effect, f'未识别的效果类型 {effect[8]}。')
        if kind.name not in UPSTREAM_EXPLICIT_EFFECTS:
            return self._unknown_effect(effect, f'上游没有为 {kind.name} 实现独立说明；保留完整原始字段。')
        try:
            target = EffectTarget(effect[7])
        except (ValueError, TypeError):
            return self._unknown_effect(effect, f'未识别的效果目标 {effect[7]}。')
        if effect[6] not in (0, 1, 2):
            return self._unknown_effect(effect, f'未识别的效果倾向 disposition={effect[6]}。')
        if not isinstance(effect[14], int) or not 0 <= effect[14] < len(SCHOOL_NAMES):
            self._unknown_effect(effect, f'未识别的效果学派编码 {effect[14]}。')
        if kind == SpellEffects.shadow_pact and effect[5] not in range(6):
            return self._unknown_effect(effect, f'未识别的暗影契约效果种类 {effect[5]}。')
        if kind == SpellEffects.modify_school_pips and effect[14] not in range(2, 9):
            return self._unknown_effect(effect, f'未知学派魔豆编码 {effect[14]}。')
        if kind in (SpellEffects.modify_incoming_damage_type, SpellEffects.modify_outgoing_damage_type) and effect[5] not in PRISM_SCHOOLS:
            self._unknown_effect(effect, f'未识别的棱镜学派哈希 {effect[5]}。')
        try:
            text = self._upstream_get_string_from_effect(effect, parent_is_x_pip, parent_is_convert)
        except (IndexError, KeyError, ValueError, TypeError, OverflowError) as error:
            return self._unknown_effect(effect, f'效果 {kind.name} 的字段无法按上游解释：{type(error).__name__}。')
        if '未解析法术 ID=' in text or '未解析生物 ID=' in text:
            self._unknown_effect(effect, '效果引用的法术或生物未在数据库中解析；完整原字段已保留。')
        # Three target enum values were left without a suffix by upstream. Keep
        # their distinct meaning rather than silently losing the target.
        extra_targets = {
            EffectTarget.invalid_target: '【目标未指定】',
            EffectTarget.preselected_enemy_single: '【预选单个敌人】',
            EffectTarget.at_least_one_enemy: '【至少一个敌人】',
            EffectTarget.friendly_single_not_me: '【其他单个队友】',
        }
        if target in extra_targets:
            text += ' ' + extra_targets[target]
        return text

    def render_effect(self, effect, parent_is_x_pip=False, parent_is_convert=False):
        return localize_output(self.get_string_from_effect(effect, parent_is_x_pip, parent_is_convert))

    def replace_condition_with_emojis(self, condition, use_blade_trap=False):
        condition = _text(condition)
        result = self._upstream_replace_condition_with_emojis(condition, use_blade_trap)
        # The upstream helper names the seven core schools; retain the same
        # scheme for the remaining enum schools and explicit school exclusions.
        for name in SCHOOL_NAMES[9:]:
            result = re.sub(r'\b' + re.escape(name.title()) + r'\b', getattr(emojis, name), result)
        return result

    def replace_consecutive_duplicates(self, text):
        return self._upstream_replace_consecutive_duplicates(text)

    def _condition_for_effect(self, effect, use_blade_trap=False):
        text = self.replace_condition_with_emojis(effect[16], use_blade_trap)
        localized = localize_output(text)
        without_tokens = re.sub(r'【[^】]*】', '', localized)
        unknown_words = sorted(set(re.findall(r'\b[A-Za-z][A-Za-z_]+\b', without_tokens)))
        if unknown_words:
            self._unknown_effect(effect, '条件包含未识别的原文词：' + ', '.join(unknown_words) + '。')
            return '【部分条件保留原文】' + text
        return text

    def condense_conditionals(self, text):
        """Condense only a real six-school family, never six repeated copies."""
        school_tokens = [getattr(emojis, name) for name in ('DEATH', 'FIRE', 'ICE', 'LIFE', 'MYTH', 'STORM')]
        sections = text.split('\n\n')
        groups = defaultdict(list)
        for index, section in enumerate(sections):
            normalized = section
            for token in school_tokens:
                normalized = normalized.replace(token, '@')
            groups[normalized.lstrip('\n')].append(index)
        replacements, removed = {}, set()
        for normalized, indices in groups.items():
            if len(indices) < 6:
                continue
            seen_schools = {token for index in indices for token in school_tokens if token in sections[index]}
            if len(seen_schools) < 6:
                continue
            section = normalized
            if 'Target @' in section:
                section = section.replace('Target @', f'{emojis.ELEMENTAL}/{emojis.SPIRIT}').replace('@', emojis.CHROMATIC_TARGET)
            elif 'Caster @' in section:
                section = section.replace('Caster @', f'{emojis.SELF} {emojis.ELEMENTAL}/{emojis.SPIRIT}').replace('@', emojis.CHROMATIC_CASTER)
            else:
                section = section.replace('@', emojis.CHROMATIC_TARGET)
            replacements[indices[0]] = section
            removed.update(indices[1:])
        return '\n\n'.join(replacements.get(index, section) for index, section in enumerate(sections) if index not in removed)

    def recursive_generate_effect_string(self, spell_effects, effect_string, nested_level=0, parent_is_x_pip=False, parent_is_convert=False, parent_id=-1):
        if nested_level > self.max_depth or len(self._active) > self.max_depth:
            raise ValueError('法术效果树超过层级上限，未截断数据')
        if parent_id in self._active:
            self._warn(f'检测到效果树循环 parent_id={parent_id}，相关原字段已保留。')
            return
        self._active.add(parent_id)
        try:
            children = self._children.get(parent_id, ()) if self._children is not None else [row for row in spell_effects if row[2] == parent_id]
            for effect in children:
                self._render_steps += 1
                if self._render_steps > self.max_effects * 4:
                    raise ValueError('效果树遍历超过预算，未生成不完整说明')
                effect_id, effect_class, effect_type = effect[0], effect[4], effect[8]
                if effect_id in self._active:
                    effect_string.append('  ' * nested_level + self._unknown_effect(effect, f'检测到循环效果节点 {effect_id}。') + '\n')
                    continue
                self._visited.add(effect_id)
                if effect_class == 7 or effect_type not in (0, 93, 135):
                    text = self.get_string_from_effect(effect, parent_is_x_pip, parent_is_convert)
                    effect_string.append('  ' * nested_level + text + '\n')
                condition = _text(effect[16])
                if effect_class == 0:
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level + 1, parent_id=effect_id)
                elif effect_class in (3, 5, 7):
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level, parent_id=effect_id)
                elif effect_class == 1:
                    effect_string.append('\n' + '  ' * nested_level + 'Random:\n')
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level + 1, parent_id=effect_id)
                    effect_string.append('\n')
                elif effect_class == 2:
                    effect_string.append('\n' + '  ' * nested_level + 'Variable:\n')
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level + 1, parent_is_x_pip=True, parent_id=effect_id)
                    effect_string.append('\n')
                elif effect_class == 4:
                    condition_text = self._condition_for_effect(effect)
                    effect_string.append('\n' + '  ' * nested_level + condition_text + ':\n')
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level + 1, parent_id=effect_id)
                    effect_string.append('\n')
                elif effect_class == 6:
                    condition_text = self._condition_for_effect(effect, use_blade_trap=True)
                    effect_string.append('\n' + '  ' * nested_level + condition_text + ':\n')
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level + 1, parent_is_convert=True, parent_id=effect_id)
                    effect_string.append('\n')
                else:
                    effect_string.append('  ' * nested_level + self._unknown_effect(effect, f'未知 effect_class={effect_class}，子节点仍继续读取。') + '\n')
                    self.recursive_generate_effect_string(spell_effects, effect_string, nested_level + 1, parent_id=effect_id)
        finally:
            self._active.remove(parent_id)

    def generate_spell_effects_description(self, spell_effects, *, condense_threshold=4000):
        if len(spell_effects) > self.max_effects:
            raise ValueError('单法术效果行数超过上限')
        self._children = defaultdict(list)
        self._visited, self._active, self._render_steps = set(), set(), 0
        known = set()
        for effect in spell_effects:
            if len(effect) != len(EFFECT_FIELDS):
                raise ValueError('效果记录必须含 17 列')
            if effect[0] in known:
                raise ValueError(f'重复效果节点 ID={effect[0]}')
            known.add(effect[0])
            self._children[effect[2]].append(effect)
        for children in self._children.values():
            children.sort(key=lambda row: (row[3] if row[3] is not None else 0, row[0]))
        parts = []
        self.recursive_generate_effect_string(spell_effects, parts)
        for effect in spell_effects:
            if effect[0] in self._visited:
                continue
            self._warn(f'效果节点 {effect[0]} 不可从根到达（父节点缺失或循环）；已单独保留。')
            parts.append('\n【独立或异常节点】' + self._unknown_effect(effect, '效果树存在孤立或循环节点。') + '\n')
            self._visited.add(effect[0])
            self.recursive_generate_effect_string(spell_effects, parts, parent_id=effect[0])
        raw = ''.join(parts)
        if len(raw) > MAX_TEXT_LENGTH:
            raise ValueError('效果说明超过文本上限，未截断数据')
        raw = self.replace_consecutive_duplicates(raw)
        if len(raw) > condense_threshold:
            raw = self.condense_conditionals(raw)
        return localize_output(re.sub(r'\n{3,}', '\n\n', raw))

    def parse_description(self, description, effects):
        """All upstream placeholders, with explicit unresolved tokens and bounds."""
        text = re.sub(r'#-?\d+:', '', _text(description))
        text = re.sub(r'<[^>]*>', '', text)
        text = re.sub(r'\{[^{}]*\}', '', text).replace('%%', '%')
        if len(text) > MAX_TEXT_LENGTH:
            raise ValueError('法术原始说明超过长度上限')
        for match in list(re.finditer(r'\$([\w:]+?)(\d*)\$', text)):
            variable, suffix = match.group(1), match.group(2)
            actual, token = variable + suffix, match.group(0)
            index = int(suffix) - 1 if suffix else 0
            if index > len(effects):
                index = len(effects) - 1
            effect = effects[index] if 0 <= index < len(effects) else None
            replacement = None
            if variable in ('eA', 'eAPerPip', 'eAPerPipAll'):
                if actual == 'eA1':
                    replacement = ''  # Original Kimerith template convention.
                elif effect is not None:
                    replacement = _text(effect[0])
            elif variable == 'eAMul':
                replacement = '50'  # Upstream's fixed template multiplier.
                self._warn('eAMul 按 Kimerith 上游模板约定显示 50；不是运行时测量值。')
            elif variable == 'eAMax':
                if effect is not None:
                    replacement = _text(effect[2])
            elif variable == 'eABonus':
                replacement = ''
            elif variable == 'eAExtra':
                before = text
                text = text.replace('\\n+' + token, '')
                if before == text:
                    self._warn(f'未在上游预期位置找到 {token}；保留原始占位符。')
                continue
            elif variable == 'eARounds':
                if effect is not None:
                    replacement = _text(effect[2])
            elif variable == 'dT_image':
                if effect is not None:
                    replacement = _text(effect[1])
            elif variable == ':':
                replacement = '→'
            elif variable in ICON_TERMS:
                replacement = icon_text(variable)
            if replacement is None:
                self._warn(f'说明占位符 {token} 未解析，原文已保留。')
            else:
                text = text.replace(token, replacement)
                if variable == 'eABonus':
                    text = text.lstrip()
        return text.replace('\\n', '\n').replace('\\r', '\r')

    def render_spell_details(self, spell, *, num_targets=None, include_raw=False):
        """Return JSON-safe fields for one catalogue entry.

        num_targets=None exports 0, 1, 2, 3, 4 AND every nonzero target count
        present in this spell's database rows. Explicit int / iterable requests
        are accepted. Variant 0 is always included as the upstream-compatible
        common-row fallback for an otherwise unseen target count.
        """
        self._warnings, self._unknown = [], {}
        row = self._spell_row(spell)
        template_id = row['template_id']
        description_ref = row.get('description')
        original = self._locale(description_ref)
        localized, translated = self._translation(original, f'locale_en:{description_ref}')
        simple = self.fetch_spell_effects(template_id)
        parsed = self.parse_description(original, simple)
        parsed_localized = self.parse_description(localized, simple) if translated else parsed
        description_zh = parsed_localized if translated or re.search(r'[\u3400-\u9fff]', original) else ('原文（未提供中文本地化）：' + parsed_localized if parsed_localized else '')
        real = self._all_real_effects(template_id)
        if num_targets is None:
            counts = {0, 1, 2, 3, 4}
            counts.update(_integer(effect[15], 'spell_effects.num_targets') for effect in real)
        elif isinstance(num_targets, (int, str)):
            counts = {0, _integer(num_targets, 'num_targets')}
        else:
            counts = {0, *(_integer(value, 'num_targets') for value in num_targets)}
        if len(counts) > MAX_VARIANTS:
            raise ValueError('目标数变体超过 128 种，未静默丢弃变体')
        variants = []
        for count in sorted(counts):
            selected = [effect for effect in real if effect[15] in (0, count)]
            text = self.generate_spell_effects_description(selected)
            variants.append({'num_targets': count, 'text': text, 'effect_count': len(selected)})
        result = {
            'description_raw': original,
            'description_parsed': parsed,
            'description_zh': description_zh,
            'effect_variants': variants,
            'effect_unparsed': list(self._unknown.values()),
            'effect_warnings': self._warnings[:],
            'spell_effects_available': 'spell_effects' in self.tables,
        }
        if include_raw or self._unknown:
            result['effect_fields'] = list(EFFECT_FIELDS)
        if include_raw:
            result['effect_rows'] = [[_json_value(value) for value in effect] for effect in real]
            result['description_effects'] = [[_json_value(value) for value in effect] for effect in simple]
        return result


def render_spell_details(connection, spell_or_id, *, num_targets=None, translate=None, include_raw=False):
    return SpellEffectRenderer(connection, translate=translate).render_spell_details(spell_or_id, num_targets=num_targets, include_raw=include_raw)
