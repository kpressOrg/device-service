const express = require("express")
const dotenv = require("dotenv")
const pgp = require("pg-promise")()
const amqp = require("amqplib/callback_api")
const { exec, execSync } = require("child_process")
const fs = require("fs/promises")
const util = require("util")
const os = require("os")
const cors = require("cors")
const morgan = require("morgan")
const path = require("path")

const app = express()
dotenv.config()

app.use(express.json())
app.use(
  cors({
    origin: "*",
  })
)
app.use(morgan("dev"))

const execPromise = util.promisify(exec)
const photoSaveDirectory = path.join(__dirname, "public/photos")
const videoSaveDirectory = path.join(__dirname, "public/videos")

async function ensureDirectoryExists(directory) {
  try {
    await fs.access(directory)
  } catch (error) {
    await fs.mkdir(directory, { recursive: true })
  }
}

// Get the appropriate command based on OS
function getCaptureCommand(fullPath) {
  let cameraName = ""

  switch (os.platform()) {
    case "darwin": // macOS
      try {
        cameraName = execSync("imagesnap -l").toString().split("\n")[1].trim()
        if (!cameraName) throw new Error("No camera available")
        return `imagesnap -w 1 -v "${fullPath}"`
      } catch (error) {
        throw new Error("No camera available")
      }
    case "win32": // Windows
      try {
        return `ffmpeg.exe -f dshow -i video="BRIO 4K Stream Edition" -frames:v 1 "${fullPath}"`
      } catch (error) {
        throw new Error("No camera available")
      }
    case "linux": // Linux
      try {
        const devices = execSync("v4l2-ctl --list-devices").toString()
        console.log(devices)
        const match = devices.match(/(\/dev\/video\d+)/)
        if (!match) throw new Error("No camera available")
        cameraName = match[1]
        return `ffmpeg -f video4linux2 -i ${cameraName} -frames:v 1 "${fullPath}"`
      } catch (error) {
        throw new Error("No camera available")
      }
    default:
      throw new Error("Unsupported OS")
  }
}

function getCaptureVideoCommand(fullPath) {
  let cameraName = ""

  switch (os.platform()) {
    case "darwin": // macOS
      try {
        cameraName = execSync("imagesnap -l").toString().split("\n")[1].trim()
        if (!cameraName) throw new Error("No camera available")
        return `ffmpeg -f avfoundation -framerate 30 -i "${cameraName}" -t 10 "${fullPath}"`
      } catch (error) {
        throw new Error("No camera available")
      }
    case "win32": // Windows
      try {
        return `ffmpeg.exe -f dshow -i video="BRIO 4K Stream Edition" -t 10 "${fullPath}"`
      } catch (error) {
        throw new Error("No camera available")
      }
    case "linux": // Linux
      try {
        const devices = execSync("v4l2-ctl --list-devices").toString()
        console.log(devices)
        const match = devices.match(/(\/dev\/video\d+)/)
        if (!match) throw new Error("No camera available")
        cameraName = match[1]
        return `ffmpeg -f video4linux2 -i ${cameraName} -t 10 "${fullPath}"`
      } catch (error) {
        throw new Error("No camera available")
      }
    default:
      throw new Error("Unsupported OS")
  }
}

function getStreamCommand() {
  let cameraName = ""

  switch (os.platform()) {
    case "darwin": // macOS
      try {
        cameraName = execSync("imagesnap -l").toString().split("\n")[1].trim()
        if (!cameraName) throw new Error("No camera available")
        return `ffmpeg -f avfoundation -framerate 30 -i "${cameraName}" -f mpegts udp://127.0.0.1:12345`
      } catch (error) {
        throw new Error("No camera available")
      }
    case "win32": // Windows
      try {
     return `ffmpeg.exe -f dshow -framerate 30 -i video="BRIO 4K Stream Edition" -vcodec mpeg2video -f mpegts udp://127.0.0.1:12345`
      } catch (error) {
        throw new Error("No camera available")
      }
    case "linux": // Linux
      try {
        const devices = execSync("v4l2-ctl --list-devices").toString()
        console.log(devices)
        const match = devices.match(/(\/dev\/video\d+)/)
        if (!match) throw new Error("No camera available")
        cameraName = match[1]
        return `ffmpeg -f video4linux2 -i ${cameraName} -f mpegts udp://127.0.0.1:12345`
      } catch (error) {
        throw new Error("No camera available")
      }
    default:
      throw new Error("Unsupported OS")
  }
}

async function capturePhoto(fullPath) {
  try {
    const command = getCaptureCommand(fullPath)
    const { stderr } = await execPromise(command)
    console.log("Capture logs:", stderr)

    // Verify file existence
    await fs.access(fullPath)
    return fullPath
  } catch (error) {
    await fs.unlink(fullPath).catch(() => {}) // Cleanup failed attempts
    throw new Error(`Camera error: ${error.stderr || error.message}`)
  }
}

async function captureVideo(fullPath) {
  try {
    const command = getCaptureVideoCommand(fullPath)
    const { stderr } = await execPromise(command)
    console.log("Capture logs:", stderr)

    // Verify file existence
    await fs.access(fullPath)
    return fullPath
  } catch (error) {
    await fs.unlink(fullPath).catch(() => {}) // Cleanup failed attempts
    throw new Error(`Camera error: ${error.stderr || error.message}`)
  }
}

