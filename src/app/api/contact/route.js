import nodemailer from "nodemailer";
const FRONT_ORIGINS = [
  "https://upbstudents-labibliotheque.netlify.app",
  "https://upbstudents-labibliotheque.com",
];
function corsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (FRONT_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}
export async function POST(req) {
  const origin = req.headers.get("origin") || "";
  try {
    const { nom, email, objet, message } = await req.json();

    // --- 1️⃣ Envoi email ---
    const transporter = nodemailer.createTransport({
      service: "gmail", // ou autre SMTP
      auth: {
        user: process.env.EMAIL_USER, // ton email d'envoi
        pass: process.env.EMAIL_PASS, // mot de passe d'application Gmail
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_RECEIVER, // ton email qui reçoit les messages
      replyTo: email, // pour pouvoir répondre directement à l'utilisateur
      subject: objet || `Nouveau message de ${nom}`,
      text: ` De : ${nom} <${email}>\n\n${message}`,
    };

    await transporter.sendMail(mailOptions);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Erreur lors de l'envoi" }), {
      status: 500,
      headers: corsHeaders(origin),
    });
  }
}
export async function OPTIONS(req) {
  const origin = req.headers.get("origin") || "";
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
