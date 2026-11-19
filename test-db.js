require("dotenv").config();

const { Pool } = require("pg");

console.log("DATABASE_URL loaded:", !!process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000
});

async function testConnection() {
  try {
    const result = await pool.query("SELECT NOW()");

    console.log("SUCCESS! Supabase connected.");
    console.log("Database time:", result.rows[0].now);
  } catch (error) {
    console.log("Error name:", error.name);
    console.log("Error code:", error.code);
    console.log("Error message:", error.message);
  } finally {
    await pool.end();
  }
}

testConnection();