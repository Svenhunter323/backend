const mongoose = require("mongoose");

const AdminUserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: { type: String }, // bcrypt hash
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("AdminUser", AdminUserSchema);
