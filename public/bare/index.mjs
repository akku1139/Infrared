const endpoint = `${location.origin}/bare/v3`;

function responseHeaders(value) {
  const headers = {};
  if (!value) return headers;
  const parsed = JSON.parse(value);
  for (const [key, headerValue] of Object.entries(parsed)) headers[key] = headerValue;
  return headers;
}

function websocketEndpoint() {
  return endpoint.replace(/^http/, 'ws');
}

export default class BareTransport {
  ready = false;

  async init() {
    this.ready = true;
  }

  meta() {
    return {};
  }

  async request(remote, method, body, headers) {
    const response = await fetch(endpoint, {
      method,
      headers: {
        'X-Bare-URL': remote.href,
        'X-Bare-Headers': JSON.stringify(headers),
      },
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
    });

    return {
      body: response.body,
      headers: responseHeaders(response.headers.get('X-Bare-Headers')),
      status: Number(response.headers.get('X-Bare-Status')) || response.status,
      statusText: response.headers.get('X-Bare-Status-Text') || response.statusText,
    };
  }

  connect(remote, protocols, headers, onopen, onmessage, onclose, onerror) {
    const socket = new WebSocket(websocketEndpoint());
    socket.binaryType = 'arraybuffer';
    let opened = false;

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        type: 'connect',
        remote: remote.href,
        protocols,
        headers,
        forwardHeaders: [],
      }));
    });
    socket.addEventListener('message', (event) => {
      if (!opened) {
        try {
          const metadata = JSON.parse(event.data);
          if (metadata.type !== 'open') throw new Error('Invalid Bare WebSocket metadata');
          opened = true;
          onopen(metadata.protocol || '');
        } catch (error) {
          onerror(String(error));
          socket.close(1011, 'Invalid Bare WebSocket metadata');
        }
        return;
      }
      onmessage(event.data);
    });
    socket.addEventListener('error', () => onerror('Bare WebSocket error'));
    socket.addEventListener('close', (event) => onclose(event.code, event.reason));

    return [
      (data) => socket.send(data),
      (code, reason) => socket.close(code, reason),
    ];
  }
}
