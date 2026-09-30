import { NextResponse } from "next/server";
import { FRONTEND_URL } from "../../../../../lib/config.js";
import { loadProfile, sessionPayload } from "../../../../../lib/http.js";
import { createAnonClient } from "../../../../../lib/supabaseClient.js";

const STATE_COOKIE = "google_oauth_state";

function frontendRedirect({ error, session }) {
  const destination = new URL("/", FRONTEND_URL);
  if (error) {
    destination.searchParams.set("google_error", error);
  } else {
    const hash = new URLSearchParams({
      ...session,
      expires_at: String(session.expires_at),
      type: "google",
    });
    destination.hash = hash.toString();
  }

  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google/callback",
    maxAge: 0,
  });
  return response;
}

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const returnedState = searchParams.get("state");
  const storedState = request.cookies.get(STATE_COOKIE)?.value;

  if (!returnedState || !storedState || returnedState !== storedState) {
    return frontendRedirect({ error: "invalid_state" });
  }

  const googleError = searchParams.get("error");
  if (googleError) {
    return frontendRedirect({
      error: googleError === "access_denied" ? "cancelled" : "oauth_failed",
    });
  }

  const code = searchParams.get("code");
  if (!code) return frontendRedirect({ error: "oauth_failed" });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[google] Configuration OAuth manquante");
    return frontendRedirect({ error: "server_configuration" });
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/api/google/callback`,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenResponse.ok) {
      console.error("[google] Échec de l'échange du code OAuth");
      return frontendRedirect({ error: "oauth_failed" });
    }

    const tokens = await tokenResponse.json();
    if (!tokens.id_token) {
      console.error("[google] Jeton d'identité absent de la réponse OAuth");
      return frontendRedirect({ error: "oauth_failed" });
    }

    const client = createAnonClient();
    const { data, error } = await client.auth.signInWithIdToken({
      provider: "google",
      token: tokens.id_token,
    });

    if (error || !data?.user || !data.session) {
      console.error("[google] Échec de connexion Supabase", error?.message);
      return frontendRedirect({ error: "provider_configuration" });
    }

    if (!data.user.email || !data.user.email_confirmed_at) {
      return frontendRedirect({ error: "unverified_email" });
    }

    try {
      await loadProfile(data.user);
    } catch (profileError) {
      if (profileError?.extra?.code === "ACCOUNT_LINK_CONFLICT") {
        return frontendRedirect({ error: "account_conflict" });
      }
      throw profileError;
    }

    return frontendRedirect({ session: sessionPayload(data.session) });
  } catch (error) {
    console.error("[google] Erreur lors de l'authentification", error);
    return frontendRedirect({ error: "authentication_failed" });
  }
}