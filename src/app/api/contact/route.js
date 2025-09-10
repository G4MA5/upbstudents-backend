import nodemailer from "nodemailer";

export async function POST(req) {
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
    });
  }
}
