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

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Ошибка подключения к базе:', err);
  } else {
    console.log('Подключено к базе:', res.rows[0]);
  }
});

app.get('/', (req, res) => {
  res.send('Сервер работает');
});

// Получить круги текущего пользователя
app.get('/circles', async (req, res) => {
  const user_id = req.query.user_id;
  if (!user_id) return res.status(400).send("user_id обязателен");

  try {
    const circles = await pool.query(
      'SELECT * FROM circles WHERE user_id = $1 ORDER BY id DESC',
      [user_id]
    );
    const sells = await pool.query(
      'SELECT * FROM sells WHERE user_id = $1',
      [user_id]
    );

    const result = circles.rows.map(c => ({
      id: c.id,
      buyAmount: parseFloat(c.buyamount),
      remaining: parseFloat(c.remaining),
      closed: c.closed,
      user_id: c.user_id,
      sells: sells.rows.filter(s => s.circle_id === c.id).map(s => ({
        id: s.id,
        circle_id: s.circle_id,
        amount: s.amount,
        currency: s.currency,
        price: s.price,
        note: s.note
      }))
    }));

    res.json(result);
  } catch (error) {
    console.error('Ошибка при получении кругов:', error);
    res.status(500).send('Ошибка сервера');
  }
});

// Создать новый круг
app.post('/circles', async (req, res) => {
  const { buyAmount, user_id } = req.body;
  if (!buyAmount || !user_id) return res.status(400).send("Недостаточно данных");

  try {
    const result = await pool.query(
      'INSERT INTO circles (buyamount, remaining, closed, user_id) VALUES ($1, $1, false, $2) RETURNING *',
      [buyAmount, user_id]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Ошибка при создании круга:', error);
    res.status(500).send('Ошибка сервера');
  }
});

// Добавить продажу в круг
app.post('/circles/:id/sells', async (req, res) => {
  const circleId = req.params.id;
  const { amount, currency, price, note, user_id } = req.body;

  if (!amount || !currency || !price || !user_id) {
    return res.status(400).send("Некорректные данные");
  }

  try {
    const circleResult = await pool.query('SELECT * FROM circles WHERE id = $1 AND user_id = $2', [circleId, user_id]);
    if (circleResult.rows.length === 0) {
      return res.status(404).send("Круг не найден или не ваш");
    }

    const circle = circleResult.rows[0];
    if (circle.closed || circle.remaining < amount) {
      return res.status(400).send("Недостаточно остатка или круг закрыт");
    }

    const newRemaining = circle.remaining - amount;
    const closed = newRemaining <= 0;

    await pool.query('UPDATE circles SET remaining = $1, closed = $2 WHERE id = $3', [
      newRemaining, closed, circleId
    ]);

    const sellResult = await pool.query(
      'INSERT INTO sells (circle_id, amount, currency, price, note, user_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [circleId, amount, currency, price, note, user_id]
    );

    res.status(201).json(sellResult.rows[0]);
  } catch (error) {
    console.error('Ошибка при добавлении продажи:', error);
    res.status(500).send('Ошибка сервера');
  }
});

// Удалить круг
app.delete('/circles/:id', async (req, res) => {
  const user_id = req.query.user_id;
  const circleId = req.params.id;
  if (!user_id) return res.status(400).send("user_id обязателен");

  try {
    const check = await pool.query('SELECT * FROM circles WHERE id = $1 AND user_id = $2', [circleId, user_id]);
    if (check.rows.length === 0) {
      return res.status(404).send("Круг не найден или не ваш");
    }

    await pool.query('DELETE FROM sells WHERE circle_id = $1 AND user_id = $2', [circleId, user_id]);
    await pool.query('DELETE FROM circles WHERE id = $1 AND user_id = $2', [circleId, user_id]);
    res.status(204).send();
  } catch (error) {
    console.error('Ошибка при удалении круга:', error);
    res.status(500).send("Ошибка сервера");
  }
});

// Цитаты (бонус)
const quotes = [
  "Делай сегодня то, что другие не хотят, чтобы завтра жить так, как другие не могут.",
  "Успех — это лестница, на которую нельзя подняться, держа руки в карманах.",
  "Не бойся изменений — бойся остаться на месте.",
  "Каждая ошибка — это шаг к успеху.",
  "Ты сильнее, чем думаешь.",
];

app.get('/quote', (req, res) => {
  const randomIndex = Math.floor(Math.random() * quotes.length);
  res.json({ quote: quotes[randomIndex] });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
