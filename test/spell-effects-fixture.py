"""Synthetic, asset-free fixtures for the GPL spell interpreter port."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys


MODULE = Path(__file__).resolve().parents[1] / 'tools' / 'catalog' / 'spell_effects.py'
spec = importlib.util.spec_from_file_location('spell_effects', MODULE)
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)


def database():
    db = sqlite3.connect(':memory:')
    db.executescript('''
    CREATE TABLE locale_en (id INTEGER PRIMARY KEY, data TEXT);
    CREATE TABLE spells (id INTEGER PRIMARY KEY, template_id INTEGER, name INTEGER, real_name TEXT, description INTEGER, school INTEGER);
    CREATE TABLE mobs (id INTEGER PRIMARY KEY, name INTEGER, real_name TEXT);
    CREATE TABLE effects (id INTEGER PRIMARY KEY, spell INTEGER, indx INTEGER, param INTEGER, damage INTEGER, rounds INTEGER);
    CREATE TABLE spell_effects (id INTEGER PRIMARY KEY, spell_id INTEGER, parent_id INTEGER, idx INTEGER, effect_class INTEGER, param INTEGER, disposition INTEGER, target INTEGER, type INTEGER, heal_modifier REAL, rounds INTEGER, pip_num INTEGER, protected INTEGER, rank INTEGER, school INTEGER, num_targets INTEGER, condition TEXT);
    ''')
    db.executemany('INSERT INTO locale_en VALUES (?,?)', [(1, 'Fixture Spell'), (2, 'Deal $eA$ $dT_image$ $Damage_image$.'), (3, 'Referenced Spell'), (4, 'Referenced Creature')])
    db.execute('INSERT INTO spells VALUES (7,9007199254740993,1,?,2,2)', (b'Fixture_Spell',))
    db.execute('INSERT INTO spells VALUES (9,100,3,?,2,3)', (b'Referenced_Spell',))
    db.execute('INSERT INTO mobs VALUES (200,4,?)', (b'Referenced_Creature',))
    db.execute('INSERT INTO effects VALUES (1,9007199254740993,0,125,2,3)')
    db.execute('INSERT INTO effects VALUES (2,9007199254740993,1,250,3,4)')
    db.execute('INSERT INTO effects VALUES (3,7,0,999,4,99)')
    return db


def effect(kind='damage', **options):
    row = dict(zip(s.EFFECT_FIELDS, [1, 9007199254740993, -1, 0, 0, 125, 1, 8, 1, .5, 0, 2, 0, 0, 2, 0, '']))
    row['type'] = getattr(s.SpellEffects, kind).value if isinstance(kind, str) else kind
    row.update(options)
    return tuple(row[key] for key in s.EFFECT_FIELDS)


def insert(db, rows):
    db.executemany('INSERT INTO spell_effects VALUES (' + ','.join('?' for _ in s.EFFECT_FIELDS) + ')', rows)


def sweep():
    r = s.SpellEffectRenderer(database())
    examples = {}
    exercised = 0
    for kind in s.SpellEffects:
        parameters = [20, -1, 0]
        if kind.name in ('add_spell_to_deck', 'add_spell_to_hand', 'modify_card_mutation'):
            parameters = [100]
        elif kind.name in ('summon_creature', 'spawn_creature', 'kill_creature'):
            parameters = [200]
        elif kind.name in ('modify_incoming_damage_type', 'modify_outgoing_damage_type'):
            parameters = [72777]
        elif kind.name == 'shadow_pact':
            parameters = list(range(6))
        for param in parameters:
            for disposition in (0, 1, 2):
                for rounds in (0, 3):
                    for target in (3, 8, 11):
                        for protected in (0, 1):
                            row = effect(kind.name, param=param, disposition=disposition, rounds=rounds, target=target, protected=protected)
                            rendered = r.render_effect(row)
                            assert rendered, kind.name
                            if kind.name in s.UPSTREAM_EXPLICIT_EFFECTS:
                                assert '未解释效果' not in rendered, (kind.name, rendered)
                            else:
                                assert '未解释效果' in rendered, (kind.name, rendered)
                            examples.setdefault(kind.name, rendered)
                            exercised += 1
    return {'enum': len(s.SpellEffects), 'supported': len(s.UPSTREAM_EXPLICIT_EFFECTS), 'unsupported': len(set(k.name for k in s.SpellEffects) - s.UPSTREAM_EXPLICIT_EFFECTS), 'cases': exercised, 'labels': len(s.EFFECT_NAMES_ZH), 'examples': examples}


def main(mode):
    db = database()
    r = s.SpellEffectRenderer(db)
    if mode == 'sweep':
        return sweep()
    if mode == 'core':
        return {
            'damage': r.render_effect(effect(param=125)),
            'protected_dot': r.render_effect(effect('damage_over_time', param=300, rounds=3, protected=1)),
            'heal_percent': r.render_effect(effect('heal_percent', param=25)),
            'max_health': r.render_effect(effect('max_health_damage', param=15, rounds=3)),
            'absorb': r.render_effect(effect('absorb_damage', param=500, protected=1)),
            'blade': r.render_effect(effect('modify_outgoing_damage', param=35)),
            'weakness': r.render_effect(effect('modify_outgoing_damage', param=-25)),
            'trap': r.render_effect(effect('modify_incoming_damage', param=30)),
            'shield': r.render_effect(effect('modify_incoming_damage', param=-50)),
            'negative_aura': r.render_effect(effect('modify_incoming_damage', param=30, rounds=4)),
            'global': r.render_effect(effect('modify_incoming_damage', param=30, target=3)),
            'steal': r.render_effect(effect('steal_health', param=600, heal_modifier=.5)),
            'detonate': [r.render_effect(effect('detonate_over_time', param=-1, heal_modifier=1.5, disposition=d)) for d in range(3)],
            'swap': [r.render_effect(effect('swap_charm', disposition=d)) for d in range(3)],
        }
    if mode == 'targets':
        return {str(target.value): r.render_effect(effect(target=target.value)) for target in s.EffectTarget}
    if mode == 'pips':
        return {
            'x': r.render_effect(effect(param=80, rank=3), parent_is_x_pip=True),
            'convert_zero': r.render_effect(effect('modify_outgoing_damage', param=25, rank=0), parent_is_convert=True),
            'convert_rank': r.render_effect(effect('modify_outgoing_damage', param=25, rank=2), parent_is_convert=True),
            'school': [r.render_effect(effect('modify_school_pips', param=1, school=school)) for school in range(2, 9)],
            'prism': r.render_effect(effect('modify_incoming_damage_type', param=72777)),
            'percent_rank': r.render_effect(effect('modify_card_damage_by_rank', param=30, rounds=300)),
        }
    if mode == 'references':
        r = s.SpellEffectRenderer(db, translate={'Referenced Spell': '引用法术', 'Referenced Creature': '引用生物'})
        return {name: r.render_effect(effect(name, param=100 if name.startswith('add_') or name == 'modify_card_mutation' else 200)) for name in ('add_spell_to_deck', 'add_spell_to_hand', 'modify_card_mutation', 'kill_creature', 'spawn_creature', 'summon_creature')}
    if mode == 'hierarchy':
        rows = []
        for cls in range(8):
            identity = cls * 10 + 1
            root_type = 'shadow_pact' if cls == 7 else 'convert_hanging_effect' if cls == 6 else 'invalid_spell_effect'
            condition = 'Convert 2 Blade' if cls == 6 else 'If Target School Fire and not 1 Weakness on Caster'
            rows.append(effect(root_type, id=identity, idx=cls, effect_class=cls, param=3, condition=condition))
            rows.append(effect('modify_outgoing_damage' if cls == 6 else 'damage', id=identity + 1, parent_id=identity, param=cls + 10, rank=3 if cls == 2 else 0))
        return {'text': r.generate_spell_effects_description(rows), 'classes': list(range(8)), 'warnings': r._warnings}
    if mode == 'conditions':
        exclusion = ' and '.join('not Target School ' + name for name in ('Death', 'Fire', 'Ice', 'Life', 'Myth', 'Storm'))
        return {
            'balance_target': s.localize_output(r.replace_condition_with_emojis('If ' + exclusion)),
            'balance_caster': s.localize_output(r.replace_condition_with_emojis('If ' + exclusion.replace('Target', 'Caster'))),
            'weaving': s.localize_output(r.replace_condition_with_emojis('If Caster Secondary School Fire and Target Secondary School Ice')),
            'logic': s.localize_output(r.replace_condition_with_emojis('If Target has 1 Modify Outgoing Damage and not Caster below 20% HP or 2 Shadow Pips on Target')),
            'convert': s.localize_output(r.replace_condition_with_emojis('Convert 2 Blade, Trap and DamageOverTime', use_blade_trap=True)),
        }
    if mode == 'chromatic':
        schools = ('FIRE', 'ICE', 'STORM', 'MYTH', 'LIFE', 'DEATH')
        def family(target):
            return '\n\n'.join(f'If {target} {getattr(s.emojis, school)}:\n  25 {getattr(s.emojis, school)}{s.emojis.DAMAGE}' for school in schools)
        repeated = '\n\n'.join([f'If Target {s.emojis.FIRE}:\n  25 {s.emojis.FIRE}{s.emojis.DAMAGE}'] * 6)
        return {'target': s.localize_output(r.condense_conditionals(family('Target'))), 'caster': s.localize_output(r.condense_conditionals(family('Caster'))), 'repeated': r.condense_conditionals(repeated), 'duplicates': r.replace_consecutive_duplicates('一行\n一行\n一行\n\n另一行\n')}
    if mode == 'templates':
        template = r'#-2:<center>$eA$|$eA1$|$eAPerPip2$|$eAPerPipAll2$|$eAMul$|$eAMax2$|$eABonus$\n+$eAExtra$|$eARounds2$|$dT_image2$|$:$|$Damage_image$|$UnknownToken$|%%|{discard}</center>'
        effects = r.fetch_spell_effects(9007199254740993)
        parsed = r.parse_description(template, effects)
        overflow = r.parse_description('$eAMax3$ $eARounds3$ $eA20$', effects)
        empty = r.parse_description('$eA$ $eAMax$ $eARounds$ $dT_image$', [])
        return {'parsed': parsed, 'overflow': overflow, 'empty': empty, 'warnings': r._warnings, 'icons': {name: r.parse_description('$' + name + '$', effects) for name in s.ICON_TERMS}}
    if mode == 'variants':
        insert(db, [effect(id=1, param=100), effect(id=2, param=200, num_targets=1), effect(id=3, param=700, num_targets=7), effect(id=4, param=999, spell_id=7)])
        calls = []
        def translate(text, ref=None):
            calls.append((text, ref))
            return '造成 $eA$ $dT_image$ $Damage_image$。' if ref == 'locale_en:2' else None
        result = s.render_spell_details(db, 9007199254740993, translate=translate, include_raw=True)
        result['explicit'] = r.render_spell_details(9007199254740993, num_targets=99)['effect_variants']
        result['calls'] = calls
        return result
    if mode == 'unknown':
        insert(db, [effect(id=1, type=999, param=12345), effect('bounce_next', id=2), effect('damage', id=3, target=999), effect('damage', id=4, school=999), effect('modify_incoming_damage_type', id=5, param=1234)])
        return r.render_spell_details(9007199254740993)
    if mode == 'unknown_references':
        insert(db, [effect('add_spell_to_hand', id=1, param=555555), effect('invalid_spell_effect', id=2, effect_class=4, condition='If Target UnmappedStatus'), effect(id=3, parent_id=2)])
        return r.render_spell_details(9007199254740993)
    if mode == 'cycles':
        rows = [effect(id=1, parent_id=2), effect(id=2, parent_id=1), effect(id=3, parent_id=999), effect(id=4, parent_id=4)]
        return {'text': r.generate_spell_effects_description(rows), 'warnings': r._warnings, 'unknown': list(r._unknown.values())}
    if mode == 'missing':
        db.execute('DROP TABLE effects')
        db.execute('DROP TABLE spell_effects')
        return s.render_spell_details(db, {'id': 7, 'template_id': 9007199254740993, 'description': 2})
    if mode == 'bounds':
        outcomes = {}
        cases = {
            'row_limit': lambda: s.SpellEffectRenderer(db, max_effects=2).generate_spell_effects_description([effect(id=i) for i in range(3)]),
            'depth': lambda: s.SpellEffectRenderer(db, max_depth=2).generate_spell_effects_description([effect(id=i, parent_id=-1 if i == 0 else i - 1) for i in range(5)]),
            'transparent_depth': lambda: s.SpellEffectRenderer(db, max_depth=2).generate_spell_effects_description([effect(id=i, parent_id=-1 if i == 0 else i - 1, effect_class=3) for i in range(5)]),
            'duplicate': lambda: r.generate_spell_effects_description([effect(), effect()]),
            'variants': lambda: r.render_spell_details(9007199254740993, num_targets=range(200)),
            'text': lambda: r.parse_description('x' * (s.MAX_TEXT_LENGTH + 1), []),
            'unknown_id': lambda: r.render_spell_details(7),
            'wrong_row': lambda: r.render_spell_details({'id': 7, 'description': 2}),
        }
        for name, callback in cases.items():
            try:
                callback()
            except (ValueError, LookupError) as error:
                outcomes[name] = str(error)
            else:
                raise AssertionError('Expected a bounded failure: ' + name)
        return outcomes
    if mode == 'readonly':
        before = db.total_changes
        forbidden = {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE, sqlite3.SQLITE_CREATE_TABLE, sqlite3.SQLITE_DROP_TABLE}
        def authorizer(action, *args):
            return sqlite3.SQLITE_DENY if action in forbidden else sqlite3.SQLITE_OK
        db.set_authorizer(authorizer)
        result = s.render_spell_details(db, 9007199254740993)
        return {'before': before, 'after': db.total_changes, 'result': result}
    if mode == 'preload':
        insert(db, [effect(id=1, param=100), effect(id=2, param=200, num_targets=7)])
        expected = r.render_spell_details(9007199254740993)
        stats = r.preload_effects()
        queries = []
        db.set_trace_callback(queries.append)
        actual = r.render_spell_details(9007199254740993)
        db.set_trace_callback(None)
        budget = None
        try:
            r.preload_effects(max_total_rows=1)
        except ValueError as error:
            budget = str(error)
        return {'equal': actual == expected, 'stats': stats, 'queries': queries, 'budget': budget, 'cache_intact': r.render_spell_details(9007199254740993) == expected}
    raise ValueError('Unknown fixture mode: ' + mode)


if __name__ == '__main__':
    print(json.dumps(main(sys.argv[1]), ensure_ascii=False, allow_nan=False))
