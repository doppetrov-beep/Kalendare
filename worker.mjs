const encoder = new TextEncoder();
const cookieName = "__Host-kalendare";
const loginPattern = /^[a-z0-9][a-z0-9_-]{1,39}$/;
const versionPattern = /^[a-f0-9-]{36}$/;
const storageKeys = ["shift-calendar-v1", "shift-calendar-notes-v1", "shift-calendar-crews-v1"];
const maxBody = 1024 * 1024;

function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function key(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sign(secret, value) {
  return hex(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(value)));
}

async function verify(secret, value, signature) {
  if (!/^[a-f0-9]{64}$/.test(signature ?? "")) return false;
  const bytes = Uint8Array.from(signature.match(/../g), byte => parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", await key(secret), bytes, encoder.encode(value));
}

async function body(request, maxBytes) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json") || !request.body) throw new Error("body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let content = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error("size");
      content += decoder.decode(value, { stream: true });
    }
    return JSON.parse(content + decoder.decode());
  } finally {
    await reader.cancel();
  }
}

function sessionCookie(value, lifetime) {
  return cookieName + "=" + value + "; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=" + lifetime;
}

function accountVerifier(account) {
  return typeof account === "string" ? account : account?.verifier;
}

function profile(login, account) {
  return {
    login,
    displayName: account?.displayName || login,
    firstCrewName: account?.firstCrewName ?? null,
    lockedCycleStart: login === "admin" ? null : "2026-10-21",
    canRestoreBackup: account?.canRestoreBackup !== false
  };
}

async function session(request, env, accounts) {
  const cookie = (request.headers.get("Cookie") ?? "").split(/;\s*/).find(value => value.startsWith(cookieName + "="));
  const [login, expires, signature] = (cookie?.slice(cookieName.length + 1) ?? "").split(".");
  if (!loginPattern.test(login) || !Object.hasOwn(accounts, login) || Number(expires) <= Date.now()) return null;
  const verifier = accountVerifier(accounts[login]);
  return verifier && await verify(env.AUTH_SECRET, ["session", login, expires, verifier].join(":"), signature) ? login : null;
}

function validSnapshot(payload) {
  if (!payload || !versionPattern.test(payload.revision) && payload.revision !== null) return false;
  const data = payload.data;
  return data && Object.keys(data).length === storageKeys.length &&
    storageKeys.every(name => Object.hasOwn(data, name) && (data[name] === null || typeof data[name] === "string"));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      if (!/^\/work(?:\/|$)/.test(url.pathname)) return env.ASSETS.fetch(request);
      if (!env.AUTH_SECRET || !env.ACCOUNTS) return json({ error: "setup" }, 503);
      if (!await session(request, env, JSON.parse(env.ACCOUNTS))) return Response.redirect(new URL("/", url), 303);
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) return json({ error: "origin" }, 403);
    if (!env.AUTH_SECRET || !env.ACCOUNTS || !env.DISK_TOKEN) return json({ error: "setup" }, 503);
    try {
      const accounts = JSON.parse(env.ACCOUNTS);
      const ip = request.headers.get("CF-Connecting-IP") ?? "local";
      if (url.pathname === "/api/login" && request.method === "POST") {
        if (!(await env.LOGIN_LIMIT.limit({ key: ip })).success) return json({ error: "rate" }, 429);
        const credentials = await body(request, 1024).catch(() => null);
        const login = String(credentials?.login ?? "").trim().toLowerCase();
        const password = credentials?.password;
        const account = Object.hasOwn(accounts, login) ? accounts[login] : null;
        const verifier = accountVerifier(account) ?? "0".repeat(64);
        const valid = loginPattern.test(login) && typeof password === "string" && password.length <= 128 &&
          await verify(env.AUTH_SECRET, ["password", login, password].join(":"), verifier);
        if (!valid) return json({ error: "credentials" }, 401);
        const lifetime = 14 * 24 * 60 * 60;
        const expires = Date.now() + lifetime * 1000;
        const signature = await sign(env.AUTH_SECRET, ["session", login, expires, verifier].join(":"));
        return json(profile(login, account), 200, { "Set-Cookie": sessionCookie([login, expires, signature].join("."), lifetime) });
      }
      if (url.pathname === "/api/logout" && request.method === "POST") {
        return json({}, 200, { "Set-Cookie": sessionCookie("", 0) });
      }
      const login = await session(request, env, accounts);
      if (!login) return json({ error: "session" }, 401);
      if (url.pathname === "/api/session" && request.method === "GET") return json(profile(login, accounts[login]));
      if (url.pathname !== "/api/state" || !["GET", "PUT"].includes(request.method)) return json({ error: "route" }, 404);
      if (!(await env.SYNC_LIMIT.limit({ key: login })).success) return json({ error: "rate" }, 429);
      const object = env.SYNC.get(env.SYNC.idFromName(login));
      if (request.method === "GET") return object.fetch("https://sync.internal/" + login);
      const payload = await body(request, maxBody).catch(() => null);
      if (!validSnapshot(payload)) return json({ error: "data" }, 400);
      const { firstCrewName, lockedCycleStart } = profile(login, accounts[login]);
      const settings = payload.data[storageKeys[0]];
      if (lockedCycleStart && settings !== null) {
        const calendar = await Promise.resolve().then(() => JSON.parse(settings)).catch(() => null);
        if (calendar?.base !== lockedCycleStart) return json({ error: "cycle_start_locked" }, 403);
      }
      const crews = payload.data[storageKeys[2]];
      if (firstCrewName && crews !== null) {
        const names = await Promise.resolve().then(() => JSON.parse(crews)).catch(() => null);
        if (!Array.isArray(names) || names.length !== 3 || names[0] !== firstCrewName) {
          return json({ error: "first_crew_locked" }, 403);
        }
      }
      return object.fetch("https://sync.internal/" + login, { method: "PUT", body: JSON.stringify(payload) });
    } catch {
      return json({ error: "unavailable" }, 503);
    }
  }
};

