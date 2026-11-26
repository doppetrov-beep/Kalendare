import getpass
import hashlib
import hmac
import json
import re
import secrets
from pathlib import Path

path = Path(".dev.vars.production")
values = {}
if path.exists():
    for line in path.read_text().splitlines():
        name, value = line.split("=", 1)
        values[name] = json.loads(value)
values.setdefault("AUTH_SECRET", secrets.token_hex(32))
accounts = json.loads(values.get("ACCOUNTS", "{}"))
login = input("Login to add, change or remove: ").strip().lower()
if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,39}", login):
    raise SystemExit("Use 2–40 ASCII letters, digits, underscores or hyphens.")
action = input("Set password [enter] or remove account [r]: ").strip()
if action == "r":
    if login not in accounts:
        raise SystemExit("Account not found.")
    del accounts[login]
else:
    if login not in accounts and len(accounts) >= 5:
        raise SystemExit("All five account slots are in use.")
    password = getpass.getpass("Password (20–128 characters, or Enter to generate): ")
    if password and not 20 <= len(password) <= 128:
        raise SystemExit("Password must have 20–128 characters.")
    if not password:
        password = secrets.token_urlsafe(24)
        print(f"Save this password before closing the terminal: {password}")
    accounts[login] = hmac.new(
        values["AUTH_SECRET"].encode(), f"password:{login}:{password}".encode(), hashlib.sha256
    ).hexdigest()
values["ACCOUNTS"] = json.dumps(accounts, separators=(",", ":"))
if not values.get("DISK_TOKEN"):
    token = getpass.getpass("Yandex Disk OAuth token (Enter to configure later): ").strip()
    if token:
        values["DISK_TOKEN"] = token
tmp = path.with_suffix(".tmp")
tmp.write_text("".join(f"{name}={json.dumps(value)}\n" for name, value in values.items()))
tmp.replace(path)
print("Local configuration updated.")
