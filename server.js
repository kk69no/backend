const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use((req, res, next) => {
  const id = req.headers['x-telegram-user-id'];
  const username = req.headers['x-telegram-username'];
  const photo = req.headers['x-telegram-photo'];
  req.tgUser = id ? { id, username, photo_url: photo } : { id: 999999, username: 'demo_user' };
  next();
});

app.get('/circles', async (req, res) => {
  const circles = (await pool.query(
    'SELECT * FROM circles WHERE user_id=$1 ORDER BY id',
    [req.tgUser.id]
  )).rows;
  for (let c of circles) {
    c.sells = (await pool.query(
      'SELECT * FROM sells WHERE circle_id=$1 ORDER BY id',
      [c.id]
    )).rows;
  }
  res.json(circles);
});

app.post('/circles', async (req, res) => {
  const { buyAmount, buyPrice } = req.body;
  const result = await pool.query(
    'INSERT INTO circles (user_id, buy_amount, buy_price) VALUES ($1, $2, $3) RETURNING *',
    [req.tgUser.id, buyAmount, buyPrice]
  );
  res.json(result.rows[0]);
});

app.post('/circles/:id/sells', async (req, res) => {
  const { amount, currency, price, note } = req.body;
  const circleId = req.params.id;
  await pool.query(
    'INSERT INTO sells (circle_id, amount, currency, price, note) VALUES ($1, $2, $3, $4, $5)',
    [circleId, amount, currency, price, note]
  );
  res.sendStatus(201);
});

app.delete('/circles/:id', async (req, res) => {
  const id = req.params.id;
  await pool.query('DELETE FROM sells WHERE circle_id=$1', [id]);
  await pool.query('DELETE FROM circles WHERE id=$1', [id]);
  res.sendStatus(204);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Server on port ${PORT}`));
