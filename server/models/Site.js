import mongoose from 'mongoose';
const SiteSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url:  { type: String, required: true },
  apiKey:{ type: String, required: true },
  enabled: { type: Boolean, default: true },

  scheduleMode: { type: String, enum: ['manual','everySeconds','everyHours','dailyTime','cron','once'], default:'manual' },
  everySeconds: { type: Number, min: 1, max: 100000000, default: null },
  everyHours:   { type: Number, default: 1 },
  dailyAt:      { type: String, default: null },
  timezone:     { type: String, default: null },
  scheduleCron: { type: String, default: null },
  onceAt:       { type: Date,   default: null },

  lastSuccessAt: { type: Date, default: null },
  counters: { sent: { type: Number, default: 0 }, failed: { type: Number, default: 0 } },

  dailyLimit: { type: Number, default: 0 },
  todayKey:   { type: String, default: null },
  todayCount: { type: Number, default: 0 }
}, { timestamps: true });
export default mongoose.model('Site', SiteSchema);
