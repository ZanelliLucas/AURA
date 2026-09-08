// Connecteur Communication - Discord (webhook). "Redaction et suivi de
// messages mail/Discord" (§3). Un webhook suffit pour poster dans un
// salon - pas besoin d'un bot complet pour cette action ponctuelle.
async function sendWebhookMessage({ webhookUrl, content }) {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(text || `Discord webhook (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return { sent: true };
}

module.exports = { sendWebhookMessage };
