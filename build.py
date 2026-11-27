import re
from pathlib import Path, PurePosixPath
from shutil import copy2
from zipfile import ZipFile

dist = Path("dist")
dist.mkdir(exist_ok=True)
for name in ("index.html", "sync.js", "theme.js", "site.css", "manifest.webmanifest", "service-worker.js",
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
copy2("work/heidelberg/index.html", landing)
copy2("work/heidelberg/navigation.js", landing.with_name("navigation.js"))

for guide in ("ctp", "shooter"):
    page = landing.with_name(guide + ".html")
    html = page.read_text(encoding="utf-8")
    controller = html.rfind("<script>")
    if controller < 0 or "window.setLanguage=" not in html[controller:]:
        raise ValueError(f"Language controller missing from {guide}")
    end = html.index("</script>", controller) + len("</script>")
    html = html[:controller] + '<script src="./navigation.js"></script>' + html[end:]
    for language in ("ru", "en"):
        html = html.replace(f""" onclick="setLanguage('{language}')" """.rstrip(), "", 1)
    html = html.replace("<main>", f'<main data-guide="{guide}">', 1)
    html = html.replace(f'src="original_{guide}/x-1.html"', f'src="russian_{guide}/x-1.html"', 1)
    html = html.replace('id="langStatus" role="status">Английский оригинал', 'id="langStatus" role="status">Русский перевод', 1)
    language_bar = re.search(r'<div class="langbar">.*?</div>', html, re.DOTALL)
    if not language_bar:
        raise ValueError(f"Language controls missing from {guide}")
    html = html.replace(language_bar[0], "", 1).replace('<div class="wrap">', language_bar[0] + '<div class="wrap">', 1)
    html = html.replace("<body>", '<body class="manual-reader">', 1)
    html = html.replace("</head>", '<script src="../../theme.js"></script><link rel="stylesheet" href="../../site.css"></head>', 1)
    page.write_text(html, encoding="utf-8")

for folder in ("original_ctp", "russian_ctp", "original_shooter", "russian_shooter"):
    for page in (landing.parent / folder).glob("x-*.html"):
        html = page.read_bytes()
        html = re.sub(br"<html\b", b'<html class="manual-article"', html, count=1, flags=re.IGNORECASE)
        assets = b'<meta name="viewport" content="width=device-width, initial-scale=1"><script src="../../../theme.js"></script><link rel="stylesheet" href="../../../site.css">'
        html = re.sub(br"</head\s*>", assets + b"</head>", html, count=1, flags=re.IGNORECASE)
        page.write_bytes(html)
