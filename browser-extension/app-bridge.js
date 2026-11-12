const WEB_CHANNEL = 'HKSR_WEB_V2';
const EXTENSION_CHANNEL = 'HKSR_EXTENSION_V2';
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

function postToPage(message) {
  window.postMessage({ channel: EXTENSION_CHANNEL, ...message }, window.location.origin);
}

postToPage({ type: 'EXTENSION_READY', version: EXTENSION_VERSION });

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const request = event.data;
  if (!request || request.channel !== WEB_CHANNEL || request.type !== 'EXTENSION_REQUEST') return;
  if (typeof request.requestId !== 'string' || typeof request.action !== 'string') return;

  try {
    const response = await chrome.runtime.sendMessage({
      channel: WEB_CHANNEL,
      action: request.action,
      payload: request.payload ?? {},
    });
    postToPage({ type: 'EXTENSION_RESPONSE', requestId: request.requestId, response });
  } catch (error) {
    postToPage({
      type: 'EXTENSION_RESPONSE',
      requestId: request.requestId,
      response: { ok: false, error: error instanceof Error ? error.message : String(error) },
    });
  }
});
