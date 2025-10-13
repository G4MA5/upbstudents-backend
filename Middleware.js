// backend/middleware.js
import { NextResponse } from "next/server";

// Liste des origines autorisées
const ALLOWED = [
  "https://upbstudents-labibliotheque.netlify.app",
  "https://upbstudents-labibliotheque.com",
];

function corsHeaders(origin) {
  return {
    // Essentiel : l'origine autorisée
    "Access-Control-Allow-Origin": origin, // Essentiel : les méthodes autorisées
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", // Essentiel : les en-têtes qui peuvent être envoyés dans la requête
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true", // Optimisation : met en cache les résultats du pré-vol pendant 24h (en secondes)
    "Access-Control-Max-Age": "86400",
  };
}

export function middleware(req) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED.includes(origin); // 1. Gestion de la requête Pré-vol (OPTIONS)
  if (req.method === "OPTIONS") {
    const headers = new Headers();
    if (isAllowed) {
      // Ajoute TOUS les headers CORS à la réponse OPTIONS
      const ch = corsHeaders(origin);
      Object.entries(ch).forEach(([k, v]) => headers.set(k, v));
    } // Retourne une réponse 204 No Content avec les en-têtes CORS // C'est cette réponse qui doit satisfaire le navigateur
    return new Response(null, { status: 204, headers });
  } // 2. Gestion des autres requêtes (GET, POST, etc.)

  const res = NextResponse.next();
  if (isAllowed) {
    // Pour la requête principale, seul ACAO est strictement nécessaire,
    // mais ajoutons Allow-Credentials pour être sûr.
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Access-Control-Allow-Credentials", "true");
  }
  return res;
}
