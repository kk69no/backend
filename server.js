require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Проверка Telegram initData
function verifyInitData(initDataRaw) {
  const token = process.env.BOT_TOKEN;
  const secret = crypto.createHash('sha256').update(token).digest();
  const parsed = new URLSearchParams(initDataRaw);
  const hash = parsed.get('hash');
  parsed.delete('hash');

  const dataCheckString = [...parsed.entries()]
    .sort()
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const hmac = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  return hmac === hash;
}

// 📌 Middleware авторизации
app.use(async (req, res, next) => {
  const initData = req.headers['x-init-data'];
  if (!initData || !verifyInitData(initData)) return res.status(401).send('Invalid initData');
  const parsed = Object.fromEntries(new URLSearchParams(initData));
  req.tgUser = {
    id: parsed.user?.id || parsed.user_id,
    username: parsed.user?.username || '',
    first_name: parsed.user?.first_name || '',
    photo_url: parsed.user?.photo_url || ''
  };
  // Сохраняем пользователя
  await pool.query(
    `INSERT INTO users (telegram_id, username, first_name, photo_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id) DO UPDATE SET username = $2, first_name = $3, photo_url = $4`,
    [req.tgUser.id, req.tgUser.username, req.tgUser.first_name, req.tgUser.photo_url]
  );
  next();
});

// 🚀 Создание круга
app.post('/circles', async (req, res) => {
  const { buyAmount } = req.body;
  const { id: user_id } = req.tgUser;
  const result = await pool.query(
    `INSERT INTO circles (user_id, buyamount, remaining, closed)
     VALUES ($1, $2, $2, false) RETURNING *`,
    [user_id, buyAmount]
  );
  res.json(result.rows[0]);
});

// ➕ Добавить сделку в круг
app.post('/circles/:circleId/sells', async (req, res) => {
  const { amount, currency, price, note } = req.body;
  const circleId = req.params.circleId;
  const result = await pool.query(
    `INSERT INTO sells (circle_id, amount, currency, price, note)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [circleId, amount, currency, price, note]
  );
  // обновить remaining
  await pool.query(
    `UPDATE circles SET remaining = remaining - $1 WHERE id = $2`,
    [amount, circleId]
  );
  res.json(result.rows[0]);
});

// ❌ Удалить круг
app.delete('/circles/:id', async (req, res) => {
  const { id } = req.params;
  await pool.query(`DELETE FROM sells WHERE circle_id = $1`, [id]);
  await pool.query(`DELETE FROM circles WHERE id = $1`, [id]);
  res.sendStatus(200);
});

// 📝 Изменить сделку
app.patch('/sells/:id', async (req, res) => {
  const { amount, currency, price, note } = req.body;
  const { id } = req.params;
  await pool.query(
    `UPDATE sells SET amount = $1, currency = $2, price = $3, note = $4 WHERE id = $5`,
    [amount, currency, price, note, id]
  );
  res.sendStatus(200);
});

// 📊 Получить круги + сделки
app.get('/circles', async (req, res) => {
  const { id: user_id } = req.tgUser;
  const result = await pool.query(`SELECT * FROM circles WHERE user_id = $1 ORDER BY id DESC`, [user_id]);
  const circles = result.rows;

  for (let circle of circles) {
    const sells = await pool.query(`SELECT * FROM sells WHERE circle_id = $1 ORDER BY id`, [circle.id]);
    circle.sells = sells.rows;
  }

  res.json(circles);
});

// 📈 Аналитика по кругу
app.get('/analytics/:circleId', async (req, res) => {
  const { circleId } = req.params;
  const result = await pool.query(`SELECT * FROM circles WHERE id = $1`, [circleId]);
  const circle = result.rows[0];
  if (!circle) return res.status(404).send('Круг не найден');

  const sells = await pool.query(`SELECT * FROM sells WHERE circle_id = $1`, [circleId]);

  const totalRevenue = sells.rows.reduce((acc, s) => acc + s.amount * s.price, 0);
  const totalSold = circle.buyamount - circle.remaining;
  const pnl = totalRevenue - circle.buyamount;
  const percent = (totalSold / circle.buyamount) * 100;

  res.json({ pnl, revenue: totalRevenue, progress: percent });
});

// 🧾 Логи
app.post('/logs', async (req, res) => {
  const { action } = req.body;
  const { id: user_id } = req.tgUser;
  await pool.query(
    `INSERT INTO logs (user_id, action) VALUES ($1, $2)`,
    [user_id, action]
  );
  res.sendStatus(200);
});

app.get('/logs', async (req, res) => {
  const { id: user_id } = req.tgUser;
  const result = await pool.query(`SELECT * FROM logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [user_id]);
  res.json(result.rows);
});

// 🌐 Старт сервера
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
