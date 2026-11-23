# SPDX-License-Identifier: GPL-3.0-only
"""Kimerith native stat display and base-plus-equipment compatibility export.

Derived from MajorPain1/Kimerith-WindHammer bot/database.py and
bot/extensions/mobs.py, revision 3c24847d111387fc0b34772b548f74e80089599f.
https://github.com/MajorPain1/Kimerith-WindHammer

These routines only SELECT from an existing connection. The caller controls
the read-only SQLite connection and attaches the returned data to its catalogue.
"""

import math
import re
import sqlite3

REVISION = "3c24847d111387fc0b34772b548f74e80089599f"
SCHOOLS = ("fire", "ice", "storm", "myth", "life", "death", "balance", "star", "sun", "moon", "shadow")
MAX_STATS = 512
MAX_SAFE_INTEGER = 9007199254740991
STAT_ICONS = {"health": "stat.health", "mana": "stat.mana", "damage": "stat.damage", "flat_damage": "stat.flat_damage", "resist": "stat.resist", "flat_resist": "stat.flat_resist", "critical": "stat.critical", "block": "stat.block", "accuracy": "stat.accuracy", "pierce": "stat.pierce", "incoming": "stat.incoming", "outgoing": "stat.outgoing", "power_pip": "pip.power", "power_pips": "pip.power", "pips": "pip.normal", "shadow_pips": "pip.shadow"}

