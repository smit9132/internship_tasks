require('dotenv').config();

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { once } = require('node:events');
const { after, before, test } = require('node:test');
const mongoose = require('mongoose');
const path = require('node:path');

const app = require('../app');
const connectDB = require('../config/db');
const Lead = require('../models/Lead');

const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const testEmail = `leadflow-test-${testSuffix}@example.test`;
const webhookFailureEmail = `leadflow-webhook-failure-${testSuffix}@example.test`;
const webhookOfflineEmail = `leadflow-webhook-offline-${testSuffix}@example.test`;
const testName = `LeadFlow API Test ${testSuffix}`;
const testSource = `Test-${testSuffix}`;

let server;
let baseUrl;
let webhookServer;
let webhookBaseUrl;
const webhookEvents = [];

test('n8n workflow validates and normalizes lead events', () => {
  const workflow = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'automation', 'lead-created-workflow.json'), 'utf8'),
  );
  const validationCode = workflow.nodes.find(
    (node) => node.name === 'Validate and log lead',
  ).parameters.jsCode;
  const validateLead = new Function('$input', validationCode);
  const lead = {
    _id: '507f1f77bcf86cd799439011',
    name: '  Alex Example  ',
    email: '  ALEX@EXAMPLE.TEST  ',
    phone: '+1 555 0100',
    company: 'Example Co',
    source: 'Website',
    enquiry: 'Interested in a demo.',
    status: 'New',
  };

  const result = validateLead({ first: () => ({ json: { event: 'lead.created', lead } }) })[0].json;
  assert.equal(result.event, 'lead.created');
  assert.equal(result.lead.name, 'Alex Example');
  assert.equal(result.lead.email, 'alex@example.test');
  assert.throws(
    () => validateLead({ first: () => ({ json: { event: 'lead.updated', lead } }) }),
    /Expected a lead\.created event/,
  );
  assert.throws(
    () => validateLead({
      first: () => ({
        json: { event: 'lead.created', lead: { ...lead, email: 'not-an-email' } },
      }),
    }),
    /Lead email is invalid/,
  );
  assert.throws(
    () => validateLead({
      first: () => ({
        json: { event: 'lead.created', lead: { ...lead, status: 'Unknown' } },
      }),
    }),
    /Lead status is invalid/,
  );
});

async function request(path, { method = 'GET', body, rawBody } = {}) {
  const headers = {};
  let requestBody;

  if (rawBody !== undefined) {
    headers['content-type'] = 'application/json';
    requestBody = rawBody;
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: requestBody,
  });
  const responseBody = await response.json();

  return { status: response.status, body: responseBody };
}

before(async () => {
  await connectDB();
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  webhookServer = require('node:http').createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    webhookEvents.push({
      url: req.url,
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    });
    if (req.url === '/offline') {
      req.socket.destroy();
      return;
    }
    res.writeHead(req.url === '/failure' ? 503 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  });
  webhookServer.listen(0, '127.0.0.1');
  await once(webhookServer, 'listening');
  webhookBaseUrl = `http://127.0.0.1:${webhookServer.address().port}`;
});

