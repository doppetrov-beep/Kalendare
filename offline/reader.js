const get = id => document.getElementById(id);
const snapshotKey = "kalendare:offline:snapshot";
const sourceKey = "kalendare:offline:source";
const accessKey = "kalendare:offline:key";
const date = new Date();
get("day").value = [date.getFullYear(), String(date.getMonth()+1).padStart(2,"0"), String(date.getDate()).padStart(2,"0")].join("-");
let snapshot = null;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function parse(raw) {
  const { settings, crews, notes } = raw;
  if (raw.format !== "kalendare-shared" || raw.version !== 1 || !datePattern.test(settings?.base) ||
      !Number.isFinite(Date.parse(settings.base)) || !Array.isArray(crews) || crews.length !== 3 ||
      !crews.every(name => typeof name === "string") || !notes || typeof notes !== "object") throw Error("snapshot");
  return {
    format:raw.format, version:raw.version, exportedAt:raw.exportedAt,
    settings:{base:settings.base,overrides:settings.overrides ?? {}}, crews, notes
  };
}
function draftKey() { return "kalendare:offline:draft:" + get("day").value; }
function render() {
  const day = get("day").value;
  get("draft").value = localStorage.getItem(draftKey()) ?? "";
  get("draftStatus").textContent = "";
  if (!snapshot || !day) {
    get("roster").textContent = "";
    get("note").textContent = "";
    return;
  }
  const elapsed = (Date.parse(day) - Date.parse(snapshot.settings.base)) / 86400000;
  const phase = Math.floor(((elapsed % 9) + 9) % 9 / 3);
  const crews = [];
  snapshot.crews.forEach((name,index) => { crews[(phase + index) % 3] = name; });
  const changed = snapshot.settings.overrides[day];
  if ([0,1,2].includes(changed)) [crews[phase],crews[changed]] = [crews[changed],crews[phase]];
  get("roster").textContent = ["День", "Ночь", "Выходной"].map((label,index)=>label+" · "+crews[index]).join(" / ");
  get("note").textContent = typeof snapshot.notes[day] === "string" ? snapshot.notes[day] : "На эту дату заметок нет.";
}
function accept(raw) {
  const next = parse(raw);
  localStorage.setItem(snapshotKey, JSON.stringify(next));
  snapshot = next;
  showSnapshot();
}
function showSnapshot() {
  const stamp = new Date(snapshot.exportedAt);
  get("status").textContent = Number.isFinite(stamp.getTime()) ? "Копия от " + stamp.toLocaleString("ru-RU") : "Копия сохранена на устройстве";
  render();
}
async function update() {
  const source = get("source").value.trim();
  try {
    const link = new URL(source);
    if (link.protocol !== "https:" || !["disk.yandex.ru","disk.yandex.com","yadi.sk"].includes(link.hostname)) throw Error("link");
    const api = new URL("https://cloud-api.yandex.net/v1/disk/public/resources/download");
    api.searchParams.set("public_key", link.href);
    const response = await fetch(api,{credentials:"omit",signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw Error("link");
    const { href } = await response.json();
    if (new URL(href).protocol !== "https:") throw Error("link");
    const download = await fetch(href,{credentials:"omit",referrerPolicy:"no-referrer",signal:AbortSignal.timeout(15000)});
    if (!download.ok) throw Error("download");
    const sealed = await download.json();
    if (sealed.format !== "kalendare-encrypted" || sealed.version !== 1) throw Error("snapshot");
    const bytes = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
    const secret = get("key").value.trim();
    const key = await crypto.subtle.importKey("raw", bytes(secret), "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes(sealed.iv)},key,bytes(sealed.data));
    accept(JSON.parse(new TextDecoder().decode(plaintext)));
    localStorage.setItem(sourceKey, source);
    localStorage.setItem(accessKey, secret);
  } catch {
    get("status").textContent = snapshot ? "Обновление недоступно. Открыта сохранённая копия." : "Общая копия недоступна. Проверьте ссылку или выберите файл.";
  }
}
get("file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try { accept(JSON.parse(await file.text())); }
  catch { get("status").textContent = "Не удалось открыть общую копию."; }
  event.target.value = "";
});
get("day").addEventListener("change", render);
get("update").addEventListener("click",update);
get("save").addEventListener("click",()=>{
  localStorage.setItem(draftKey(),get("draft").value);
  get("draftStatus").textContent = "Черновик сохранён на устройстве.";
});
get("copy").addEventListener("click",async()=>{
  try {
    await navigator.clipboard.writeText(get("draft").value);
    get("draftStatus").textContent = "Черновик скопирован.";
  } catch {
    get("draft").select();
    get("draftStatus").textContent = "Черновик выделен. Скопируйте его вручную.";
  }
});
get("source").value = localStorage.getItem(sourceKey) ?? "";
get("key").value = localStorage.getItem(accessKey) ?? "";
const invite = new URLSearchParams(location.hash.slice(1));
if (invite.has("source") && invite.has("key")) {
  get("source").value = invite.get("source");
  get("key").value = invite.get("key");
  history.replaceState(null,"",location.pathname + location.search);
  update();
}
try {
  const saved = localStorage.getItem(snapshotKey);
  if (saved) { snapshot = parse(JSON.parse(saved)); showSnapshot(); }
} catch {}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
