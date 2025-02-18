const express = require("express")
const dotenv = require("dotenv")
const pgp = require("pg-promise")()
const amqp = require("amqplib/callback_api")
const { exec } = require("child_process")
const fs = require("fs/promises")
const util = require("util")
const os = require("os")
const path = require("path")

const app = express()
dotenv.config()

const execPromise = util.promisify(exec)
const saveDirectory = path.join(__dirname, "photos")

async function ensureDirectoryExists() {
  try {
    await fs.access(saveDirectory)
  } catch (error) {
    await fs.mkdir(saveDirectory, { recursive: true })
  }
}

// Get the appropriate command based on OS
function getCaptureCommand(fullPath) {
  console.log(os.platform())
   const cameraName = "HD Pro Webcam C920"; 
  switch (os.platform()) {
    case "darwin": // macOS
      return `imagesnap -w 1 -v "${fullPath}"` // Uses imagesnap
    case "win32": // Windows
      return `ffmpeg.exe -f dshow -i video="${cameraName}" -frames:v 1 "${fullPath}"`
    case "linux": // Linux
      return `ffmpeg -f video4linux2 -i /dev/video0 -frames:v 1 "${fullPath}"`
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
              const fileName = `photo_${Date.now()}.jpg`

              await ensureDirectoryExists()

              const fullPath = path.join(saveDirectory, fileName)

              const resultPath = await capturePhoto(fullPath)
              res.status(200).send(`Photo saved to: ${resultPath}`)
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
