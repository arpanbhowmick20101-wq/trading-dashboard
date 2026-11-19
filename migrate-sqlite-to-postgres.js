
require("dotenv").config();

const Database = require("better-sqlite3");
const { Pool } = require("pg");
const path = require("path");

const sqlite = new Database(path.join(__dirname, "trades.db"), {
  readonly: true
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const tables = ["users", "trades", "rules"];

async function migrate() {
  const client = await pool.connect();

  try {
    console.log("Checking databases...");

    // Refuse to overwrite existing Supabase records.
    for (const table of tables) {
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM public.${table}`
      );

      if (result.rows[0].count !== 0) {
        throw new Error(
          `Supabase ${table} table is not empty. Migration stopped safely.`
        );
      }
    }

    await client.query("BEGIN");

    for (const table of tables) {
      const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();

      if (rows.length === 0) {
        console.log(`${table}: 0 records`);
        continue;
      }

      const sqliteColumns = Object.keys(rows[0]);

      const schemaResult = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
         AND table_name = $1`,
        [table]
      );

      const pgColumns = new Set(
        schemaResult.rows.map(row => row.column_name)
      );

      const columns = sqliteColumns.filter(column =>
        pgColumns.has(column)
      );

      if (columns.length === 0) {
        throw new Error(`No matching columns found for ${table}`);
      }

      const columnSQL = columns.map(column => `"${column}"`).join(", ");
      const placeholders = columns.map(
        (_, index) => `$${index + 1}`
      ).join(", ");

      const insertSQL =
        `INSERT INTO public."${table}" (${columnSQL})
         VALUES (${placeholders})`;

      for (const row of rows) {
        const values = columns.map(column => row[column]);
        await client.query(insertSQL, values);
      }

      console.log(`${table}: ${rows.length} records copied`);
    }

    // Reset identity sequences after preserving original IDs.
    for (const table of ["users", "trades"]) {
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('public.${table}', 'id'),
          COALESCE((SELECT MAX(id) FROM public.${table}), 1),
          EXISTS(SELECT 1 FROM public.${table})
        )
      `);
    }

    await client.query("COMMIT");

    console.log("\nMigration completed successfully!");

    for (const table of tables) {
      const result = await client.query(
        `SELECT COUNT(*)::int AS count FROM public.${table}`
      );

      console.log(`${table} in Supabase: ${result.rows[0].count}`);
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration stopped:", error.message);
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

migrate();