const connectToDatabase = async (retries = 5, delay = 5000) => {
  while (retries) {
    try {
      const db = pgp(process.env.DATABASE_URL)
      await db.connect()
      console.log("Connected to the database")

      // Create the devices table if it doesn't exist
      await db.none(`
        CREATE TABLE IF NOT EXISTS devices (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `)
      console.log("Table 'devices' created successfully")

      return db
    } catch (error) {
      console.error("Failed to connect to the database, retrying...", error)
      retries -= 1
      await new Promise((res) => setTimeout(res, delay))
    }
  }
  throw new Error("Could not connect to the database after multiple attempts")
}

const connectToRabbitMQ = () => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("RabbitMQ connection timeout"))
    }, 5000) // 5 seconds timeout

    amqp.connect(process.env.RABBITMQ_URL, (error0, connection) => {
      clearTimeout(timeout)
      if (error0) {
        reject(error0)
      } else {
        resolve(connection)
      }
    })
  })
}

connectToDatabase()
  .then((db) => {
    app.use(express.json())

    app.get("/", (req, res) => {
      res.json("device service")
    })

    connectToRabbitMQ()
      .then((connection) => {
        connection.createChannel((error1, channel) => {
          if (error1) {
            throw error1
          }
          const queue = "device_created"

          channel.assertQueue(queue, {
            durable: false,
          })

          // Create a new device
          app.post("/create", (req, res) => {
            const { title, description } = req.body
            if (!title || !description) {
              return res.status(400).json({ error: "Title and description are required" })
            }
            db.none("INSERT INTO devices(title, description) VALUES($1, $2)", [title, description])
              .then(() => {
                res.status(201).json({ message: "Device created successfully" })

                // Send message to RabbitMQ
                const device = { title, description }
                channel.sendToQueue(queue, Buffer.from(JSON.stringify(device)))
                console.log(" [x] Sent %s", device)
              })
              .catch((error) => {
                res.status(500).json({ error: error.message })
              })
          })

          // Capture a video
          app.get("/video", async (req, res) => {
            try {
              const timestamp = Date.now()
              const start_at = new Date(timestamp)
          
              const fileName = `video_${Date.now()}.mp4`

              await ensureDirectoryExists(videoSaveDirectory)

              const fullPath = path.join(videoSaveDirectory, fileName)

              const resultPath = await captureVideo(fullPath)
              const end_at = new Date(Date.now())
              const duration = end_at - start_at
              res.status(200).send(`Video saved to: ${resultPath}, duration: ${duration}ms`)
            } catch (error) {
              console.error("Request error:", error)
              res.status(500).send(error.message)
            }
          })

          // Stream video
          app.get("/stream", (req, res) => {
            try {
              const command = getStreamCommand(); // Ensure this command is correct for your environment
              const stream = exec(command);
              res.setHeader("Content-Type", "video/mp2t");
              stream.stdout.pipe(res);
              stream.stderr.on("data", (data) => {
                console.error(`stderr: ${data}`);
              });
              stream.on("close", (code) => {
                console.log(`Stream process exited with code ${code}`);
              });
            } catch (error) {
              console.error("Stream error:", error);
              res.status(500).send(error.message);
            }
          });

          // Read all devices
          app.get("/all", (req, res) => {
            db.any("SELECT * FROM devices")
              .then((data) => {
                res.status(200).json(data)
              })
              .catch((error) => {
                res.status(500).json({ error: error.message })
              })
          })

          // Update a device
          app.patch("/device/:id", (req, res) => {
            const { id } = req.params
            const { title, description } = req.body
            db.none("UPDATE devices SET title=$1, description=$2 WHERE id=$3", [title, description, id])
              .then(() => {
                res.status(200).json({ message: "Device updated successfully" })
              })
              .catch((error) => {
                res.status(500).json({ error: error.message })
              })
          })

          // Delete a device
          app.delete("/device/:id", (req, res) => {
            const { id } = req.params
            db.none("DELETE FROM devices WHERE id=$1", [id])
              .then(() => {
                res.status(204).json({ message: "Device deleted successfully" })
              })
              .catch((error) => {
                res.status(500).json({ error: error.message })
              })
          })

          // Capture a photo
          app.get("/photo", async (req, res) => {
            try {
              const timestamp = Date.now()
              const start_at = new Date(timestamp)
              const fileName = `photo_${Date.now()}.jpg`

              await ensureDirectoryExists(photoSaveDirectory)

              const fullPath = path.join(photoSaveDirectory, fileName)

              const resultPath = await capturePhoto(fullPath)
              const end_at = new Date(Date.now())
              const duration = end_at - start_at
              res.status(200).send(`Photo saved to: ${resultPath}, duration: ${duration}ms`)
            } catch (error) {
              console.error("Request error:", error)
              res.status(500).send(error.message)
            }
          })

          app.listen(process.env.PORT, () => {
            console.log(`Example app listening at ${process.env.APP_URL}:${process.env.PORT}`)
          })
        })
      })
      .catch((error) => {
        console.error("Failed to connect to RabbitMQ:", error)
      })
  })
  .catch((error) => {
    console.error("Failed to start the server:", error)
  })