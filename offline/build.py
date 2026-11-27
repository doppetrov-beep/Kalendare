import json
import shutil
import sys
from pathlib import Path

target = Path(sys.argv[1])
target.mkdir(parents=True, exist_ok=True)
for name in ("index.html", "reader.js", "manifest.json", "sw.js"):
    shutil.copyfile(Path("offline") / name, target / name)
for name in ("site.css", "theme.js"):
    shutil.copyfile(Path("dist") / name, target / name)
calendar_html = Path("index.html").read_text(encoding="utf-8")
calendar_styles = calendar_html.split("<style>", 1)[1].split("</style>", 1)[0]
(target / "calendar.css").write_text(calendar_styles.strip() + "\n", encoding="utf-8")
shutil.copyfile("icon-192.png", target / "icon.png")
shutil.copytree("dist/work", target / "work", dirs_exist_ok=True)
assets = ["./"]
for path in sorted(target.rglob("*")):
    if path.is_file() and path.name != "assets.js":
        name = path.relative_to(target).as_posix()
        assets.append("./" + name)
        if name.endswith("/index.html"):
            assets.append("./" + name.removesuffix("index.html"))
(target / "assets.js").write_text("self.readerAssets = " + json.dumps(assets) + ";", encoding="utf-8")
