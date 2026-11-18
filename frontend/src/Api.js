import WebApp from "./tg.js";

const API = import.meta.env.VITE_API_URL;

let token = null;

// A random id kept in this device's storage. The server uses it to spot many
// accounts on one device. (Fingerprints built from phone model etc. would
// wrongly flag different people who own the same phone, so we don't use them.)
function deviceId() {
  try {
    let id = localStorage.getItem("px_device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("px_device", id);
    }
    return id;
  } catch {
    return undefined;
  }
}

export async function login() {
  WebApp.ready();
  WebApp.expand();

  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // initData is the signed string Telegram gives the Mini App
    body: JSON.stringify({ initData: WebApp.initData, deviceHash: deviceId() }),
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
      // Fastify rejects an empty body that is labelled as JSON, so only send
      // the JSON header when there really is a body.
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `API ${res.status}`);
    err.code = data.error;
    err.data = data; // extra fields like { need, have, min }
    err.status = res.status;
    throw err;
  }
  return data;
}

export function haptic(kind = "success") {
  try {
    WebApp.HapticFeedback.notificationOccurred(kind);
  } catch {
    /* not available outside Telegram */
  }
}