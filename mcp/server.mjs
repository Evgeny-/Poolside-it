#!/usr/bin/env node
import http from "node:http";
import { randomUUID } from "node:crypto";

const DEFAULT_PORT = Number(process.env.POOLSIDE_MCP_BRIDGE_PORT || 8765);
const MAX_FALLBACK_PORT = Number(process.env.POOLSIDE_MCP_BRIDGE_MAX_PORT || DEFAULT_PORT + 10);
const BRIDGE_TOKEN = process.env.POOLSIDE_BRIDGE_TOKEN || "poolside-it-for-me-local-bridge-v1";
const HOST = "127.0.0.1";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const COMMAND_TIMEOUT_MS = Number(process.env.POOLSIDE_MCP_COMMAND_TIMEOUT_MS || 90000);
const EXTENSION_CONNECT_WAIT_MS = Number(process.env.POOLSIDE_MCP_EXTENSION_WAIT_MS || 10000);
const STATUS_CONNECT_WAIT_MS = Number(process.env.POOLSIDE_MCP_STATUS_WAIT_MS || 2500);
const EXTENSION_CONNECT_POLL_MS = 100;
const POLL_HOLD_MS = 25000;
const EXTENSION_STALE_MS = 45000;

const extensionClients = new Map();
const pendingCommands = new Map();
let brokerMode = "primary";
let activePort = DEFAULT_PORT;
let brokerReadyResolved = false;
let resolveBrokerReady = null;
const brokerReady = new Promise((resolve) => {
  resolveBrokerReady = resolve;
});

const server = http.createServer(handleHttpRequest);
server.on("error", async (error) => {
  if (error?.code === "EADDRINUSE") {
    const health = await getExistingBridgeHealth(activePort).catch(() => null);
    const supportsProxyCalls = await existingBridgeSupportsProxyCalls(activePort).catch(() => false);
    if (health?.ok && supportsProxyCalls) {
      brokerMode = "proxy";
      log(`Local bridge already running on http://${HOST}:${activePort}; using it as the broker.`);
      markBrokerReady();
      return;
    }
    if (activePort < MAX_FALLBACK_PORT) {
      const nextPort = activePort + 1;
      log(`Local bridge port ${activePort} is in use; trying ${nextPort}.`);
      activePort = nextPort;
      server.listen(activePort, HOST);
      return;
    }
  }

  log(`Failed to start local bridge: ${error.message}`);
  process.exit(1);
});
server.listen(activePort, HOST, () => {
  brokerMode = "primary";
  log(`Poolside MCP bridge listening on http://${HOST}:${activePort}`);
  log("Load the extension in Google Chrome and open the side panel to connect it.");
  markBrokerReady();
});

process.stdin.setEncoding("utf8");
let stdinBuffer = "";
process.stdin.on("data", (chunk) => {
  stdinBuffer += chunk;
  let newlineIndex = stdinBuffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = stdinBuffer.slice(0, newlineIndex).trim();
    stdinBuffer = stdinBuffer.slice(newlineIndex + 1);
    if (line) {
      handleMcpLine(line);
    }
    newlineIndex = stdinBuffer.indexOf("\n");
  }
});

process.stdin.on("end", () => {
  if (server.listening) {
    server.close();
  }
});

async function handleMcpLine(line) {
  let message = null;
  try {
    message = JSON.parse(line);
  } catch (error) {
    writeMcpError(null, -32700, "Parse error", { message: error.message });
    return;
  }

  if (!message || typeof message !== "object") {
    writeMcpError(null, -32600, "Invalid Request");
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(message, "id")) {
    return;
  }

  try {
    await brokerReady;
    const result = await handleMcpRequest(message);
    writeMcpResult(message.id, result);
  } catch (error) {
    writeMcpError(message.id, -32000, error.message || String(error), error.data || undefined);
  }
}

function markBrokerReady() {
  if (brokerReadyResolved) {
    return;
  }
  brokerReadyResolved = true;
  resolveBrokerReady();
}

async function handleMcpRequest(message) {
  const params = message.params || {};
  switch (message.method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion || MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: {
            listChanged: false
          }
        },
        serverInfo: {
          name: "poolside-browser",
          version: "0.1.0"
        }
      };
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: createTools()
      };
    case "tools/call":
      return callTool(params.name, params.arguments || {});
    default:
      throw new Error(`Unsupported MCP method: ${message.method}`);
  }
}

