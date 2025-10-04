// backend/middleware.js
import { NextResponse } from "next/server";

const ALLOWED = ["https://upbstudents-labibliotheque.netlify.app"];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

export function middleware(req) {
  const origin = req.headers.get("origin") || "";
  const isAllowed = ALLOWED.includes(origin);
  const responseHeaders = new Headers();

  // ✅ Si c’est une requête preflight OPTIONS
  if (req.method === "OPTIONS") {
    if (isAllowed) {
      const headers = corsHeaders(origin);
      Object.entries(headers).forEach(([k, v]) => responseHeaders.set(k, v));
    }
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  // ✅ Pour les autres requêtes
  const res = NextResponse.next();
  if (isAllowed) {
    const headers = corsHeaders(origin);
    Object.entries(headers).forEach(([k, v]) => res.headers.set(k, v));
  }
  return res;
}
