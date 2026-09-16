(function (global) {
  const prefix = '/service/';
  const urlRegex = /^(#|about:|data:|mailto:|javascript:)/i;

  function encode(value) {
    if (!value) return value;
    let output = '';
    for (let index = 0; index < value.length; index += 1) {
      output += index % 2 ? String.fromCharCode(value.charCodeAt(index) ^ 2) : value[index];
    }
    return encodeURIComponent(output);
  }

  function decode(value) {
    if (!value) return value;
    const [path, ...query] = value.split('?');
    let output = '';
    const decoded = decodeURIComponent(path);
    for (let index = 0; index < decoded.length; index += 1) {
      output += index % 2 ? String.fromCharCode(decoded.charCodeAt(index) ^ 2) : decoded[index];
    }
    return output + (query.length ? `?${query.join('?')}` : '');
  }

  function isProxyUrl(value) {
    return typeof value === 'string' && value.startsWith(`${global.location.origin}${prefix}`);
  }

  function rewriteUrl(value, base, origin = global.location.origin) {
    const input = String(value ?? '').trim();
    if (!input || urlRegex.test(input)) return input;
    if (input.startsWith(prefix)) return `${origin}${input}`;
    if (isProxyUrl(input)) return input;
    try {
      return `${origin}${prefix}${encode(new URL(input, base).href)}`;
    } catch {
      return `${origin}${prefix}${encode(input)}`;
    }
  }

  function sourceUrl(value, base = global.location.href) {
    const input = String(value ?? '');
    const originPrefix = `${global.location.origin}${prefix}`;
    if (!input || urlRegex.test(input) || !input.startsWith(originPrefix)) return input;
    try {
      return new URL(decode(input.slice(originPrefix.length)), base).href;
    } catch {
      return decode(input.slice(originPrefix.length));
    }
  }

  global.infraredProxy = {
    prefix,
    encode,
    decode,
    isProxyUrl,
    rewriteUrl,
    sourceUrl,
    toProxyUrl(value) {
      return `${global.location.origin}${prefix}${encode(value)}`;
    },
  };
})(self);
