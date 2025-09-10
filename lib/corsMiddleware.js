export function corsD(req, res) {
  // Autoriser ton frontend exact ou '*' pour dev
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://upbstudents.netlify.app"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Si c’est une requête preflight OPTIONS, on répond immédiatement
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true; // indique qu’on a géré la requête
  }
  return false; // continue le traitement normal
}