async function callTool(name, args) {
  if (brokerMode === "proxy") {
    return toToolResult(await callPrimaryBrokerTool(name, args));
  }
  return toToolResult(await executeLocalTool(name, args));
}

async function executeLocalTool(name, args) {
  if (name === "browser_status") {
    const client = await waitForActiveExtensionClient(STATUS_CONNECT_WAIT_MS);
    if (!client) {
      return {
        extensionConnected: false,
        brokerMode,
        waitedMs: STATUS_CONNECT_WAIT_MS,
        message: disconnectedMessage()
      };
    }
  }

  return sendCommandToExtension(name, args);
}

function toToolResult(result) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2)
      }
    ]
  };
}

async function sendCommandToExtension(method, params) {
  const client = await waitForActiveExtensionClient(EXTENSION_CONNECT_WAIT_MS);
  if (!client) {
    throw new Error(disconnectedMessage());
  }

  const id = `cmd_${Date.now()}_${randomUUID()}`;
  const command = {
    type: "command",
    id,
    method,
    params
  };

  const promise = new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingCommands.delete(id);
      reject(new Error(`Timed out waiting for the extension to complete ${method}.`));
    }, COMMAND_TIMEOUT_MS);

    pendingCommands.set(id, {
      resolve,
      reject,
      timeoutId
    });
  });

  deliverCommand(client, command);
  return promise;
}

async function waitForActiveExtensionClient(timeoutMs) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let client = getActiveExtensionClient();
  while (!client && Date.now() < deadline) {
    await sleep(EXTENSION_CONNECT_POLL_MS);
    client = getActiveExtensionClient();
  }
  return client;
}

function deliverCommand(client, command) {
  client.lastSeen = Date.now();
  if (client.pendingPoll) {
    const pendingPoll = client.pendingPoll;
    client.pendingPoll = null;
    clearTimeout(pendingPoll.timeoutId);
    sendJson(pendingPoll.response, 200, command);
    return;
  }
  client.queue.push(command);
}

function getActiveExtensionClient() {
  const now = Date.now();
  const candidates = Array.from(extensionClients.values())
    .filter((client) => now - client.lastSeen <= EXTENSION_STALE_MS)
    .sort((left, right) => {
      if (left.pendingPoll && !right.pendingPoll) {
        return -1;
      }
      if (!left.pendingPoll && right.pendingPoll) {
        return 1;
      }
      return right.lastSeen - left.lastSeen;
    });
  return candidates[0] || null;
}

function disconnectedMessage() {
  return `Poolside browser extension is not connected after waiting ${EXTENSION_CONNECT_WAIT_MS}ms. Open Google Chrome, load the Poolside it for me extension, and open the side panel or click the extension icon so the extension service worker is active.`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getExistingBridgeHealth(port = activePort) {
  const response = await fetchWithTimeout(`http://${HOST}:${port}/health`, {
    method: "GET"
  }, 1000);
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return data?.ok ? data : null;
}

async function existingBridgeSupportsProxyCalls(port = activePort) {
  const response = await fetchWithTimeout(`http://${HOST}:${port}/mcp/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      token: "__probe__",
      method: "browser_status",
      params: {}
    })
  }, 1000);
  return response.status === 401 || response.status === 200;
}

async function callPrimaryBrokerTool(method, params) {
  const response = await fetchWithTimeout(`http://${HOST}:${activePort}/mcp/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      token: BRIDGE_TOKEN,
      method,
      params
    })
  }, COMMAND_TIMEOUT_MS + 5000);

  if (response.status === 404) {
    throw new Error("A Poolside bridge is already running, but it is an older version that cannot proxy multiple MCP clients. Stop the old node mcp/server.mjs process and start this MCP server again.");
  }
  if (!response.ok) {
    throw new Error(`Primary Poolside bridge returned HTTP ${response.status}.`);
  }

  const data = await response.json();
  if (!data?.ok) {
    const error = new Error(data?.error?.message || "Primary Poolside bridge command failed.");
    error.data = data?.error || null;
    throw error;
  }
  return data.data;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Timed out connecting to ${url}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function handleHttpRequest(request, response) {
  try {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, null);
      return;
    }

    const url = new URL(request.url || "/", `http://${HOST}:${DEFAULT_PORT}`);
    if (url.pathname === "/health" && request.method === "GET") {
      sendJson(response, 200, {
        ok: true,
        name: "poolside-browser",
        brokerMode,
        extensionConnected: Boolean(getActiveExtensionClient()),
        port: activePort
      });
      return;
    }

    if (url.pathname === "/mcp/call" && request.method === "POST") {
      const body = await readJsonBody(request);
      await handleMcpHttpCall(body, response);
      return;
    }

    if (url.pathname === "/extension/poll" && request.method === "GET") {
      handleExtensionPoll(url, request, response);
      return;
    }

    if (url.pathname === "/extension/result" && request.method === "POST") {
      const body = await readJsonBody(request);
      handleExtensionResult(body, response);
      return;
    }

    sendJson(response, 404, {
      ok: false,
      error: "Not found."
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error.message || String(error)
    });
  }
}

