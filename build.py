from pathlib import Path, PurePosixPath
from shutil import copy2
from zipfile import ZipFile

dist = Path("dist")
dist.mkdir(exist_ok=True)
for name in ("index.html", "sync.js", "theme.js", "manifest.webmanifest", "service-worker.js",
             "icon-192.png", "apple-touch-icon.png", "work/index.html", "dnd/index.html"):
    target = dist / name
    target.parent.mkdir(parents=True, exist_ok=True)
    copy2(name, target)

with ZipFile("work/heidelberg/Heidelberg_RU_EN.zip") as archive:
    for entry in archive.infolist():
        parts = PurePosixPath(entry.filename).parts
        if entry.is_dir():
            continue
        if len(parts) < 2 or any(part in ("..", "/") or "\\" in part or ":" in part for part in parts):
            raise ValueError(f"Unexpected archive path: {entry.filename}")
        target = dist.joinpath("work", "heidelberg", *parts[1:])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.read(entry))

landing = dist / "work/heidelberg/index.html"
html = landing.read_text(encoding="utf-8")
html = html.replace("<main>", '<main><a href="../">← Рабочий журнал</a>', 1)
html = html.replace("Выберите руководство. Интернет не требуется.", "Выберите руководство.")
html = html.replace("</style>", "@media(max-width:600px){main{margin:0;padding:20px}a{padding:14px}}</style>")
landing.write_text(html, encoding="utf-8")