# Complete display/order map from the fixed upstream revision; labels translated
# to Chinese. 'exported_rating' retains uncertain units instead of inventing a
# rating-to-percentage conversion. Combat selection separately follows upstream.
STAT_DEFINITIONS = {
    '4927049617827923818': {'canonical': 'CanonicalFireDamage', 'order': 55, 'label': '火焰伤害', 'unit': 'percent', 'school': 'fire', 'stat': 'damage', 'display_mode': 'number'},
    '6727779672465143848': {'canonical': 'CanonicalIceDamage', 'order': 67, 'label': '冰霜伤害', 'unit': 'percent', 'school': 'ice', 'stat': 'damage', 'display_mode': 'number'},
    '3522838679519470489': {'canonical': 'CanonicalStormDamage', 'order': 103, 'label': '风暴伤害', 'unit': 'percent', 'school': 'storm', 'stat': 'damage', 'display_mode': 'number'},
    '2529555124841550219': {'canonical': 'CanonicalMythDamage', 'order': 91, 'label': '神圣伤害', 'unit': 'percent', 'school': 'myth', 'stat': 'damage', 'display_mode': 'number'},
    '2761527870413855644': {'canonical': 'CanonicalDeathDamage', 'order': 43, 'label': '亡灵伤害', 'unit': 'percent', 'school': 'death', 'stat': 'damage', 'display_mode': 'number'},
    '6957132674211135574': {'canonical': 'CanonicalShadowDamage', 'order': 115, 'label': '暗影伤害', 'unit': 'percent', 'school': 'shadow', 'stat': 'damage', 'display_mode': 'number'},
    '7296197634635589946': {'canonical': 'CanonicalAllDamage', 'order': 20, 'label': '伤害', 'unit': 'percent', 'school': 'universal', 'stat': 'damage', 'display_mode': 'number'},
    '6320324722421312509': {'canonical': 'CanonicalAllFishingLuck', 'order': 3, 'label': '钓鱼幸运', 'unit': 'percent', 'school': 'universal', 'stat': 'fishing_luck', 'display_mode': 'number'},
    '4475605042457954949': {'canonical': 'CanonicalStormAccuracy', 'order': 96, 'label': '风暴命中', 'unit': 'percent', 'school': 'storm', 'stat': 'accuracy', 'display_mode': 'number'},
    '7992954197970867928': {'canonical': 'CanonicalFireAccuracy', 'order': 48, 'label': '火焰命中', 'unit': 'percent', 'school': 'fire', 'stat': 'accuracy', 'display_mode': 'number'},
    '4637156723960149266': {'canonical': 'CanonicalIceAccuracy', 'order': 60, 'label': '冰霜命中', 'unit': 'percent', 'school': 'ice', 'stat': 'accuracy', 'display_mode': 'number'},
    '6000014209282948555': {'canonical': 'CanonicalLifeAccuracy', 'order': 72, 'label': '生命命中', 'unit': 'percent', 'school': 'life', 'stat': 'accuracy', 'display_mode': 'number'},
    '7637194812770774862': {'canonical': 'CanonicalDeathAccuracy', 'order': 36, 'label': '亡灵命中', 'unit': 'percent', 'school': 'death', 'stat': 'accuracy', 'display_mode': 'number'},
    '8558694730007442541': {'canonical': 'CanonicalBalanceAccuracy', 'order': 24, 'label': '平衡命中', 'unit': 'percent', 'school': 'balance', 'stat': 'accuracy', 'display_mode': 'number'},
    '6903334711162988879': {'canonical': 'CanonicalMythAccuracy', 'order': 84, 'label': '神圣命中', 'unit': 'percent', 'school': 'myth', 'stat': 'accuracy', 'display_mode': 'number'},
    '886598337825556740': {'canonical': 'CanonicalShadowAccuracy', 'order': 108, 'label': '暗影命中', 'unit': 'percent', 'school': 'shadow', 'stat': 'accuracy', 'display_mode': 'number'},
    '519022312295458080': {'canonical': 'CanonicalAllAccuracy', 'order': 13, 'label': '命中', 'unit': 'percent', 'school': 'universal', 'stat': 'accuracy', 'display_mode': 'number'},
    '114089067047437639': {'canonical': 'CanonicalStormArmorPiercing', 'order': 98, 'label': '风暴穿透', 'unit': 'percent', 'school': 'storm', 'stat': 'pierce', 'display_mode': 'number'},
    '492510026881542455': {'canonical': 'CanonicalFireArmorPiercing', 'order': 50, 'label': '火焰穿透', 'unit': 'percent', 'school': 'fire', 'stat': 'pierce', 'display_mode': 'number'},
    '5311808592473234324': {'canonical': 'CanonicalIceArmorPiercing', 'order': 62, 'label': '冰霜穿透', 'unit': 'percent', 'school': 'ice', 'stat': 'pierce', 'display_mode': 'number'},
    '6245842459206511310': {'canonical': 'CanonicalLifeArmorPiercing', 'order': 74, 'label': '生命穿透', 'unit': 'percent', 'school': 'life', 'stat': 'pierce', 'display_mode': 'number'},
    '8022134959406000665': {'canonical': 'CanonicalDeathArmorPiercing', 'order': 38, 'label': '亡灵穿透', 'unit': 'percent', 'school': 'death', 'stat': 'pierce', 'display_mode': 'number'},
    '8387859607449748700': {'canonical': 'CanonicalBalanceArmorPiercing', 'order': 26, 'label': '平衡穿透', 'unit': 'percent', 'school': 'balance', 'stat': 'pierce', 'display_mode': 'number'},
    '865803129726658378': {'canonical': 'CanonicalMythArmorPiercing', 'order': 86, 'label': '神圣穿透', 'unit': 'percent', 'school': 'myth', 'stat': 'pierce', 'display_mode': 'number'},
    '7213263316072792443': {'canonical': 'CanonicalShadowArmorPiercing', 'order': 110, 'label': '暗影穿透', 'unit': 'percent', 'school': 'shadow', 'stat': 'pierce', 'display_mode': 'number'},
    '5878931342881014006': {'canonical': 'CanonicalAllArmorPiercing', 'order': 16, 'label': '穿透', 'unit': 'percent', 'school': 'universal', 'stat': 'pierce', 'display_mode': 'number'},
    '3048880215231770449': {'canonical': 'CanonicalLifeHealing', 'order': 120, 'label': '对外治疗', 'unit': 'percent', 'school': 'universal', 'stat': 'outgoing', 'display_mode': 'number'},
    '6363946171904787641': {'canonical': 'CanonicalPowerPip', 'order': 5, 'label': '超级豆概率', 'unit': 'percent', 'school': 'universal', 'stat': 'power_pip', 'display_mode': 'number'},
    '2669355392519095199': {'canonical': 'CanonicalMaxMana', 'order': 1, 'label': '法力上限', 'unit': 'flat', 'school': 'universal', 'stat': 'mana', 'display_mode': 'number'},
    '7856887239808991597': {'canonical': 'CanonicalMaxHealth', 'order': 0, 'label': '生命上限', 'unit': 'flat', 'school': 'universal', 'stat': 'health', 'display_mode': 'number'},
    '7322927550781641425': {'canonical': 'CanonicalFireFlatDamage', 'order': 51, 'label': '火焰固定伤害', 'unit': 'flat', 'school': 'fire', 'stat': 'flat_damage', 'display_mode': 'number'},
    '592800758175992719': {'canonical': 'CanonicalIceFlatDamage', 'order': 63, 'label': '冰霜固定伤害', 'unit': 'flat', 'school': 'ice', 'stat': 'flat_damage', 'display_mode': 'number'},
    '5014592992818751446': {'canonical': 'CanonicalStormFlatDamage', 'order': 99, 'label': '风暴固定伤害', 'unit': 'flat', 'school': 'storm', 'stat': 'flat_damage', 'display_mode': 'number'},
    '5185100146563071688': {'canonical': 'CanonicalMythFlatDamage', 'order': 87, 'label': '神圣固定伤害', 'unit': 'flat', 'school': 'myth', 'stat': 'flat_damage', 'display_mode': 'number'},
    '404725660134742063': {'canonical': 'CanonicalDeathFlatDamage', 'order': 39, 'label': '亡灵固定伤害', 'unit': 'flat', 'school': 'death', 'stat': 'flat_damage', 'display_mode': 'number'},
    '4200377635371816693': {'canonical': 'CanonicalShadowFlatDamage', 'order': 111, 'label': '暗影固定伤害', 'unit': 'flat', 'school': 'shadow', 'stat': 'flat_damage', 'display_mode': 'number'},
    '7517828738876145149': {'canonical': 'CanonicalAllFlatDamage', 'order': 9, 'label': '固定伤害', 'unit': 'flat', 'school': 'universal', 'stat': 'flat_damage', 'display_mode': 'number'},
    '5616048861211119605': {'canonical': 'CanonicalFireReduceDamage', 'order': 45, 'label': '火焰抗性', 'unit': 'percent', 'school': 'fire', 'stat': 'resist', 'display_mode': 'number'},
    '3021485278224481533': {'canonical': 'CanonicalIceReduceDamage', 'order': 57, 'label': '冰霜抗性', 'unit': 'percent', 'school': 'ice', 'stat': 'resist', 'display_mode': 'number'},
    '8963565193214169286': {'canonical': 'CanonicalStormReduceDamage', 'order': 93, 'label': '风暴抗性', 'unit': 'percent', 'school': 'storm', 'stat': 'resist', 'display_mode': 'number'},
    '2014476814297117202': {'canonical': 'CanonicalMythReduceDamage', 'order': 81, 'label': '神圣抗性', 'unit': 'percent', 'school': 'myth', 'stat': 'resist', 'display_mode': 'number'},
    '9016906601746555967': {'canonical': 'CanonicalDeathReduceDamage', 'order': 33, 'label': '亡灵抗性', 'unit': 'percent', 'school': 'death', 'stat': 'resist', 'display_mode': 'number'},
    '8927214466468965361': {'canonical': 'CanonicalShadowReduceDamage', 'order': 105, 'label': '暗影抗性', 'unit': 'percent', 'school': 'shadow', 'stat': 'resist', 'display_mode': 'number'},
    '8270991097218515519': {'canonical': 'CanonicalAllReduceDamage', 'order': 11, 'label': '抗性', 'unit': 'percent', 'school': 'universal', 'stat': 'resist', 'display_mode': 'number'},
    '8613945154050726733': {'canonical': 'CanonicalIncHealing', 'order': 119, 'label': '接受治疗', 'unit': 'percent', 'school': 'universal', 'stat': 'incoming', 'display_mode': 'number'},
    '5194860493161286656': {'canonical': 'CanonicalIncomingAccuracy', 'order': 15, 'label': '命中', 'unit': 'percent', 'school': 'universal', 'stat': 'accuracy', 'display_mode': 'number'},
    '5756243114844684910': {'canonical': 'CanonicalLifeReduceDamage', 'order': 69, 'label': '生命抗性', 'unit': 'percent', 'school': 'life', 'stat': 'resist', 'display_mode': 'number'},
    '8173155469709074108': {'canonical': 'CanonicalBalanceReduceDamage', 'order': 21, 'label': '平衡抗性', 'unit': 'percent', 'school': 'balance', 'stat': 'resist', 'display_mode': 'number'},
    '8852389366728109463': {'canonical': 'CanonicalLifeDamage', 'order': 79, 'label': '生命伤害', 'unit': 'percent', 'school': 'life', 'stat': 'damage', 'display_mode': 'number'},
    '6605029530240813612': {'canonical': 'CanonicalLifeFlatDamage', 'order': 75, 'label': '生命固定伤害', 'unit': 'flat', 'school': 'life', 'stat': 'flat_damage', 'display_mode': 'number'},
    '4376060851841335605': {'canonical': 'CanonicalBalanceDamage', 'order': 31, 'label': '平衡伤害', 'unit': 'percent', 'school': 'balance', 'stat': 'damage', 'display_mode': 'number'},
    '2400520913488793249': {'canonical': 'CanonicalBalanceFishingLuck', 'order': 32, 'label': '平衡钓鱼幸运', 'unit': 'percent', 'school': 'balance', 'stat': 'fishing_luck', 'display_mode': 'number'},
    '4579435914049228684': {'canonical': 'CanonicalDeathFishingLuck', 'order': 44, 'label': '亡灵钓鱼幸运', 'unit': 'percent', 'school': 'death', 'stat': 'fishing_luck', 'display_mode': 'number'},
    '6055768302773000618': {'canonical': 'CanonicalFireFishingLuck', 'order': 56, 'label': '火焰钓鱼幸运', 'unit': 'percent', 'school': 'fire', 'stat': 'fishing_luck', 'display_mode': 'number'},
    '8466624188072466067': {'canonical': 'CanonicalIceFishingLuck', 'order': 68, 'label': '冰霜钓鱼幸运', 'unit': 'percent', 'school': 'ice', 'stat': 'fishing_luck', 'display_mode': 'number'},
    '3112303596442896403': {'canonical': 'CanonicalLifeFishingLuck', 'order': 80, 'label': '生命钓鱼幸运', 'unit': 'percent', 'school': 'life', 'stat': 'fishing_luck', 'display_mode': 'number'},
    '1639169840831004840': {'canonical': 'CanonicaMythFishingLuck', 'order': 92, 'label': '神圣钓鱼幸运', 'unit': 'percent', 'school': 'myth', 'stat': 'fishing_luck', 'display_mode': 'number'},
    '6390126131458189177': {'canonical': 'CanonicaShadowFishingLuck', 'order': 116, 'label': '暗影钓鱼幸运', 'unit': 'percent', 'school': 'shadow', 'stat': 'fishing_luck', 'display_mode': 'number'},
    '2498009617457926425': {'canonical': 'CanonicaStormFishingLuck', 'order': 104, 'label': '风暴钓鱼幸运', 'unit': 'percent', 'school': 'storm', 'stat': 'fishing_luck', 'display_mode': 'number'},
    '4652121098213854526': {'canonical': 'CanonicalBalanceFlatDamage', 'order': 27, 'label': '平衡固定伤害', 'unit': 'flat', 'school': 'balance', 'stat': 'flat_damage', 'display_mode': 'number'},
    '7679508463806348964': {'canonical': 'CanonicalMaxManaPercentReduce', 'order': 134, 'label': '法力上限降低 100%', 'unit': 'flag', 'school': 'universal', 'stat': 'mana', 'display_mode': 'text'},
    '2717353107569841333': {'canonical': 'XPPercent', 'order': 6, 'label': '经验加成', 'unit': 'percent', 'school': 'universal', 'stat': None, 'display_mode': 'number'},
    '7671607427959608256': {'canonical': 'GoldPercent', 'order': 7, 'label': '金币加成', 'unit': 'percent', 'school': 'universal', 'stat': None, 'display_mode': 'number'},
    '1442133179647054380': {'canonical': 'CanonicalMaxEnergy', 'order': 2, 'label': '能量上限', 'unit': 'flat', 'school': 'universal', 'stat': 'energy', 'display_mode': 'number'},
    '2238598923626418029': {'canonical': 'CanonicalAllCriticalHit', 'order': 17, 'label': '暴击评级', 'unit': 'rating', 'school': 'universal', 'stat': 'critical', 'display_mode': 'number'},
    '7415582896521970590': {'canonical': 'CanonicalAllBlock', 'order': 10, 'label': '格挡评级', 'unit': 'rating', 'school': 'universal', 'stat': 'block', 'display_mode': 'number'},
    '1917893698577262159': {'canonical': 'CanonicalAllPowerPipRating', 'order': 8, 'label': '超级豆概率', 'unit': 'exported_rating', 'school': 'universal', 'stat': 'power_pip', 'display_mode': 'number'},
    '5299425904318465855': {'canonical': 'CanonicalAllReduceDamageRating', 'order': 12, 'label': '抗性', 'unit': 'exported_rating', 'school': 'universal', 'stat': 'resist', 'display_mode': 'number'},
    '3606782491526053210': {'canonical': 'CanonicalAllAccuracyRating', 'order': 14, 'label': '命中', 'unit': 'exported_rating', 'school': 'universal', 'stat': 'accuracy', 'display_mode': 'number'},
    '8529374255302927746': {'canonical': 'CanonicalStormCriticalHit', 'order': 101, 'label': '风暴暴击评级', 'unit': 'rating', 'school': 'storm', 'stat': 'critical', 'display_mode': 'number'},
    '2216355934372790763': {'canonical': 'CanonicalMythCriticalHit', 'order': 89, 'label': '神圣暴击评级', 'unit': 'rating', 'school': 'myth', 'stat': 'critical', 'display_mode': 'number'},
    '5573407276814835007': {'canonical': 'CanonicalLifeCriticalHit', 'order': 77, 'label': '生命暴击评级', 'unit': 'rating', 'school': 'life', 'stat': 'critical', 'display_mode': 'number'},
    '6536213859373647995': {'canonical': 'CanonicalIceCriticalHit', 'order': 65, 'label': '冰霜暴击评级', 'unit': 'rating', 'school': 'ice', 'stat': 'critical', 'display_mode': 'number'},
    '1853945345244447112': {'canonical': 'CanonicalFireCriticalHit', 'order': 53, 'label': '火焰暴击评级', 'unit': 'rating', 'school': 'fire', 'stat': 'critical', 'display_mode': 'number'},
    '7788213497803634698': {'canonical': 'CanonicalDeathCriticalHit', 'order': 41, 'label': '亡灵暴击评级', 'unit': 'rating', 'school': 'death', 'stat': 'critical', 'display_mode': 'number'},
    '3305375089829176965': {'canonical': 'CanonicalBalanceCriticalHit', 'order': 29, 'label': '平衡暴击评级', 'unit': 'rating', 'school': 'balance', 'stat': 'critical', 'display_mode': 'number'},
    '6674977064640490796': {'canonical': 'CanonicalShadowCriticalHit', 'order': 113, 'label': '暗影暴击评级', 'unit': 'rating', 'school': 'shadow', 'stat': 'critical', 'display_mode': 'number'},
    '1038040780563339586': {'canonical': 'CanonicalBalanceBlock', 'order': 28, 'label': '平衡格挡评级', 'unit': 'rating', 'school': 'balance', 'stat': 'block', 'display_mode': 'number'},
    '4399511681421038693': {'canonical': 'CanonicalDeathBlock', 'order': 40, 'label': '亡灵格挡评级', 'unit': 'rating', 'school': 'death', 'stat': 'block', 'display_mode': 'number'},
    '1215463960136244631': {'canonical': 'CanonicalFireBlock', 'order': 52, 'label': '火焰格挡评级', 'unit': 'rating', 'school': 'fire', 'stat': 'block', 'display_mode': 'number'},
    '8221870029320029560': {'canonical': 'CanonicalIceBlock', 'order': 64, 'label': '冰霜格挡评级', 'unit': 'rating', 'school': 'ice', 'stat': 'block', 'display_mode': 'number'},
    '7351836674550443592': {'canonical': 'CanonicalLifeBlock', 'order': 76, 'label': '生命格挡评级', 'unit': 'rating', 'school': 'life', 'stat': 'block', 'display_mode': 'number'},
    '3225487762658918996': {'canonical': 'CanonicalMythBlock', 'order': 88, 'label': '神圣格挡评级', 'unit': 'rating', 'school': 'myth', 'stat': 'block', 'display_mode': 'number'},
    '7616372928570938185': {'canonical': 'CanonicalStormBlock', 'order': 100, 'label': '风暴格挡评级', 'unit': 'rating', 'school': 'storm', 'stat': 'block', 'display_mode': 'number'},
    '7761615877907768251': {'canonical': 'CanonicalShadowBlock', 'order': 112, 'label': '暗影格挡评级', 'unit': 'rating', 'school': 'shadow', 'stat': 'block', 'display_mode': 'number'},
    '6409691187048650641': {'canonical': 'CanonicalBalanceAccuracyRating', 'order': 25, 'label': '平衡命中', 'unit': 'exported_rating', 'school': 'balance', 'stat': 'accuracy', 'display_mode': 'number'},
    '911277060681050044': {'canonical': 'CanonicalDeathAccuracyRating', 'order': 37, 'label': '亡灵命中', 'unit': 'exported_rating', 'school': 'death', 'stat': 'accuracy', 'display_mode': 'number'},
    '5503780012086736826': {'canonical': 'CanonicalFireAccuracyRating', 'order': 49, 'label': '火焰命中', 'unit': 'exported_rating', 'school': 'fire', 'stat': 'accuracy', 'display_mode': 'number'},
    '8779361818395802456': {'canonical': 'CanonicalIceAccuracyRating', 'order': 61, 'label': '冰霜命中', 'unit': 'exported_rating', 'school': 'ice', 'stat': 'accuracy', 'display_mode': 'number'},
    '6247842152727503795': {'canonical': 'CanonicalLifeAccuracyRating', 'order': 73, 'label': '生命命中', 'unit': 'exported_rating', 'school': 'life', 'stat': 'accuracy', 'display_mode': 'number'},
    '8757126199912471591': {'canonical': 'CanonicalMythAccuracyRating', 'order': 85, 'label': '神圣命中', 'unit': 'exported_rating', 'school': 'myth', 'stat': 'accuracy', 'display_mode': 'number'},
    '5578207146269346481': {'canonical': 'CanonicalStormAccuracyRating', 'order': 97, 'label': '风暴命中', 'unit': 'exported_rating', 'school': 'storm', 'stat': 'accuracy', 'display_mode': 'number'},
    '7216557400949564182': {'canonical': 'CanonicalShadowAccuracyRating', 'order': 109, 'label': '暗影命中', 'unit': 'exported_rating', 'school': 'shadow', 'stat': 'accuracy', 'display_mode': 'number'},
    '7882269862380033550': {'canonical': 'CanonicalBalanceReduceDamageRating', 'order': 22, 'label': '平衡抗性', 'unit': 'exported_rating', 'school': 'balance', 'stat': 'resist', 'display_mode': 'number'},
    '3344787873302418295': {'canonical': 'CanonicalDeathReduceDamageRating', 'order': 34, 'label': '亡灵抗性', 'unit': 'exported_rating', 'school': 'death', 'stat': 'resist', 'display_mode': 'number'},
    '8259437479977187641': {'canonical': 'CanonicalFireReduceDamageRating', 'order': 46, 'label': '火焰抗性', 'unit': 'exported_rating', 'school': 'fire', 'stat': 'resist', 'display_mode': 'number'},
    '7727666186455372297': {'canonical': 'CanonicalIceReduceDamageRating', 'order': 58, 'label': '冰霜抗性', 'unit': 'exported_rating', 'school': 'ice', 'stat': 'resist', 'display_mode': 'number'},
    '2954235277782321372': {'canonical': 'CanonicalLifeReduceDamageRating', 'order': 70, 'label': '生命抗性', 'unit': 'exported_rating', 'school': 'life', 'stat': 'resist', 'display_mode': 'number'},
    '395658174601260832': {'canonical': 'CanonicalMythReduceDamageRating', 'order': 82, 'label': '神圣抗性', 'unit': 'exported_rating', 'school': 'myth', 'stat': 'resist', 'display_mode': 'number'},
    '7389602087179845900': {'canonical': 'CanonicalStormReduceDamageRating', 'order': 94, 'label': '风暴抗性', 'unit': 'exported_rating', 'school': 'storm', 'stat': 'resist', 'display_mode': 'number'},
    '5211435273867763189': {'canonical': 'CanonicalShadowReduceDamageRating', 'order': 106, 'label': '暗影抗性', 'unit': 'exported_rating', 'school': 'shadow', 'stat': 'resist', 'display_mode': 'number'},
    '8300655413306936432': {'canonical': 'CanonicalBalanceMastery', 'order': 121, 'label': '平衡学派精通（允许超级豆）', 'unit': 'flag', 'school': 'balance', 'stat': 'power_pip', 'display_mode': 'text'},
    '2414906546956263419': {'canonical': 'CanonicalDeathMastery', 'order': 122, 'label': '亡灵学派精通（允许超级豆）', 'unit': 'flag', 'school': 'death', 'stat': 'power_pip', 'display_mode': 'text'},
    '2189448845149557921': {'canonical': 'CanonicalFireMastery', 'order': 123, 'label': '火焰学派精通（允许超级豆）', 'unit': 'flag', 'school': 'fire', 'stat': 'power_pip', 'display_mode': 'text'},
    '7283851183648437222': {'canonical': 'CanonicalIceMastery', 'order': 124, 'label': '冰霜学派精通（允许超级豆）', 'unit': 'flag', 'school': 'ice', 'stat': 'power_pip', 'display_mode': 'text'},
    '3004050976789385242': {'canonical': 'CanonicalLifeMastery', 'order': 125, 'label': '生命学派精通（允许超级豆）', 'unit': 'flag', 'school': 'life', 'stat': 'power_pip', 'display_mode': 'text'},
    '1281491519962261038': {'canonical': 'CanonicalMythMastery', 'order': 126, 'label': '神圣学派精通（允许超级豆）', 'unit': 'flag', 'school': 'myth', 'stat': 'power_pip', 'display_mode': 'text'},
    '2469605530504075823': {'canonical': 'CanonicalStormMastery', 'order': 127, 'label': '风暴学派精通（允许超级豆）', 'unit': 'flag', 'school': 'storm', 'stat': 'power_pip', 'display_mode': 'text'},
    '1356499624784645974': {'canonical': 'CanonicalStunResistance', 'order': 131, 'label': '眩晕抵抗', 'unit': 'percent', 'school': 'universal', 'stat': 'stun_resist', 'display_mode': 'number'},
    '2004825781349682682': {'canonical': 'ReduceDamageInvunerable', 'order': 132, 'label': '伤害免疫', 'unit': 'flag', 'school': 'universal', 'stat': 'damage', 'display_mode': 'text'},
    '2839691986916792581': {'canonical': 'CanonicalShadowPip', 'order': 118, 'label': '暗影豆', 'unit': 'count', 'school': 'universal', 'stat': 'shadow_pips', 'display_mode': 'number'},
    '4978214201579900260': {'canonical': 'CanonicalAllFlatReduceDamage', 'order': 19, 'label': '固定减伤', 'unit': 'flat', 'school': 'universal', 'stat': 'flat_resist', 'display_mode': 'number'},
    '3870249803521257249': {'canonical': 'CanonicalLifeFlatReduceDamage', 'order': 71, 'label': '生命固定减伤', 'unit': 'flat', 'school': 'life', 'stat': 'flat_resist', 'display_mode': 'number'},
    '8048142704309762636': {'canonical': 'CanonicalDeathFlatReduceDamage', 'order': 35, 'label': '亡灵固定减伤', 'unit': 'flat', 'school': 'death', 'stat': 'flat_resist', 'display_mode': 'number'},
    '6199885772058519069': {'canonical': 'CanonicalMythFlatReduceDamage', 'order': 83, 'label': '神圣固定减伤', 'unit': 'flat', 'school': 'myth', 'stat': 'flat_resist', 'display_mode': 'number'},
    '5622264160357693297': {'canonical': 'CanonicalStormFlatReduceDamage', 'order': 95, 'label': '风暴固定减伤', 'unit': 'flat', 'school': 'storm', 'stat': 'flat_resist', 'display_mode': 'number'},
    '6104028773220871206': {'canonical': 'CanonicalIceFlatReduceDamage', 'order': 59, 'label': '冰霜固定减伤', 'unit': 'flat', 'school': 'ice', 'stat': 'flat_resist', 'display_mode': 'number'},
    '517997605277141342': {'canonical': 'CanonicalFireFlatReduceDamage', 'order': 47, 'label': '火焰固定减伤', 'unit': 'flat', 'school': 'fire', 'stat': 'flat_resist', 'display_mode': 'number'},
    '6295384463249252803': {'canonical': 'CanonicalBalanceFlatReduceDamage', 'order': 23, 'label': '平衡固定减伤', 'unit': 'flat', 'school': 'balance', 'stat': 'flat_resist', 'display_mode': 'number'},
    '5534655449767564306': {'canonical': 'CanonicalShadowFlatReduceDamage', 'order': 107, 'label': '暗影固定减伤', 'unit': 'flat', 'school': 'shadow', 'stat': 'flat_resist', 'display_mode': 'number'},
    '2333335804123005736': {'canonical': 'CanonicalWispBonus', 'order': 4, 'label': '生命 / 法力光球加成', 'unit': 'raw', 'school': 'universal', 'stat': None, 'display_mode': 'number'},
    '7997597043356400574': {'canonical': 'CanonicalAllPipConversion', 'order': 18, 'label': '魔豆转换评级', 'unit': 'rating', 'school': 'universal', 'stat': 'pip_conversion', 'display_mode': 'number'},
    '871469722291796233': {'canonical': 'CanonicalFirePipConversion', 'order': 54, 'label': '火焰魔豆转换评级', 'unit': 'rating', 'school': 'fire', 'stat': 'pip_conversion', 'display_mode': 'number'},
    '7386904160115854408': {'canonical': 'CanonicalIcePipConversion', 'order': 66, 'label': '冰霜魔豆转换评级', 'unit': 'rating', 'school': 'ice', 'stat': 'pip_conversion', 'display_mode': 'number'},
    '243692005498424446': {'canonical': 'CanonicalLifePipConversion', 'order': 78, 'label': '生命魔豆转换评级', 'unit': 'rating', 'school': 'life', 'stat': 'pip_conversion', 'display_mode': 'number'},
    '8482182373145732159': {'canonical': 'CanonicalDeathPipConversion', 'order': 42, 'label': '亡灵魔豆转换评级', 'unit': 'rating', 'school': 'death', 'stat': 'pip_conversion', 'display_mode': 'number'},
    '6026568610099277730': {'canonical': 'CanonicalMythPipConversion', 'order': 90, 'label': '神圣魔豆转换评级', 'unit': 'rating', 'school': 'myth', 'stat': 'pip_conversion', 'display_mode': 'number'},
    '7684239359783256384': {'canonical': 'CanonicalBalancePipConversion', 'order': 30, 'label': '平衡魔豆转换评级', 'unit': 'rating', 'school': 'balance', 'stat': 'pip_conversion', 'display_mode': 'number'},
    '6065329904430118857': {'canonical': 'CanonicalStormPipConversion', 'order': 102, 'label': '风暴魔豆转换评级', 'unit': 'rating', 'school': 'storm', 'stat': 'pip_conversion', 'display_mode': 'number'},
    '4152987833773801989': {'canonical': 'CanonicalShadowPipConversion', 'order': 114, 'label': '暗影魔豆转换评级', 'unit': 'rating', 'school': 'shadow', 'stat': 'pip_conversion', 'display_mode': 'number'},
    '8811156029932062589': {'canonical': 'CanonicalMoonReduceDamage', 'order': 128, 'label': '月亮抗性', 'unit': 'percent', 'school': 'moon', 'stat': 'resist', 'display_mode': 'number'},
    '7930153565277160705': {'canonical': 'CanonicalSunReduceDamage', 'order': 129, 'label': '太阳抗性', 'unit': 'percent', 'school': 'sun', 'stat': 'resist', 'display_mode': 'number'},
    '3885806032443980457': {'canonical': 'CanonicalStarReduceDamage', 'order': 130, 'label': '星辰抗性', 'unit': 'percent', 'school': 'star', 'stat': 'resist', 'display_mode': 'number'},
    '9008314395548218089': {'canonical': 'CanonicalShadowPipRating', 'order': 117, 'label': '暗影豆评级', 'unit': 'rating', 'school': 'universal', 'stat': 'shadow_pips', 'display_mode': 'number'},
    '8238137646312774092': {'canonical': 'CanonicalAllArchmastery', 'order': 133, 'label': '精通评级', 'unit': 'rating', 'school': 'universal', 'stat': 'archmastery', 'display_mode': 'number'},
}


