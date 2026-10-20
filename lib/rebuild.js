// Asks Netlify to rebuild the website after the library changes, so the new
// document gets its own page and enters the sitemaps (search engines, AI).
// Enabled only when NETLIFY_BUILD_HOOK_URL is set (Netlify → Site configuration
// → Build & deploy → Build hooks). Never blocks nor breaks the request.
export async function requestSiteRebuild(reason) {
  const hook = process.env.NETLIFY_BUILD_HOOK_URL;
  if (!hook) return;
  try {
    const url = new URL(hook);
    url.searchParams.set("trigger_title", `Bibliothèque : ${reason}`.slice(0, 120));
    await fetch(url, { method: "POST", signal: AbortSignal.timeout(4000) });
  } catch (err) {
    console.error("[rebuild] reconstruction du site non demandée", err?.message || err);
  }
}
