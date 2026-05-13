# Сайт ООО «ЛСТ ПРО» для lstpro.ru

Production-ready статический сайт для Netlify.

## Состав
- `index.html` — главная страница
- `compliance-511.html` — сведения по Приказу Минцифры РФ от 02.06.2025 №511
- `privacy.html` — политика обработки персональных данных
- `user-agreement.html` — пользовательское соглашение
- `cookies.html` — cookie notice
- `requisites.html` — реквизиты
- `success.html` — страница успешной отправки формы
- `404.html` — страница ошибки
- `robots.txt`, `sitemap.xml`, `netlify.toml`
- `assets/` — SVG-графика и favicon

## Деплой на Netlify
1. Создайте репозиторий GitHub `lstpro-site`.
2. Загрузите файлы из архива в корень репозитория.
3. В Netlify выберите Add new site → Import from Git → GitHub → `lstpro-site`.
4. Build command оставьте пустым, Publish directory: `.`.
5. В Domain management добавьте домен `lstpro.ru`.
6. Настройте DNS у регистратора по инструкциям Netlify.

## Формы Netlify
Форма заявки подключена через `data-netlify="true"`. После первого деплоя Netlify автоматически обнаружит форму `request`.

## Что заменить перед публикацией
- Добавить номер счётчика Яндекс.Метрики, если нужен.
- При необходимости указать основной ОКВЭД после подтверждения.
- Проверить и утвердить юридическую редакцию политики/соглашения.
