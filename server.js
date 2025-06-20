const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Сервер работает');
});

app.listen(10000, () => {
    console.log('Сервер запущен на порту 10000');
});