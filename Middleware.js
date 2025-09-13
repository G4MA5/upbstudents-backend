// backend/middleware.js
import { NextResponse } from "next/server";

const ALLOWED = ["https://upbstudents-labibliotheque.netlify.app"];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

export function middleware(req) {
  const origin = req.headers.get("origin") || "";
  // si préflight
  if (req.method === "OPTIONS") {
    const headers = new Headers();
    if (ALLOWED.includes(origin)) {
      const ch = corsHeaders(origin);
      Object.entries(ch).forEach(([k, v]) => headers.set(k, v));
    }
    return new Response(null, { status: 204, headers });
  }

  // pour les autres requêtes : laisser passer et ajouter headers
  const res = NextResponse.next();
  if (ALLOWED.includes(origin)) {
    const ch = corsHeaders(origin);
    Object.entries(ch).forEach(([k, v]) => res.headers.set(k, v));
  }
  return res;
}
