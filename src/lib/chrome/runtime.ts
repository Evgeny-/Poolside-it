export async function sendRuntimeMessage<T = any>(type: string, payload: Record<string, any> = {}): Promise<T> {
  const response = await chrome.runtime.sendMessage({ type, payload });
  if (!response?.ok) {
    throw new Error(response?.error?.message || "Extension message failed.");
  }
  return response.data;
}

export function openExtensionTab(path: string) {
  chrome.tabs.create({
    url: chrome.runtime.getURL(path)
  });
}
