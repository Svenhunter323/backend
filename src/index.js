require("dotenv").config();
// const express = require("express");
const connectDB = require("./db");
// const initSocket = require("./socket");
// const AdminUser = require("./models/AdminUser");
// const app = express();
const server = require("./api");
const initWeb3Listeners = require("./web3");

// AdminUser.create({
//     username: "admin",
//     passwordHash: "$2b$10$EIX/$2b$10$e8HSFTaCIbvvwkg9MWg9IeQ5ffGO.jH6AE1wZkRnypanRbkqsP/my" // Example hash
//     }).catch(err => {
//     if (err.code !== 11000) console.error("❌ Admin user creation error:", err);
// })

connectDB();
initWeb3Listeners();

// Start server
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log("🚀 Server running on port", PORT);
  });
}
