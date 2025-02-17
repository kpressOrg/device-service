const express = require("express");
const { exec } = require("child_process");
const fs = require("fs/promises");
const util = require("util");
const app = express();
const port = 3000;

const execPromise = util.promisify(exec);
const saveDirectory = "./photos/";

async function ensureDirectoryExists() {
  try {
    await fs.access(saveDirectory);
  } catch (error) {
    await fs.mkdir(saveDirectory, { recursive: true });
  }
}

async function capturePhoto(fullPath) {
  try {
    const { stderr } = await execPromise(`imagesnap -w 1 -v "${fullPath}"`);
    console.log("Capture logs:", stderr); // Optional debug

    // Verify file existence
    await fs.access(fullPath);
    return fullPath;
  } catch (error) {
    // Cleanup failed attempts
    await fs.unlink(fullPath).catch(() => {});
    throw new Error(`Camera error: ${error.stderr || error.message}`);
  }
}

async function initialize() {
  await ensureDirectoryExists();

  app.get("/photo", async (req, res) => {
    try {
      const fileName = `photo_${Date.now()}.jpg`;
      const fullPath = `${saveDirectory}${fileName}`;

      const resultPath = await capturePhoto(fullPath);
      res.status(200).send(`Photo saved to: ${resultPath}`);
    } catch (error) {
      console.error("Request error:", error);
      res.status(500).send(error.message);
    }
  });

  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

initialize().catch((error) => {
  console.error("Server initialization failed:", error);
  process.exit(1);
});
