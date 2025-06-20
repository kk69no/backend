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
        console.error('Ошибка подключения к Supabase:', err);
    } else {
        console.log('Подключено к Supabase:', res.rows[0]);
    }
});

app.get('/', (req, res) => {
    res.send('Сервер работает');
});

app.get('/users', async(req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users');
        res.json(result.rows);
    } catch (error) {
        console.error('Ошибка при получении пользователей:', error);
        res.status(500).send('Ошибка сервера');
    }
});

app.post('/users', async(req, res) => {
    const { name, email } = req.body;
    if (!name || !email) {
        return res.status(400).send('Имя и email обязательны');
    }
    try {
        const result = await pool.query(
            'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *', [name, email]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Ошибка при добавлении пользователя:', error);
        res.status(500).send('Ошибка сервера');
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
