import { HttpError } from "./http.js";

export const FILIERES = ["MIAGE", "ASSRI", "SEA", "SEG", "3EA", "SJAP", "RIT"];

export const NIVEAUX_INSCRIPTION = ["Licence 1", "Licence 2", "Licence 3"];

export const NIVEAUX = [
  ...NIVEAUX_INSCRIPTION,
  "Master 1",
  "Master 2",
  "Licence",
  "Master",
];

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

/**
 * Nettoie une valeur texte :
 * - convertit en chaîne
 * - remplace les espaces multiples
 * - supprime les espaces au début et à la fin
 * - limite la longueur
 */
export function clean(value, max = 200) {
  if (value === undefined || value === null) return "";

  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Nettoie un texte pouvant contenir plusieurs lignes.
 */
export function cleanMultiline(value, max = 5000) {
  if (value === undefined || value === null) return "";

  return String(value).replace(/\r\n/g, "\n").trim().slice(0, max);
}

/**
 * Vérifie qu'une adresse e-mail est valide.
 */
export function isEmail(value) {
  return EMAIL_RE.test(value) && value.length <= 254;
}

/**
 * Normalise une adresse e-mail.
 */
export function normalizeEmail(value) {
  return clean(value, 254).toLowerCase();
}

/**
 * Vérifie que les champs obligatoires sont présents.
 */
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

/**
 * Vérifie qu'une valeur appartient à une liste autorisée.
 */
export function requireOneOf(value, list, label) {
  if (!list.includes(value)) {
    throw new HttpError(400, `${label} invalide.`);
  }
}

/**
 * Vérifie la validité du mot de passe.
 */
export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    throw new HttpError(
      400,
      "Le mot de passe doit contenir au moins 8 caractères.",
    );
  }

  if (password.length > 72) {
    throw new HttpError(
      400,
      "Le mot de passe est trop long (72 caractères maximum).",
    );
  }
}

/**
 * Vérifie qu'une année est valide.
 */
export function validateYear(annee) {
  const year = Number(annee);
  const current = new Date().getFullYear();

  if (!/^\d{4}$/.test(String(annee)) || year < 2000 || year > current + 1) {
    throw new HttpError(400, "Année invalide.");
  }
}

/**
 * Vérifie le type et la taille d'un fichier.
 */
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
 * Rend une valeur sûre pour les clés de stockage.
 *
 * Les accents sont supprimés et les caractères spéciaux
 * sont remplacés.
 */
export function storageSafe(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ._-]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Échappe les caractères HTML dangereux.
 */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
