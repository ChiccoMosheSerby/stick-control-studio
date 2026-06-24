import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    // Password-reset: a hashed single-use token + its expiry (set on "forgot",
    // cleared on successful reset). We store only the hash, never the raw token.
    resetTokenHash: { type: String, default: null },
    resetExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("User", userSchema);
