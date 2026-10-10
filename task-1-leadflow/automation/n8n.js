const WEBHOOK_TIMEOUT_MS = 3000;

async function notifyLeadCreated(lead) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return false;
  }

  let destination;
  try {
    destination = new URL(webhookUrl);
  } catch {
    console.error('n8n notification skipped: N8N_WEBHOOK_URL is not a valid URL. The lead remains saved.');
    return false;
  }

  if (destination.protocol !== 'http:' && destination.protocol !== 'https:') {
    console.error('n8n notification skipped: N8N_WEBHOOK_URL must use HTTP or HTTPS. The lead remains saved.');
    return false;
  }

  try {
    const response = await fetch(destination, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'lead.created',
        sentAt: new Date().toISOString(),
        lead: typeof lead.toObject === 'function' ? lead.toObject() : lead,
      }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(
        `n8n notification failed with HTTP ${response.status}. The lead remains saved.`,
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      `n8n notification failed (${error.name || 'Error'}). The lead remains saved.`,
    );
    return false;
  }
}

module.exports = { notifyLeadCreated };
