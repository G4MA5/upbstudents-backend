// backend/middleware.js
import { NextResponse } from "next/server";

const ALLOWED = ["https://upbstudents-labibliotheque.netlify.app"];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

export function middleware(req) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED.includes(origin);

  // 🔹 Si c’est une requête préflight (OPTIONS)
  if (req.method === "OPTIONS") {
    const headers = new Headers();
    if (isAllowed) {
      Object.entries(corsHeaders(origin)).forEach(([k, v]) =>
        headers.set(k, v)
      );
    }
    return new Response(null, { status: 204, headers });
  }

  // 🔹 Sinon, pour toutes les autres requêtes
  const res = NextResponse.next();
  if (isAllowed) {
    const ch = corsHeaders(origin);
    Object.entries(ch).forEach(([k, v]) => res.headers.set(k, v));
  }
  return res;
}