async function handleMcpHttpCall(body, response) {
  if (body?.token !== BRIDGE_TOKEN) {
    sendJson(response, 401, {
      ok: false,
      error: "Invalid bridge token."
    });
    return;
  }

  try {
    const data = await executeLocalTool(String(body.method || ""), body.params || {});
    sendJson(response, 200, {
      ok: true,
      data
    });
  } catch (error) {
    sendJson(response, 200, {
      ok: false,
      error: {
        name: error.name || "Error",
        message: error.message || String(error),
        stack: error.stack || ""
      }
    });
  }
}

function handleExtensionPoll(url, request, response) {
  const token = url.searchParams.get("token") || "";
  if (token !== BRIDGE_TOKEN) {
    sendJson(response, 401, {
      ok: false,
      error: "Invalid bridge token."
    });
    return;
  }

  const clientId = url.searchParams.get("clientId") || "";
  if (!clientId) {
    sendJson(response, 400, {
      ok: false,
      error: "clientId is required."
    });
    return;
  }

  const now = Date.now();
  let client = extensionClients.get(clientId);
  if (!client) {
    client = {
      clientId,
      connectedAt: now,
      lastSeen: now,
      pendingPoll: null,
      queue: []
    };
    extensionClients.set(clientId, client);
    log(`Extension connected: ${clientId}`);
  }
  client.lastSeen = now;

  if (client.pendingPoll) {
    clearTimeout(client.pendingPoll.timeoutId);
    sendJson(client.pendingPoll.response, 200, {
      type: "noop",
      connected: true,
      reason: "superseded_poll"
    });
    client.pendingPoll = null;
  }

  const command = client.queue.shift();
  if (command) {
    sendJson(response, 200, command);
    return;
  }

  const timeoutId = setTimeout(() => {
    if (client.pendingPoll?.response !== response) {
      return;
    }
    client.pendingPoll = null;
    sendJson(response, 200, {
      type: "noop",
      connected: true,
      port: DEFAULT_PORT
    });
  }, POLL_HOLD_MS);

  client.pendingPoll = {
    response,
    timeoutId
  };

  request.on("close", () => {
    if (client.pendingPoll?.response === response) {
      clearTimeout(client.pendingPoll.timeoutId);
      client.pendingPoll = null;
    }
  });
}

function handleExtensionResult(body, response) {
  if (body?.token !== BRIDGE_TOKEN) {
    sendJson(response, 401, {
      ok: false,
      error: "Invalid bridge token."
    });
    return;
  }

  const pending = pendingCommands.get(body?.id);
  if (!pending) {
    sendJson(response, 404, {
      ok: false,
      error: "Command is no longer pending."
    });
    return;
  }

  pendingCommands.delete(body.id);
  clearTimeout(pending.timeoutId);
  if (body.ok) {
    pending.resolve(body.data);
  } else {
    const error = new Error(body.error?.message || "Extension command failed.");
    error.data = body.error || null;
    pending.reject(error);
  }
  sendJson(response, 200, {
    ok: true
  });
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  if (statusCode === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(body));
}

function writeMcpResult(id, result) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    result
  })}\n`);
}

function writeMcpError(id, code, message, data = undefined) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data })
    }
  })}\n`);
}

function log(message) {
  process.stderr.write(`[poolside-mcp] ${message}\n`);
}

