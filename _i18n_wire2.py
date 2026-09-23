# -*- coding: utf-8 -*-
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace_all(path: Path, reps: list[tuple[str, str]]) -> None:
    text = path.read_text(encoding="utf-8")
    for old, new in reps:
        if old not in text:
            print(f"MISSING in {path.name}: {old[:90]!r}")
        else:
            text = text.replace(old, new)
    path.write_text(text, encoding="utf-8")
    ka = len(re.findall(r"[\u10A0-\u10FF]", text))
    # Allow intentional session-expired match strings
    print(f"{path.relative_to(ROOT)}: {ka} KA chars")


# ========== courier-history ==========
exec(open(ROOT / "_i18n_wire.py", encoding="utf-8").read().split("print(\"history loops updated\")")[0] + 'print("history part1")')

# Re-run history loop fixes from wire.py by importing logic inline
from _i18n_wire import *  # noqa — already ran via exec partial; better run wire.py first
