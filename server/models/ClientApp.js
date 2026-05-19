import mongoose from 'mongoose';

const ClientAppSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true, maxlength: 60 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  databaseName: { type: String, required: true, trim: true, maxlength: 120 },
  enabled: { type: Boolean, default: true },

  // v13: true fresh client app isolation. Each client gets its own Node backend process,
  // own port, own Mongo DB, own auth file, and own logs. Main app only reverse-proxies /slug.
  mode: { type: String, enum: ['instance', 'tenant'], default: 'instance', index: true },
  port: { type: Number, default: null, index: true },
  processPid: { type: Number, default: null },
  processStatus: { type: String, default: 'created' },
  lastStartedAt: { type: Date, default: null },
  lastError: { type: String, default: '' },

  createdBy: { type: String, default: '' },
  lastOpenedAt: { type: Date, default: null }
}, { timestamps: true });

export default mongoose.model('ClientApp', ClientAppSchema);