after(async () => {
  try {
    await Lead.deleteMany({
      email: { $in: [testEmail, webhookFailureEmail, webhookOfflineEmail] },
    });
  } finally {
    await Promise.all(
      [server, webhookServer]
        .filter(Boolean)
        .map(
          (httpServer) =>
            new Promise((resolve, reject) => {
              httpServer.close((error) => (error ? reject(error) : resolve()));
            }),
        ),
    );
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
});

test('Lead API supports CRUD and returns useful validation errors', async (t) => {
  const payload = {
    name: testName,
    email: testEmail,
    phone: '+1 555 0100',
    company: 'LeadFlow Test Company',
    source: testSource,
    enquiry: 'Synthetic automated API test; no personal data.',
  };
  let leadId;

  await t.test('health reports the live MongoDB connection', async () => {
    const result = await request('/api/health');

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.database, 'connected');
  });

  await t.test('creates a lead with a default status and timestamps', async () => {
    process.env.N8N_WEBHOOK_URL = webhookBaseUrl;
    const result = await request('/api/leads', { method: 'POST', body: payload });

    assert.equal(result.status, 201);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.name, testName);
    assert.equal(result.body.data.email, testEmail);
    assert.equal(result.body.data.status, 'New');
    assert.ok(result.body.data._id);
    assert.ok(result.body.data.createdAt);
    assert.ok(result.body.data.updatedAt);
    leadId = result.body.data._id;

    assert.equal(webhookEvents.length, 1);
    assert.equal(webhookEvents[0].body.event, 'lead.created');
    assert.equal(webhookEvents[0].body.lead._id, leadId);
    assert.equal(webhookEvents[0].body.lead.email, testEmail);
    assert.ok(webhookEvents[0].body.sentAt);
  });

  await t.test('keeps the lead saved when the n8n webhook returns an error', async () => {
    process.env.N8N_WEBHOOK_URL = `${webhookBaseUrl}/failure`;
    const payloadWithFailureEmail = {
      ...payload,
      name: `${testName} Webhook Failure`,
      email: webhookFailureEmail,
    };
    const result = await request('/api/leads', {
      method: 'POST',
      body: payloadWithFailureEmail,
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.data.email, webhookFailureEmail);
    assert.ok(await Lead.findOne({ email: webhookFailureEmail }));
    assert.equal(webhookEvents.at(-1).url, '/failure');
  });

  await t.test('keeps the lead saved when n8n cannot be reached', async () => {
    process.env.N8N_WEBHOOK_URL = `${webhookBaseUrl}/offline`;
    const result = await request('/api/leads', {
      method: 'POST',
      body: {
        ...payload,
        name: `${testName} Webhook Offline`,
        email: webhookOfflineEmail,
      },
    });

    assert.equal(result.status, 201);
    assert.equal(result.body.data.email, webhookOfflineEmail);
    assert.ok(await Lead.findOne({ email: webhookOfflineEmail }));
  });

  await t.test('rejects duplicate email addresses with HTTP 409', async () => {
    const result = await request('/api/leads', { method: 'POST', body: payload });

    assert.equal(result.status, 409);
    assert.match(result.body.error.message, /email address already exists/i);
  });

  await t.test('lists leads with search, status, and source filters', async () => {
    const query = new URLSearchParams({
      search: testEmail,
      status: 'New',
      source: testSource,
    });
    const result = await request(`/api/leads?${query}`);

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.data[0]._id, leadId);
  });

  await t.test('gets a lead by its MongoDB ObjectId', async () => {
    const result = await request(`/api/leads/${leadId}`);

    assert.equal(result.status, 200);
    assert.equal(result.body.data._id, leadId);
  });

  await t.test('updates lead fields and refreshes updatedAt', async () => {
    const original = await Lead.findById(leadId);
    const result = await request(`/api/leads/${leadId}`, {
      method: 'PATCH',
      body: { status: 'Qualified' },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.status, 'Qualified');
    assert.ok(new Date(result.body.data.updatedAt) >= original.updatedAt);
  });

  await t.test('rejects invalid IDs, missing records, and invalid filters', async () => {
    const invalidId = await request('/api/leads/not-an-object-id');
    const missingRecord = await request('/api/leads/000000000000000000000000');
    const invalidFilter = await request('/api/leads?status=NotAStatus');

    assert.equal(invalidId.status, 400);
    assert.match(invalidId.body.error.message, /valid MongoDB ObjectId/i);
    assert.equal(missingRecord.status, 404);
    assert.equal(invalidFilter.status, 400);
  });

  await t.test('rejects invalid create and patch payloads', async () => {
    const missingField = await request('/api/leads', {
      method: 'POST',
      body: { name: 'Incomplete lead' },
    });
    const invalidEmail = await request('/api/leads', {
      method: 'POST',
      body: { ...payload, email: 'not-an-email' },
    });
    const invalidStatus = await request(`/api/leads/${leadId}`, {
      method: 'PATCH',
      body: { status: 'Invalid' },
    });
    const emptyPatch = await request(`/api/leads/${leadId}`, {
      method: 'PATCH',
      body: {},
    });
    const unknownField = await request('/api/leads', {
      method: 'POST',
      body: { ...payload, unexpected: true },
    });

    assert.equal(missingField.status, 400);
    assert.equal(invalidEmail.status, 400);
    assert.equal(invalidStatus.status, 400);
    assert.equal(emptyPatch.status, 400);
    assert.equal(unknownField.status, 400);
  });

  await t.test('returns a useful error for malformed JSON', async () => {
    const result = await request('/api/leads', {
      method: 'POST',
      rawBody: '{"name":',
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.error.message, 'Request body contains invalid JSON.');
  });

  await t.test('deletes the lead and returns 404 when it is requested again', async () => {
    const deleted = await request(`/api/leads/${leadId}`, { method: 'DELETE' });
    const missing = await request(`/api/leads/${leadId}`);

    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.data._id, leadId);
    assert.equal(missing.status, 404);
    leadId = undefined;
  });
});
