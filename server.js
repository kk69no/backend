const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
const axios = require('axios');
const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  host: process.env.PGHOST,
  port: 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

// Проверка initData от Telegram
function verifyInitData(initData, botToken) {
  const hash = new URLSearchParams(initData).get('hash');
  const params = [...new URLSearchParams(initData)]
    .filter(([key]) => key !== 'hash')
    .map(([key, val]) => `${key}=${val}`)
    .sort()
    .join('\n');

  const secret = crypto.createHash('sha256').update(botToken).digest();
  const hmac = crypto.createHmac('sha256', secret).update(params).digest('hex');
  return hmac === hash;
}

// Авторизация через Telegram WebApp
app.post('/auth', async (req, res) => {
  const { initData } = req.body;
  if (!verifyInitData(initData, process.env.BOT_TOKEN)) {
    return res.status(403).send("Недопустимая подпись");
  }

  const user = JSON.parse(new URLSearchParams(initData).get("user"));
  const { id, username, first_name, photo_url } = user;
  await pool.query(`
    INSERT INTO users (id, username, first_name, photo_url)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO NOTHING;
  `, [id, username, first_name, photo_url]);

  res.status(200).send("OK");
});

// Получение кругов
app.get('/circles', async (req, res) => {
  const { user_id } = req.query;
  const circles = await pool.query(`SELECT * FROM circles WHERE user_id = $1 ORDER BY id DESC`, [user_id]);
  const sells = await pool.query(`SELECT * FROM sells WHERE user_id = $1`, [user_id]);

  const result = circles.rows.map(c => ({
    ...c,
    buyAmount: parseFloat(c.buyamount),
    remaining: parseFloat(c.remaining),
    sells: sells.rows.filter(s => s.circle_id === c.id)
  }));

  res.json(result);
});

// Создание круга
app.post('/circles', async (req, res) => {
  const { buyAmount, user_id } = req.body;
  const result = await pool.query(
    `INSERT INTO circles (buyamount, remaining, closed, user_id, created_at)
     VALUES ($1, $1, false, $2, NOW()) RETURNING *`, [buyAmount, user_id]
  );
  await pool.query(`INSERT INTO logs (type, user_id, circle_id, message, created_at)
                    VALUES ('create_circle', $2, $1, 'Создан круг', NOW())`, [result.rows[0].id, user_id]);
  res.status(201).json(result.rows[0]);
});

// Добавление сделки
app.post('/circles/:id/sells', async (req, res) => {
  const circleId = req.params.id;
  const { amount, currency, price, note, user_id } = req.body;

  const circle = await pool.query('SELECT * FROM circles WHERE id = $1 AND user_id = $2', [circleId, user_id]);
  if (!circle.rows.length) return res.status(404).send("Круг не найден");

  const remaining = parseFloat(circle.rows[0].remaining) - amount;
  const closed = remaining <= 0;

  await pool.query(`UPDATE circles SET remaining = $1, closed = $2 WHERE id = $3`, [remaining, closed, circleId]);
  const result = await pool.query(
    `INSERT INTO sells (circle_id, amount, currency, price, note, user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
    [circleId, amount, currency, price, note, user_id]
  );

  await pool.query(`INSERT INTO logs (type, user_id, circle_id, message, created_at)
                    VALUES ('add_sell', $1, $2, 'Добавлена продажа', NOW())`, [user_id, circleId]);

  res.status(201).json(result.rows[0]);
});

// Обновление сделки
app.patch('/sells/:id', async (req, res) => {
  const { amount, currency, price, note, user_id } = req.body;
  const id = req.params.id;
  const result = await pool.query(
    `UPDATE sells SET amount = $1, currency = $2, price = $3, note = $4 WHERE id = $5 AND user_id = $6 RETURNING *`,
    [amount, currency, price, note, id, user_id]
  );
  res.status(200).json(result.rows[0]);
});

// Удаление круга
app.delete('/circles/:id', async (req, res) => {
  const { user_id } = req.query;
  const id = req.params.id;
  await pool.query('DELETE FROM sells WHERE circle_id = $1 AND user_id = $2', [id, user_id]);
  await pool.query('DELETE FROM circles WHERE id = $1 AND user_id = $2', [id, user_id]);
  res.status(204).send();
});

// Аналитика круга
app.get('/analytics/:circleId', async (req, res) => {
  const { user_id } = req.query;
  const { circleId } = req.params;
  const sells = await pool.query('SELECT * FROM sells WHERE circle_id = $1 AND user_id = $2', [circleId, user_id]);
  const circle = await pool.query('SELECT * FROM circles WHERE id = $1 AND user_id = $2', [circleId, user_id]);
  if (!circle.rows.length) return res.status(404).send("Круг не найден");

  const revenue = sells.rows.reduce((sum, s) => sum + parseFloat(s.amount) * parseFloat(s.price), 0);
  const cost = parseFloat(circle.rows[0].buyamount);
  const pnl = revenue - cost;

  res.json({
    buyAmount: cost,
    revenue: revenue,
    pnl: pnl,
    profitRate: (pnl / cost) * 100
  });
});

// Генерация заметки через OpenAI
// новый: локальная генерация заметки
app.post('/note/ai', async (req, res) => {
  const { currency, price } = req.body;
  const templates = [
    `Сделка с ${currency} по цене ${price}₽`,
    `Продажа ${currency} выгодно по ${price}₽`,
    `${currency} по ${price}₽ — быстрый обмен`,
    `Биржевой курс ${currency}: ${price}₽`
  ];
  const note = templates[Math.floor(Math.random() * templates.length)];
  res.json({ note });
});


// Проверка кругов каждые 10 минут (долго незакрытые)
setInterval(async () => {
  const res = await pool.query(`
    SELECT * FROM circles WHERE closed = false AND created_at < NOW() - INTERVAL '24 hours'
  `);
  for (let circle of res.rows) {
    await axios.post(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      chat_id: circle.user_id,
      text: `⚠️ Круг #${circle.id} остаётся незакрытым более 24 часов`
    });
  }
}, 600000); // 10 мин

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
