import nodemailer from "nodemailer";
import { HttpError } from "./http.js";
import { escapeHtml } from "./validation.js";

let transporter = null;

export function isMailConfigured() {
  return Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

function getTransporter() {
  if (!isMailConfigured()) {
    throw new HttpError(
      503,
      "Le service d'e-mail est momentanément indisponible. Veuillez réessayer plus tard.",
    );
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || "gmail",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return transporter;
}

/**
 * Sends an e-mail. Transport failures are logged and turned into a
 * user-facing French error (never the raw SMTP message).
 */
export async function sendMail({ to, subject, text, html, replyTo }) {
  const transport = getTransporter();
  try {
    await transport.sendMail({
      from: `"UpB Student's" <${process.env.EMAIL_USER}>`,
      to,
      replyTo,
      subject,
      text,
      html,
    });
  } catch (err) {
    console.error("[mailer]", err);
    throw new HttpError(
      502,
      "L'e-mail n'a pas pu être envoyé. Veuillez réessayer dans quelques instants.",
    );
  }
}

/** Minimal branded layout; every dynamic value must already be escaped. */
export function emailLayout(title, bodyHtml) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="background:#fff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden">
<div style="background:#16325c;color:#fff;padding:18px 24px;font-size:16px;font-weight:bold">UpB Student's · ${escapeHtml(title)}</div>
<div style="padding:24px;font-size:14px;line-height:1.6">${bodyHtml}</div>
</div>
<p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px">Bibliothèque numérique UpB Student's · Gama Labs</p>
</div></body></html>`;
}

export function detailsTable(rows) {
  return `<table style="width:100%;border-collapse:collapse">${rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#6b7280;width:38%;vertical-align:top">${escapeHtml(k)}</td><td style="padding:6px 0;font-weight:bold">${escapeHtml(v)}</td></tr>`,
    )
    .join("")}</table>`;
}
