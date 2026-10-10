const express = require('express');
const mongoose = require('mongoose');

const { notifyLeadCreated } = require('../automation/n8n');
const Lead = require('../models/Lead');

const router = express.Router();
const leadFields = ['name', 'email', 'phone', 'company', 'source', 'enquiry', 'status'];
const leadStatuses = ['New', 'Contacted', 'Qualified', 'Converted', 'Lost'];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createRequestError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateLeadPayload(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createRequestError(400, 'Request body must be a JSON object.');
  }

  const unknownFields = Object.keys(body).filter((field) => !leadFields.includes(field));
  if (unknownFields.length > 0) {
    throw createRequestError(400, `Unknown field: ${unknownFields[0]}.`);
  }

  if (partial && Object.keys(body).length === 0) {
    throw createRequestError(400, 'Provide at least one lead field to update.');
  }

  for (const field of leadFields) {
    if (!Object.hasOwn(body, field)) {
      if (!partial && field !== 'status') {
        throw createRequestError(400, `${field} is required.`);
      }
      continue;
    }

    const value = body[field];
    if (field === 'status') {
      if (typeof value !== 'string' || !leadStatuses.includes(value)) {
        throw createRequestError(
          400,
          `Status must be one of: ${leadStatuses.join(', ')}.`,
        );
      }
      continue;
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
      throw createRequestError(400, `${field} must be a non-empty string.`);
    }
  }

  if (Object.hasOwn(body, 'email') && !emailPattern.test(body.email.trim())) {
    throw createRequestError(400, 'Enter a valid email address.');
  }

  const maximumLengths = {
    name: 100,
    email: 254,
    phone: 30,
    company: 120,
    source: 80,
    enquiry: 2000,
  };

  for (const [field, maximum] of Object.entries(maximumLengths)) {
    if (Object.hasOwn(body, field) && body[field].trim().length > maximum) {
      throw createRequestError(400, `${field} must be ${maximum} characters or fewer.`);
    }
  }
}

function validateLeadId(id) {
  if (!mongoose.isObjectIdOrHexString(id)) {
    throw createRequestError(400, 'Lead ID must be a valid MongoDB ObjectId.');
  }
}

router.post('/', async (req, res) => {
  validateLeadPayload(req.body);
  const lead = await Lead.create(req.body);
  await notifyLeadCreated(lead);

  res.status(201).json({
    success: true,
    data: lead,
    message: 'Lead created successfully.',
  });
});

router.get('/', async (req, res) => {
  const { search, status, source } = req.query;
  const filter = {};

  if (search !== undefined) {
    if (typeof search !== 'string' || search.trim().length > 100) {
      throw createRequestError(400, 'Search must be a string of 100 characters or fewer.');
    }
    const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escapedSearch) {
      filter.$or = ['name', 'email', 'company'].map((field) => ({
        [field]: { $regex: escapedSearch, $options: 'i' },
      }));
    }
  }

  if (status !== undefined) {
    if (typeof status !== 'string' || !leadStatuses.includes(status)) {
      throw createRequestError(
        400,
        `Status must be one of: ${leadStatuses.join(', ')}.`,
      );
    }
    filter.status = status;
  }

  if (source !== undefined) {
    if (
      typeof source !== 'string' ||
      source.trim().length === 0 ||
      source.trim().length > 80
    ) {
      throw createRequestError(400, 'Source must be a non-empty string of 80 characters or fewer.');
    }
    filter.source = source.trim();
  }

  const leads = await Lead.find(filter).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    data: leads,
  });
});

router.get('/:id', async (req, res) => {
  validateLeadId(req.params.id);
  const lead = await Lead.findById(req.params.id);

  if (!lead) {
    throw createRequestError(404, 'Lead not found.');
  }

  res.status(200).json({
    success: true,
    data: lead,
  });
});

router.patch('/:id', async (req, res) => {
  validateLeadId(req.params.id);
  validateLeadPayload(req.body, { partial: true });

  const lead = await Lead.findByIdAndUpdate(req.params.id, req.body, {
    returnDocument: 'after',
    runValidators: true,
  });

  if (!lead) {
    throw createRequestError(404, 'Lead not found.');
  }

  res.status(200).json({
    success: true,
    data: lead,
    message: 'Lead updated successfully.',
  });
});

router.delete('/:id', async (req, res) => {
  validateLeadId(req.params.id);
  const lead = await Lead.findByIdAndDelete(req.params.id);

  if (!lead) {
    throw createRequestError(404, 'Lead not found.');
  }

  res.status(200).json({
    success: true,
    data: lead,
    message: 'Lead deleted successfully.',
  });
});

module.exports = router;
