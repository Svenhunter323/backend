const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const AdminUser = require("../src/models/AdminUser");

async function createAdmin() {
  await mongoose.connect("mongodb://localhost:27017/waveflip");

  const password = "defence323"; // Change this to your desired password
  const hash = await bcrypt.hash(password, 10);

  const existing = await AdminUser.findOne({ username: "admin" });
  if (existing) {
    existing.passwordHash = hash;
    await existing.save();
    console.log("✅ Admin password updated");
  } else {
    await AdminUser.create({ username: "admin", passwordHash: hash });
    console.log("✅ Admin user created");
  }

  mongoose.disconnect();
}

createAdmin();
// Call this script with `node scripts/createAdmin.js` to create or update the admin user