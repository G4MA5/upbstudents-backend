export const FRONTEND_URL = (
  process.env.FRONTEND_URL || "https://upbstudents-labibliotheque.com"
).replace(/\/+$/, "");

export const DOCUMENTS_BUCKET = "Doc";
export const PROPOSALS_BUCKET = "propositions";

/** Address that receives contact messages and document proposals. */
export function adminEmail() {
  return process.env.ADMIN_EMAIL || process.env.EMAIL_RECEIVER || "";
}
