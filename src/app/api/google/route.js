import { NextResponse } from "next/server";
import { FRONTEND_URL } from "../../../../lib/config.js";

const STATE_COOKIE = "google_oauth_state";

export async function GET(request) {
  const { origin } = new URL(request.url);

  const googleClientId = process.env.GOOGLE_CLIENT_ID;

  if (!googleClientId) {
    const destination = new URL("/", FRONTEND_URL);
    destination.searchParams.set("google_error", "server_configuration");
    return NextResponse.redirect(destination);
  }

  const redirectUri = `${origin}/api/google/callback`;
  const state = crypto.randomUUID();
  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  googleAuthUrl.searchParams.set("client_id", googleClientId);
  googleAuthUrl.searchParams.set("redirect_uri", redirectUri);
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("prompt", "select_account");
  googleAuthUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(googleAuthUrl.toString());
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google/callback",
    maxAge: 10 * 60,
  });
  return response;
}
