import { HttpError } from "./http.js";

export const FILIERES = ["MIAGE", "ASSRI", "SEA", "SEG", "3EA", "SJAP", "RIT"];
export const NIVEAUX_INSCRIPTION = ["Licence 1", "Licence 2", "Licence 3"];
export const NIVEAUX = [...NIVEAUX_INSCRIPTION, "Master 1", "Master 2", "Licence", "Master"];
export const TYPES = ["Examen", "Cours", "TD", "TP", "Mémoire", "Livre"];
export const SESSIONS = ["Session 1", "Session 2"];

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 Mo

export const ALLOWED_FILE_TYPES = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "image/png": "png",
  "image/jpeg": "jpg",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trims, collapses whitespace and bounds the length of a text value. */
export function clean(value, max = 200) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

export function cleanMultiline(value, max = 5000) {
  if (value === undefined || value === null) return "";
  return String(value).replace(/\r\n/g, "\n").trim().slice(0, max);
}

export function isEmail(value) {
  return EMAIL_RE.test(value) && value.length <= 254;
}

export function normalizeEmail(value) {
  return clean(value, 254).toLowerCase();
}

export function requireFields(fields) {
  const missing = Object.entries(fields)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new HttpError(400, "Veuillez remplir tous les champs obligatoires.", {
      fields: missing,
    });
  }
}

export function requireOneOf(value, list, label) {
  if (!list.includes(value)) {
    throw new HttpError(400, `${label} invalide.`);
  }
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new HttpError(
      400,
      "Le mot de passe doit contenir au moins 8 caractères.",
    );
  }
  if (password.length > 72) {
    throw new HttpError(400, "Le mot de passe est trop long (72 caractères maximum).");
  }
}

export function validateYear(annee) {
  const year = Number(annee);
  const current = new Date().getFullYear();
  if (!/^\d{4}$/.test(String(annee)) || year < 2000 || year > current + 1) {
    throw new HttpError(400, "Année invalide.");
  }
}

export function validateFile({ fileType, fileSize }) {
  if (!ALLOWED_FILE_TYPES[fileType]) {
    throw new HttpError(
      415,
      "Format non pris en charge. Formats acceptés : PDF, DOC, DOCX, PNG, JPG.",
    );
  }
  const size = Number(fileSize);
  if (!Number.isFinite(size) || size <= 0) {
    throw new HttpError(400, "Le fichier est vide.");
  }
  if (size > MAX_FILE_SIZE) {
    throw new HttpError(413, "Le fichier dépasse la taille maximale de 20 Mo.");
  }
}

/**
 * Storage keys only accept a safe ASCII subset: accents are stripped and
 * everything else is replaced, so free-text subject names never produce an
 * invalid key.
 */
export function storageSafe(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ._-]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
