// 성경통독표 알림 서버 (Cloudflare Worker)
// - 앱이 "이 폰에 몇 시에 알림 보내줘"라고 등록하면 저장해둡니다.
// - 1분마다 깨어나서, 지금이 등록한 시간이면 알림을 보냅니다.
// 알림 문구(오늘 읽을 곳)는 폰 안의 앱이 채워 넣으므로, 서버는 "아침/저녁"만 알려줍니다.

import { sendPush } from './webpush.js';

const SUBS_KEY = 'subs';
const MAX_SUBS = 10;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALLOWED_ORIGINS_DEFAULT = 'https://ynbodystudio.github.io';
const ALLOWED_ORIGINS = [/^https:\/\/ynbodystudio\.github\.io$/,/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
// 알림은 진짜 푸시 서비스 주소로만 보냅니다 (엉뚱한 곳으로 요청을 보내는 데 쓰이지 않게)
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.some((re) => re.test(origin)) ? origin : ALLOWED_ORIGINS_DEFAULT,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const reply = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/') return reply({ ok: true, name: 'bible-reading-plan push' });
    if (request.method !== 'POST') return reply({ ok: false, error: 'not found' }, 404);

    let body;
    try { body = await request.json(); } catch { return reply({ ok: false, error: 'bad json' }, 400); }

    if (path === '/subscribe') {
      const sub = cleanSubscription(body, env);
      if (!sub) return reply({ ok: false, error: 'invalid subscription' }, 400);
      const subs = (await loadSubs(env)).filter((s) => s.endpoint !== sub.endpoint);
      subs.push(sub);
      subs.sort((a, b) => b.updatedAt - a.updatedAt);
      await env.SUBS.put(SUBS_KEY, JSON.stringify(subs.slice(0, MAX_SUBS)));
      return reply({ ok: true });
    }

    if (path === '/unsubscribe') {
      const subs = await loadSubs(env);
      const left = subs.filter((s) => s.endpoint !== body.endpoint);
      if (left.length !== subs.length) await env.SUBS.put(SUBS_KEY, JSON.stringify(left));
      return reply({ ok: true });
    }

    if (path === '/test') {
      const sub = (await loadSubs(env)).find((s) => s.endpoint === body.endpoint);
      if (!sub) return reply({ ok: false, error: 'not subscribed' }, 404);
      const r = await sendPush(sub, JSON.stringify({ kind: 'test', date: localParts(Date.now(), sub.tz).date }), vapidOf(env), 600);
      return reply({ ok: r.ok, status: r.status }, r.ok ? 200 : 502);
    }

    return reply({ ok: false, error: 'not found' }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDue(event.scheduledTime, env));
  }
};

export async function sendDue(time, env) {
  const subs = await loadSubs(env);
  if (!subs.length) return [];
  const vapid = vapidOf(env);
  const sent = [];
  const gone = new Set();

  await Promise.all(subs.map(async (sub) => {
    const now = localParts(time, sub.tz);
    for (const kind of ['morning', 'evening']) {
      if (!sub[kind].on || sub[kind].time !== now.time) continue;
      try {
        const r = await sendPush(sub, JSON.stringify({ kind, date: now.date }), vapid);
        sent.push({ kind, status: r.status });
        if (r.gone) gone.add(sub.endpoint);
      } catch (err) {
        sent.push({ kind, error: String(err) });
      }
    }
  }));

  if (gone.size) {
    await env.SUBS.put(SUBS_KEY, JSON.stringify(subs.filter((s) => !gone.has(s.endpoint))));
  }
  return sent;
}

async function loadSubs(env) {
  return (await env.SUBS.get(SUBS_KEY, 'json')) || [];
}

function vapidOf(env) {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

function cleanSubscription(body, env) {
  const s = body && body.subscription;
  if (!s || typeof s.endpoint !== 'string' || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') return null;
  let url;
  try { url = new URL(s.endpoint); } catch { return null; }
  const localTest = env.ALLOW_LOCAL_ENDPOINT === '1' && url.hostname === '127.0.0.1';
  if (!localTest && (url.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(url.hostname)))) return null;

  const slot = (v, fallback) => ({
    on: !!(v && v.on),
    time: v && TIME_RE.test(v.time) ? v.time : fallback
  });
  return {
    endpoint: s.endpoint,
    keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
    tz: validTimeZone(body.tz) ? body.tz : 'Asia/Seoul',
    morning: slot(body.morning, '07:00'),
    evening: slot(body.evening, '21:00'),
    updatedAt: Date.now()
  };
}

function validTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// 그 사람의 시간대 기준 날짜와 시각 → { date: 'YYYY-MM-DD', time: 'HH:MM' }
export function localParts(time, tz) {
  const parts = {};
  new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(time)).forEach((p) => { parts[p.type] = p.value; });
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
