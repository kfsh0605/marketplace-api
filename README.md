# Marketplace API — ДЗ №9 (ДЗ №1 курсового проєкту)

OpenAPI-контракт та мінімальний Express-сервер для курсового проєкту Node.js Pro.
Каталог товарів (`/products`) та оформлення замовлень (`/orders`) з курсор-пагінацією,
обов'язковим заголовком `Idempotency-Key` на створенні замовлення та помилками у
форматі `application/problem+json` (RFC 9457).

## Обраний варіант

**Варіант Б — runtime-валідація на кордоні.**

Мінімальний сервер на Express (`app.js`), де `express-openapi-validator` валідує
кожен запит і кожну відповідь проти `openapi/openapi.yaml` (`validateRequests: true`,
`validateResponses: true`), а власний error-handler перекладає помилки валідатора у
`problem+json`. Реалізовано всі 5 операцій зі спеки з in-memory даними (без БД).

Додатково реалізована повна семантика `Idempotency-Key` (позначена в ДЗ як бонус,
не обов'язковий для балів): повтор того самого ключа й тіла повертає той самий `201`
із заголовком `Idempotency-Replay: true`; той самий ключ з іншим тілом — `422 problem+json`.

## Встановлення

```
npm install
```

## Запуск

```
npm start
```

Сервер піднімається на `http://localhost:3000`.

## Перевірка

### Спека

```
npx @redocly/cli lint openapi/openapi.yaml
npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
node check-spec.js
```

Очікується: лінт — exit code 0 (warnings допустимі, errors — ні); `check-spec.js` —
`операцій: 5 · ресурсів: 2`, `Idempotency-Key: required = true`, опис ≥ 40 символів.

Кількість згадувань у спеці:

```
grep -c 'Idempotency-Key' openapi/openapi.yaml
grep -c 'next_cursor' openapi/openapi.yaml
grep -c 'application/problem+json' openapi/openapi.yaml
```

(на Windows PowerShell без grep — еквівалент:
`(Select-String -Path openapi/openapi.yaml -Pattern 'Idempotency-Key').Count` і так само
для інших двох патернів)

### Сервер (після `npm start`, у іншому терміналі)

Тестові тіла запитів лежать у файлах `valid-order.json`, `empty-items.json`,
`other-order.json` у корені репозиторію.

```
curl -i -X POST http://localhost:3000/orders -H "Content-Type: application/json" -d @valid-order.json
```
→ `400`, `Content-Type: application/problem+json` (немає Idempotency-Key)

```
curl -i -X POST http://localhost:3000/orders -H "Content-Type: application/json" -H "Idempotency-Key: test-key-1" -d @empty-items.json
```
→ `400`, `application/problem+json` (`items` порожній)

```
curl -i -X POST http://localhost:3000/orders -H "Content-Type: application/json" -H "Idempotency-Key: test-key-2" -d @valid-order.json
```
→ `201`, створено замовлення

Повторіть останню команду ще раз з тим самим ключем — отримаєте `201` +
`Idempotency-Replay: true` і той самий `id` замовлення. З ключем `test-key-2`, але
тілом з `other-order.json` — отримаєте `422 problem+json`.

Курсор-пагінація каталогу:

```
curl -i "http://localhost:3000/products?limit=2"
curl -i "http://localhost:3000/products?limit=2&cursor=<next_cursor з попередньої відповіді>"
```

## Структура

| Файл / тека | Призначення |
|---|---|
| `openapi/openapi.yaml` | контракт: 2 ресурси (products, orders), 5 операцій, cursor-пагінація, Idempotency-Key, problem+json |
| `app.js` | Express-сервер з express-openapi-validator, in-memory дані, error-handler, логіка Idempotency-Key |
| `check-spec.js` | програмна перевірка обсягу спеки |
| `spec.json` | зібрана (bundled) спека — результат `redocly bundle` |
| `valid-order.json`, `empty-items.json`, `other-order.json` | тестові тіла запитів для ручної перевірки |