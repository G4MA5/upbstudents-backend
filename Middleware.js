// backend/middleware.js - CORRIGÉ ET ROBUSTE

import { NextResponse } from "next/server";
// import type { NextRequest } from "next/server"; // Optionnel, mais recommandé si vous utilisez TypeScript

// Liste des origines autorisées
const ALLOWED_ORIGINS = ["https://upbstudents-labibliotheque.netlify.app"];

// Configuration des en-têtes pour le pré-vol et les requêtes réelles
const CORS_HEADERS = {
  // Les méthodes que le client est autorisé à utiliser
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  // Les en-têtes personnalisés que le client est autorisé à envoyer
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  // Permet d'inclure des cookies (nécessaire si vous utilisez des tokens/cookies)
  "Access-Control-Allow-Credentials": "true",
  // Mise en cache du pré-vol (24 heures)
  "Access-Control-Max-Age": "86400",
};

// 🛑 IMPORTANT : Définir le matcher pour cibler uniquement les routes API
export const config = {
  matcher: "/api/:path*",
};

export function middleware(req) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED_ORIGINS.includes(origin);
  const isPreflight = req.method === "OPTIONS";

  // --- 1. Gestion de la requête OPTIONS (Pré-vol) ---
  if (isPreflight) {
    // Crée une réponse 204 (No Content) pour le pré-vol
    const response = new Response(null, { status: 204 });

    // Ajoute les headers CORS généraux à la réponse 204
    Object.entries(CORS_HEADERS).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    // Ajoute l'en-tête Access-Control-Allow-Origin SEULEMENT si l'origine est autorisée
    if (isAllowed) {
      response.headers.set("Access-Control-Allow-Origin", origin);
    }

    // C'est cette réponse qui résout l'erreur "missing Allow origin header"
    return response;
  }

  // --- 2. Gestion des requêtes réelles (GET, POST, etc.) ---
  const res = NextResponse.next();

  if (isAllowed) {
    // Pour la requête réelle, ACAO est le plus critique
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return res;
}