class CombatDataError(ValueError):
    pass


def _id(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)) or not re.fullmatch(r"[0-9]{1,40}", str(value)):
        raise CombatDataError("战斗资料 ID 必须是完整非负十进制整数。")
    return str(int(value))


def _value(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or abs(value) > MAX_SAFE_INTEGER:
        raise CombatDataError("战斗属性包含无效或无法安全表示的数值。")
    return value


def _text(value):
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value or "")


def _columns(connection, table):
    allowed = {"item_stats", "mob_stats", "mob_items", "items", "mobs"}
    if table not in allowed:
        raise CombatDataError("不允许查询此战斗数据表。")
    return {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}


def read_entity_stats(connection, table, owner_column, identity, *, for_combat=False):
    """Return native records: hash/canonical/order/label/value/unit/school/stat.

    Regular Canonical records use all 135 upstream display mappings. Starting
    pips and speed are included; card/Maycast/passenger records belong to the
    caller's existing rich item fields, matching upstream raw-stat separation.
    """
    allowed = {"item_stats": "item", "mob_stats": "mob"}
    if allowed.get(table) != owner_column:
        raise CombatDataError("属性表与所属 ID 列不匹配。")
    required = {owner_column, "kind", "a", "b"}
    columns = _columns(connection, table)
    if not required <= columns:
        raise CombatDataError(f"{table} 缺少必要字段：{', '.join(sorted(required - columns))}。")
    ordering = ' ORDER BY "id"' if "id" in columns else ""
    cursor = connection.execute(f'SELECT kind, a, b FROM "{table}" WHERE "{owner_column}" = ?{ordering}', (_id(identity),))
    result = []

    def append(record):
        if len(result) >= MAX_STATS:
            raise CombatDataError("单个实体的原生属性超过 512 条，导出已停止。")
        if record.get("display_mode") == "text":
            # Upstream displays these descriptions regardless of their numeric
            # value. Keep the number for compatibility and expose the same
            # non-numeric presentation to the Chinese stat-row view.
            record["text"] = "有"
        if record.get("unit") == "exported_rating":
            record["label"] += "（导出评级）"
        if record.get("stat") in STAT_ICONS:
            record["icon"] = STAT_ICONS[record["stat"]]
        result.append(record)

    for kind, a, b in cursor:
        if kind == 1:
            hash_value = _id(a)
            definition = STAT_DEFINITIONS.get(hash_value)
            if definition:
                append({**definition, "hash": hash_value, "value": _value(b), "known": True})
            else:
                append({"hash": hash_value, "canonical": None, "order": 2000000, "label": "未知属性", "value": _value(b), "unit": "raw", "school": "universal", "stat": None, "display_mode": "number", "known": False})
        elif kind == 2:
            for value, order, label, stat in ((a, 1320, "起手普通豆", "pips"), (b, 1330, "起手超级豆", "power_pips")):
                if value != 0:
                    append({"hash": None, "canonical": "StartingPips", "order": order, "label": label, "value": _value(value), "unit": "count", "school": "universal", "stat": stat, "display_mode": "number", "known": True})
        elif kind == 5:
            # Item detail uses 1350; fetch_raw_item_stats used for mob merging
            # uses 1340. Preserve that upstream distinction explicitly.
            order = 1340 if for_combat or table == "mob_stats" else 1350
            append({"hash": None, "canonical": "SpeedBuff", "order": order, "label": "速度原始值", "value": _value(a), "unit": "raw", "school": "universal", "stat": "speed", "display_mode": "number", "known": True})
    # Stable sorting matches item detail/mob display. Equal orders keep their
    # original row order, which matters for upstream duplicate-record behavior.
    return sorted(result, key=lambda row: row["order"])


