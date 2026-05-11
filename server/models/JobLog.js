import mongoose from 'mongoose';
const JobLogSchema = new mongoose.Schema({
  siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site' },
  action: { type: String, enum: ['ping','run','schedule','queue-bulk'], required: true },
  status: { type: String, enum: ['success','error'], required: true },
  message:{ type: String },
  payload:{ type: Object }
}, { timestamps: true });
export default mongoose.model('JobLog', JobLogSchema);

// Auto-expire logs after 30 days
JobLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60*60*24*30 });
