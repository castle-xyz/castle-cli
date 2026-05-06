#!/usr/bin/env python3
"""Render a per-run timeline.md from a transcript.jsonl.

Usage: transcript-timeline.py <run-dir-or-transcript.jsonl> [...]

Walks the transcript and emits a human-readable timeline of tool calls
with running offsets in seconds (when timestamps are available; otherwise
just sequence numbers). Saves alongside the transcript as timeline.md.
"""
import json
import os
import sys
from datetime import datetime


def parse_ts(d):
    # Claude stream-json: timestamp on outer envelope as "timestamp" or via session info; no per-message wallclock.
    # Codex JSON: 'timestamp' on each event.
    for k in ('timestamp', 'created_at', 'wallclock_ms'):
        v = d.get(k)
        if isinstance(v, (int, float)):
            return float(v) / (1000 if v > 1e12 else 1)
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace('Z', '+00:00')).timestamp()
            except Exception:
                pass
    return None


def truncate(s, n):
    if len(s) <= n:
        return s
    return s[: n - 1] + '…'


def render(transcript_path):
    out_path = os.path.join(os.path.dirname(transcript_path), 'timeline.md')
    lines = []
    first_ts = None
    seq = 0
    with open(transcript_path) as f:
        for raw in f:
            try:
                d = json.loads(raw)
            except Exception:
                continue
            t = parse_ts(d)
            if first_ts is None and t is not None:
                first_ts = t
            offset = (t - first_ts) if (first_ts is not None and t is not None) else None
            msg = d.get('message') or d
            if not isinstance(msg, dict):
                continue
            content = msg.get('content', [])
            if isinstance(content, str):
                content = [{'type': 'text', 'text': content}]
            for c in content if isinstance(content, list) else []:
                ctype = c.get('type')
                if ctype == 'text':
                    text = c.get('text', '').replace('\n', ' ').strip()
                    if not text:
                        continue
                    seq += 1
                    prefix = f't+{offset:5.1f}s' if offset is not None else f'#{seq:03d}'
                    lines.append(f'**{prefix}** _text_: {truncate(text, 200)}')
                elif ctype == 'tool_use':
                    name = c.get('name', '?')
                    inp = c.get('input') or {}
                    seq += 1
                    prefix = f't+{offset:5.1f}s' if offset is not None else f'#{seq:03d}'
                    if name == 'Bash':
                        cmd = inp.get('command', '').replace('\n', ' ')
                        desc = inp.get('description', '').strip()
                        body = f'`{truncate(cmd, 220)}`' + (f' — {desc}' if desc else '')
                        lines.append(f'**{prefix}** Bash: {body}')
                    elif name == 'Read':
                        lines.append(f"**{prefix}** Read: `{inp.get('file_path', '')}`")
                    elif name == 'Edit':
                        lines.append(f"**{prefix}** Edit: `{inp.get('file_path', '')}`")
                    elif name == 'Write':
                        lines.append(f"**{prefix}** Write: `{inp.get('file_path', '')}`")
                    elif name == 'Grep':
                        lines.append(f"**{prefix}** Grep: `{truncate(inp.get('pattern', ''), 80)}` in `{inp.get('path', '.')}`")
                    elif name == 'Glob':
                        lines.append(f"**{prefix}** Glob: `{truncate(inp.get('pattern', ''), 80)}`")
                    else:
                        lines.append(f"**{prefix}** {name}: {truncate(json.dumps(inp), 220)}")
                elif ctype == 'tool_result':
                    # skip — too noisy in timeline
                    pass

    header = f'# Transcript timeline\n\nSource: `{transcript_path}`\n\n'
    with open(out_path, 'w') as out:
        out.write(header)
        out.write('\n\n'.join(lines))
        out.write('\n')
    return out_path


def main():
    targets = sys.argv[1:]
    if not targets:
        print(__doc__)
        sys.exit(1)
    for t in targets:
        if os.path.isdir(t):
            tp = os.path.join(t, 'transcript.jsonl')
        else:
            tp = t
        if not os.path.isfile(tp):
            print(f'skip (no transcript): {t}', file=sys.stderr)
            continue
        out = render(tp)
        print(out)


if __name__ == '__main__':
    main()
