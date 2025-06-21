const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const dotenv = require('dotenv');
const crypto = require('crypto');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL подключение
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ======== Проверка initData с отладкой ========
function verifyInitData(initDataRaw) {
  try {
    const token = process.env.BOT_TOKEN;
    if (!token || !initDataRaw) {
      console.log("❌ Нет token или initData");
      return false;
    }

    const secret = crypto.createHash('sha256').update(token).digest();
    const parsed = new URLSearchParams(initDataRaw);
    const hash = parsed.get('hash');
    parsed.delete('hash');

    const dataCheckString = [...parsed.entries()]
      .sort()
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const hmac = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

    const valid = hmac === hash;

    if (!valid) {
      console.log("❌ Неверная подпись initData:");
      console.log("📥 raw initData:", initDataRaw);
      console.log("📄 dataCheckString:", dataCheckString);
      console.log("✅ calculated HMAC:", hmac);
      console.log("🛑 provided hash:", hash);
    }

    return valid;
  } catch (e) {
    console.log("❌ Ошибка в verifyInitData:", e.message);
    return false;
  }
}

// ======== Middleware: проверка initData или DEMO режим ========
app.use((req, res, next) => {
  const initDataRaw = req.headers['x-init-data'];

  if (initDataRaw) {
    const ok = verifyInitData(initDataRaw);
    if (!ok) {
      console.log("⛔️ Подпись initData не прошла");
      return res.status(401).send("Invalid initData");
    }

    try {
      const parsed = new URLSearchParams(initDataRaw);
      const user = JSON.parse(parsed.get('user'));

      req.tgUser = {
        id: user.id,
        username: user.username || null,
        photo_url: user.photo_url || null
      };
    } catch (e) {
      console.log("❌ Ошибка разбора user:", e.message);
      return res.status(400).send("Bad user data");
    }

    return next();
  }

  // Если initData не передан → включаем тестовый режим
  console.log("⚠️ DEMO-режим: initData не передан");
  req.tgUser = { id: 999999, username: 'demo_user' };
  next();
});

// ======== Маршруты ========

// Получить круги пользователя
app.get('/circles', async (req, res) => {
  const { id } = req.tgUser;
  const result = await pool.query(
    'SELECT * FROM circles WHERE user_id = $1 ORDER BY id ASC',
    [id]
  );

  const circles = result.rows;
  for (let circle of circles) {
    const sells = await pool.query(
      'SELECT * FROM sells WHERE circle_id = $1 ORDER BY id ASC',
      [circle.id]
    );
    circle.sells = sells.rows;
  }

  res.json(circles);
});

// Создать круг
app.post('/circles', async (req, res) => {
  const { id } = req.tgUser;
  const { buyAmount } = req.body;

  const result = await pool.query(
    'INSERT INTO circles (user_id, buyAmount, remaining, closed) VALUES ($1, $2, $2, false) RETURNING *',
    [id, buyAmount]
  );

  res.json(result.rows[0]);
});

// Удалить круг
app.delete('/circles/:id', async (req, res) => {
  const circleId = req.params.id;
  await pool.query('DELETE FROM sells WHERE circle_id = $1', [circleId]);
  await pool.query('DELETE FROM circles WHERE id = $1', [circleId]);
  res.sendStatus(204);
});

// Добавить сделку (продажу)
app.post('/circles/:id/sells', async (req, res) => {
  const circleId = req.params.id;
  const { amount, currency, price, note } = req.body;

  await pool.query(
    'INSERT INTO sells (circle_id, amount, currency, price, note) VALUES ($1, $2, $3, $4, $5)',
    [circleId, amount, currency, price, note]
  );

  await pool.query(
    'UPDATE circles SET remaining = remaining - $1 WHERE id = $2',
    [amount * price, circleId]
  );

  res.sendStatus(201);
});

// Заглушка: логи
app.get('/logs', async (req, res) => {
  res.json([
    { action: "Создан круг", created_at: new Date().toISOString() },
    { action: "Добавлена сделка", created_at: new Date().toISOString() }
  ]);
});

// ======== Запуск сервера ========
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
