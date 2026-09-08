// Connecteur Communication - Email (SMTP generique). Fonctionne avec
// n'importe quel fournisseur SMTP (Gmail necessite un "mot de passe
// d'application", pas le mot de passe du compte).
const nodemailer = require('nodemailer');

async function sendMail({ smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, to, subject, body }) {
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(smtpPort) || 587,
    secure: !!smtpSecure,
    auth: { user: smtpUser, pass: smtpPass }
  });
  const info = await transporter.sendMail({ from: smtpUser, to, subject, text: body });
  return { messageId: info.messageId };
}

module.exports = { sendMail };
