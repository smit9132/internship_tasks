require('dotenv').config();

const assert = require('node:assert/strict');
const { once } = require('node:events');
const { after, before, test } = require('node:test');
const mongoose = require('mongoose');

const app = require('../app');
const connectDB = require('../config/db');
const Lead = require('../models/Lead');

const testSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const testEmail = `leadflow-test-${testSuffix}@example.test`;
const testName = `LeadFlow API Test ${testSuffix}`;
const testSource = `Test-${testSuffix}`;

let server;
let baseUrl;

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
});

after(async () => {
  try {
    await Lead.deleteMany({ email: testEmail });
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
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
