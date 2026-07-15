// src/main/history/db.ts
import Database from "better-sqlite3";
import schemaSql from "./schema.sql?raw"; // inlined at build time by electron-vite

export function openDatabase(filePath: string, schemaOverride?: string): Database.Database {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schemaOverride ?? schemaSql);
  return db;
}
