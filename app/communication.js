// Connecteur Communication (§3 : "Redaction et suivi de messages
// mail/Discord"). Toute action d'envoi est "Sensible" (§14.1) :
// confirmation explicite geree cote UI avant l'appel, et un apercu est
// toujours affiche avant (F-09, principe releve dans la carte mentale).
const core = require('./core');
const store = require('./store');
const mail = require('./connectors/mail');
const discord = require('./connectors/discord');

const COMM_FIELDS = ['smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpPass', 'discordWebhookUrl'];

function getCommStatus() {
  const config = core.loadConfig();
  return {
    mail: !!(config.smtpHost && config.smtpUser && config.smtpPass),
    discord: !!config.discordWebhookUrl
  };
}

function setCommField(key, value) {
  if (!COMM_FIELDS.includes(key)) throw new Error(`Champ inconnu : ${key}.`);
  const config = core.loadConfig();
  config[key] = value;
  core.saveConfig(config);
  return getCommStatus();
}

function friendlyMailError(err) {
  if (err.responseCode === 535 || /invalid login|authentication/i.test(err.message)) {
    return 'Authentification SMTP refusée (identifiants ou mot de passe d’application incorrects).';
  }
  return err.message;
}

// mail.send (Sensible)
async function mailSend({ to, subject, body }) {
  if (!to || !to.trim()) throw new Error('Destinataire manquant.');
  const config = core.loadConfig();
  if (!config.smtpHost || !config.smtpUser || !config.smtpPass) throw new Error('SMTP non configuré.');
  try {
    const result = await mail.sendMail({ ...config, to, subject, body });
    store.logAction({ typeAction: 'mail.send', sensibilite: 'sensible', statut: 'execute', details: { to, subject } });
    return result;
  } catch (err) {
    const message = friendlyMailError(err);
    store.logAction({ typeAction: 'mail.send', sensibilite: 'sensible', statut: 'echoue', details: { error: message } });
    throw new Error(message);
  }
}

// discord.send_message (Sensible)
async function discordSend(content) {
  if (!content || !content.trim()) throw new Error('Message vide.');
  const config = core.loadConfig();
  if (!config.discordWebhookUrl) throw new Error('Webhook Discord non configuré.');
  try {
    const result = await discord.sendWebhookMessage({ webhookUrl: config.discordWebhookUrl, content });
    store.logAction({ typeAction: 'discord.send_message', sensibilite: 'sensible', statut: 'execute', details: { length: content.length } });
    return result;
  } catch (err) {
    store.logAction({ typeAction: 'discord.send_message', sensibilite: 'sensible', statut: 'echoue', details: { error: err.message } });
    throw new Error(`Discord : ${err.message}`);
  }
}

module.exports = { getCommStatus, setCommField, mailSend, discordSend };
