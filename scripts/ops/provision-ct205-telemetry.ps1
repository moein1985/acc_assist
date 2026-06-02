param(
  [Parameter(Mandatory = $true)]
  [string]$ProxmoxHost,

  [Parameter(Mandatory = $true)]
  [string]$ProxmoxUser,

  [Parameter(Mandatory = $true)]
  [string]$ProxmoxPassword,

  [int]$ContainerId = 205,
  [string]$Template = 'debian-12-bookworm-iran-custom.tar.gz',
  [string]$Hostname = 'acc-telemetry'
)

$ErrorActionPreference = 'Stop'

$remoteScriptPath = Join-Path $env:TEMP "ct-$ContainerId-telemetry-bootstrap.sh"

$remoteScript = @'
set -e

echo "[1/7] Ensure CT $ContainerId exists and running"
if ! pct status $ContainerId >/dev/null 2>&1; then
  pct create $ContainerId local:vztmpl/$Template --hostname $Hostname --cores 2 --memory 2048 --swap 512 --rootfs local-lvm:20 --net0 name=eth0,bridge=vmbr0,ip=dhcp --unprivileged 1 --features nesting=1
fi
pct start $ContainerId || true

echo "[2/7] Ensure DHCP config"
pct exec $ContainerId -- sh -lc 'echo [Match] > /etc/systemd/network/10-eth0.network; echo Name=eth0 >> /etc/systemd/network/10-eth0.network; echo >> /etc/systemd/network/10-eth0.network; echo [Network] >> /etc/systemd/network/10-eth0.network; echo DHCP=yes >> /etc/systemd/network/10-eth0.network'
pct exec $ContainerId -- sh -lc 'systemctl enable systemd-networkd >/dev/null 2>&1 || true; systemctl restart systemd-networkd >/dev/null 2>&1 || true; ip link set eth0 up || true; sleep 2; ip -4 addr show eth0; ip -4 route'

echo "[3/7] Install runtime packages"
if ! pct exec $ContainerId -- sh -lc 'apt-get -o Acquire::Retries=3 update'; then
  echo "Primary mirror update failed, switching to Debian official mirrors"
  pct exec $ContainerId -- sh -lc 'cat > /etc/apt/sources.list << "EOF"
deb http://deb.debian.org/debian bookworm main
deb http://security.debian.org/debian-security bookworm-security main
deb http://deb.debian.org/debian bookworm-updates main
EOF'
  pct exec $ContainerId -- sh -lc 'apt-get -o Acquire::Retries=3 update'
fi
pct exec $ContainerId -- sh -lc 'DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs node-ws curl ca-certificates'

echo "[4/7] Prepare dirs and auth token"
pct exec $ContainerId -- sh -lc 'mkdir -p /opt/acc-telemetry-collector /var/lib/acc-telemetry /etc/acc-telemetry'
pct exec $ContainerId -- sh -lc 'if [ ! -s /etc/acc-telemetry/token ]; then tr -dc A-Za-z0-9 </dev/urandom | head -c 48 > /etc/acc-telemetry/token; fi; chmod 600 /etc/acc-telemetry/token'

echo "[5/7] Deploy collector app"
pct exec $ContainerId -- sh -lc 'cat > /opt/acc-telemetry-collector/server.js << "EOF"
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { URL } = require("node:url");
const { WebSocketServer } = require("ws");

const PORT = Number.parseInt(process.env.PORT || "8081", 10);
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || "/var/lib/acc-telemetry";
const EVENTS_FILE = process.env.EVENTS_FILE || path.join(DATA_DIR, "events.ndjson");
const TOKEN_FILE = process.env.TOKEN_FILE || "/etc/acc-telemetry/token";
const MAX_BODY_BYTES = Number.parseInt(process.env.MAX_BODY_BYTES || "524288", 10);
const MAX_READ_EVENTS = Number.parseInt(process.env.MAX_READ_EVENTS || "200", 10);

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EVENTS_FILE)) {
  fs.writeFileSync(EVENTS_FILE, "", "utf8");
}

function readToken() {
  return fs.readFileSync(TOKEN_FILE, "utf8").trim();
}

function writeEvent(rawEvent, source) {
  const event = {
    receivedAt: new Date().toISOString(),
    source,
    event: rawEvent
  };
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + "\n", "utf8");
  return event;
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function normalizeBearerToken(req) {
  const auth = req.headers["authorization"] || "";
  const prefix = "Bearer ";
  if (typeof auth === "string" && auth.startsWith(prefix)) {
    return auth.slice(prefix.length).trim();
  }
  return "";
}

