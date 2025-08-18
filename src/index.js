require("dotenv").config();
// const express = require("express");
const http = require("http");
const cors = require("cors");
const connectDB = require("./db");
const initSocket = require("./socket");
// const AdminUser = require("./models/AdminUser");
// const app = express();
const app = require("./api");
const initWeb3Listeners = require("./web3");

const server = http.createServer(app);

// AdminUser.create({
//     username: "admin",
//     passwordHash: "$2b$10$EIX/$2b$10$e8HSFTaCIbvvwkg9MWg9IeQ5ffGO.jH6AE1wZkRnypanRbkqsP/my" // Example hash
//     }).catch(err => {
//     if (err.code !== 11000) console.error("❌ Admin user creation error:", err);
// })

// Middleware
// app.use(cors());
// app.use(express.json());

// Init DB & Socket.io
connectDB();
initSocket(server);
initWeb3Listeners();

// Start server
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  server.listen(PORT, () => {
    console.log("🚀 Server running on port", PORT);
  });
}
