import express from "express";
import cors from "cors";
import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get("/api/deals", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM deals ORDER BY date DESC");
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/deals", async (req, res) => {
  const { date, profit } = req.body;
  try {
    await pool.query("INSERT INTO deals (date, profit) VALUES ($1, $2)", [date, profit]);
    res.sendStatus(200);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`Server listening on port ${port}`));
