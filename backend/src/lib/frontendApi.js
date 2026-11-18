import WebApp from "@twa-dev/sdk";

const API = import.meta.env.VITE_API_URL;

let token = null;

export async function login() {
  WebApp.ready();
  WebApp.expand();

  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // initData is the signed string Telegram gives the Mini App
    body: JSON.stringify({ initData: WebApp.initData }),
  });
  if (!res.ok) throw new Error("login failed");

  const data = await res.json();
  token = data.token;
  return data.user;
}

export async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}