(() => {
  "use strict";
  const keys = ["shift-calendar-v1", "shift-calendar-notes-v1", "shift-calendar-crews-v1"];
  const empty = () => Object.fromEntries(keys.map(key => [key, null]));
  const status = document.querySelector("#sync-status");
  const form = document.querySelector("#cloud-login");
  const app = document.querySelector("main");
  const loginPanel = document.querySelector("#cloud-panel");
  const syncTools = document.querySelector("#sync-tools");
  const workTools = document.querySelector("#work-tools");
  const profileName = document.querySelector("#profile-name");
  const toolbar = document.querySelector("#cloud-tools");
  const conflictTools = document.querySelector("#sync-conflict");
  const migrate = document.querySelector("#sync-import");
  let login = null;
  let firstCrewName = null;
  let state;
  let conflict;
  let busy = false;
  let timer;

  function store(next) {
    localStorage.setItem("kalendare-cloud:" + login, JSON.stringify(next));
    state = next;
  }

  function refresh() {
    window.dispatchEvent(new Event("kalendare-sync"));
  }

  async function api(route, method = "GET", data = null) {
    const response = await fetch("./api/" + route, {
      method, cache: "no-store",
      ...(data === null ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) })
    });
    if (!response.ok && response.status !== 409) throw Object.assign(new Error("api"), { status: response.status });
    return { data: await response.json(), conflict: response.status === 409 };
  }

  function schedule(delay = 800) {
    clearTimeout(timer);
    timer = setTimeout(sync, delay);
  }

  function leave() {
    login = null;
    firstCrewName = null;
    conflict = null;
    state = null;
    app.hidden = toolbar.hidden = conflictTools.hidden = true;
    loginPanel.append(syncTools);
    loginPanel.hidden = false;
    form.hidden = false;
    refresh();
  }

  function showCalendar() {
    if (!app.hidden) return;
    workTools.append(syncTools);
    loginPanel.hidden = true;
    app.hidden = false;
  }

  function enter({ login: name, displayName, firstCrewName: lockedName }) {
    profileName.textContent = displayName || name;
    firstCrewName = lockedName || null;
    let cached = null;
    try {
      const saved = JSON.parse(localStorage.getItem("kalendare-cloud:" + name) || "null");
      if (saved?.data && keys.every(key => saved.data[key] === null || typeof saved.data[key] === "string")) {
        cached = saved;
      }
    } catch {}
    login = name;
    state = cached || { revision: null, data: empty(), pending: false };
    migrate.hidden = !keys.some(key => localStorage.getItem(key) !== null);
    toolbar.hidden = false;
    form.hidden = true;
    refresh();
    if (cached) showCalendar();
    sync();
  }

  async function sync() {
    if (!login || busy || conflict) return;
    busy = true;
    let retry = false;
    const sent = state;
    status.textContent = "Синхронизация…";
    try {
      const result = await api("state", sent.pending ? "PUT" : "GET",
        sent.pending ? { revision: sent.revision, data: sent.data } : null);
      const remote = result.data;
      if (result.conflict || (state !== sent && !sent.pending && state.revision !== remote.revision)) {
        conflict = remote;
        conflictTools.hidden = false;
        status.textContent = "Запись изменилась на другом устройстве. Выбери версию.";
      } else {
        const newer = state !== sent;
        const next = {
          revision: remote.revision,
          data: newer ? state.data : remote.data ?? empty(),
          pending: newer
        };
        store(next);
        if (!newer && !sent.pending && keys.some(key => sent.data[key] !== next.data[key])) refresh();
        status.textContent = newer ? "Ожидает синхронизации" : "Синхронизировано";
      }
      showCalendar();
    } catch (error) {
      if (error.status === 401) {
        leave();
        status.textContent = "Войди снова. Сохранённые на устройстве правки будут отправлены после входа.";
      } else {
        status.textContent = state?.pending ? "Правки на устройстве. Ожидают синхронизации." : "Облако недоступно. Повторяем подключение.";
        retry = true;
        if (state?.revision || state?.pending) showCalendar();
      }
    } finally {
      busy = false;
      if (retry || state?.pending && !conflict) schedule(retry ? 15000 : 400);
    }
  }

  function updateAll(values) {
    if (!login || !state) throw new Error("session");
    values = lockFirstCrew(values);
    if (Object.entries(values).every(([key, value]) => state.data[key] === value)) return;
    const data = { ...state.data, ...values };
    const upload = JSON.stringify({ revision: state.revision ?? "0".repeat(36), data });
    if (new TextEncoder().encode(upload).length > 1024 * 1024) {
      throw new Error("Данные превышают допустимый размер синхронизации.");
    }
    store({ ...state, data, pending: true });
    status.textContent = "Ожидает синхронизации";
    schedule();
  }

  window.calendarStorage = {
    get firstCrewName() { return firstCrewName; },
    getItem: key => state?.data[key] ?? null,
    setItem: (key, value) => updateAll({ [key]: value }),
    setItems: updateAll
  };

  function lockFirstCrew(data) {
    const crews = data[keys[2]];
    if (!firstCrewName || typeof crews !== "string") return data;
    const names = JSON.parse(crews);
    if (!Array.isArray(names) || names.length !== 3) return data;
    return { ...data, [keys[2]]: JSON.stringify([firstCrewName, names[1], names[2]]) };
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      const fields = new FormData(form);
      const result = await api("login", "POST", { login: fields.get("login"), password: fields.get("password") });
      form.reset();
      enter(result.data);
    } catch (error) {
      status.textContent = error.status === 401 ? "Не подошёл логин или пароль." :
        error.status === 429 ? "Слишком много попыток. Попробуй через минуту." : "Вход пока недоступен.";
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#cloud-logout").addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    try {
      await api("logout", "POST");
      leave();
      status.textContent = "Выход выполнен.";
    } catch {
      status.textContent = "Не удалось завершить сеанс. Попробуй снова.";
    } finally {
      busy = false;
    }
  });

  conflictTools.addEventListener("click", event => {
    const choice = event.target.dataset.choose;
    if (!conflict || !choice) return;
    if (!confirm(choice === "local" ? "Заменить облачную версию этой копией?" : "Заменить несохранённые правки облачной версией?")) return;
    store({ revision: conflict.revision, data: choice === "local" ? state.data : conflict.data ?? empty(), pending: choice === "local" });
    conflict = null;
    conflictTools.hidden = true;
    refresh();
    sync();
  });

  migrate.addEventListener("click", () => {
    if (busy || conflict || app.hidden) return;
    if (!confirm("Перенести заметки и настройки из прежнего календаря? Заметки с совпадающими датами сохранятся из облачной копии.")) return;
    const data = { ...state.data };
    for (const key of keys) {
      const previous = localStorage.getItem(key);
      if (previous === null) continue;
      if (key === keys[1]) {
        try {
          data[key] = JSON.stringify({ ...JSON.parse(previous), ...JSON.parse(data[key] || "{}") });
        } catch { /* Leave an unreadable legacy value in its original storage. */ }
      } else {
        data[key] ??= previous;
      }
    }
    store({ ...state, data: lockFirstCrew(data), pending: true });
    migrate.hidden = true;
    refresh();
    sync();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) sync(); });
  window.addEventListener("online", sync);
  api("session").then(result => enter(result.data)).catch(error => {
    status.textContent = error.status === 401 ? "" : "Сервис входа пока недоступен.";
  });
})();
