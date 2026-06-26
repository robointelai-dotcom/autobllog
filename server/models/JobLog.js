import mongoose from 'mongoose';

export const JobLogSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', index: true },
  action: {
    type: String,
    enum: [
      'ping','run','schedule','queue-bulk','queue-sync','settings','history','gemini-test','prompt','prompt-ai-generate','prompt-ai-activate','plugins',
      'plugin-upload','plugin-activate','plugin-deactivate','plugin-reactivate','plugin-delete'
    ],
    required: true,
    index: true
  },
  status: { type: String, enum: ['success','error','skipped'], required: true, index: true },
  message:{ type: String, default: '' },
  payload:{ type: Object, default: undefined }
}, { timestamps: true });

// Auto-expire logs after 30 days.
JobLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60*60*24*30 });

export default mongoose.model('JobLog', JobLogSchema);
