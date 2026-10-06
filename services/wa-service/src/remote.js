// Stockage distant (Supabase) pour les hébergeurs dont le disque est éphémère (ex. Render gratuit).
// Active avec SESSION_STORE=supabase + SUPABASE_URL + SUPABASE_SERVICE_KEY.
// Table clé/valeur public.wa_state (migration 20261002030000_wa_state.sql) :
//   "session:<nom>"  → fichiers de la session WhatsApp
//   "queue"          → file d'attente et campagnes
// Client REST minimal (fetch) : aucune dépendance supplémentaire.

export const remoteEnabled = () => process.env.SESSION_STORE === "supabase";

const enc = encodeURIComponent;

async function rest(method, query, { body, headers } = {}) {
  const base = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!base || !key) {
    throw new Error("SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis avec SESSION_STORE=supabase");
  }
  const res = await fetch(`${base}/rest/v1/wa_state${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Supabase ${method} wa_state → ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

/** Toutes les lignes dont la clé commence par `prefix` : [{ key, value }]. */
export async function getByPrefix(prefix) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest("GET", `?select=key,value&key=like.${enc(prefix)}*&order=key&limit=1000&offset=${offset}`);
    rows.push(...(page || []));
    if (!page || page.length < 1000) return rows;
  }
}

export async function getOne(key) {
  const rows = await rest("GET", `?select=value&key=eq.${enc(key)}&limit=1`);
  return rows?.[0]?.value ?? null;
}

/** rows : [{ key, value }] — insère ou remplace. */
export async function upsertMany(rows) {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 200) {
    await rest("POST", "?on_conflict=key", {
      body: rows.slice(i, i + 200).map((r) => ({ key: r.key, value: r.value, updated_at: now })),
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    });
  }
}

export async function removeKeys(keys) {
  for (let i = 0; i < keys.length; i += 20) {
    await Promise.all(
      keys.slice(i, i + 20).map((k) => rest("DELETE", `?key=eq.${enc(k)}`, { headers: { Prefer: "return=minimal" } })),
    );
  }
}

export const removeByPrefix = (prefix) =>
  rest("DELETE", `?key=like.${enc(prefix)}*`, { headers: { Prefer: "return=minimal" } });

// ---------- Verrou (une seule instance connectée à WhatsApp à la fois) ----------
// Deux copies du service (déploiement qui se chevauche, réveil de l'hébergeur) qui utilisent la
// même session WhatsApp se chassent mutuellement (code 440) et mélangent les clés de chiffrement :
// les destinataires voient alors « En attente de ce message ». Le verrou est un « bail » stocké dans
// la ligne "lock" de wa_state : valable ttlMs, renouvelé tant que l'instance vit, repris par une autre
// si elle disparaît.
const iso = (ms) => new Date(ms).toISOString();

/** true si l'instance `owner` détient (ou vient de prendre) le verrou `name`. */
export async function acquireLock(name, owner, ttlMs) {
  const now = Date.now();
  const value = { owner, expiresAt: iso(now + ttlMs) };

  // 1) Première prise : la ligne n'existe pas encore, on la crée.
  const created = await rest("POST", "?on_conflict=key", {
    body: [{ key: name, value, updated_at: iso(now) }],
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
  });
  if (Array.isArray(created) && created.length > 0) return true;

  // 2) La ligne existe : on la prend si le bail est expiré OU s'il est déjà à nous (renouvellement).
  // Les dates ISO se comparent correctement comme du texte.
  const condition = `or=(value->>expiresAt.lt.${enc(iso(now))},value->>owner.eq.${enc(owner)})`;
  const updated = await rest("PATCH", `?key=eq.${enc(name)}&${condition}`, {
    body: { value, updated_at: iso(now) },
    headers: { Prefer: "return=representation" },
  });
  return Array.isArray(updated) && updated.length > 0;
}

/** Libère le verrou s'il est à nous (arrêt propre : la prochaine instance le prend tout de suite). */
export async function releaseLock(name, owner) {
  await rest("PATCH", `?key=eq.${enc(name)}&value->>owner=eq.${enc(owner)}`, {
    body: { value: { owner: null, expiresAt: iso(0) }, updated_at: iso(Date.now()) },
    headers: { Prefer: "return=minimal" },
  });
}