def aggregate_native_stats(base_stats, equipment_stats, object_name="", *, duplicate_mode="upstream"):
    if duplicate_mode not in ("upstream", "sum"):
        raise CombatDataError("重复属性策略必须是 upstream 或 sum。")
    warnings = []
    base = sorted((dict(row) for row in base_stats), key=lambda row: row["order"])
    groups = [[dict(row) for row in group] for group in equipment_stats]
    if len({row["order"] for row in base}) != len(base):
        warnings.append("本体存在同 order 重复记录；" + ("兼容上游首条写入/末条引用行为，结果不等于简单求和。" if duplicate_mode == "upstream" else "sum 模式合并求和，修复上游重复本体记录覆盖问题。"))
    if duplicate_mode == "sum":
        combined = {}
        for record in [*base, *(row for group in groups for row in group)]:
            if record["order"] in combined:
                combined[record["order"]]["value"] += record["value"]
            else:
                combined[record["order"]] = record
        merged = list(combined.values())
    else:
        merged = base
        latest = {record["order"]: record for record in merged}
        for group in groups:
            for record in group:
                existing = latest.get(record["order"])
                if existing is not None:
                    index = next(index for index, candidate in enumerate(merged) if candidate["order"] == existing["order"])
                    merged[index]["value"] = record["value"] + existing["value"]
                else:
                    merged.append(record)
                    latest[record["order"]] = record
    if len(merged) > MAX_STATS:
        raise CombatDataError("合并后的原生属性超过 512 条，导出已停止。")
    merged.sort(key=lambda row: row["order"])
    for row in merged:
        _value(row["value"])
    if any(row["order"] == 2000000 for row in merged):
        warnings.append("未知属性沿用上游共同 order=2000000；未知字段不能保证对应当前游戏完整资料。")
    if any(row.get("stat") == "resist" and row.get("unit") == "exported_rating" for row in merged):
        warnings.append("上游将 ReduceDamageRating 与 ReduceDamage 一并计入抗性；保留兼容语义，不宣称已验证官方评级换算。")
    polymorph = "polymorph" in _text(object_name).lower()
    display = [{**row, "value": int(row["value"] / 2) if polymorph else row["value"]} for row in merged]
    if polymorph:
        warnings.append("与上游一致：polymorph 怪物详情显示属性减半并向零截断；mob calc 使用未减半的本体加装备属性。")
    targets = {}
    for school in SCHOOLS:
        targets[school] = {
            "resist": sum(row["value"] for row in merged if row.get("school") in ("universal", school) and row.get("stat") == "resist"),
            "block": sum(row["value"] for row in merged if row.get("school") in ("universal", school) and row.get("stat") == "block"),
        }
        _value(targets[school]["resist"])
        _value(targets[school]["block"])
    return {"revision": REVISION, "stats_scope": "base_and_equipment", "duplicate_mode": duplicate_mode, "raw_stats": merged, "display_stats": display, "target_by_school": targets, "warnings": warnings}


