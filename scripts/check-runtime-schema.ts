import * as schema from "../drizzle/schema";
import { is } from "drizzle-orm";
import { MySqlTable, getTableConfig } from "drizzle-orm/mysql-core";
import mysql, { type RowDataPacket } from "mysql2/promise";

/** Read-only inventory: proves table/column presence, not historical migration execution. */
async function main() {
 if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
 const connection = await mysql.createConnection(process.env.DATABASE_URL);
 try {
  const [rows] = await connection.query<RowDataPacket[]>("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()");
  const presentColumns = new Set(rows.map(row => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const presentTables = new Set(rows.map(row => String(row.TABLE_NAME)));
  const tables = Object.values(schema).filter(value => is(value, MySqlTable)).map(table => getTableConfig(table as MySqlTable));
  const missingTables = tables.filter(table => !presentTables.has(table.name)).map(table => table.name);
  const missingColumns = tables.flatMap(table => table.columns.filter(column => !presentColumns.has(`${table.name}.${column.name}`)).map(column => ({table: table.name, column: column.name, expectedSqlType: column.getSQLType()})));
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), tableCount: tables.length, declaredColumnCount: tables.reduce((n, table) => n + table.columns.length, 0), missingTables, missingColumns, guarantee: "presence only; migration journal and constraint/type equality are not inferred" }, null, 2));
  if (missingTables.length || missingColumns.length) process.exitCode = 1;
 } finally { await connection.end(); }
}
main().catch(() => { console.error("Runtime schema inspection failed; inspect the configured database privately."); process.exitCode = 1; });
