#!/usr/bin/env bash
# Первичная настройка VDS (Ubuntu 24.04) для сайта lstpro.ru.
# Запуск под root из корня клонированного репозитория:
#   git clone https://github.com/titovlst-sketch/lstpro-site.git && cd lstpro-site
#   bash deploy/setup-server.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Запустите под root: sudo bash deploy/setup-server.sh"; exit 1; fi
if [[ ! -f index.html || ! -d deploy ]]; then echo "Запускайте из корня репозитория lstpro-site"; exit 1; fi

echo "== Пакеты =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq nginx certbot python3-certbot-nginx nodejs ufw fail2ban rsync unattended-upgrades

echo "== Сайт -> /var/www/lstpro =="
mkdir -p /var/www/lstpro
rsync -a --delete \
  --exclude '.git*' --exclude 'deploy/' --exclude 'README.md' --exclude 'netlify.toml' \
  ./ /var/www/lstpro/
chown -R www-data:www-data /var/www/lstpro

echo "== nginx =="
install -m 644 deploy/nginx/lstpro-headers.conf /etc/nginx/snippets/lstpro-headers.conf
install -m 644 deploy/nginx/lstpro.ru.conf /etc/nginx/sites-available/lstpro.ru.conf
ln -sf /etc/nginx/sites-available/lstpro.ru.conf /etc/nginx/sites-enabled/lstpro.ru.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "== Обработчик формы =="
mkdir -p /opt/lstpro-form
install -m 644 deploy/form-handler/server.js /opt/lstpro-form/server.js
install -m 644 deploy/form-handler/lstpro-form.service /etc/systemd/system/lstpro-form.service
if [[ ! -f /etc/lstpro-form.env ]]; then
  cat > /etc/lstpro-form.env <<'EOF'
# Уведомления о заявках в Telegram: создайте бота у @BotFather,
# узнайте свой chat_id у @userinfobot и впишите значения.
#TELEGRAM_BOT_TOKEN=123456:ABC...
#TELEGRAM_CHAT_ID=123456789
EOF
  chmod 600 /etc/lstpro-form.env
fi
systemctl daemon-reload
systemctl enable --now lstpro-form
sleep 1
curl -fsS http://127.0.0.1:8300/health && echo " — обработчик формы работает"

echo "== Файрвол и защита =="
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== SSH =="
if [[ -s /root/.ssh/authorized_keys ]] || find /home/*/.ssh/authorized_keys -size +0c -print -quit 2>/dev/null | grep -q .; then
  install -m 644 /dev/stdin /etc/ssh/sshd_config.d/90-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  systemctl reload ssh
  echo "SSH-ключи найдены — вход по паролю отключён."
else
  echo "ВНИМАНИЕ: SSH-ключей не найдено, вход по паролю оставлен. Добавьте ключ и перезапустите скрипт."
fi

echo
echo "================================================================"
echo "Готово. Дальше вручную:"
echo "1) Направьте DNS lstpro.ru (A-запись) на IP этого сервера."
echo "2) Выпустите сертификат:  certbot --nginx --redirect -d lstpro.ru -d www.lstpro.ru"
echo "3) Впишите Telegram-токен в /etc/lstpro-form.env и выполните: systemctl restart lstpro-form"
echo "4) Настройте автодеплой из GitHub — см. deploy/README.md"
echo "================================================================"
