// Обработчик формы заявки lstpro.ru (замена Netlify Forms).
// Без внешних зависимостей, Node 18+.
//
// Принимает POST (application/x-www-form-urlencoded) на любой путь,
// пишет заявку в JSONL-журнал (доказательство согласия на обработку ПДн)
// и отправляет уведомления: на почту по SMTP и/или в Telegram — что настроено.
// Отвечает 303 -> /success.html, чтобы браузер показал страницу успеха.
//
// Переменные окружения (см. /etc/lstpro-form.env):
//   PORT              порт (по умолчанию 8300, слушает только 127.0.0.1)
//   DATA_FILE         путь к журналу (по умолчанию /var/lib/lstpro-form/requests.jsonl)
//   SMTP_HOST, SMTP_PORT (465 = TLS сразу, иначе STARTTLS), SMTP_USER, SMTP_PASS
//   MAIL_TO           получатель заявок; MAIL_FROM (по умолчанию = SMTP_USER)
//   SMTP_TLS_REJECT_UNAUTHORIZED=0  отключить проверку TLS-сертификата SMTP-сервера
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
//
// Тест почты: node server.js --test-email

const http = require('http');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8300);
const DATA_FILE = process.env.DATA_FILE || '/var/lib/lstpro-form/requests.jsonl';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const SMTP = {
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER,
  pass: process.env.SMTP_PASS,
  to: process.env.MAIL_TO,
  from: process.env.MAIL_FROM || process.env.SMTP_USER,
  rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== '0',
};

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

// --- SMTP (EHLO -> STARTTLS -> AUTH LOGIN -> MAIL) --------------------------

// У почтового сервера может быть несколько A-записей, часть — недоступные
// снаружи; Node 18 сам адреса не перебирает, поэтому перебираем вручную.
async function smtpConnect(host, port, implicitTls, rejectUnauthorized) {
  let addrs;
  try { addrs = await require('dns').promises.resolve4(host); } catch { addrs = [host]; }
  let lastErr;
  for (const addr of addrs) {
    try {
      return await new Promise((resolve, reject) => {
        const s = implicitTls
          ? tls.connect({ host: addr, port, servername: host, rejectUnauthorized })
          : net.connect({ host: addr, port });
        const t = setTimeout(() => { s.destroy(); reject(new Error(`connect timeout ${addr}`)); }, 6000);
        s.once(implicitTls ? 'secureConnect' : 'connect', () => { clearTimeout(t); resolve(s); });
        s.once('error', e => { clearTimeout(t); reject(e); });
      });
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('smtp connect failed');
}

async function smtpSend({ subject, text }) {
  const { host, port, user, pass, from, to, rejectUnauthorized } = SMTP;
  if (!host || !user || !pass || !to) return 'smtp not configured';
  const implicitTls = port === 465;
  const socket = await smtpConnect(host, port, implicitTls, rejectUnauthorized);

  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  const message = [
    `From: lstpro.ru <${from}>`,
    `To: <${to}>`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(text).replace(/(.{76})/g, '$1\r\n'),
    '.',
  ].join('\r\n');

  return new Promise((resolve, reject) => {
    let sock = socket, buf = '', step = 0, settled = false;
    const timer = setTimeout(() => fail(new Error('smtp timeout')), 30000);
    const done = () => { if (!settled) { settled = true; clearTimeout(timer); resolve('sent'); } };
    const fail = e => { if (!settled) { settled = true; clearTimeout(timer); try { sock.destroy(); } catch {} reject(e); } };
    const send = line => sock.write(line + '\r\n');

    // Каждый шаг: ожидаемый код ответа и действие после него
    const steps = [];
    steps.push({ code: 220, run: () => send('EHLO lstpro.ru') });
    if (!implicitTls) {
      steps.push({ code: 250, run: () => send('STARTTLS') });
      steps.push({ code: 220, run: upgrade });
      steps.push({ code: 250, run: () => send('AUTH LOGIN') }); // ответ на повторный EHLO
    } else {
      steps.push({ code: 250, run: () => send('AUTH LOGIN') });
    }
    steps.push({ code: 334, run: () => send(b64(user)) });
    steps.push({ code: 334, run: () => send(b64(pass)) });
    steps.push({ code: 235, run: () => send(`MAIL FROM:<${from}>`) });
    steps.push({ code: 250, run: () => send(`RCPT TO:<${to}>`) });
    steps.push({ code: 250, run: () => send('DATA') });
    steps.push({ code: 354, run: () => sock.write(message + '\r\n') });
    steps.push({ code: 250, run: () => { send('QUIT'); done(); } });

    function onData(chunk) {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const m = line.match(/^(\d{3}) /); // финальная строка ответа (после кода — пробел)
        if (!m) continue;
        const code = Number(m[1]);
        const s = steps[step];
        if (!s) return;
        if (code !== s.code) return fail(new Error(`smtp step ${step}: ожидали ${s.code}, получили "${line}"`));
        step++;
        s.run();
      }
    }

    function upgrade() {
      sock.removeListener('data', onData);
      buf = '';
      sock = tls.connect({ socket: sock, servername: host, rejectUnauthorized }, () => {
        sock.on('data', onData);
        send('EHLO lstpro.ru');
      });
      sock.on('error', fail);
    }

    sock.on('data', onData);
    sock.on('error', fail);
  });
}

// --- Уведомления ------------------------------------------------------------

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

function notifyEmail(entry) {
  return smtpSend({
    subject: `Заявка с lstpro.ru: ${entry.name}`,
    text: [
      'Новая заявка с сайта lstpro.ru',
      '',
      `Имя:     ${entry.name}`,
      `Контакт: ${entry.contact}`,
      `Задача:  ${entry.message}`,
      '',
      `Согласие на обработку ПДн: ${entry.consent || 'не отмечено'}`,
      `Время: ${entry.ts}`,
      `IP: ${entry.ip}`,
    ].join('\n'),
  });
}

function notifyAll(entry) {
  return Promise.allSettled([notifyEmail(entry), notifyTelegram(entry)]).then(results => {
    results.forEach(r => { if (r.status === 'rejected') console.error('notify failed:', r.reason); });
  });
}

// --- Режим теста почты ------------------------------------------------------

if (process.argv.includes('--test-email')) {
  smtpSend({
    subject: 'Тест: заявки с lstpro.ru настроены',
    text: 'Это тестовое письмо от обработчика формы lstpro.ru.\n\nЕсли вы его читаете — SMTP-уведомления о заявках работают.\nЗаявки также сохраняются на сервере в /var/lib/lstpro-form/requests.jsonl.',
  }).then(r => { console.log('OK:', r); process.exit(0); })
    .catch(e => { console.error('FAIL:', e.message); process.exit(1); });
} else {

// --- HTTP-сервер ------------------------------------------------------------

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
      if (res.headersSent) return;
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
      redirect(); // посетителя не заставляем ждать SMTP
      await notifyAll(entry);
    } catch (e) {
      console.error('request failed:', e);
      redirect();
    }
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`lstpro-form listening on 127.0.0.1:${PORT}`));

}
