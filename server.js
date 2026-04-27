const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "chat-data.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function createDefaultData() {
  return {
    groups: [
      { id: "school-friends", name: "School Friends", createdAt: Date.now() }
    ],
    users: [],
    messages: []
  };
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = createDefaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    const initial = createDefaultData();
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

let data = loadData();
const clients = new Set();

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function broadcast() {
  for (const client of clients) {
    client.write("event: sync\n");
    client.write(`data: ${Date.now()}\n\n`);
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || "text/plain; charset=utf-8";
  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  });
}

function upsertUser({ name, status, groupId }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName || !groupId) {
    return null;
  }

  const existing = data.users.find((user) => user.name.toLowerCase() === trimmedName.toLowerCase());
  if (existing) {
    existing.name = trimmedName;
    existing.status = String(status || "Online").trim() || "Online";
    existing.groupId = groupId;
    existing.lastSeen = Date.now();
    return existing;
  }

  const created = {
    id: crypto.randomUUID(),
    name: trimmedName,
    status: String(status || "Online").trim() || "Online",
    groupId,
    lastSeen: Date.now()
  };
  data.users.push(created);
  return created;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, data);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    res.write("event: sync\n");
    res.write(`data: ${Date.now()}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/presence") {
    try {
      const body = await readBody(req);
      const user = upsertUser(body);
      if (!user) {
        sendJson(res, 400, { error: "Name and group are required" });
        return;
      }
      saveData();
      broadcast();
      sendJson(res, 200, { ok: true, user });
    } catch {
      sendJson(res, 400, { error: "Invalid presence payload" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/groups") {
    try {
      const body = await readBody(req);
      const name = String(body.name || "").trim();
      if (!name) {
        sendJson(res, 400, { error: "Group name is required" });
        return;
      }

      const group = {
        id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`,
        name,
        createdAt: Date.now()
      };

      data.groups.unshift(group);

      if (body.creatorName) {
        upsertUser({
          name: body.creatorName,
          status: "Created the group",
          groupId: group.id
        });
      }

      saveData();
      broadcast();
      sendJson(res, 201, { ok: true, group });
    } catch {
      sendJson(res, 400, { error: "Invalid group payload" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/messages") {
    try {
      const body = await readBody(req);
      const text = String(body.text || "").trim();
      const userName = String(body.userName || "").trim();
      const groupId = String(body.groupId || "").trim();

      if (!text || !userName || !groupId) {
        sendJson(res, 400, { error: "Message, user, and group are required" });
        return;
      }

      upsertUser({
        name: userName,
        status: "Online",
        groupId
      });

      const message = {
        id: crypto.randomUUID(),
        groupId,
        userName,
        text,
        createdAt: Date.now()
      };

      data.messages.push(message);
      data.messages = data.messages.slice(-500);
      saveData();
      broadcast();
      sendJson(res, 201, { ok: true, message });
    } catch {
      sendJson(res, 400, { error: "Invalid message payload" });
    }
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    serveFile(res, path.join(ROOT, "index.html"));
    return;
  }

  const filePath = path.join(ROOT, url.pathname.replace(/^\/+/, ""));
  if (filePath.startsWith(ROOT) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveFile(res, filePath);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`PulseRoom server running on http://localhost:${PORT}`);
});
