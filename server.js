const express = require("express");
const bodyParser = require("body-parser");
const { WebSocketServer } = require("ws");
const http = require("http");
const crypto = require("crypto");
const path = require("path");
const urlMap = new Map();
const pendingDeliveries = new Map();
const clients = new Set();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(bodyParser.json());
const generateCode = () =>
  crypto.randomBytes(6).toString("base64url").slice(0, 10);
async function asyncSet(shortCode, url) {
  return new Promise((resolve) => {
    setTimeout(() => {
      urlMap.set(shortCode, url);
      resolve();
    }, 10);
  });
}
app.use(express.static(path.join(__dirname, "public")));
app.post("/url", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is missing" });

  const code = generateCode();
  const linkUrlsShortened = `http://localhost:3000/${code}`;

  await asyncSet(code, url);
  res.sendStatus(200);
  const payload = JSON.stringify({ shortenedURL: linkUrlsShortened });
  for (const ws of clients) {
    try {
      ws.send(payload);
      pendingDeliveries.set(code, { ws, payload, attempts: 1 });
    } catch (e) {
      console.error("unable to send", e);
    }
  }
});
app.get("/:code", async (req, res) => {
  const originalUrl = urlMap.get(req.params.code);
  if (!originalUrl) {
    return res.status(404).json({ error: "URL not found" });
  }
  res.json({ url: originalUrl });
});
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.ack && pendingDeliveries.has(data.ack)) {
        pendingDeliveries.delete(data.ack);
      }
    } catch (e) {
      console.error("Incorrect Data", e);
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});
setInterval(() => {
  for (const [code, delivery] of pendingDeliveries) {
    if (delivery.attempts >= 5) {
      console.warn(
        `Unable to deliver ${code} after ${delivery.attempts} attempts`
      );
      pendingDeliveries.delete(code);
      continue;
    }

    try {
      delivery.ws.send(delivery.payload);
      delivery.attempts++;
    } catch (e) {
      console.error("Try again please", e);
    }
  }
}, 3000); // Retry every 3s

server.listen(3000, () => {
  console.log("app is running at http://localhost:3000");
});