function isAuthorizedHttp(req) {
  const expected = readToken();
  const provided = normalizeBearerToken(req);
  return expected && provided && expected === provided;
}

function readLastEvents(limit) {
  const bounded = Number.isFinite(limit) ? Math.max(1, Math.min(limit, MAX_READ_EVENTS)) : 100;
  const text = fs.readFileSync(EVENTS_FILE, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  const sliced = lines.slice(-bounded);
  return sliced.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { parseError: true, raw: line };
    }
  });
}

const server = http.createServer((req, res) => {
  if (!req.url) {
    return json(res, 400, { ok: false, error: "MISSING_URL" });
  }

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "acc-telemetry-collector", ts: new Date().toISOString() });
  }

  if (req.method === "GET" && url.pathname === "/events") {
    if (!isAuthorizedHttp(req)) {
      return json(res, 401, { ok: false, error: "UNAUTHORIZED" });
    }

    const limit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
    const events = readLastEvents(limit);
    return json(res, 200, { ok: true, count: events.length, events });
  }

  if (req.method === "POST" && url.pathname === "/ingest") {
    if (!isAuthorizedHttp(req)) {
      return json(res, 401, { ok: false, error: "UNAUTHORIZED" });
    }

    let total = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks).toString("utf8");
        const payload = JSON.parse(body);
        const list = Array.isArray(payload) ? payload : [payload];
        list.forEach((item) => writeEvent(item, "http"));
        return json(res, 200, { ok: true, written: list.length });
      } catch (err) {
        return json(res, 400, { ok: false, error: "BAD_JSON", message: String(err.message || err) });
      }
    });

    req.on("error", (err) => {
      return json(res, 500, { ok: false, error: "STREAM_ERROR", message: String(err.message || err) });
    });

    return;
  }

  return json(res, 404, { ok: false, error: "NOT_FOUND" });
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    const expected = readToken();
    const queryToken = url.searchParams.get("token") || "";
    const headerToken = normalizeBearerToken(req);
    const provided = queryToken || headerToken;

    if (!expected || !provided || provided !== expected) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ ok: true, type: "welcome", ts: new Date().toISOString() }));

  ws.on("message", (message) => {
    try {
      const text = Buffer.isBuffer(message) ? message.toString("utf8") : String(message);
      const payload = JSON.parse(text);
      const list = Array.isArray(payload) ? payload : [payload];
      list.forEach((item) => writeEvent(item, "ws"));
      ws.send(JSON.stringify({ ok: true, type: "ack", written: list.length, ts: new Date().toISOString() }));
    } catch (err) {
      ws.send(JSON.stringify({ ok: false, type: "error", error: "BAD_JSON", message: String(err.message || err) }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[acc-telemetry-collector] listening on ${HOST}:${PORT}`);
});
EOF'
pct exec $ContainerId -- sh -lc 'node -e "console.log(require.resolve(\"ws\"))"'

echo "[6/7] Install and start service"
pct exec $ContainerId -- sh -lc 'cat > /etc/systemd/system/acc-telemetry.service << "EOF"
[Unit]
Description=ACC Telemetry Collector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/acc-telemetry-collector
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=8081
Environment=DATA_DIR=/var/lib/acc-telemetry
Environment=TOKEN_FILE=/etc/acc-telemetry/token
ExecStart=/usr/bin/node /opt/acc-telemetry-collector/server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF'

pct exec $ContainerId -- sh -lc 'systemctl daemon-reload; systemctl enable --now acc-telemetry'

echo "[7/7] Verify"
pct exec $ContainerId -- sh -lc 'ip -4 addr show eth0 | sed -n "1,5p"'
pct exec $ContainerId -- sh -lc 'ss -lntp | grep 8081 || true'
pct exec $ContainerId -- sh -lc 'TOKEN=$(cat /etc/acc-telemetry/token); curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8081/health'
echo "--- TOKEN ---"
pct exec $ContainerId -- sh -lc 'cat /etc/acc-telemetry/token'
'@

$remoteScript = $remoteScript.Replace('$ContainerId', [string]$ContainerId).Replace('$Template', $Template).Replace('$Hostname', $Hostname)

$remoteScript | Set-Content -Path $remoteScriptPath -Encoding ascii

Write-Host "Remote bootstrap script: $remoteScriptPath"
plink -batch -ssh "$ProxmoxUser@$ProxmoxHost" -pw "$ProxmoxPassword" -m "$remoteScriptPath"
