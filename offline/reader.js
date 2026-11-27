const get = id => document.getElementById(id);
const snapshotKey = "kalendare:offline:snapshot";
const sourceKey = "kalendare:offline:source";
const accessKey = "kalendare:offline:key";
const shifts = [
  { letter: "Д", name: "Дневная смена", css: "daytime", suffix: "Day" },
  { letter: "Н", name: "Ночная смена", css: "night", suffix: "Night" },
  { letter: "В", name: "Выходной", css: "off", suffix: "Off" }
];
const fullDate = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: "UTC" });
const monthTitle = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" });
function todayKey() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
}
let selectedDay = todayKey();
let snapshot = null;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
function parse(raw) {
  const { settings, crews, notes } = raw;
  if (raw.format !== "kalendare-shared" || raw.version !== 1 || !datePattern.test(settings?.base) ||
      !Number.isFinite(Date.parse(settings.base)) || !Array.isArray(crews) || crews.length !== 3 ||
      !crews.every(name => typeof name === "string") || !notes || typeof notes !== "object") throw Error("snapshot");
  return {
    format:raw.format, version:raw.version, exportedAt:raw.exportedAt,
    settings:{base:settings.base,overrides:settings.overrides ?? {}}, crews, notes: Object.fromEntries(Object.entries(notes).filter(([day, note]) => datePattern.test(day) && typeof note === "string"))
  };
}
function draftKey() { return "kalendare:offline:draft:" + selectedDay; }
function schedule(day) {
  const elapsed = (Date.parse(day) - Date.parse(snapshot.settings.base)) / 86400000;
  const phase = Math.floor(((elapsed % 9) + 9) % 9 / 3);
  const changed = snapshot.settings.overrides[day];
  return { phase, selected: [0,1,2].includes(changed) ? changed : phase };
}
function shiftDetails(day) {
  const { phase, selected } = schedule(day);
  const crews = [];
  snapshot.crews.forEach((name, index) => { crews[(phase + index) % 3] = name; });
  [crews[phase], crews[selected]] = [crews[selected], crews[phase]];
  return { shift: shifts[selected], crews };
}
function renderMonth(day) {
  const month = get("calendar");
  month.replaceChildren();
  const first = new Date(day.slice(0, 7) + "-01T00:00:00Z");
  get("monthTitle").textContent = monthTitle.format(first).replace(/ г\.$/, "");
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const today = todayKey();
  for (let blank = 0; blank < (first.getUTCDay() + 6) % 7; blank++) {
    const placeholder = document.createElement("span");
    placeholder.className = "day empty";
    placeholder.setAttribute("aria-hidden", "true");
    month.append(placeholder);
  }
  for (let number = 1; number <= count; number++) {
    const key = day.slice(0, 8) + String(number).padStart(2, "0");
    const shift = snapshot ? shifts[schedule(key).selected] : null;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "day " + (shift?.css ?? "unloaded");
    button.classList.toggle("is-today", key === today);
    button.classList.toggle("is-selected", key === day);
    button.classList.toggle("has-note", Boolean(snapshot?.notes[key]?.trim()));
    button.setAttribute("aria-pressed", String(key === day));
    button.setAttribute("aria-label", [fullDate.format(new Date(key)), shift?.name].filter(Boolean).join(", "));
    const numeral = document.createElement("span");
    numeral.className = "number";
    numeral.textContent = number;
    button.append(numeral);
    if (shift) {
      const letter = document.createElement("span");
      letter.className = "letter";
      letter.textContent = shift.letter;
      button.append(letter);
    }
    button.addEventListener("click", () => selectDay(key));
    month.append(button);
  }
}
function render() {
  const today = todayKey();
  get("todayDate").textContent = fullDate.format(new Date(today));
  get("selectedDate").textContent = fullDate.format(new Date(selectedDay));
  renderMonth(selectedDay);
  if (!snapshot) return;
  const current = shiftDetails(today);
  const selected = shiftDetails(selectedDay);
  get("todaySymbol").textContent = current.shift.letter;
  get("todaySymbol").className = "today-symbol " + current.shift.css;
  get("todayShift").textContent = current.shift.name;
  get("todayPerson").textContent = snapshot.crews[0];
  get("selectedShift").textContent = selected.shift.name;
  get("selectedShift").className = "detail-shift " + selected.shift.css;
  shifts.forEach(({ suffix }, index) => {
    get("todayCrew" + suffix).textContent = current.crews[index];
    get("selectedCrew" + suffix).textContent = selected.crews[index];
  });
  const note = snapshot.notes[selectedDay];
  get("note").textContent = typeof note === "string" && note.trim() ? note : "На эту дату заметок нет.";
}
function selectDay(day) {
  if (day !== selectedDay) {
    selectedDay = day;
    loadDraft();
  }
  render();
}
function loadDraft() {
  get("draft").value = localStorage.getItem(draftKey()) ?? "";
  get("draftStatus").textContent = "";
}
function moveMonth(offset) {
  const day = new Date(selectedDay);
  selectDay(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + offset, 1)).toISOString().slice(0, 10));
}
function accept(raw) {
  const next = parse(raw);
  localStorage.setItem(snapshotKey, JSON.stringify(next));
  snapshot = next;
  showSnapshot();
}
function showSnapshot() {
  const stamp = new Date(snapshot.exportedAt);
  get("sync-status").textContent = Number.isFinite(stamp.getTime()) ? "Копия от " + stamp.toLocaleString("ru-RU") : "Копия сохранена на устройстве";
  render();
}
async function update() {
  const source = get("source").value.trim();
  const secret = get("key").value.trim();
  get("update").disabled = true;
  get("diskStatus").textContent = "Загружаем копию…";
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
    const key = await crypto.subtle.importKey("raw", bytes(secret), "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes(sealed.iv)},key,bytes(sealed.data));
    accept(JSON.parse(new TextDecoder().decode(plaintext)));
    localStorage.setItem(sourceKey, source);
    localStorage.setItem(accessKey, secret);
    get("diskStatus").textContent = "Копия обновлена.";
  } catch {
    get("sync-status").textContent = snapshot ? "Обновление недоступно. Открыта сохранённая копия." : "Общая копия недоступна. Проверь ссылку в настройках.";
    get("diskStatus").textContent = "Проверь ссылку, ключ и подключение к интернету.";
  } finally {
    get("update").disabled = false;
  }
}
get("file").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    accept(JSON.parse(await file.text()));
    get("diskStatus").textContent = "Копия открыта.";
  } catch {
    get("diskStatus").textContent = "Не удалось открыть общую копию.";
  }
  event.target.value = "";
});
get("settingsOpen").addEventListener("click", () => get("settingsDialog").showModal());
get("settingsClose").addEventListener("click", () => get("settingsDialog").close());
get("jumpToday").addEventListener("click", () => selectDay(todayKey()));
get("prevMonth").addEventListener("click", () => moveMonth(-1));
get("nextMonth").addEventListener("click", () => moveMonth(1));
get("diskForm").addEventListener("submit", event => {
  event.preventDefault();
  update();
});
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
const invited = invite.has("source") && invite.has("key");
if (invited) {
  get("source").value = invite.get("source");
  get("key").value = invite.get("key");
  history.replaceState(null,"",location.pathname + location.search);
}
loadDraft();
render();
try {
  const saved = localStorage.getItem(snapshotKey);
  if (saved) { snapshot = parse(JSON.parse(saved)); showSnapshot(); }
} catch {}
if (invited || (navigator.onLine && get("source").value && get("key").value)) update();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
