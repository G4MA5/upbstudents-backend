// backend/middleware.js
import { NextResponse } from "next/server";

// L'origine de votre frontend
const ALLOWED = ["https://upbstudents-labibliotheque.netlify.app"];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true", // Cache le résultat du pré-vol pendant 24h (86400 secondes)
    "Access-Control-Max-Age": "86400",
  };
}

export function middleware(req) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED.includes(origin); // --- 1. GESTION DE LA REQUÊTE PRÉ-VOL (OPTIONS) ---
  if (req.method === "OPTIONS") {
    const headers = new Headers();
    if (isAllowed) {
      // Ajoute TOUS les headers CORS à la réponse OPTIONS (c'est la clé)
      const ch = corsHeaders(origin);
      Object.entries(ch).forEach(([k, v]) => headers.set(k, v));
    } // Retourne une réponse 204 No Content avec les en-têtes CORS
    return new Response(null, { status: 204, headers });
  } // --- 2. GESTION DES AUTRES REQUÊTES (GET, POST, etc.) ---

  const res = NextResponse.next();
  if (isAllowed) {
    // Ajoute les en-têtes CORS nécessaires à la réponse de la requête principale
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
  }
  return res;
}