function createTools() {
  return [
    {
      name: "browser_status",
      description: "Use this to check whether the Poolside Chrome extension is connected to this MCP bridge.",
      inputSchema: objectSchema({})
    },
    {
      name: "open_url",
      description: "Use this to open or navigate the active Chrome tab to an http or https URL through the Poolside extension.",
      inputSchema: objectSchema({
        url: {
          type: "string",
          description: "The absolute URL to open. If the scheme is omitted, https:// is assumed."
        },
        newTab: {
          type: "boolean",
          description: "Open the URL in a new active tab instead of navigating the current active tab."
        }
      }, ["url"])
    },
    {
      name: "observe_active_tab",
      description: "Use this before element actions. It returns a compact page snapshot with visible text, actionable element IDs, and a snapshotId for later actions.",
      inputSchema: objectSchema({
        persist: {
          type: "boolean",
          description: "Whether the extension should save this snapshot as the latest debug snapshot."
        }
      }),
      annotations: {
        readOnlyHint: true
      }
    },
    {
      name: "read_page_text",
      description: "Use this to read an additional visible text chunk from the last observed page snapshot.",
      inputSchema: objectSchema({
        snapshotId: {
          type: "string",
          description: "The snapshotId returned by observe_active_tab."
        },
        cursor: {
          type: "string",
          description: "The nextCursor value from a previous visibleText page."
        }
      }),
      annotations: {
        readOnlyHint: true
      }
    },
    {
      name: "click_element",
      description: "Use this to click an element ID from the latest observe_active_tab snapshot. Call observe_active_tab again after clicking if the page changes.",
      inputSchema: actionSchema({
        elementId: {
          type: "string",
          description: "Element ID from observe_active_tab."
        }
      }, ["elementId"])
    },
    {
      name: "fill_element",
      description: "Use this to type text into a fillable element ID from observe_active_tab.",
      inputSchema: actionSchema({
        elementId: {
          type: "string",
          description: "Element ID from observe_active_tab."
        },
        text: {
          type: "string",
          description: "Text to enter."
        }
      }, ["elementId", "text"])
    },
    {
      name: "clear_element",
      description: "Use this to clear a fillable element ID from observe_active_tab.",
      inputSchema: actionSchema({
        elementId: {
          type: "string",
          description: "Element ID from observe_active_tab."
        }
      }, ["elementId"])
    },
    {
      name: "select_option",
      description: "Use this to select an option in a select element from observe_active_tab.",
      inputSchema: actionSchema({
        elementId: {
          type: "string",
          description: "Select element ID from observe_active_tab."
        },
        value: {
          type: "string",
          description: "Option value. Use this when available."
        },
        text: {
          type: "string",
          description: "Visible option text to match if value is unknown."
        }
      }, ["elementId"])
    },
    {
      name: "submit_form",
      description: "Use this only when the user intends to submit the form. The extension may require user confirmation.",
      inputSchema: actionSchema({
        elementId: {
          type: "string",
          description: "A visible field or submit button inside the form."
        }
      }, ["elementId"])
    },
    {
      name: "press_key",
      description: "Use this for keyboard-specific controls. Prefer submit_form over Enter for forms.",
      inputSchema: actionSchema({
        key: {
          type: "string",
          enum: ["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Backspace"]
        },
        elementId: {
          type: "string",
          description: "Optional element ID to focus before pressing the key."
        }
      }, ["key"])
    },
    {
      name: "scroll",
      description: "Use this to scroll the active page.",
      inputSchema: actionSchema({
        direction: {
          type: "string",
          enum: ["up", "down", "left", "right"]
        },
        amount: {
          type: "number",
          description: "Approximate pixels to scroll."
        }
      }, ["direction"])
    }
  ];
}

function actionSchema(properties, required = []) {
  return objectSchema({
    snapshotId: {
      type: "string",
      description: "Optional snapshotId returned by observe_active_tab. If omitted, the extension uses the latest snapshot for the active tab."
    },
    summary: {
      type: "string",
      description: "Short user-visible action summary."
    },
    reason: {
      type: "string",
      description: "Short reason for the action."
    },
    requiresConfirmation: {
      type: "boolean",
      description: "Set true for risky actions. The extension applies its own deterministic confirmation policy regardless."
    },
    riskCategory: {
      type: "string",
      enum: ["safe_navigation", "data_entry", "external_submit", "destructive", "financial", "auth_sensitive", "unknown"]
    },
    ...properties
  }, required);
}

function objectSchema(properties, required = []) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required
  };
}
