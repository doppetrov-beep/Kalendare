import re
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

for guide in ("ctp", "shooter"):
    page = landing.with_name(guide + ".html")
    html = page.read_text(encoding="utf-8")
    # Cloudflare serves the article at its canonical URL without ".html".
    # Keep the archive's page identifiers when the iframe reports that URL.
    html = html.replace(r"(x-[0-9]+\.html)$", r"(x-[0-9]+)(?:\.html)?$", 1)
    html = html.replace("current=m[2];", "current=m[2]+'.html';", 1)
    html = html.replace(f'src="original_{guide}/x-1.html"', f'src="russian_{guide}/x-1.html"', 1)
    html = html.replace(f"currentDir='original_{guide}',mode='ru'", f"currentDir='russian_{guide}',mode='ru'", 1)
    html = html.replace('id="langStatus" role="status">Английский оригинал', 'id="langStatus" role="status">Русский перевод', 1)
    language_bar = re.search(r'<div class="langbar">.*?</div>', html, re.DOTALL)
    if not language_bar:
        raise ValueError(f"Language controls missing from {guide}")
    html = html.replace(language_bar[0], "", 1).replace('<div class="wrap">', language_bar[0] + '<div class="wrap">', 1)
    html = html.replace("</style>", """
.langbar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:6px;height:auto;min-height:44px}
.langbar button[aria-pressed="true"]{background:#143b5d;color:#fff;border-color:#143b5d}
@media(min-width:701px){.wrap{height:calc(100vh - 124px)}}
</style>""", 1)
    page.write_text(html, encoding="utf-8")
