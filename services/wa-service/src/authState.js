// État d'authentification WhatsApp (la "session").
//  - SESSION_STORE absent  : fichiers dans AUTH_DIR (défaut "auth") — hébergeur avec disque persistant.
//  - SESSION_STORE=supabase : table wa_state — hébergeur au disque éphémère (Render gratuit) :
//    un redémarrage reprend la session sans rescanner le QR code.
import fs from "node:fs";
import { BufferJSON, initAuthCreds, proto, useMultiFileAuthState } from "@whiskeysockets/baileys";
import * as remote from "./remote.js";

const PREFIX = "session:";
const FLUSH_DELAY_MS = 300;
const RETRY_DELAY_MS = 5000;

// Les clés contiennent des Buffer : on passe par BufferJSON de Baileys pour les stocker en JSON.
const toStored = (value) => JSON.parse(JSON.stringify(value, BufferJSON.replacer));
const fromStored = (value) => JSON.parse(JSON.stringify(value), BufferJSON.reviver);

export async function useAuthState() {
  if (!remote.remoteEnabled()) {
    const dir = process.env.AUTH_DIR || "auth";
    const result = await useMultiFileAuthState(dir);
    return {
      ...result,
      flush: async () => {},
      clear: async () => fs.rmSync(dir, { recursive: true, force: true }),
    };
  }

  // Mode Supabase : tout est chargé en mémoire au démarrage (quelques dizaines de lignes),
  // les lectures sont locales et les écritures partent en lot, avec nouvel essai en cas d'échec.
  const cache = new Map((await remote.getByPrefix(PREFIX)).map((r) => [r.key.slice(PREFIX.length), r.value]));
  const pendingSet = new Map();
  const pendingDelete = new Set();
  let timer = null;
  let chain = Promise.resolve();

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    chain = chain.then(async () => {
      const sets = [...pendingSet];
      const deletes = [...pendingDelete];
      pendingSet.clear();
      pendingDelete.clear();
      try {
        await remote.upsertMany(sets.map(([name, value]) => ({ key: PREFIX + name, value })));
        await remote.removeKeys(deletes.map((name) => PREFIX + name));
      } catch (err) {
        console.error("[session] sauvegarde Supabase impossible, nouvel essai :", err.message);
        // On remet en attente sans écraser une valeur plus récente.
        for (const [name, value] of sets) if (!pendingSet.has(name) && !pendingDelete.has(name)) pendingSet.set(name, value);
        for (const name of deletes) if (!pendingSet.has(name) && !pendingDelete.has(name)) pendingDelete.add(name);
        if (!timer) timer = setTimeout(flush, RETRY_DELAY_MS);
      }
    });
    return chain;
  };

  const schedule = () => {
    if (!timer) timer = setTimeout(flush, FLUSH_DELAY_MS);
  };
  const write = (name, value) => {
    const stored = toStored(value);
    cache.set(name, stored);
    pendingDelete.delete(name);
    pendingSet.set(name, stored);
    schedule();
  };
  const del = (name) => {
    cache.delete(name);
    pendingSet.delete(name);
    pendingDelete.add(name);
    schedule();
  };

  const creds = cache.has("creds") ? fromStored(cache.get("creds")) : initAuthCreds();
  if (!cache.has("creds")) write("creds", creds);

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          for (const id of ids) {
            const stored = cache.get(`${type}-${id}`);
            let value = stored === undefined ? undefined : fromStored(stored);
            if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            data[id] = value;
          }
          return data;
        },
        set: async (data) => {
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              if (value) write(`${category}-${id}`, value);
              else del(`${category}-${id}`);
            }
          }
        },
      },
    },
    saveCreds: async () => write("creds", creds),
    flush,
    // Déconnexion depuis le téléphone : on efface la session pour obtenir un nouveau QR code.
    clear: async () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pendingSet.clear();
      pendingDelete.clear();
      cache.clear();
      await chain;
      await remote.removeByPrefix(PREFIX);
    },
  };
}
