import mongoose from 'mongoose';

export const SiteSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  url:  { type: String, required: true, trim: true, maxlength: 2000 },
  apiKey:{ type: String, required: true, select: true },
  enabled: { type: Boolean, default: true },

  scheduleMode: { type: String, enum: ['manual','everySeconds','everyHours','dailyTime','cron','once'], default:'manual' },
  everySeconds: { type: Number, min: 1, max: 100000000, default: null },
  everyHours:   { type: Number, min: 1, max: 8760, default: 1 },
  dailyAt:      { type: String, default: null },
  timezone:     { type: String, default: null },
  scheduleCron: { type: String, default: null },
  onceAt:       { type: Date,   default: null },

  lastSuccessAt: { type: Date, default: null },
  lastErrorAt:   { type: Date, default: null },
  counters: { sent: { type: Number, default: 0 }, failed: { type: Number, default: 0 } },

  dailyLimit: { type: Number, min: 0, max: 100000, default: 0 },
  todayKey:   { type: String, default: null },
  todayCount: { type: Number, min: 0, default: 0 }
}, { timestamps: true });

SiteSchema.index({ url: 1 }, { unique: true });

export default mongoose.model('Site', SiteSchema);
