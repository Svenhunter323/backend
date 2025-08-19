const express = require("express");
const cors = require("cors");
const app = express();
const adminrouter = require("./admin");
const io = require("../socket/index").io;
const betsRoute = require("./bets")(io);
const avatarRouter = require("./avatar");
const path = require("path");
const fs = require("fs");

app.use(cors());
app.use(express.json());


// Ensure avatar directory exists
const AVATAR_DIR = path.join(process.cwd(), "uploads", "avatars");
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

// Serve uploaded avatars statically
app.use("/avatars", express.static(AVATAR_DIR));

app.use("/api/admin", adminrouter);
app.use("/api/bets", betsRoute);
app.use("/api/avatar", avatarRouter);

module.exports = app;