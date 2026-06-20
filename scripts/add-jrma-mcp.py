#!/usr/bin/env python3
"""
One-shot script to add the JustRunMy.App MCP server to ~/.claude.json
Run once, then delete this file.
"""

import json
import os
import shutil
from datetime import datetime

CONFIG_PATH = os.path.expanduser("~/.claude.json")

JRMA_MCP = {
    "justrunmy.app": {
        "url": "https://justrunmy.app/api/mcp",
        "headers": {
            "X-User-Identity": "CfDJ8I6qJxyfn1BFmLYpveog239Y1rBy+j32XRLO5EoyHZoir3OpSk1d4MIOX8k7Sa14kxAM7LOJUnfsImP5NPeLbhhNOoNdLlbJJybguB/ZvqDNjVgAfTd6PiO5KDaIKE+oJ91LJUmAu9Dp8IEG81piQ43qrfdxdwj6JUQJ+izLV47r+6N+5Vz1bS95PWvgMqNeD/kylkzjKIcr6z7Gi0GtN/Pvi6fVQFBEFXbU14AUGbA/NQcv8J+MNLeg76fbNpc3m1tYeHhCzMqIuSJtWLM10Qevf/QAwxXsJRsHdBCBS5yzDU4BRv5urMasZwn1rQZxGW2gkZcYbaPLEaFCZYXaP3rHKjKGw86CJoMWGJX7aryXChqWaDG8YzP1xBRRpm4LUfCUmrczqxYlHPQF8UWXhU/DuWGsB9D2ts/d+o6SFWoMGKhREmKbp08lBNrjXV8fpaiqQZMH/fH+R3EH2/1MZJpksX/EPszG72fyZjSOLoldH9UQbLG4i2uLSZP6+JMyDyz6x5UXMlxk3AamwXGFZ1KY3H9ij7VSwXF9mOVmI/ZYqzj1sQbJkbQzw2ZgBhFp24mn1f2aKeg4mW+2L8EGrAVtzBXS4lKpetFkrUVSbSC4xEtK3c1MMV2TjUqSfq+p0X7p8Rvhj/QuoYMu40SAn4bvIxfVNs3W7SvE1QwwtY2DMgrgcQB1iYF5c9m5GuSB9glAnJmulPSVSAsatoUsfWEsAkEa4fIEZGJWVVTD6ZX3ZMmXiOxnxYJAXGIC354wlZ/p/eOotWdY2fANpd2MMnf9G3J7bjvn9KBus/SKLePHgxF+W+rNTDx6vzpz02i1M2E5LxeF23N15LpVQWjQ0tG8slWMJGb9WEjCehA+Uzs2"
        }
    }
}

# Read existing config (or start fresh)
if os.path.exists(CONFIG_PATH):
    shutil.copy(CONFIG_PATH, CONFIG_PATH + ".bak")
    print(f"Backed up existing config to {CONFIG_PATH}.bak")
    with open(CONFIG_PATH, "r") as f:
        config = json.load(f)
else:
    config = {}
    print("No existing ~/.claude.json found, creating new one")

# Merge in the MCP server
config.setdefault("mcpServers", {}).update(JRMA_MCP)

with open(CONFIG_PATH, "w") as f:
    json.dump(config, f, indent=2)

print("Done! JRMA MCP server added to ~/.claude.json")
print("Restart Claude for the changes to take effect.")
