// 웹 푸시 보내기
// 알림 내용을 암호화(RFC 8291, aes128gcm)하고, 우리 서버라는 증명(VAPID 서명)을 붙여서
// 애플/구글 등의 푸시 서비스로 보냅니다. 외부 라이브러리 없이 WebCrypto만 씁니다.

const enc = new TextEncoder();

export function b64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// 공개키(65바이트) + 비밀값(d) → WebCrypto가 읽는 JWK 모양
function privateJwk(publicRaw, d) {
  return {
    kty: 'EC', crv: 'P-256', ext: true,
    x: bytesToB64url(publicRaw.slice(1, 33)),
    y: bytesToB64url(publicRaw.slice(33, 65)),
    d
  };
}

// test: { salt: Uint8Array, asPublic: b64url, asPrivate: b64url } — 테스트용 고정값
export async function encryptPayload(subscription, payload, test) {
  const uaPublic = b64urlToBytes(subscription.keys.p256dh);
  const authSecret = b64urlToBytes(subscription.keys.auth);

  let asPublic, asPrivateKey;
  if (test) {
    asPublic = b64urlToBytes(test.asPublic);
    asPrivateKey = await crypto.subtle.importKey('jwk', privateJwk(asPublic, test.asPrivate),
      { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    asPrivateKey = pair.privateKey;
  }
  const salt = test ? test.salt : crypto.getRandomValues(new Uint8Array(16));

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivateKey, 256));

  const one = new Uint8Array([1]);
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = await hmac(prkKey, concat(keyInfo, one));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), one))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), one))).slice(0, 12);

  const plain = concat(enc.encode(payload), new Uint8Array([2])); // 2 = 마지막 조각 표시
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plain));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

export async function vapidAuthHeader(endpoint, vapid, now = Date.now()) {
  const publicRaw = b64urlToBytes(vapid.publicKey);
  const key = await crypto.subtle.importKey('jwk', privateJwk(publicRaw, vapid.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = bytesToB64url(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 3600,
    sub: vapid.subject
  })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(header + '.' + body));
  return 'vapid t=' + header + '.' + body + '.' + bytesToB64url(sig) + ', k=' + vapid.publicKey;
}

// 결과: { ok, status, gone }  gone = 구독이 사라짐(앱 삭제·알림 끔) → 목록에서 지워야 함
export async function sendPush(subscription, payload, vapid, ttl = 3600) {
  const body = await encryptPayload(subscription, payload);
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthHeader(subscription.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: 'high'
    },
    body
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}
