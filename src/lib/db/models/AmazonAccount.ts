import mongoose, { Document, Schema } from "mongoose";

export interface IAmazonAccount extends Document {
  userId: mongoose.Types.ObjectId;
  label: string;
  encryptedEmail: string;    // AES-256-GCM encrypted email/phone
  encryptedPassword: string; // AES-256-GCM encrypted Amazon password
  createdAt: Date;
  updatedAt: Date;
}

const AmazonAccountSchema = new Schema<IAmazonAccount>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    encryptedEmail: {
      type: String,
      required: true,
    },
    encryptedPassword: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

// Delete stale cached model so schema changes take effect in dev hot-reload
delete mongoose.models.AmazonAccount;
export default mongoose.model<IAmazonAccount>("AmazonAccount", AmazonAccountSchema);
