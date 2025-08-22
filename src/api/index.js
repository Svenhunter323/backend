const express = require("express");
const http = require("http");
const cors = require("cors");
const app = express();
const { initSocket, getIO } = require("../socket");
const avatarRouter = require("./avatar");
const path = require("path");
const fs = require("fs");

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
initSocket(server);

// Ensure avatar directory exists
const AVATAR_DIR = path.join(process.cwd(), "public", "avatars");
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

// Serve uploaded avatars statically
// app.use("/avatars", express.static(AVATAR_DIR));

// Serve static files for dapp and admin
// app.use("/", express.static(path.join(__dirname, "../../public/lobby")));
// // app.use("/admin", express.static(path.join(__dirname, "../../public/admin")));

const makeAdminRouter = require("./admin");
const betsRoute = require("./bets")(getIO());
const dashboardRoute = require("./dashboard");
const leaderboardRoute = require("./leaderboard");

app.use("/api/admin", makeAdminRouter);
app.use("/api/bets", betsRoute);
app.use("/api/dashboard", dashboardRoute);
app.use("/api/avatar", avatarRouter);
app.use("/api/leaderboard", leaderboardRoute);

// app.get('/:path*', (req, res) => {
//     res.sendFile(path.join(__dirname, '../../public/lobby', 'index.html'));
// });

module.exports = server;