// VAPID 열쇠 한 쌍 만들기 (처음 한 번만)
// 공개키는 앱(js/app.js)과 wrangler.toml에, 비밀키는 .dev.vars와 Cloudflare 비밀값에 넣습니다.

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

console.log('VAPID_PUBLIC_KEY=' + b64url(pub));
console.log('VAPID_PRIVATE_KEY=' + jwk.d);
