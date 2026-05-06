#!/usr/bin/env python3
"""Aggregate per-stack stats across N rounds of breakout-opus runs.

Usage: aggregate-rounds.py <campaign-tag-prefix>
e.g. aggregate-rounds.py breakout-opus-145327
"""
import json
import os
import sys
import glob
import statistics

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def stack_label(d):
    name = os.path.basename(d)
    if 'breakout-single-script' in name:
        return 'cli4-single-script'
    if 'breakout-separate-actors' in name:
        return 'cli4-separate-actors'
    if 'cli-script-smoke' in name:
        return 'cli-script'
    if 'experimental-web-canvas-smoke' in name:
        return 'exp-web-canvas'
    if 'experimental-web-pixi-smoke' in name:
        return 'exp-web-pixi'
    if '-pixi-smoke' in name:
        return 'pixi'
    if '-canvas-smoke' in name:
        return 'canvas'
    return name


def collect(prefix):
    by_stack = {}
    web_dirs = glob.glob(os.path.join(ROOT, 'eval-runs', 'web-smoke', f'*{prefix}*'))
    cli_dirs = glob.glob(os.path.join(ROOT, 'eval-runs', f'*{prefix}*'))
    seen = set()
    for d in web_dirs + cli_dirs:
        if d in seen:
            continue
        seen.add(d)
        rj = os.path.join(d, 'result.json')
        if not os.path.isfile(rj):
            continue
        try:
            r = json.load(open(rj))
        except Exception:
            continue
        label = stack_label(d)
        ver = r.get('verification') or {}
        warns = r.get('warnings', ver.get('qualityWarnings', [])) or []
        agent_ms = (r.get('timings') or {}).get('agentMs') or r.get('durationMs') or 0
        total_ms = (r.get('timings') or {}).get('totalMs') or r.get('durationMs') or 0
        by_stack.setdefault(label, []).append({
            'agent_s': agent_ms / 1000,
            'total_s': total_ms / 1000,
            'warnings': len(warns),
            'warn_text': warns[:1],
            'run': os.path.basename(d),
        })
    return by_stack


def fmt(values):
    if not values:
        return ('', '', '', '')
    if len(values) == 1:
        v = values[0]
        return (f'{v:.0f}', f'{v:.0f}', f'{v:.0f}', f'{v:.0f}')
    sv = sorted(values)
    median = statistics.median(sv)
    p25 = sv[len(sv) // 4] if len(sv) >= 4 else sv[0]
    p75 = sv[(3 * len(sv)) // 4] if len(sv) >= 4 else sv[-1]
    return (f'{sv[0]:.0f}', f'{median:.0f}', f'{p75:.0f}', f'{sv[-1]:.0f}')


def main():
    if len(sys.argv) < 2:
        print('Usage: aggregate-rounds.py <campaign-tag-prefix>')
        sys.exit(1)
    prefix = sys.argv[1]
    by_stack = collect(prefix)
    if not by_stack:
        print(f'no runs found matching prefix: {prefix}')
        sys.exit(1)
    rows = []
    order = ['canvas', 'pixi', 'cli-script', 'cli4-single-script',
             'cli4-separate-actors', 'exp-web-canvas', 'exp-web-pixi']
    for stack in order:
        runs = by_stack.get(stack, [])
        if not runs:
            continue
        agent_vals = [r['agent_s'] for r in runs]
        total_vals = [r['total_s'] for r in runs]
        warn_count = sum(1 for r in runs if r['warnings'] > 0)
        n = len(runs)
        a_min, a_med, a_p75, a_max = fmt(agent_vals)
        t_min, t_med, t_p75, t_max = fmt(total_vals)
        rows.append({
            'stack': stack,
            'n': n,
            'agent_med': a_med,
            'agent_p75': a_p75,
            'agent_range': f'{a_min}–{a_max}',
            'total_med': t_med,
            'total_p75': t_p75,
            'total_range': f'{t_min}–{t_max}',
            'warn_rate': f'{warn_count}/{n}',
        })

    # markdown table
    print(f'# Breakout opus campaign: {prefix}\n')
    print('| stack | n | agent median (s) | agent p75 | agent range | total median | total p75 | total range | warn rate |')
    print('| --- | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: |')
    for r in rows:
        print(f"| {r['stack']} | {r['n']} | {r['agent_med']} | {r['agent_p75']} | {r['agent_range']} | {r['total_med']} | {r['total_p75']} | {r['total_range']} | {r['warn_rate']} |")

    # raw per-run too
    print('\n\n## Per-run detail')
    for stack in order:
        runs = by_stack.get(stack, [])
        if not runs:
            continue
        print(f'\n### {stack}')
        for r in sorted(runs, key=lambda x: x['run']):
            warn_str = f" warn={r['warnings']}" if r['warnings'] else ''
            print(f"- {r['run']}: agent={r['agent_s']:.0f}s total={r['total_s']:.0f}s{warn_str}")


if __name__ == '__main__':
    main()
