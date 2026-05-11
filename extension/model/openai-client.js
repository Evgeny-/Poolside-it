import { BUILT_IN_MODELS, DEFAULT_MODEL } from "../shared/protocol.js";

export function getOpenAIModelStatus() {
  return {
    provider: "openai",
    endpoint: "https://api.openai.com/v1/responses",
    status: "ready",
    defaultModel: DEFAULT_MODEL,
    builtInModels: BUILT_IN_MODELS,
    note: "Model calls are made only from the extension service worker. API keys are not sent to content scripts or injected pages."
  };
}

export async function callOpenAIResponses({ apiKey, body }) {
  if (!apiKey) {
    throw new Error("OpenAI API key is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

export async function listOpenAIModels({ apiKey }) {
  if (!apiKey) {
    return BUILT_IN_MODELS;
  }

  const response = await fetch("https://api.openai.com/v1/models", {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI model list failed with ${response.status}`;
    throw new Error(message);
  }

  const ids = (payload.data || [])
    .map((model) => model.id)
    .filter((id) => isUsableTextModelId(id))
    .sort((left, right) => left.localeCompare(right));

  return Array.from(new Set([...BUILT_IN_MODELS, ...ids]));
}

export function extractResponseText(response) {
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }

  const chunks = [];
  for (const item of response?.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") {
        chunks.push(content.text);
      }
      if (typeof content.output_text === "string") {
        chunks.push(content.output_text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function isUsableTextModelId(id) {
  if (!/^(gpt|o[0-9]|chatgpt)/i.test(id)) {
    return false;
  }

  return ![
    "audio",
    "image",
    "realtime",
    "search-preview",
    "transcribe",
    "tts",
    "whisper"
  ].some((excluded) => id.toLowerCase().includes(excluded));
}
