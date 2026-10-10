const mongoose = require('mongoose');

const leadStatuses = ['New', 'Contacted', 'Qualified', 'Converted', 'Lost'];

const leadSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required.'],
      trim: true,
      maxlength: [100, 'Name must be 100 characters or fewer.'],
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      trim: true,
      lowercase: true,
      maxlength: [254, 'Email must be 254 characters or fewer.'],
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address.'],
      unique: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone is required.'],
      trim: true,
      maxlength: [30, 'Phone must be 30 characters or fewer.'],
    },
    company: {
      type: String,
      required: [true, 'Company is required.'],
      trim: true,
      maxlength: [120, 'Company must be 120 characters or fewer.'],
    },
    source: {
      type: String,
      required: [true, 'Source is required.'],
      trim: true,
      maxlength: [80, 'Source must be 80 characters or fewer.'],
    },
    enquiry: {
      type: String,
      required: [true, 'Enquiry is required.'],
      trim: true,
      maxlength: [2000, 'Enquiry must be 2000 characters or fewer.'],
    },
    status: {
      type: String,
      enum: {
        values: leadStatuses,
        message: `Status must be one of: ${leadStatuses.join(', ')}.`,
      },
      default: 'New',
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Lead', leadSchema);
