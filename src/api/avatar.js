// routes/avatar.js
const express = require("express");
const router = express.Router();
const User = require("../models/User");

// Parse JSON bodies for this router
router.use(express.json());

/**
 * GET /api/avatar/:username
 * Response: { avatar: string }  // e.g. "/avatars/12.png" or absolute URL
 */
router.get("/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username });
    if (!user || !user.avatar) return res.status(404).json({ error: "Not found" });
    return res.json({ avatar: user.avatar });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to load avatar" });
  }
});

/**
 * PATCH /api/avatar/:username
 * Body: { "avatarUrl": "/avatars/12.png" }    // existing asset only (no file upload)
 * Saves the URL as-is (absolute URL) or validates preset path (/avatars/1..29.png).
 */
router.patch("/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const { avatarUrl } = req.body || {};

    if (!avatarUrl || typeof avatarUrl !== "string") {
      return res.status(400).json({ error: "avatarUrl is required" });
    }

    // Accept either absolute URLs or our preset path /avatars/1..29.png
    const isAbsolute = /^https?:\/\/\S+$/i.test(avatarUrl);
    const isPreset   = /^\/avatars\/([1-9]|1\d|2\d|29)\.png$/i.test(avatarUrl);

    if (!isAbsolute && !isPreset) {
      return res.status(400).json({ error: "Invalid avatarUrl (must be absolute or /avatars/1..29.png)" });
    }

    const user = await User.findOneAndUpdate(
      { username },
      { $set: { wallet: username, avatar: avatarUrl } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.json({ success: true, avatar: user.avatar });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to save avatar" });
  }
});

module.exports = router;
