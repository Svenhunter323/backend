const express = require("express");
const cors = require("cors");
const app = express();
const adminrouter = require("./admin");
const io = require("../socket/index").io;
const betsRoute = require("./bets")(io);

app.use(cors());
app.use(express.json());

// Sample endpoint
app.get("/api/leaderboard", (req, res) => {
  res.json([
    { user: "0x123...", wins: 12 },
    { user: "0xabc...", wins: 9 }
  ]);
});

// app.listen(PORT, () => console.log(`API listening on port ${PORT}`));
app.use("/api/admin", adminrouter);
app.use("/api/bets", betsRoute);
module.exports = app;