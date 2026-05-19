import mongoose from 'mongoose';

const ClientAppSchema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true, maxlength: 60 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  databaseName: { type: String, required: true, trim: true, maxlength: 120 },
  enabled: { type: Boolean, default: true },
  createdBy: { type: String, default: '' },
  lastOpenedAt: { type: Date, default: null }
}, { timestamps: true });

export default mongoose.model('ClientApp', ClientAppSchema);
