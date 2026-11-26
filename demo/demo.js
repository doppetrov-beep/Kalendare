"use strict";

window.kalendareDemoFetch = async (route, options) => {
  const account = "kalendare-phone-demo";
  const sessionKey = account + ":session";
  const stateKey = account + ":state";
  if (route === "login") {
    localStorage.setItem(sessionKey, "signed-in");
    return Response.json({ login: account });
  }
  if (route === "logout") {
    localStorage.removeItem(sessionKey);
    return Response.json({});
  }
  if (!localStorage.getItem(sessionKey)) return Response.json({}, { status: 401 });
  if (route === "session") return Response.json({ login: account });
  const state = JSON.parse(localStorage.getItem(stateKey) || '{"revision":null,"data":null}');
  if (options.method === "GET") return Response.json(state);
  const next = JSON.parse(options.body);
  if (state.revision !== next.revision) return Response.json(state, { status: 409 });
  const saved = { revision: crypto.randomUUID(), data: next.data };
  localStorage.setItem(stateKey, JSON.stringify(saved));
  return Response.json(saved);
};
