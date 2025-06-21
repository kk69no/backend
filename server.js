const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ✅ Middleware: извлекаем user из заголовков (без подписи)
app.use((req, res, next) => {
  const id = req.headers['x-telegram-user-id'];
  const username = req.headers['x-telegram-username'];
  const photo = req.headers['x-telegram-photo'];

  if (!id) {
    req.tgUser = { id: 999999, username: "demo_user" };
  } else {
    req.tgUser = {
      id,
      username: username || null,
      photo_url: photo || null
    };
  }

  next();
});

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

app.post('/circles', async (req, res) => {
  const { id } = req.tgUser;
  const { buyAmount } = req.body;

  const result = await pool.query(
    'INSERT INTO circles (user_id, buyAmount, remaining, closed) VALUES ($1, $2, $2, false) RETURNING *',
    [id, buyAmount]
  );

  res.json(result.rows[0]);
});

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

app.delete('/circles/:id', async (req, res) => {
  const circleId = req.params.id;
  await pool.query('DELETE FROM sells WHERE circle_id = $1', [circleId]);
  await pool.query('DELETE FROM circles WHERE id = $1', [circleId]);
  res.sendStatus(204);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