async function diskLink(env, login, operation) {
  const url = new URL("https://cloud-api.yandex.net/v1/disk/resources/" + operation);
  url.searchParams.set("path", "app:/" + login + ".json");
  if (operation === "upload") url.searchParams.set("overwrite", "true");
  const response = await fetch(url, {
    headers: { Authorization: "OAuth " + env.DISK_TOKEN },
    signal: AbortSignal.timeout(6000),
    redirect: "manual"
  });
  if (operation === "download" && response.status === 404) {
    const failure = await response.json();
    if (failure.error === "DiskNotFoundError") return null;
  }
  if (!response.ok) throw new Error("disk_" + operation + "_http_" + response.status);
  const { href } = await response.json();
  if (new URL(href).protocol !== "https:") throw new Error("disk");
  return href;
}

export class DiskSync {
  constructor(context, env) {
    this.context = context;
    this.env = env;
  }

  async fetch(request) {
    // One coordinator per profile serializes the read/check/write sequence.
    // The persistent snapshot itself lives on Yandex Disk.
    return this.context.blockConcurrencyWhile(async () => {
      let step = "download_link";
      try {
        const login = new URL(request.url).pathname.slice(1);
        const download = await diskLink(this.env, login, "download");
        let current = { revision: null, data: null };
        if (download) {
          step = "download_file";
          const response = await fetch(download, { signal: AbortSignal.timeout(6000) });
          if (!response.ok) throw new Error("download");
          current = await response.json();
          if (!validSnapshot(current) || !current.revision) throw new Error("snapshot");
        }
        if (request.method === "GET") return json(current);
        const next = await request.json();
        if (next.revision !== current.revision) return json(current, 409);
        const snapshot = { revision: crypto.randomUUID(), data: next.data };
        step = "upload_link";
        const upload = await diskLink(this.env, login, "upload");
        step = "upload_file";
        const response = await fetch(upload, {
          method: "PUT", body: JSON.stringify(snapshot), signal: AbortSignal.timeout(6000)
        });
        if (!response.ok) throw new Error("upload");
        return json(snapshot);
      } catch (error) {
        const upstream = /^disk_(download|upload)_http_\d{3}$/.test(error?.message ?? "") ? error.message : null;
        return json({ error: "disk", reason: upstream ?? step }, 503);
      }
    });
  }
}
