const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false }
});

// Получить круги пользователя
app.get('/circles', async (req, res) => {
  const user_id = req.query.user_id;
  if (!user_id) return res.status(400).send("user_id обязателен");

  const circles = await pool.query(
    'SELECT * FROM circles WHERE user_id = $1 ORDER BY id DESC',
    [user_id]
  );
  const sells = await pool.query('SELECT * FROM sells WHERE user_id = $1', [user_id]);

  const result = circles.rows.map(c => ({
    ...c,
    buyAmount: parseFloat(c.buyamount),
    remaining: parseFloat(c.remaining),
    sells: sells.rows.filter(s => s.circle_id === c.id)
  }));

  res.json(result);
});

// Создать круг
app.post('/circles', async (req, res) => {
  const { buyAmount, user_id } = req.body;
  if (!buyAmount || !user_id) return res.status(400).send("Недостаточно данных");

  const result = await pool.query(
    'INSERT INTO circles (buyamount, remaining, closed, user_id) VALUES ($1, $1, false, $2) RETURNING *',
    [buyAmount, user_id]
  );
  res.status(201).json(result.rows[0]);
});

// Добавить продажу
app.post('/circles/:id/sells', async (req, res) => {
  const circleId = req.params.id;
  const { amount, currency, price, note, user_id } = req.body;

  const circle = await pool.query('SELECT * FROM circles WHERE id = $1 AND user_id = $2', [circleId, user_id]);
  if (!circle.rows.length) return res.status(404).send("Круг не найден");

  const remaining = circle.rows[0].remaining - amount;
  const closed = remaining <= 0;

  await pool.query('UPDATE circles SET remaining = $1, closed = $2 WHERE id = $3', [remaining, closed, circleId]);
  const result = await pool.query(
    'INSERT INTO sells (circle_id, amount, currency, price, note, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [circleId, amount, currency, price, note, user_id]
  );
  res.status(201).json(result.rows[0]);
});

// Удалить круг и его сделки
app.delete('/circles/:id', async (req, res) => {
  const user_id = req.query.user_id;
  const id = req.params.id;

  await pool.query('DELETE FROM sells WHERE circle_id = $1 AND user_id = $2', [id, user_id]);
  await pool.query('DELETE FROM circles WHERE id = $1 AND user_id = $2', [id, user_id]);

  res.status(204).send();
});

// Редактировать сделку
app.patch('/sells/:id', async (req, res) => {
  const id = req.params.id;
  const { amount, currency, price, note, user_id } = req.body;

  const check = await pool.query('SELECT * FROM sells WHERE id = $1 AND user_id = $2', [id, user_id]);
  if (!check.rows.length) return res.status(404).send("Сделка не найдена");

  const result = await pool.query(
    'UPDATE sells SET amount = $1, currency = $2, price = $3, note = $4 WHERE id = $5 RETURNING *',
    [amount, currency, price, note, id]
  );
  res.status(200).json(result.rows[0]);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Сервер работает на порту", PORT));
