// Обработчик формы заявки lstpro.ru (замена Netlify Forms).
// Без внешних зависимостей, Node 18+.
//
// Принимает POST (application/x-www-form-urlencoded) на любой путь,
// пишет заявку в JSONL-журнал (доказательство согласия на обработку ПДн)
// и отправляет уведомление в Telegram, если заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID.
// Отвечает 303 -> /success.html, чтобы браузер показал страницу успеха.
//
// Переменные окружения (см. /etc/lstpro-form.env):
//   PORT              порт (по умолчанию 8300, слушает только 127.0.0.1)
//   DATA_FILE         путь к журналу (по умолчанию /var/lib/lstpro-form/requests.jsonl)
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID  куда слать уведомления

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8300);
const DATA_FILE = process.env.DATA_FILE || '/var/lib/lstpro-form/requests.jsonl';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

const MAX_BODY = 64 * 1024;
const rate = new Map(); // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  const hits = (rate.get(ip) || []).filter(t => now - t < 60_000);
  hits.push(now);
  rate.set(ip, hits);
  if (rate.size > 10_000) rate.clear();
  return hits.length > 5;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function notifyTelegram(entry) {
  if (!TG_TOKEN || !TG_CHAT) return;
  const text = [
    '<b>Заявка с lstpro.ru</b>',
    `<b>Имя:</b> ${esc(entry.name)}`,
    `<b>Контакт:</b> ${esc(entry.contact)}`,
    `<b>Задача:</b> ${esc(entry.message)}`,
    `<i>${entry.ts} · IP ${entry.ip}</i>`,
  ].join('\n');
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) console.error('telegram error:', res.status, await res.text());
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }

  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > MAX_BODY) req.destroy();
  });
  req.on('end', async () => {
    const redirect = () => {
      res.writeHead(303, { Location: '/success.html' });
      res.end();
    };
    try {
      const p = new URLSearchParams(body);
      const ip = req.headers['x-real-ip'] || req.socket.remoteAddress || '';

      // Honeypot и рейт-лимит: боту отвечаем как обычно, но заявку не сохраняем
      if (p.get('bot-field') || rateLimited(ip)) return redirect();

      const entry = {
        ts: new Date().toISOString(),
        ip,
        name: (p.get('name') || '').slice(0, 200).trim(),
        contact: (p.get('contact') || '').slice(0, 200).trim(),
        message: (p.get('message') || '').slice(0, 4000).trim(),
        consent: p.get('consent') || '',
        ua: String(req.headers['user-agent'] || '').slice(0, 300),
      };
      if (!entry.name || !entry.contact || !entry.message) return redirect();

      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.appendFileSync(DATA_FILE, JSON.stringify(entry) + '\n');
      await notifyTelegram(entry).catch(e => console.error('notify failed:', e));
      redirect();
    } catch (e) {
      console.error('request failed:', e);
      redirect(); // посетителю всегда показываем успех, ошибки смотрим в journalctl
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`lstpro-form listening on 127.0.0.1:${PORT}`));
