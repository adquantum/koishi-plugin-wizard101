'use strict';

// SPDX-License-Identifier: GPL-3.0-only
// The Python oracle below embeds unmodified function/class/table source from
// MajorPain1/Kimerith-WindHammer revision 3c24847d111387fc0b34772b548f74e80089599f.
// Only Discord/database IO is replaced with deterministic synthetic fixtures.
// No downloaded database, Discord installation, upstream checkout or network
// access is required when these tests run.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  PROVENANCE, KimerithInputError, translateBuffs, criticalMultiplier,
  pveDamageCurve, calculateKimerithDamage, calculateKimerithMobDamage,
  aggregateMobStats, formatKimerithReport,
} = require('../lib/kimerith-math.cjs');

const PYTHON = process.env.WIZARD101_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const COMBAT_DIRECTORY = path.resolve(__dirname, '../tools/catalog');
const UPSTREAM_SOURCE_SHA256 = '74971d77d4261e4430e30c8649356e91669de8a1d97c5abdce0b673aea843254';
const UPSTREAM_SOURCE = String.raw`_SCHOOLS_STR = [
    "Fire",
    "Ice",
    "Storm",
    "Myth",
    "Life",
    "Death",
    "Balance",
    "Star",
    "Sun",
    "Moon",
    "Gardening",
    "Shadow",
    "Fishing",
    "Cantrips",
    "Castlemagic",
    "WhirlyBurly",
]

@dataclass
class StatObject:
    order: int
    value: int
    string: str

    def to_string(self) -> str:
        if self.string.startswith(("Allows", "Invul", "Gives", "Maycasts", "-")):
            return self.string
        elif self.value > 0:
            return f"+{self.value}{self.string}"
        else:
            return f"{self.value}{self.string}"

def _fnv_1a(data: bytes) -> int:
    state = 0xCBF2_9CE4_8422_2325
    for b in data:
        state ^= b
        state *= 0x0000_0100_0000_01B3
        state &= 0xFFFF_FFFF_FFFF_FFFF
    return state >> 1

_STAT_DISPLAY_TABLE = {
    _fnv_1a(b"CanonicalFireDamage"): f" {FIRE}{DAMAGE}",
    _fnv_1a(b"CanonicalIceDamage"): f" {ICE}{DAMAGE}",
    _fnv_1a(b"CanonicalStormDamage"): f" {STORM}{DAMAGE}",
    _fnv_1a(b"CanonicalMythDamage"): f" {MYTH}{DAMAGE}",
    _fnv_1a(b"CanonicalDeathDamage"): f" {DEATH}{DAMAGE}",
    _fnv_1a(b"CanonicalShadowDamage"): f" {SHADOW}{DAMAGE}",
    _fnv_1a(b"CanonicalAllDamage"): f" {DAMAGE}",
    _fnv_1a(b"CanonicalAllFishingLuck"): f"% {FISHING_LUCK}",
    _fnv_1a(b"CanonicalStormAccuracy"): f"% {STORM}{ACCURACY}",
    _fnv_1a(b"CanonicalFireAccuracy"): f"% {FIRE}{ACCURACY}",
    _fnv_1a(b"CanonicalIceAccuracy"): f"% {ICE}{ACCURACY}",
    _fnv_1a(b"CanonicalLifeAccuracy"): f"% {LIFE}{ACCURACY}",
    _fnv_1a(b"CanonicalDeathAccuracy"): f"% {DEATH}{ACCURACY}",
    _fnv_1a(b"CanonicalBalanceAccuracy"): f"% {BALANCE}{ACCURACY}",
    _fnv_1a(b"CanonicalMythAccuracy"): f"% {MYTH}{ACCURACY}",
    _fnv_1a(b"CanonicalShadowAccuracy"): f"% {SHADOW}{ACCURACY}",
    _fnv_1a(b"CanonicalAllAccuracy"): f"% {ACCURACY}",
    _fnv_1a(b"CanonicalStormArmorPiercing"): f" {STORM}{PIERCE}",
    _fnv_1a(b"CanonicalFireArmorPiercing"): f" {FIRE}{PIERCE}",
    _fnv_1a(b"CanonicalIceArmorPiercing"): f" {ICE}{PIERCE}",
    _fnv_1a(b"CanonicalLifeArmorPiercing"): f" {LIFE}{PIERCE}",
    _fnv_1a(b"CanonicalDeathArmorPiercing"): f" {DEATH}{PIERCE}",
    _fnv_1a(b"CanonicalBalanceArmorPiercing"): f" {BALANCE}{PIERCE}",
    _fnv_1a(b"CanonicalMythArmorPiercing"): f" {MYTH}{PIERCE}",
    _fnv_1a(b"CanonicalShadowArmorPiercing"): f" {SHADOW}{PIERCE}",
    _fnv_1a(b"CanonicalAllArmorPiercing"): f" {PIERCE}",
    _fnv_1a(b"CanonicalLifeHealing"): f"% {OUTGOING}{HEART}",
    _fnv_1a(b"CanonicalPowerPip"): f"% {POWER_PIP} Chance",
    _fnv_1a(b"CanonicalMaxMana"): f" Max {MANA}",
    _fnv_1a(b"CanonicalMaxHealth"): f" Max {HEALTH}",
    _fnv_1a(b"CanonicalFireFlatDamage"): f" {FIRE}{FLAT_DAMAGE}",
    _fnv_1a(b"CanonicalIceFlatDamage"): f" {ICE}{FLAT_DAMAGE}",
    _fnv_1a(b"CanonicalStormFlatDamage"): f" {STORM}{FLAT_DAMAGE}",
    _fnv_1a(b"CanonicalMythFlatDamage"): f" {MYTH}{FLAT_DAMAGE}",
    _fnv_1a(b"CanonicalDeathFlatDamage"): f" {DEATH}{FLAT_DAMAGE}",
    _fnv_1a(b"CanonicalShadowFlatDamage"): f" {SHADOW}{FLAT_DAMAGE}",
    _fnv_1a(b"CanonicalAllFlatDamage"): f" {FLAT_DAMAGE}",
    _fnv_1a(b"CanonicalFireReduceDamage"): f" {FIRE}{RESIST}",
    _fnv_1a(b"CanonicalIceReduceDamage"): f" {ICE}{RESIST}",
    _fnv_1a(b"CanonicalStormReduceDamage"): f" {STORM}{RESIST}",
    _fnv_1a(b"CanonicalMythReduceDamage"): f" {MYTH}{RESIST}",
    _fnv_1a(b"CanonicalDeathReduceDamage"): f" {DEATH}{RESIST}",
    _fnv_1a(b"CanonicalShadowReduceDamage"): f" {SHADOW}{RESIST}",
    _fnv_1a(b"CanonicalAllReduceDamage"): f" {RESIST}",
    _fnv_1a(b"CanonicalIncHealing"): f"% {INCOMING}{HEART}",
    _fnv_1a(b"CanonicalIncomingAccuracy"): f"% {ACCURACY}",
    _fnv_1a(b"CanonicalLifeReduceDamage"): f" {LIFE}{RESIST}",
    _fnv_1a(b"CanonicalBalanceReduceDamage"): f" {BALANCE}{RESIST}",
    _fnv_1a(b"CanonicalLifeDamage"): f" {LIFE}{DAMAGE}",
    _fnv_1a(b"CanonicalLifeFlatDamage"): f" {LIFE}{FLAT_DAMAGE}",
    _fnv_1a(b"CanonicalBalanceDamage"): f" {BALANCE}{DAMAGE}",
    _fnv_1a(b"CanonicalBalanceFishingLuck"): f"% {BALANCE}{FISHING_LUCK}",
    _fnv_1a(b"CanonicalDeathFishingLuck"): f"% {DEATH}{FISHING_LUCK}",
    _fnv_1a(b"CanonicalFireFishingLuck"): f"% {FIRE}{FISHING_LUCK}",
    _fnv_1a(b"CanonicalIceFishingLuck"): f"% {ICE}{FISHING_LUCK}",
    _fnv_1a(b"CanonicalLifeFishingLuck"): f"% {LIFE}{FISHING_LUCK}",
    _fnv_1a(b"CanonicaMythFishingLuck"): f"% {MYTH}{FISHING_LUCK}",
    _fnv_1a(b"CanonicaShadowFishingLuck"): f"% {SHADOW}{FISHING_LUCK}",
    _fnv_1a(b"CanonicaStormFishingLuck"): f"% {STORM}{FISHING_LUCK}",
    _fnv_1a(b"CanonicalBalanceFlatDamage"): f" {BALANCE}{FLAT_DAMAGE}",
    _fnv_1a(b"CanonicalMaxManaPercentReduce"): f"-100% Max {MANA}",
    _fnv_1a(b"XPPercent"): "XP",
    _fnv_1a(b"GoldPercent"): ":coin:",
    _fnv_1a(b"CanonicalMaxEnergy"): f" Max {ENERGY}",
    _fnv_1a(b"CanonicalAllCriticalHit"): f" {CRIT} Rating",
    _fnv_1a(b"CanonicalAllBlock"): f" {BLOCK} Rating",
    _fnv_1a(b"CanonicalAllPowerPipRating"): f"% {POWER_PIP} Chance",
    _fnv_1a(b"CanonicalAllReduceDamageRating"): f" {RESIST}",
    _fnv_1a(b"CanonicalAllAccuracyRating"): f" {ACCURACY}",
    _fnv_1a(b"CanonicalStormCriticalHit"): f" {STORM}{CRIT} Rating",
    _fnv_1a(b"CanonicalMythCriticalHit"): f" {MYTH}{CRIT} Rating",
    _fnv_1a(b"CanonicalLifeCriticalHit"): f" {LIFE}{CRIT} Rating",
    _fnv_1a(b"CanonicalIceCriticalHit"): f" {ICE}{CRIT} Rating",
    _fnv_1a(b"CanonicalFireCriticalHit"): f" {FIRE}{CRIT} Rating",
    _fnv_1a(b"CanonicalDeathCriticalHit"): f" {DEATH}{CRIT} Rating",
    _fnv_1a(b"CanonicalBalanceCriticalHit"): f" {BALANCE}{CRIT} Rating",
    _fnv_1a(b"CanonicalShadowCriticalHit"): f" {SHADOW}{CRIT} Rating",
    _fnv_1a(b"CanonicalBalanceBlock"): f" {BALANCE}{BLOCK} Rating",
    _fnv_1a(b"CanonicalDeathBlock"): f" {DEATH}{BLOCK} Rating",
    _fnv_1a(b"CanonicalFireBlock"): f" {FIRE}{BLOCK} Rating",
    _fnv_1a(b"CanonicalIceBlock"): f" {ICE}{BLOCK} Rating",
    _fnv_1a(b"CanonicalLifeBlock"): f" {LIFE}{BLOCK} Rating",
    _fnv_1a(b"CanonicalMythBlock"): f" {MYTH}{BLOCK} Rating",
    _fnv_1a(b"CanonicalStormBlock"): f" {STORM}{BLOCK} Rating",
    _fnv_1a(b"CanonicalShadowBlock"): f" {SHADOW}{BLOCK} Rating",
    _fnv_1a(b"CanonicalBalanceAccuracyRating"): f"% {BALANCE}{ACCURACY}",
    _fnv_1a(b"CanonicalDeathAccuracyRating"): f"% {DEATH}{ACCURACY}",
    _fnv_1a(b"CanonicalFireAccuracyRating"): f"% {FIRE}{ACCURACY}",
    _fnv_1a(b"CanonicalIceAccuracyRating"): f"% {ICE}{ACCURACY}",
    _fnv_1a(b"CanonicalLifeAccuracyRating"): f"% {LIFE}{ACCURACY}",
    _fnv_1a(b"CanonicalMythAccuracyRating"): f"% {MYTH}{ACCURACY}",
    _fnv_1a(b"CanonicalStormAccuracyRating"): f"% {STORM}{ACCURACY}",
    _fnv_1a(b"CanonicalShadowAccuracyRating"): f"% {SHADOW}{ACCURACY}",
    _fnv_1a(b"CanonicalBalanceReduceDamageRating"): f" {BALANCE}{RESIST}",
    _fnv_1a(b"CanonicalDeathReduceDamageRating"): f" {DEATH}{RESIST}",
    _fnv_1a(b"CanonicalFireReduceDamageRating"): f" {FIRE}{RESIST}",
    _fnv_1a(b"CanonicalIceReduceDamageRating"): f" {ICE}{RESIST}",
    _fnv_1a(b"CanonicalLifeReduceDamageRating"): f" {LIFE}{RESIST}",
    _fnv_1a(b"CanonicalMythReduceDamageRating"): f" {MYTH}{RESIST}",
    _fnv_1a(b"CanonicalStormReduceDamageRating"): f" {STORM}{RESIST}",
    _fnv_1a(b"CanonicalShadowReduceDamageRating"): f" {SHADOW}{RESIST}",
    _fnv_1a(b"CanonicalBalanceMastery"): f"Allows {POWER_PIP} with {BALANCE} spells",
    _fnv_1a(b"CanonicalDeathMastery"): f"Allows {POWER_PIP} with {DEATH} spells",
    _fnv_1a(b"CanonicalFireMastery"): f"Allows {POWER_PIP} with {FIRE} spells",
    _fnv_1a(b"CanonicalIceMastery"): f"Allows {POWER_PIP} with {ICE} spells",
    _fnv_1a(b"CanonicalLifeMastery"): f"Allows {POWER_PIP} with {LIFE} spells",
    _fnv_1a(b"CanonicalMythMastery"): f"Allows {POWER_PIP} with {MYTH} spells",
    _fnv_1a(b"CanonicalStormMastery"): f"Allows {POWER_PIP} with {STORM} spells",
    _fnv_1a(b"CanonicalStunResistance"): f"% {STUN_BLOCK}",
    _fnv_1a(b"ReduceDamageInvunerable"): f"Invulnerable to {DAMAGE}",
    _fnv_1a(b"CanonicalShadowPip"): f" {SHADOW_PIP_STAT}",
    _fnv_1a(b"CanonicalAllFlatReduceDamage"): f" {FLAT_RESIST}",
    _fnv_1a(b"CanonicalLifeFlatReduceDamage"): f" {LIFE}{FLAT_RESIST}",
    _fnv_1a(b"CanonicalDeathFlatReduceDamage"): f" {DEATH}{FLAT_RESIST}",
    _fnv_1a(b"CanonicalMythFlatReduceDamage"): f" {MYTH}{FLAT_RESIST}",
    _fnv_1a(b"CanonicalStormFlatReduceDamage"): f" {STORM}{FLAT_RESIST}",
    _fnv_1a(b"CanonicalIceFlatReduceDamage"): f" {ICE}{FLAT_RESIST}",
    _fnv_1a(b"CanonicalFireFlatReduceDamage"): f" {FIRE}{FLAT_RESIST}",
    _fnv_1a(b"CanonicalBalanceFlatReduceDamage"): f" {BALANCE}{FLAT_RESIST}",
    _fnv_1a(b"CanonicalShadowFlatReduceDamage"): f" {SHADOW}{FLAT_RESIST}",
    _fnv_1a(b"CanonicalWispBonus"): f" {HEALTH_WISP}{MANA_WISP}",
    _fnv_1a(b"CanonicalAllPipConversion"): f" {PIP_CONVERSION} Rating",
    _fnv_1a(b"CanonicalFirePipConversion"): f" {FIRE}{PIP_CONVERSION} Rating",
    _fnv_1a(b"CanonicalIcePipConversion"): f" {ICE}{PIP_CONVERSION} Rating",
    _fnv_1a(b"CanonicalLifePipConversion"): f" {LIFE}{PIP_CONVERSION} Rating",
    _fnv_1a(b"CanonicalDeathPipConversion"): f" {DEATH}{PIP_CONVERSION} Rating",
    _fnv_1a(b"CanonicalMythPipConversion"): f" {MYTH}{PIP_CONVERSION} Rating",
    _fnv_1a(b"CanonicalBalancePipConversion"): f" {BALANCE}{PIP_CONVERSION} Rating",
    _fnv_1a(b"CanonicalStormPipConversion"): f" {STORM}{PIP_CONVERSION} Rating",
    _fnv_1a(b"CanonicalShadowPipConversion"): f" {SHADOW}{PIP_CONVERSION} Rating",
    _fnv_1a(b"CanonicalMoonReduceDamage"): f" {MOON}{RESIST}",
    _fnv_1a(b"CanonicalSunReduceDamage"): f" {SUN}{RESIST}",
    _fnv_1a(b"CanonicalStarReduceDamage"): f" {STAR}{RESIST}",
    _fnv_1a(b"CanonicalShadowPipRating"): f" {SHADOW_PIP_STAT} Rating",
    _fnv_1a(b"CanonicalAllArchmastery"): f" {ARCHMASTERY} Rating",
}

_STAT_ORDER_TABLE = [
    # All
    _fnv_1a(b"CanonicalMaxHealth"),
    _fnv_1a(b"CanonicalMaxMana"),
    _fnv_1a(b"CanonicalMaxEnergy"),
    _fnv_1a(b"CanonicalAllFishingLuck"),
    _fnv_1a(b"CanonicalWispBonus"),
    _fnv_1a(b"CanonicalPowerPip"),
    _fnv_1a(b"XPPercent"),
    _fnv_1a(b"GoldPercent"),
    _fnv_1a(b"CanonicalAllPowerPipRating"),
    _fnv_1a(b"CanonicalAllFlatDamage"),
    _fnv_1a(b"CanonicalAllBlock"),
    _fnv_1a(b"CanonicalAllReduceDamage"),
    _fnv_1a(b"CanonicalAllReduceDamageRating"),
    _fnv_1a(b"CanonicalAllAccuracy"),
    _fnv_1a(b"CanonicalAllAccuracyRating"),
    _fnv_1a(b"CanonicalIncomingAccuracy"),
    _fnv_1a(b"CanonicalAllArmorPiercing"),
    _fnv_1a(b"CanonicalAllCriticalHit"),
    _fnv_1a(b"CanonicalAllPipConversion"),
    _fnv_1a(b"CanonicalAllFlatReduceDamage"),
    _fnv_1a(b"CanonicalAllDamage"),
    # Balance
    _fnv_1a(b"CanonicalBalanceReduceDamage"),
    _fnv_1a(b"CanonicalBalanceReduceDamageRating"),
    _fnv_1a(b"CanonicalBalanceFlatReduceDamage"),
    _fnv_1a(b"CanonicalBalanceAccuracy"),
    _fnv_1a(b"CanonicalBalanceAccuracyRating"),
    _fnv_1a(b"CanonicalBalanceArmorPiercing"),
    _fnv_1a(b"CanonicalBalanceFlatDamage"),
    _fnv_1a(b"CanonicalBalanceBlock"),
    _fnv_1a(b"CanonicalBalanceCriticalHit"),
    _fnv_1a(b"CanonicalBalancePipConversion"),
    _fnv_1a(b"CanonicalBalanceDamage"),
    _fnv_1a(b"CanonicalBalanceFishingLuck"),
    # Death
    _fnv_1a(b"CanonicalDeathReduceDamage"),
    _fnv_1a(b"CanonicalDeathReduceDamageRating"),
    _fnv_1a(b"CanonicalDeathFlatReduceDamage"),
    _fnv_1a(b"CanonicalDeathAccuracy"),
    _fnv_1a(b"CanonicalDeathAccuracyRating"),
    _fnv_1a(b"CanonicalDeathArmorPiercing"),
    _fnv_1a(b"CanonicalDeathFlatDamage"),
    _fnv_1a(b"CanonicalDeathBlock"),
    _fnv_1a(b"CanonicalDeathCriticalHit"),
    _fnv_1a(b"CanonicalDeathPipConversion"),
    _fnv_1a(b"CanonicalDeathDamage"),
    _fnv_1a(b"CanonicalDeathFishingLuck"),
    # Fire
    _fnv_1a(b"CanonicalFireReduceDamage"),                                  #1 Resist
    _fnv_1a(b"CanonicalFireReduceDamageRating"),                            #2 Resist
    _fnv_1a(b"CanonicalFireFlatReduceDamage"),                              #3 Flat Resist
    _fnv_1a(b"CanonicalFireAccuracy"),                                      #4 Acc
    _fnv_1a(b"CanonicalFireAccuracyRating"),                                #5 Acc
    _fnv_1a(b"CanonicalFireArmorPiercing"),                                 #6 Pierce
    _fnv_1a(b"CanonicalFireFlatDamage"),                                    #7 Flat Dmg
    _fnv_1a(b"CanonicalFireBlock"),                                         #8 Block
    _fnv_1a(b"CanonicalFireCriticalHit"),                                   #9 Crit
    _fnv_1a(b"CanonicalFirePipConversion"),                                 #10 Pserve
    _fnv_1a(b"CanonicalFireDamage"),                                        #11 Dmg
    _fnv_1a(b"CanonicalFireFishingLuck"),                                   #12 Fishing luck
    # Ice
    _fnv_1a(b"CanonicalIceReduceDamage"),
    _fnv_1a(b"CanonicalIceReduceDamageRating"),
    _fnv_1a(b"CanonicalIceFlatReduceDamage"),
    _fnv_1a(b"CanonicalIceAccuracy"),
    _fnv_1a(b"CanonicalIceAccuracyRating"),
    _fnv_1a(b"CanonicalIceArmorPiercing"),
    _fnv_1a(b"CanonicalIceFlatDamage"),
    _fnv_1a(b"CanonicalIceBlock"),
    _fnv_1a(b"CanonicalIceCriticalHit"),
    _fnv_1a(b"CanonicalIcePipConversion"),
    _fnv_1a(b"CanonicalIceDamage"),
    _fnv_1a(b"CanonicalIceFishingLuck"),
    # Life
    _fnv_1a(b"CanonicalLifeReduceDamage"),
    _fnv_1a(b"CanonicalLifeReduceDamageRating"),
    _fnv_1a(b"CanonicalLifeFlatReduceDamage"),
    _fnv_1a(b"CanonicalLifeAccuracy"),
    _fnv_1a(b"CanonicalLifeAccuracyRating"),
    _fnv_1a(b"CanonicalLifeArmorPiercing"),
    _fnv_1a(b"CanonicalLifeFlatDamage"),
    _fnv_1a(b"CanonicalLifeBlock"),
    _fnv_1a(b"CanonicalLifeCriticalHit"),
    _fnv_1a(b"CanonicalLifePipConversion"),
    _fnv_1a(b"CanonicalLifeDamage"),
    _fnv_1a(b"CanonicalLifeFishingLuck"),
    # Myth
    _fnv_1a(b"CanonicalMythReduceDamage"),
    _fnv_1a(b"CanonicalMythReduceDamageRating"),
    _fnv_1a(b"CanonicalMythFlatReduceDamage"),
    _fnv_1a(b"CanonicalMythAccuracy"),
    _fnv_1a(b"CanonicalMythAccuracyRating"),
    _fnv_1a(b"CanonicalMythArmorPiercing"),
    _fnv_1a(b"CanonicalMythFlatDamage"),
    _fnv_1a(b"CanonicalMythBlock"),
    _fnv_1a(b"CanonicalMythCriticalHit"),
    _fnv_1a(b"CanonicalMythPipConversion"),
    _fnv_1a(b"CanonicalMythDamage"),
    _fnv_1a(b"CanonicaMythFishingLuck"),
    # Storm
    _fnv_1a(b"CanonicalStormReduceDamage"),
    _fnv_1a(b"CanonicalStormReduceDamageRating"),
    _fnv_1a(b"CanonicalStormFlatReduceDamage"),
    _fnv_1a(b"CanonicalStormAccuracy"),
    _fnv_1a(b"CanonicalStormAccuracyRating"),
    _fnv_1a(b"CanonicalStormArmorPiercing"),
    _fnv_1a(b"CanonicalStormFlatDamage"),
    _fnv_1a(b"CanonicalStormBlock"),
    _fnv_1a(b"CanonicalStormCriticalHit"),
    _fnv_1a(b"CanonicalStormPipConversion"),
    _fnv_1a(b"CanonicalStormDamage"),
    _fnv_1a(b"CanonicaStormFishingLuck"),
    # Shadow
    _fnv_1a(b"CanonicalShadowReduceDamage"),
    _fnv_1a(b"CanonicalShadowReduceDamageRating"),
    _fnv_1a(b"CanonicalShadowFlatReduceDamage"),
    _fnv_1a(b"CanonicalShadowAccuracy"),
    _fnv_1a(b"CanonicalShadowAccuracyRating"),
    _fnv_1a(b"CanonicalShadowArmorPiercing"),
    _fnv_1a(b"CanonicalShadowFlatDamage"),
    _fnv_1a(b"CanonicalShadowBlock"),
    _fnv_1a(b"CanonicalShadowCriticalHit"),
    _fnv_1a(b"CanonicalShadowPipConversion"),
    _fnv_1a(b"CanonicalShadowDamage"),
    _fnv_1a(b"CanonicaShadowFishingLuck"),
    _fnv_1a(b"CanonicalShadowPipRating"),
    _fnv_1a(b"CanonicalShadowPip"),
    # Inc and Out
    _fnv_1a(b"CanonicalIncHealing"),
    _fnv_1a(b"CanonicalLifeHealing"),
    # Masteries
    _fnv_1a(b"CanonicalBalanceMastery"),
    _fnv_1a(b"CanonicalDeathMastery"),
    _fnv_1a(b"CanonicalFireMastery"),
    _fnv_1a(b"CanonicalIceMastery"),
    _fnv_1a(b"CanonicalLifeMastery"),
    _fnv_1a(b"CanonicalMythMastery"),
    _fnv_1a(b"CanonicalStormMastery"),
    # Bottom stuff
    _fnv_1a(b"CanonicalMoonReduceDamage"),
    _fnv_1a(b"CanonicalSunReduceDamage"),
    _fnv_1a(b"CanonicalStarReduceDamage"),
    _fnv_1a(b"CanonicalStunResistance"),
    _fnv_1a(b"ReduceDamageInvunerable"),
    _fnv_1a(b"CanonicalAllArchmastery"),
    _fnv_1a(b"CanonicalMaxManaPercentReduce"),
]

def translate_stat(stat: int) -> Tuple[int, str, bool]:
    try:
        display_stat = _STAT_DISPLAY_TABLE[stat]
        order_number = _STAT_ORDER_TABLE.index(stat)
    except KeyError:
        display_stat = " Unknown Stat"
        order_number = 2000000

    return order_number, display_stat

def getStatIndexFromList(statlist: List[StatObject], statorder: int) -> int:
    for i, stat in enumerate(statlist):
        if stat.order == statorder:
            return i

    return -1

async def sum_stats(db, existing_stats: List[StatObject], equipped_items: List[int]):
    existing_stats_dict = {stat.order: stat for stat in existing_stats}

    for item_id in equipped_items:
        for stat in await fetch_raw_item_stats(db, item_id):
            existing_stat = existing_stats_dict.get(stat.order)

            if existing_stat is not None:
                index = getStatIndexFromList(existing_stats, existing_stat.order)
                existing_stats[index].value = stat.value + existing_stat.value
            else:
                existing_stats.append(stat)
                existing_stats_dict[stat.order] = stat

class Buff:
    def __init__(self, value, is_pierce):
        self.value = value
        self.modifier = (float(value) / 100) + 1
        self.is_pierce = is_pierce

    def __repr__(self) -> str:
        return f"{self.value=} {self.modifier=} {self.is_pierce=}"

def translate_buffs(buffs: str):
    buffs = buffs.replace("%", "")
    if buffs == "": return []

    buff_list = buffs.split(" ")
    buffs_as_modifier = []
    for buff in buff_list:
        try:
            if buff[-1] == "P":
                pierce_buff = buff.removesuffix("P")
                buff_float = float(pierce_buff)
                buffs_as_modifier.append(Buff(buff_float, True))
            else:
                buff_float = float(buff)
                buffs_as_modifier.append(Buff(buff_float, False))

        except ValueError:
            pass

    return buffs_as_modifier

def crit_multiplier(crit, block, pvp=True):
    if crit == 0: return 1
    if block == 0: return 2
    if pvp: return 2 - ((5*block) / (crit + (5*block)))
    return 2 - ((3*block) / (crit + (3*block)))

def pve_damage_curve(damage: int):
    float_dmg = float(damage) / 100

    l = 2.47 # Limit
    k0 = 237 # Start of curve
    n0 = 0 # Basically depricated
    l100 = l * 100
    k0n0 = k0 + n0
    k = math.log(l100 / (l100 - k0)) / k0
    n = math.log(1 - (k0n0 / l100)) + (k * k0n0)

    if float_dmg > (k0n0 / 100):
        return 1 + (l - (l * math.exp((-100 * k * float_dmg) + n)))

    return 1 + float_dmg

def calc_damage(base, damage: int, pierce: int, critical: int, buffs: List[Buff], mob_block: int, pvp: bool):
    ret = int(base * (1+(float(damage) / 100)))

    if buffs != []:
        for buff in buffs:
            if buff.is_pierce:
                if pierce >= -buff.value:
                    pierce += buff.value

                else:
                    new_buff_modifier = (pierce / 100) + buff.modifier
                    pierce = 0
                    ret = int(ret * new_buff_modifier)

            else:
                ret = int(ret * buff.modifier)

    return ret, int(ret * crit_multiplier(critical, mob_block, pvp))

class UpstreamMobs:
    async def build_mob_embed(self, row) -> discord.Embed:
        mob_id = row[0]
        real_name: str = row[2].decode("utf-8")
        image_file = row[3].decode("utf-8")
        title = row[4]
        rank = row[5]
        hp = row[6]
        school = row[7]
        secondary_school = row[8]
        stunnable = row[9]
        max_shadow = row[10]
        has_cheats = row[11]
        intelligence = row[12]
        selfishness = row[13]
        aggressiveness = row[14]
        monstro = database.MonstrologyKind(row[15])
        mob_name = row[17]

        ai = [f"Intelligence {intelligence}", f"Selfishness {selfishness}", f"Aggressiveness {aggressiveness}"]

        stats = await self.fetch_mob_stats(mob_id)
        items = await self.fetch_mob_items(mob_id)
        await database.sum_stats(self.bot.db, stats, items)

        stats = sorted(stats, key=lambda stat: stat.order)
        _return_stats = []
        for stat in stats:
            if "polymorph" in real_name.lower():
                stat.value = int(stat.value / 2)
            _return_stats.append(stat.to_string())

        stats = _return_stats

        flags = []
        if secondary_school:
            flags.append(f"Secondary School {database.translate_school(secondary_school)}")
        if bool(has_cheats):
            flags.append(f"This {title} Mob Cheats!")
        if max_shadow > 0:
            stats.append(f"Max {max_shadow} {emojis.SHADOW_PIP}")
        if not stunnable:
            flags.append(f"Stunnable and Beguilable")

        extracts = database.get_monstrology_string(monstro)

        embed = (
            discord.Embed(
                color=database.make_school_color(school),
                description="\n".join(stats) or "\u200b",
            )
            .set_author(name=f"{mob_name}\n({real_name}: {mob_id})\nHP {hp}\nRank {rank} {title}", icon_url=database.translate_school(school).url)
            .add_field(name="AI", value="\n".join(ai))
        )

        if flags:
            embed.add_field(name="Flags", value="\n".join(flags))

        if extracts:
            embed.add_field(name="Extracts", value="\n".join(extracts))

        discord_file = None
        if image_file:
            try:
                image_name = (image_file.split("|")[-1]).split(".")[0]
                png_file = f"{image_name}.png"
                png_name = png_file.replace(" ", "")
                png_name = os.path.basename(png_name)
                file_path = Path("PNG_Images") / png_name
                discord_file = discord.File(file_path, filename=png_name)
                embed.set_thumbnail(url=f"attachment://{png_name}")
            except:
                pass

        return embed, discord_file

    async def build_calc_embed(self, row, school, base, damage, pierce, critical, buffs, pvp):
        mob_id = row[0]
        real_name: str = row[2].decode("utf-8")
        image_file = row[3].decode("utf-8")
        hp = row[6]
        mob_school = row[7]
        mob_name = row[17]

        school_int = database._SCHOOLS_STR.index(school) + 2
        school_emoji = database.translate_school(school_int)

        buffs_as_modifiers = database.translate_buffs(buffs)

        stats = await self.fetch_mob_stats(mob_id)
        items = await self.fetch_mob_items(mob_id)
        await database.sum_stats(self.bot.db, stats, items)

        mob_buffs = []
        mob_block = 0
        for stat in stats:
            if stat.string == f" {school_emoji}{database.RESIST}" or stat.string == f" {database.RESIST}":
                mob_buffs.append(stat.value)

            elif stat.string == f" {school_emoji}{database.BLOCK} Rating" or stat.string == f" {database.BLOCK} Rating":
                mob_block += stat.value

        mob_buff = sum(mob_buffs)
        if mob_buff < 0:
            buffs_as_modifiers.append(database.Buff(float(-mob_buff), False))
        elif mob_buff > 0:
            buffs_as_modifiers.append(database.Buff(float(-mob_buff), True))

        no_crit, crit = database.calc_damage(base, damage, pierce, critical, buffs_as_modifiers, mob_block, pvp)
        embed = (
            discord.Embed(
                color=database.make_school_color(mob_school),
                description=f"{base}{database.DAMAGE} Base\n\nStats:\n{damage}% {school_emoji}{database.DAMAGE}\n{pierce}% {school_emoji}{database.PIERCE}\n{critical} {school_emoji}{database.CRIT}\n{mob_buff}% {school_emoji}{database.RESIST}\n{mob_block} {school_emoji}{database.BLOCK}\n\nBuffs: {buffs}"
            )
            .set_author(name=f"Damage Calc on {mob_name}\n({real_name}: {mob_id})\nHP {hp}", icon_url=database.translate_school(mob_school).url)
            .add_field(name="No Crit Damage", value=f"{no_crit:,}{database.DAMAGE}")
            .add_field(name="Crit Damage", value=f"{crit:,}{database.DAMAGE}")
        )

        discord_file = None
        if image_file:
            try:
                image_name = (image_file.split("|")[-1]).split(".")[0]
                png_file = f"{image_name}.png"
                png_name = png_file.replace(" ", "")
                png_name = os.path.basename(png_name)
                file_path = Path("PNG_Images") / png_name
                discord_file = discord.File(file_path, filename=png_name)
                embed.set_thumbnail(url=f"attachment://{png_name}")
            except:
                pass

        return embed, discord_file
`;
const ORACLE_PREFIX = String.raw`
import asyncio, json, math, sys
from dataclasses import dataclass
from typing import List, Tuple
from types import SimpleNamespace

class FakeEmbed:
    def __init__(self, **kwargs):
        self.description = kwargs.get("description", "")
        self.fields = []
    def set_author(self, **kwargs):
        self.author = kwargs
        return self
    def add_field(self, **kwargs):
        self.fields.append(kwargs)
        return self

class SchoolEmoji(str):
    @property
    def url(self):
        return "https://example.invalid/synthetic.png"

discord = SimpleNamespace(Embed=FakeEmbed)
emojis = SimpleNamespace(SHADOW_PIP="[SHADOW_PIP]")
ACCURACY = '[ACCURACY]'
ARCHMASTERY = '[ARCHMASTERY]'
BALANCE = '[BALANCE]'
BLOCK = '[BLOCK]'
CRIT = '[CRIT]'
DAMAGE = '[DAMAGE]'
DEATH = '[DEATH]'
ENERGY = '[ENERGY]'
FIRE = '[FIRE]'
FISHING_LUCK = '[FISHING_LUCK]'
FLAT_DAMAGE = '[FLAT_DAMAGE]'
FLAT_RESIST = '[FLAT_RESIST]'
HEALTH = '[HEALTH]'
HEALTH_WISP = '[HEALTH_WISP]'
HEART = '[HEART]'
ICE = '[ICE]'
INCOMING = '[INCOMING]'
LIFE = '[LIFE]'
MANA = '[MANA]'
MANA_WISP = '[MANA_WISP]'
MOON = '[MOON]'
MYTH = '[MYTH]'
OUTGOING = '[OUTGOING]'
PIERCE = '[PIERCE]'
PIP_CONVERSION = '[PIP_CONVERSION]'
POWER_PIP = '[POWER_PIP]'
RESIST = '[RESIST]'
SHADOW = '[SHADOW]'
SHADOW_PIP_STAT = '[SHADOW_PIP_STAT]'
STAR = '[STAR]'
STORM = '[STORM]'
STUN_BLOCK = '[STUN_BLOCK]'
SUN = '[SUN]'
`;
const ORACLE_SUFFIX = String.raw`

def translate_school(value):
    return SchoolEmoji("[" + _SCHOOLS_STR[value - 2].upper() + "]")

def make_stat(row):
    if "string" in row:
        label = row["string"]
    else:
        school = "" if row.get("school") == "universal" else "[" + row["school"].upper() + "]"
        suffix = {"resist": "[RESIST]", "block": "[BLOCK] Rating"}.get(row.get("stat"), "[DAMAGE]")
        label = " " + school + suffix
    return StatObject(row["order"], row["value"], label)

async def fetch_raw_item_stats(db, item_id):
    return [make_stat(row) for row in db[item_id]]

database = SimpleNamespace(
    _SCHOOLS_STR=_SCHOOLS_STR, translate_school=translate_school,
    translate_buffs=translate_buffs, Buff=Buff, sum_stats=sum_stats,
    calc_damage=calc_damage, make_school_color=lambda school: 0,
    MonstrologyKind=lambda value: value, get_monstrology_string=lambda value: [],
    RESIST="[RESIST]", BLOCK="[BLOCK]", DAMAGE="[DAMAGE]",
    PIERCE="[PIERCE]", CRIT="[CRIT]",
)

class FixtureMobs(UpstreamMobs):
    def __init__(self, case):
        self.case = case
        self.bot = SimpleNamespace(db=dict(enumerate(case.get("equippedItems", []))))
    async def fetch_mob_stats(self, mob_id):
        self.last_stats = sorted([make_stat(row) for row in self.case.get("baseStats", [])], key=lambda stat: stat.order)
        return self.last_stats
    async def fetch_mob_items(self, mob_id):
        return list(self.bot.db)

def export_stats(stats):
    return [{"order": stat.order, "value": stat.value} for stat in stats]

async def evaluate(case):
    mode = case.get("mode", "calc")
    if mode == "translate":
        try:
            return [{"value": buff.value, "modifier": buff.modifier, "isPierce": buff.is_pierce} for buff in translate_buffs(case["buffs"])]
        except (ValueError, IndexError) as error:
            return {"error": type(error).__name__}
    if mode == "definitions":
        return [{"hash": str(key), "order": translate_stat(key)[0], "string": translate_stat(key)[1]} for key in _STAT_DISPLAY_TABLE]
    if mode == "curve":
        return pve_damage_curve(case["damage"])
    if mode == "aggregate":
        stats = sorted([make_stat(row) for row in case["baseStats"]], key=lambda stat: stat.order)
        equipment = dict(enumerate(case["equippedItems"]))
        await sum_stats(equipment, stats, list(equipment))
        return export_stats(sorted(stats, key=lambda stat: stat.order))
    if mode == "mob":
        mob = FixtureMobs(case)
        row = [9007199254740995, 0, case.get("objectName", "SyntheticBoss").encode(), b"", "Boss", 20, 8000, 2, 0, 1, 0, 0, 5, 6, 7, 0, 0, "Synthetic Boss"]
        embed, _ = await mob.build_calc_embed(row, case.get("school", "fire").title(), case["base"], case.get("damage", 0), case.get("pierce", 0), case.get("critical", 0), case.get("buffs", ""), case.get("pvp", True))
        values = [int(field["value"].replace(",", "").replace("[DAMAGE]", "")) for field in embed.fields]
        raw_stats = export_stats(mob.last_stats)
        display, _ = await mob.build_mob_embed(row)
        return {"normal": values[0], "critical": values[1], "raw_stats": raw_stats, "display_stats": export_stats(mob.last_stats), "description": display.description}
    buffs = translate_buffs(case.get("buffs", ""))
    buffs.append(Buff(float(-case.get("resist", 0)), True))
    normal, critical = calc_damage(case["base"], case.get("damage", 0), case.get("pierce", 0), case.get("critical", 0), buffs, case.get("block", 0), case.get("pvp", True))
    return {"normal": normal, "critical": critical, "multiplier": crit_multiplier(case.get("critical", 0), case.get("block", 0), case.get("pvp", True))}

async def main():
    print(json.dumps([await evaluate(case) for case in json.load(sys.stdin)]))

asyncio.run(main())
`;

