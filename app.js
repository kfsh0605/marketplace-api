const path = require('path');
const express = require('express');
const OpenApiValidator = require('express-openapi-validator');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

// 1. Парсер JSON-тіла запиту — обов'язково ДО валідатора
app.use(express.json());

// 2. express-openapi-validator: звіряє кожен запит і кожну відповідь зі спекою
app.use(
    OpenApiValidator.middleware({
        apiSpec: path.join(__dirname, 'openapi', 'openapi.yaml'),
        validateRequests: true,
        validateResponses: true,
    })
);

// 3. In-memory "база даних"
let products = [
    {id: 'p-1', name: 'Клавіатура', priceCents: 45000, currency: 'UAH'},
    {id: 'p-2', name: 'Мишка', priceCents: 15000, currency: 'UAH'},
    {id: 'p-3', name: 'Монітор', priceCents: 850000, currency: 'UAH'},
];
let orders = [];
let nextOrderId = 1;

const idempotencyStore = new Map();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 години — стільки ж тримає ключі Stripe
const IDEMPOTENCY_MAX_ENTRIES = 10000; // запобіжник від необмеженого росту Map

function fingerprint(body) {
    return crypto.createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

function getIdempotencyRecord(key) {
    const record = idempotencyStore.get(key);
    if (!record) return undefined;
    if (Date.now() > record.expiresAt) {
        idempotencyStore.delete(key);
        return undefined;
    }
    return record;
}

function setIdempotencyRecord(key, value) {
    if (idempotencyStore.size >= IDEMPOTENCY_MAX_ENTRIES && !idempotencyStore.has(key)) {
        const oldestKey = idempotencyStore.keys().next().value;
        idempotencyStore.delete(oldestKey);
    }
    idempotencyStore.set(key, { ...value, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

// 4. Хелпери курсор-пагінації ("після елемента", як у лекції)
function encodeCursor(item) {
    return Buffer.from(JSON.stringify({id: item.id})).toString('base64url');
}

function decodeCursor(cursor) {
    try {
        return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

function paginate(list, {limit, cursor}) {
    let startIndex = 0;
    if (cursor) {
        const decoded = decodeCursor(cursor);
        if (!decoded) {
            const err = new Error('Невалідний cursor');
            err.status = 400;
            throw err;
        }
        const foundAt = list.findIndex((item) => item.id === decoded.id);
        startIndex = foundAt === -1 ? list.length : foundAt + 1;
    }
    const items = list.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < list.length;
    const next_cursor = hasMore ? encodeCursor(items[items.length - 1]) : null;
    return {items, next_cursor};
}

// 5. Роути products
app.get('/products', (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const result = paginate(products, {limit, cursor: req.query.cursor});
    res.status(200).json(result);
});

app.get('/products/:productId', (req, res) => {
    const product = products.find((p) => p.id === req.params.productId);
    if (!product) {
        const err = new Error(`Товар з id ${req.params.productId} не знайдено`);
        err.status = 404;
        throw err;
    }
    res.status(200).json(product);
});

// 6. Роути orders
app.get('/orders', (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const result = paginate(orders, {limit, cursor: req.query.cursor});
    res.status(200).json(result);
});

app.get('/orders/:orderId', (req, res) => {
    const order = orders.find((o) => o.id === req.params.orderId);
    if (!order) {
        const err = new Error(`Замовлення з id ${req.params.orderId} не знайдено`);
        err.status = 404;
        throw err;
    }
    res.status(200).json(order);
});

app.post('/orders', (req, res) => {
    const idempotencyKey = req.headers['idempotency-key'];
    const bodyFingerprint = fingerprint(req.body);

    const existing = getIdempotencyRecord(idempotencyKey);
    if (existing) {
        if (existing.fingerprint !== bodyFingerprint) {
            const err = new Error(
                `Idempotency-Key "${idempotencyKey}" вже використовувався з іншим тілом запиту`
            );
            err.status = 422;
            throw err;
        }
        res.setHeader('Idempotency-Replay', 'true');
        return res.status(201).json(existing.order);
    }

    const { items } = req.body;
    let totalCents = 0;
    for (const item of items) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) {
            const err = new Error(`Товар з id ${item.productId} не знайдено`);
            err.status = 400;
            throw err;
        }
        totalCents += product.priceCents * item.quantity;
    }

    const order = {
        id: `o-${nextOrderId++}`,
        items,
        totalCents,
        currency: 'UAH',
        status: 'new',
    };
    orders.push(order);
    setIdempotencyRecord(idempotencyKey, { fingerprint: bodyFingerprint, order });

    res.status(201).json(order);
});

// 7. Error-handler: єдина форма problem+json для БУДЬ-ЯКОЇ помилки
const PROBLEM_BASE = 'https://example.com/problems';

const TITLES = {
    400: 'Некоректний запит',
    404: 'Ресурс не знайдено',
    422: 'Неможливо обробити запит',
    409: 'Конфлікт',
    500: 'Внутрішня помилка сервера',
};

app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;

    let detail = err.message;
    if (Array.isArray(err.errors) && err.errors.length > 0) {
        detail = err.errors
            .map((e) => `${e.path ?? ''} ${e.message}`.trim())
            .join('; ');
    }

    res
        .status(status)
        .type('application/problem+json')
        .json({
            type: `${PROBLEM_BASE}/${status}`,
            title: TITLES[status] || 'Помилка',
            status,
            detail,
            instance: req.originalUrl,
        });
});

app.listen(PORT, () => {
    console.log(`Marketplace API listening on http://localhost:${PORT}`);
});