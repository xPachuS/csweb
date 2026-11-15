import { WORKER_URL } from './config.js';

export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const KEY = 'clutch:session';
export function session() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function saveSession(s) {
  try { if (s && s.token) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
}

/** Llamada al Worker. Lanza ApiError con un mensaje en castellano. */
export async function call(method, path, body) {
  const s = session();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  let res;
  try {
    res = await fetch(WORKER_URL + path, {
      method, signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(s.token ? { Authorization: `Bearer ${s.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, err.name === 'AbortError'
      ? 'El servidor tarda demasiado en responder. Si estás en España durante un partido de fútbol, puede que tu operador esté bloqueando Cloudflare: prueba con datos móviles o más tarde.'
      : 'No se pudo conectar con el servidor. Revisa tu conexión.');
  } finally { clearTimeout(timer); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new ApiError(res.status, data.error || `Error ${res.status}`);
  return data;
}

let matchesCache = null;
/** Partidos, fases y reglas (con las correcciones del administrador). Se guarda 30 s. */
export async function getMatches(force = false) {
  if (!force && matchesCache && Date.now() - matchesCache.t < 30_000) return matchesCache.data;
  const data = await call('GET', '/matches');
  for (const m of data.matches) m.time = m.date ? new Date(m.date) : null;
  matchesCache = { t: Date.now(), data };
  return data;
}
export const clearMatches = () => { matchesCache = null; };