function python(source, input, args = []) {
  const result = spawnSync(PYTHON, ['-B', '-c', source, ...args], {
    input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, `Python 3 is required for upstream cross-language tests: ${result.error?.message}`);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function oracle(cases) { return python(ORACLE_PREFIX + UPSTREAM_SOURCE + ORACLE_SUFFIX, cases); }
function minimal(rows) { return rows.map(({ order, value }) => ({ order, value })); }
function stat(order, value, school, metric, unit = metric === 'block' ? 'rating' : 'percent') {
  return { order, value, school, stat: metric, unit, label: metric };
}

const BASE_STATS = [stat(11, 20, 'universal', 'resist'), stat(45, 10, 'fire', 'resist'), stat(10, 100, 'universal', 'block'), stat(52, 50, 'fire', 'block')];
const EQUIPMENT = [[stat(11, 5, 'universal', 'resist'), stat(45, 7, 'fire', 'resist'), stat(10, 25, 'universal', 'block'), stat(64, 60, 'ice', 'block')]];

test('pinned upstream Python oracle source has its recorded digest', () => {
  assert.equal(crypto.createHash('sha256').update(UPSTREAM_SOURCE).digest('hex'), UPSTREAM_SOURCE_SHA256);
  assert.equal(PROVENANCE.revision, '3c24847d111387fc0b34772b548f74e80089599f');
});

test('damage, ordered P buffs, PvP/PvE critical and truncation match original Python', () => {
  const cases = [
    { base: 1000 },
    { base: 983, damage: 130, pierce: 15, critical: 400, resist: 45, block: 300, buffs: '35 35 40 20P -50P' },
    { base: 983, damage: 130, pierce: 15, critical: 400, resist: 45, block: 300, buffs: '35 35 40 20P -50P', pvp: false },
    { base: 555, damage: 25, pierce: 12, critical: 500, resist: 20, block: 0, buffs: '-25 40 -70P 20P -10P' },
    { base: 333, damage: 0, pierce: 75, critical: 1000, resist: 30, block: 200, buffs: '-50P -25P 40' },
    { base: 333, damage: 0, pierce: 76, critical: 1000, resist: 0, block: 200, buffs: '-50P -25P 40' },
    { base: 121, damage: 13, pierce: 10, critical: 0, resist: 0, block: 300, buffs: '.5 12.7 -25.3P 1e1P -2.5' },
    { base: 1000, damage: 250, pierce: 0, critical: 300, resist: 0, block: 200, buffs: '', pvp: false },
    { base: 999, damage: 80, pierce: 0, critical: 0, resist: -30, block: 10, buffs: '40' },
    { base: 10, damage: 0, pierce: 0, critical: 0, resist: 150, block: 0, buffs: '' },
    { base: 3, damage: -150, pierce: -10, critical: 0, resist: 0, block: 0, buffs: '25' },
    { base: 120, damage: 5, pierce: 2, critical: -100, resist: 5, block: 200, buffs: '1_0.5 ignored 20p 12%%' },
    { base: 0, damage: 10000, pierce: 10000, critical: 1000000000, resist: 10000, block: 1000000000 },
  ];
  const expected = oracle(cases);
  for (const [index, entry] of cases.entries()) {
    const actual = calculateKimerithDamage(entry);
    assert.equal(actual.normal, expected[index].normal, JSON.stringify(entry));
    assert.equal(actual.critical, expected[index].critical, JSON.stringify(entry));
    assert.equal(actual.multiplier, expected[index].multiplier, JSON.stringify(entry));
  }
});

test('buff token parsing follows original float rules and explains the safe whitespace fix', () => {
  const values = ['', '35 -20 20P -50P', '.5 +5. 1_0.5 1e2 -2.5e-1P', '30% 10%% 25p nope P', '\t35\t 5P\t'];
  const expected = oracle(values.map(buffs => ({ mode: 'translate', buffs })));
  values.forEach((buffs, index) => assert.deepEqual(translateBuffs(buffs).buffs, expected[index]));
  const broken = oracle([{ mode: 'translate', buffs: ' 35  40 ' }])[0];
  assert.equal(broken.error, 'IndexError');
  const fixed = translateBuffs(' 35  40 ');
  assert.deepEqual(fixed.buffs.map(row => row.value), [35, 40]);
  assert.match(fixed.warnings.join(' '), /修复上游/);
  assert.deepEqual(translateBuffs('20p invalid').ignoredTokens, ['20p', 'invalid']);
});

test('the original PvE curve is available but is never implicitly applied by calc', () => {
  const damageValues = [0, 100, 237, 238, 250, 500];
  const expected = oracle(damageValues.map(damage => ({ mode: 'curve', damage })));
  damageValues.forEach((damage, index) => assert.ok(Math.abs(pveDamageCurve(damage) - expected[index]) < 1e-12));
  const result = calculateKimerithDamage({ base: 1000, damage: 250, pvp: false });
  assert.equal(result.normal, 3500);
  assert.notEqual(result.normal, Math.trunc(1000 * pveDamageCurve(250)));
  assert.match(result.warnings.join(' '), /没有自动调用/);
  assert.equal(criticalMultiplier(0, 800, true), 1);
  assert.equal(criticalMultiplier(500, 0, false), 2);
  assert.ok(criticalMultiplier(500, 100, false) > criticalMultiplier(500, 100, true));
});

test('native mob merging and actual build_calc_embed/build_mob_embed agree across languages', () => {
  const cases = [
    { mode: 'mob', base: 1250, damage: 125, pierce: 30, critical: 500, buffs: '35 40 20P -50P', pvp: false, school: 'fire', baseStats: BASE_STATS, equippedItems: EQUIPMENT },
    { mode: 'mob', base: 1250, damage: 125, pierce: 30, critical: 500, buffs: '35 40 20P -50P', pvp: true, school: 'ice', baseStats: BASE_STATS, equippedItems: EQUIPMENT },
    { mode: 'mob', base: 999, damage: 80, pierce: 0, critical: 0, school: 'fire', baseStats: [stat(11, -30, 'universal', 'resist')], equippedItems: [] },
    { mode: 'mob', base: 1000, damage: 80, pierce: 15, critical: 500, school: 'shadow', objectName: 'Ice_POLYMORPH', baseStats: BASE_STATS, equippedItems: EQUIPMENT },
    { mode: 'mob', base: 1000, damage: 80, pierce: 0, critical: 500, school: 'fire', baseStats: [...BASE_STATS, stat(46, 3, 'fire', 'resist', 'exported_rating')], equippedItems: EQUIPMENT },
  ];
  const expected = oracle(cases);
  for (const [index, entry] of cases.entries()) {
    const mobCombat = aggregateMobStats(entry);
    const { base, damage, pierce, critical, buffs, pvp, school } = entry;
    const actual = calculateKimerithMobDamage({ base, damage, pierce, critical, buffs, pvp, school, mobCombat });
    assert.equal(actual.normal, expected[index].normal);
    assert.equal(actual.critical, expected[index].critical);
    assert.deepEqual(minimal(mobCombat.raw_stats), [...expected[index].raw_stats].sort((a, b) => a.order - b.order));
    assert.deepEqual(minimal(mobCombat.display_stats), expected[index].display_stats);
  }
  const mobCombat = aggregateMobStats({ baseStats: BASE_STATS, equippedItems: EQUIPMENT });
  assert.deepEqual(mobCombat.target_by_school.fire, { resist: 42, block: 175 });
  assert.deepEqual(mobCombat.target_by_school.ice, { resist: 25, block: 185 });
  assert.equal(calculateKimerithDamage({ base: 1000, resist: -30 }).normal, 1000);
  const negative = aggregateMobStats({ baseStats: [stat(11, -30, 'universal', 'resist')] });
  assert.equal(calculateKimerithMobDamage({ base: 1000, school: 'fire', mobCombat: negative }).normal, 1300);
});

test('duplicate base-order aliasing is compatible by default and explicit sum mode repairs it', () => {
  const baseStats = [stat(11, 20, 'universal', 'resist'), stat(11, 5, 'universal', 'resist')];
  const equippedItems = [[stat(11, 10, 'universal', 'resist')], [stat(11, 7, 'universal', 'resist')]];
  const before = JSON.stringify({ baseStats, equippedItems });
  const expected = oracle([{ mode: 'aggregate', baseStats, equippedItems }])[0];
  const actual = aggregateMobStats({ baseStats, equippedItems });
  assert.deepEqual(minimal(actual.raw_stats), expected);
  assert.deepEqual(actual.raw_stats.map(row => row.value), [12, 5]);
  assert.equal(actual.target_by_school.fire.resist, 17);
  assert.match(actual.warnings.join(' '), /首条写入\/末条引用/);
  const repaired = aggregateMobStats({ baseStats, equippedItems, duplicateMode: 'sum' });
  assert.equal(repaired.target_by_school.fire.resist, 42);
  assert.equal(JSON.stringify({ baseStats, equippedItems }), before, 'aggregation must not mutate caller data');
});

test('validation rejects nonfinite, unsafe, malformed and mixed-mode inputs in Chinese', () => {
  const invalid = [
    {}, { base: NaN }, { base: Infinity }, { base: -1 }, { base: 1.5 },
    { base: 1000000001 }, { base: 1, damage: 10001 }, { base: 1, resist: -10001 },
    { base: 1, critical: 500.5 }, { base: 1, pvp: 'false' },
    { base: 1, damagePercent: 100 }, { base: 1, criticalMultiplier: 2 },
    { base: 1, critical: -500, block: 100 },
    { base: 1, buffs: 'NaN' }, { base: 1, buffs: '-infP' }, { base: 1, buffs: '1e999' },
    { base: 1, buffs: '10001' }, { base: 1, buffs: '1 '.repeat(129) },
    { base: 1, buffs: '1'.repeat(2049) }, { base: 1000000000, damage: 10000, buffs: '10000 10000 10000' },
  ];
  for (const input of invalid) assert.throws(() => calculateKimerithDamage(input), error => error instanceof KimerithInputError && /[\u3400-\u9fff]/u.test(error.message));
  const combat = aggregateMobStats();
  for (const mobCombat of [{}, { ...combat, complete: false }, { ...combat, stats_scope: 'base_only' }, { ...combat, revision: 'old' }]) {
    assert.throws(() => calculateKimerithMobDamage({ base: 100, school: 'fire', mobCombat }), KimerithInputError);
  }
  assert.throws(() => calculateKimerithMobDamage({ base: 100, school: 'invalid', mobCombat: combat }), KimerithInputError);
  assert.throws(() => aggregateMobStats({ baseStats: [stat(1, NaN, 'fire', 'resist')] }), KimerithInputError);
  assert.throws(() => aggregateMobStats({ baseStats: Array(513).fill(stat(1, 1, 'fire', 'resist')) }), KimerithInputError);
  assert.throws(() => aggregateMobStats({ equippedItems: [null] }), KimerithInputError);
});

test('formatted report includes stage values, provenance and compatibility caveats', () => {
  const result = calculateKimerithDamage({ base: 100, damage: 80, buffs: '40 20P -50P', resist: -25, pvp: false });
  const text = formatKimerithReport(result);
  assert.match(text, /Kimerith 兼容伤害计算/);
  assert.match(text, /参考版本：3c24847/);
  assert.match(text, /向零截断/);
  assert.match(text, /负抗性/);
  assert.match(text, /没有自动调用/);
  assert.equal(result.stages.length, 6);
});

const COMBAT_FIXTURE = String.raw`
import hashlib, importlib, json, pathlib, sqlite3, sys, tempfile
sys.path.insert(0, sys.argv[1])
combat = importlib.import_module("combat")
definitions = combat.STAT_DEFINITIONS
hashes = {row["canonical"]: key for key, row in definitions.items()}
with tempfile.TemporaryDirectory() as directory:
    path = pathlib.Path(directory) / "fixture.db"
    db = sqlite3.connect(path)
    db.executescript('''
CREATE TABLE items(id TEXT PRIMARY KEY);
CREATE TABLE item_stats(id INTEGER PRIMARY KEY, item TEXT, kind INTEGER, a, b);
CREATE TABLE mob_stats(id INTEGER PRIMARY KEY, mob TEXT, kind INTEGER, a, b);
CREATE TABLE mob_items(id INTEGER PRIMARY KEY, mob TEXT, item TEXT);
''')
    item_id, mob_id = "9007199254740993", "9007199254740995"
    db.executemany("INSERT INTO items VALUES (?)", [(item_id,), ("catalog",)])
    base = [("CanonicalAllReduceDamage", 20), ("CanonicalFireReduceDamage", 10), ("CanonicalAllBlock", 100), ("CanonicalFireBlock", 50)]
    gear = [("CanonicalAllReduceDamage", 5), ("CanonicalFireReduceDamage", 7), ("CanonicalAllBlock", 25), ("CanonicalIceBlock", 60)]
    db.executemany("INSERT INTO mob_stats(mob, kind, a, b) VALUES (?, 1, ?, ?)", [(mob_id, hashes[name], value) for name, value in base])
    db.executemany("INSERT INTO item_stats(item, kind, a, b) VALUES (?, 1, ?, ?)", [(item_id, hashes[name], value) for name, value in gear])
    db.execute("INSERT INTO mob_items(mob, item) VALUES (?, ?)", (mob_id, item_id))
    db.execute("INSERT INTO mob_items(mob, item) VALUES ('missing-gear', '999')")
    db.executemany("INSERT INTO item_stats(item, kind, a, b) VALUES ('catalog', 1, ?, 13)", [(key,) for key in definitions])
    db.executemany("INSERT INTO item_stats(item, kind, a, b) VALUES ('catalog', ?, ?, ?)", [(1, '123456789', 17), (2, 1, 2), (5, 1.15, 0), (3, 12345, 2), (4, 12345, 99), (6, 2, 0)])
    # Numeric owners remain decimal strings at the public interface.
    db.execute("UPDATE item_stats SET item='123' WHERE item='catalog'")
    db.execute("UPDATE mob_items SET mob='888' WHERE mob='missing-gear'")
    db.commit()
    db.close()
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    readonly = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)
    cache = {}
    native = combat.read_entity_stats(readonly, "item_stats", "item", "123")
    native_combat = combat.read_entity_stats(readonly, "item_stats", "item", "123", for_combat=True)
    aggregate = combat.build_mob_combat(readonly, mob_id, "Synthetic_POLYMORPH", item_cache=cache)
    missing = combat.build_mob_combat(readonly, "888", "Synthetic")
    try:
        readonly.execute("INSERT INTO items VALUES ('should-not-write')")
        write_failed = False
    except sqlite3.OperationalError:
        write_failed = True
    bad = sqlite3.connect(":memory:")
    absent = combat.build_mob_combat(bad, "10", "Synthetic")
    bad.execute("CREATE TABLE mob_stats(mob INTEGER, kind INTEGER, a INTEGER)")
    try:
        combat.read_entity_stats(bad, "mob_stats", "mob", "10")
        missing_column = ""
    except combat.CombatDataError as error:
        missing_column = str(error)
    try:
        combat.read_entity_stats(readonly, "items; DROP TABLE items", "item", "123")
        injection_error = ""
    except combat.CombatDataError as error:
        injection_error = str(error)
    print(json.dumps({"native": native, "native_combat": native_combat, "aggregate": aggregate, "missing": missing, "absent": absent, "missing_column": missing_column, "injection_error": injection_error, "write_failed": write_failed, "unchanged": before == hashlib.sha256(path.read_bytes()).hexdigest(), "cached": list(cache)}, ensure_ascii=False))
`;

test('SQLite exporter covers all 135 original native definitions and preserves exact hash strings', () => {
  const fixture = python(COMBAT_FIXTURE, {}, [COMBAT_DIRECTORY]);
  const expected = oracle([{ mode: 'definitions' }])[0];
  const known = fixture.native.filter(row => row.hash && row.known);
  assert.equal(known.length, 135);
  const actualHashes = known.map(row => row.hash).sort();
  assert.deepEqual(actualHashes, expected.map(row => row.hash).sort());
  const sourceByHash = new Map(expected.map(row => [row.hash, row]));
  for (const row of known) {
    assert.equal(row.order, sourceByHash.get(row.hash).order, row.canonical);
    assert.equal(typeof row.hash, 'string');
    assert.match(row.label, /[\u3400-\u9fff]/u);
    assert.equal(row.value, 13);
    if (row.stat === 'resist') assert.match(sourceByHash.get(row.hash).string, /\[RESIST\]$/);
    if (row.stat === 'block') assert.match(sourceByHash.get(row.hash).string, /\[BLOCK\] Rating$/);
    if (row.unit === 'exported_rating') assert.match(row.label, /导出评级/);
    if (row.display_mode === 'text') assert.equal(row.text, '有');
  }
  assert.equal(fixture.native.find(row => row.canonical === 'CanonicalFireDamage').unit, 'percent');
  assert.equal(fixture.native.find(row => row.canonical === 'CanonicalFireCriticalHit').unit, 'rating');
  assert.equal(fixture.native.find(row => row.canonical === 'CanonicalFireReduceDamageRating').unit, 'exported_rating');
  assert.equal(fixture.native.find(row => row.known === false).hash, '123456789');
  assert.deepEqual(fixture.native.filter(row => row.canonical === 'StartingPips').map(row => row.value), [1, 2]);
  assert.equal(fixture.native.find(row => row.canonical === 'SpeedBuff').order, 1350);
  assert.equal(fixture.native_combat.find(row => row.canonical === 'SpeedBuff').order, 1340);
  assert.equal(fixture.write_failed, true);
  assert.equal(fixture.unchanged, true);
  assert.deepEqual(fixture.cached, ['9007199254740993']);
  assert.equal(fixture.aggregate.complete, true);
  assert.equal(fixture.aggregate.stats_scope, 'base_and_equipment');
  assert.deepEqual(fixture.aggregate.equipment_ids, ['9007199254740993']);
  const jsAggregate = aggregateMobStats({ baseStats: BASE_STATS, equippedItems: EQUIPMENT, objectName: 'Synthetic_POLYMORPH' });
  assert.deepEqual(minimal(fixture.aggregate.raw_stats), minimal(jsAggregate.raw_stats));
  assert.deepEqual(minimal(fixture.aggregate.display_stats), minimal(jsAggregate.display_stats));
  assert.deepEqual(fixture.aggregate.target_by_school, jsAggregate.target_by_school);
  assert.match(fixture.aggregate.warnings.join(' '), /polymorph/);
  assert.equal(fixture.missing.complete, false);
  assert.match(fixture.missing.warnings.join(' '), /装备 999/);
  assert.equal(fixture.absent.complete, false);
  assert.match(fixture.absent.warnings.join(' '), /mob_items/);
  assert.match(fixture.missing_column, /缺少必要字段：b/);
  assert.match(fixture.injection_error, /不匹配/);
});
