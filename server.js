// server.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Подключение к базе (через переменные среды)
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false }
});

// Проверка подключения
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Ошибка подключения к базе:', err);
  } else {
    console.log('Успешное подключение к базе:', res.rows[0]);
  }
});

// Главная страница
app.get('/', (req, res) => {
  res.send('Сервер работает');
});

// Получить список кругов и их продаж
app.get('/circles', async (req, res) => {
  try {
    const circles = await pool.query('SELECT * FROM circles ORDER BY id DESC');
    const sells = await pool.query('SELECT * FROM sells');

    const result = circles.rows.map(circle => {
      const circleSells = sells.rows.filter(s => s.circle_id === circle.id);
      return {
        ...circle,
        sells: circleSells
      };
    });

    res.json(result);
  } catch (error) {
    console.error("Ошибка при получении кругов:", error);
    res.status(500).send("Ошибка сервера");
  }
});

// Создание нового круга (покупка)
app.post('/circles', async (req, res) => {
  const { buyAmount } = req.body;
  if (!buyAmount || buyAmount <= 0) {
    return res.status(400).send("Неверная сумма покупки");
  }
  try {
    const result = await pool.query(
      'INSERT INTO circles (buyAmount, remaining, closed) VALUES ($1, $1, false) RETURNING *',
      [buyAmount]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка при создании круга:", error);
    res.status(500).send("Ошибка сервера");
  }
});

// Добавление продажи в круг
app.post('/circles/:id/sells', async (req, res) => {
  const circleId = req.params.id;
  const { amount, currency, price, note } = req.body;

  if (!amount || !currency || !price) {
    return res.status(400).send("Некорректные данные");
  }

  try {
    const circleResult = await pool.query('SELECT * FROM circles WHERE id = $1', [circleId]);
    if (circleResult.rows.length === 0) {
      return res.status(404).send("Круг не найден");
    }

    const circle = circleResult.rows[0];
    if (circle.closed || circle.remaining < amount) {
      return res.status(400).send("Недостаточно остатка или круг закрыт");
    }

    // Обновляем остаток
    const newRemaining = circle.remaining - amount;
    const closed = newRemaining <= 0;

    await pool.query('UPDATE circles SET remaining = $1, closed = $2 WHERE id = $3', [
      newRemaining, closed, circleId
    ]);

    const sellResult = await pool.query(
      'INSERT INTO sells (circle_id, amount, currency, price, note) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [circleId, amount, currency, price, note]
    );

    res.status(201).json(sellResult.rows[0]);
  } catch (error) {
    console.error("Ошибка при добавлении продажи:", error);
    res.status(500).send("Ошибка сервера");
  }
});

// Массив мотивационных цитат
const quotes = [
  "Делай сегодня то, что другие не хотят, чтобы завтра жить так, как другие не могут.",
  "Успех — это лестница, на которую нельзя подняться, держа руки в карманах.",
  "Не бойся изменений — бойся остаться на месте.",
  "Каждая ошибка — это шаг к успеху.",
  "Ты сильнее, чем думаешь.",
];

// Endpoint для случайной цитаты
app.get('/quote', (req, res) => {
  const randomIndex = Math.floor(Math.random() * quotes.length);
  res.json({ quote: quotes[randomIndex] });
});

// Запуск сервера
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