def build_mob_combat(connection, mob_id, object_name, *, duplicate_mode="upstream", item_cache=None):
    """Read and merge the mob's native rows and every equipped item's rows.

    complete means the required tables/references were available for the fixed
    upstream algorithm. It does not certify current game-server completeness.
    Unknown Canonical records are retained and warned about, as upstream does.
    Pass one item_cache dict across mobs to avoid repeatedly reading shared gear.
    """
    mob_id = _id(mob_id)
    complete, warnings, equipment_ids, equipment_stats = True, [], [], []
    try:
        base_stats = read_entity_stats(connection, "mob_stats", "mob", mob_id, for_combat=True)
    except (CombatDataError, sqlite3.Error) as error:
        base_stats, complete = [], False
        warnings.append(f"未完整读取本体属性：{error}")
    required = {"mob", "item"}
    if not required <= _columns(connection, "mob_items"):
        complete = False
        warnings.append("缺少 mob_items 关联表或必要列，不能认定怪物没有装备。")
    else:
        columns = _columns(connection, "mob_items")
        ordering = ' ORDER BY "id"' if "id" in columns else ""
        for (item_id,) in connection.execute(f'SELECT item FROM mob_items WHERE mob = ?{ordering}', (mob_id,)):
            if len(equipment_ids) >= 512:
                raise CombatDataError("单个怪物装备关联超过 512 条。")
            equipment_ids.append(_id(item_id))
    if len(set(equipment_ids)) != len(equipment_ids):
        warnings.append("同一装备 ID 被关联多次；按上游逐次合并，不静默去重。")
    item_columns = _columns(connection, "items")
    cache = item_cache if item_cache is not None else {}
    for item_id in equipment_ids:
        if "id" not in item_columns or connection.execute("SELECT 1 FROM items WHERE id = ?", (item_id,)).fetchone() is None:
            complete = False
            warnings.append(f"装备 {item_id} 的物品记录缺失，结果标记不完整。")
        try:
            if item_id not in cache:
                cache[item_id] = read_entity_stats(connection, "item_stats", "item", item_id, for_combat=True)
            equipment_stats.append(cache[item_id])
        except (CombatDataError, sqlite3.Error) as error:
            complete = False
            warnings.append(f"未完整读取装备 {item_id} 属性：{error}")
    result = aggregate_native_stats(base_stats, equipment_stats, object_name, duplicate_mode=duplicate_mode)
    result["complete"] = complete
    result["equipment_ids"] = equipment_ids
    result["warnings"] = list(dict.fromkeys([*result["warnings"], *warnings]))
    return result
