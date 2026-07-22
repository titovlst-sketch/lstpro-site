# Переезд lstpro.ru с Netlify на VDS (FirstVDS)

Всё необходимое лежит в этой папке:

- `setup-server.sh` — первичная настройка сервера одним запуском
- `nginx/lstpro.ru.conf` — конфиг сайта (редиректы, кэш, 404, проксирование формы)
- `nginx/lstpro-headers.conf` — security-заголовки, включая CSP (копия netlify.toml)
- `form-handler/` — обработчик формы заявки (замена Netlify Forms) + systemd-юнит

## Чек-лист переезда

### 1. Подготовка (заранее, до переключения)

- [ ] В DNS-панели домена lstpro.ru снизить TTL A-записей до 300 сек.
- [ ] Создать Telegram-бота для заявок: написать @BotFather → `/newbot`, сохранить токен.
      Узнать свой chat_id: написать @userinfobot. Написать своему боту `/start` (иначе он не сможет вам писать).

### 2. Настройка сервера (когда VDS готов)

```bash
ssh root@IP_СЕРВЕРА
git clone https://github.com/titovlst-sketch/lstpro-site.git
cd lstpro-site
bash deploy/setup-server.sh
```

Скрипт ставит nginx, certbot, Node, ufw, fail2ban, выкладывает сайт в `/var/www/lstpro`,
запускает обработчик формы и (если найден SSH-ключ) отключает вход по паролю.

- [ ] Вписать токен и chat_id в `/etc/lstpro-form.env`, затем `systemctl restart lstpro-form`.
- [ ] Проверить сайт по IP: `curl -H "Host: lstpro.ru" http://IP_СЕРВЕРА/` — должен вернуться HTML.
      Для проверки в браузере добавьте в hosts-файл строку `IP_СЕРВЕРА lstpro.ru`
      (Windows: `C:\Windows\System32\drivers\etc\hosts`), после проверки удалите.
- [ ] Проверить форму: `curl -d "name=Тест&contact=test@test.ru&message=Проверка&consent=да" http://127.0.0.1:8300/` на сервере —
      должна прийти заявка в Telegram и появиться строка в `/var/lib/lstpro-form/requests.jsonl`.

### 3. Переключение

- [ ] A-запись `lstpro.ru` → IP сервера (и `www`, если это отдельная A-запись).
- [ ] Через 5–10 минут выпустить сертификат:
      `certbot --nginx --redirect -d lstpro.ru -d www.lstpro.ru`
      (автопродление certbot настраивает сам, проверка: `certbot renew --dry-run`).
- [ ] Проверить: `https://lstpro.ru` открывается, замок валиден, форма отправляется,
      заголовки на месте: `curl -sI https://lstpro.ru | grep -i content-security`.

### 4. Автодеплой из GitHub

На сервере:
```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/github-deploy
cat /root/.ssh/github-deploy.pub >> /root/.ssh/authorized_keys
cat /root/.ssh/github-deploy   # приватный ключ — скопировать в секрет
```

В GitHub → репозиторий `lstpro-site` → Settings → Secrets and variables → Actions:

| Тип | Имя | Значение |
|---|---|---|
| Secret | `DEPLOY_HOST` | IP сервера |
| Secret | `DEPLOY_USER` | `root` |
| Secret | `DEPLOY_SSH_KEY` | приватный ключ целиком (вывод `cat` выше) |
| Variable | `DEPLOY_ENABLED` | `true` |

После этого каждый push в `main` автоматически выкладывает сайт (как было на Netlify).

### 5. После переезда

- [ ] 2–3 дня понаблюдать, затем удалить сайт в Netlify (Site settings → Delete site).
- [ ] Включить резервное копирование в панели FirstVDS.
- [ ] Вернуть TTL DNS на обычное значение (3600+).
- [ ] Заявки хранятся в `/var/lib/lstpro-form/requests.jsonl` — это же журнал согласий на обработку ПДн.

## Диагностика

```bash
systemctl status nginx lstpro-form   # состояние сервисов
journalctl -u lstpro-form -e         # логи обработчика формы
nginx -t && systemctl reload nginx   # проверка и перечитывание конфига
tail /var/lib/lstpro-form/requests.jsonl  # последние заявки
```
