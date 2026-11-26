import getpass
import hashlib
import hmac
import json
import re
import secrets
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

path = Path(".dev.vars.production")
values = {}
if path.exists():
    for line in path.read_text().splitlines():
        name, value = line.split("=", 1)
        values[name] = json.loads(value)
values.setdefault("AUTH_SECRET", secrets.token_hex(32))
accounts = json.loads(values.get("ACCOUNTS", "{}"))
generated_password = None
while True:
    login = input("Login (e.g. admin): ").strip().lower()
    if re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,39}", login):
        break
    print("Use 2–40 Latin letters, digits, underscores or hyphens.")
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
        generated_password = password
    accounts[login] = hmac.new(
        values["AUTH_SECRET"].encode(), f"password:{login}:{password}".encode(), hashlib.sha256
    ).hexdigest()
values["ACCOUNTS"] = json.dumps(accounts, separators=(",", ":"))
if not values.get("DISK_TOKEN"):
    token = getpass.getpass("Yandex Disk OAuth token (Enter to configure later): ").strip()
    if token:
        request = Request(
            "https://cloud-api.yandex.net/v1/disk/resources?path=app%3A%2F&fields=path,type",
            headers={"Authorization": f"OAuth {token}"},
        )
        try:
            with urlopen(request, timeout=15) as response:
                folder = json.load(response)
        except (URLError, ValueError):
            raise SystemExit("Yandex Disk did not accept the token or could not be reached.") from None
        folder_name = folder.get("path", "").rstrip("/").rsplit("/", 1)[-1]
        if folder.get("type") != "dir" or folder_name.casefold() != "kalendare":
            raise SystemExit("Use the token for the Kalendare application folder.")
        values["DISK_TOKEN"] = token
        print("Verified access to the Kalendare folder.")
tmp = path.with_suffix(".tmp")
tmp.write_text("".join(f"{name}={json.dumps(value)}\n" for name, value in values.items()))
tmp.replace(path)
print("Local configuration updated.")
if generated_password:
    print(f"Save this password before closing the terminal: {generated_password}")
