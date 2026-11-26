import getpass
import hashlib
import hmac
import json
import re
import secrets
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

path = Path(".dev.vars.production")


def read_secret(prompt):
    if sys.platform != "win32":
        return getpass.getpass(prompt + ": ")
    print(prompt + ":", flush=True)
    command = (
        "$value = Read-Host -AsSecureString; "
        "[Console]::OutputEncoding = [Text.Encoding]::UTF8; "
        "[Console]::Write([Net.NetworkCredential]::new('', $value).Password)"
    )
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-Command", command],
        stdout=subprocess.PIPE,
        encoding="utf-8",
        check=True,
    )
    return result.stdout
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
    password = read_secret("Password (20–128 characters, or Enter to generate)")
    if password and not 20 <= len(password) <= 128:
        raise SystemExit("Password must have 20–128 characters.")
    if not password:
        password = secrets.token_urlsafe(24)
        generated_password = password
    accounts[login] = hmac.new(
        values["AUTH_SECRET"].encode(), f"password:{login}:{password}".encode(), hashlib.sha256
    ).hexdigest()
values["ACCOUNTS"] = json.dumps(accounts, separators=(",", ":"))
while not values.get("DISK_TOKEN"):
    token = read_secret("Yandex Disk OAuth token (Enter to configure later)").strip()
    if not token:
        break
    request = Request(
        "https://cloud-api.yandex.net/v1/disk/resources?path=app%3A%2F&fields=path,type,name",
        headers={"Authorization": f"OAuth {token}"},
    )
    try:
        with urlopen(request, timeout=15) as response:
            folder = json.load(response)
    except HTTPError as error:
        print(f"Yandex Disk returned HTTP {error.code}.")
        continue
    except (URLError, ValueError):
        print("Could not check the token. Check your connection and try again.")
        continue
    folder_name = folder.get("path", "").rstrip("/").rsplit("/", 1)[-1]
    if folder.get("type") != "dir" or folder_name.strip().casefold() not in {"calendar", "kalendare"}:
        print(f"Yandex Disk opened folder {folder_name or '(unnamed)'!r}; expected 'Calendar' or 'Kalendare'.")
        continue
    values["DISK_TOKEN"] = token
    print(f"Verified access to the {folder_name} folder.")
tmp = path.with_suffix(".tmp")
tmp.write_text("".join(f"{name}={json.dumps(value)}\n" for name, value in values.items()))
tmp.replace(path)
print("Local configuration updated.")
if generated_password:
    print(f"Save this password before closing the terminal: {generated_password}")
