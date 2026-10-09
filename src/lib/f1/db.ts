/**
 * F1 Predictors Championship ΓÇö Database Layer
 * Uses the same Turso/libSQL client as the main app.
 */

import path from 'path';
import fs from 'fs';
import { createClient, Client } from '@libsql/client';
import { add_read_retry } from './retry';
import type {
  F1RaceSchedule, F1Driver, F1DriverResult, F1SessionResult,
  F1Prediction, F1Score, F1PlayerState, SessionType, PlayerState,
  F1CancelledRound, CancelledRoundSource,
} from './types';

// ΓöÇΓöÇ Client (shared singleton with main db.ts) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

const is_turso = !!process.env.TURSO_DATABASE_URL;
let client: Client | null = null;

function get_client(): Client {
  if (!client) {
    if (is_turso) {
      // Turso intermittently drops connections (ECONNRESET); retry reads so polls don't 500
      client = add_read_retry(createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN,
      }));
    } else {
      const db_path = path.join(process.cwd(), 'data', 'posts.db');
      const dir = path.dirname(db_path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      client = createClient({ url: `file:${db_path}` });
    }
  }
  return client;
}

// ΓöÇΓöÇ Schema Initialization ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

let schema_initialized = false;

async function init_f1_schema(): Promise<void> {
  const db = get_client();

  await db.execute(`
    CREATE TABLE IF NOT EXISTS f1_seasons (
      season INTEGER NOT NULL,
      round INTEGER NOT NULL,
      race_name TEXT NOT NULL,
      circuit_id TEXT NOT NULL,
      circuit_name TEXT NOT NULL,
      country TEXT NOT NULL,
      locality TEXT NOT NULL,
      race_date TEXT NOT NULL,
      race_time TEXT,
      is_sprint_weekend INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season, round)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS f1_sessions (
      id TEXT PRIMARY KEY,
      season INTEGER NOT NULL,
      round INTEGER NOT NULL,
      session_type TEXT NOT NULL,
      results_json TEXT NOT NULL,
      fastest_lap_driver_id TEXT,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      source TEXT NOT NULL DEFAULT 'jolpica'
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_f1_sessions_lookup
      ON f1_sessions(season, round, session_type)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS f1_drivers (
      season INTEGER NOT NULL,
      driver_id TEXT NOT NULL,
      code TEXT NOT NULL,
      given_name TEXT NOT NULL,
      family_name TEXT NOT NULL,
      constructor_name TEXT NOT NULL,
      constructor_id TEXT NOT NULL,
      PRIMARY KEY (season, driver_id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS f1_predictions (
      id TEXT PRIMARY KEY,
      season INTEGER NOT NULL,
      round INTEGER NOT NULL,
      session_type TEXT NOT NULL,
      player_name TEXT NOT NULL,
      p1 TEXT NOT NULL,
      p2 TEXT NOT NULL,
      p3 TEXT NOT NULL,
      fastest_lap TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(season, round, session_type, player_name)
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_f1_predictions_lookup
      ON f1_predictions(season, round, session_type)
  `);

  // Migration: add is_locked column (safe to run repeatedly)
  await db.execute(`ALTER TABLE f1_predictions ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0`).catch(() => {});

  await db.execute(`
    CREATE TABLE IF NOT EXISTS f1_scores (
      prediction_id TEXT PRIMARY KEY,
      perfect_match INTEGER NOT NULL DEFAULT 0,
      podium_lock INTEGER NOT NULL DEFAULT 0,
      almost INTEGER NOT NULL DEFAULT 0,
      fastest_lap INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      computed_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS f1_player_state (
      season INTEGER NOT NULL,
      round INTEGER NOT NULL,
      session_type TEXT NOT NULL,
      player_name TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'predicting',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season, round, session_type, player_name)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS f1_roster (
      season INTEGER NOT NULL,
      player_name TEXT NOT NULL,
      added_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season, player_name)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS f1_players (
      player_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS f1_mr_bear_staged (
      season INTEGER NOT NULL,
      round INTEGER NOT NULL,
      session_type TEXT NOT NULL,
      p1 TEXT NOT NULL,
      p2 TEXT NOT NULL,
      p3 TEXT NOT NULL,
      fastest_lap TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (season, round, session_type)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS f1_cancelled_rounds (
      season INTEGER NOT NULL,
      round INTEGER NOT NULL,
      race_name TEXT NOT NULL,
      circuit_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('auto', 'admin')),
      cancelled_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season, circuit_id, source)
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_f1_cancelled_rounds_lookup
      ON f1_cancelled_rounds(season, source)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS f1_scratched_drivers (
      season INTEGER NOT NULL,
      round INTEGER NOT NULL,
      driver_id TEXT NOT NULL,
      scratched_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (season, round, driver_id)
    )
  `);
}

async function ensure_f1_schema(): Promise<void> {
  if (!schema_initialized) {
    await init_f1_schema();
    schema_initialized = true;
  }
}

// ΓöÇΓöÇ ID Generation ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

function generate_id(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function session_id(season: number, round: number, session_type: string): string {
  return `${season}_${round}_${session_type}`;
}

// ΓöÇΓöÇ Schedule CRUD ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export async function get_cached_schedule(season: number): Promise<F1RaceSchedule[] | null> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM f1_seasons WHERE season = ? ORDER BY round ASC',
    args: [season],
  });

  if (result.rows.length === 0) return null;

  return result.rows.map(row => ({
    season: row.season as number,
    round: row.round as number,
    race_name: row.race_name as string,
    circuit_id: row.circuit_id as string,
    circuit_name: row.circuit_name as string,
    country: row.country as string,
    locality: row.locality as string,
    race_date: row.race_date as string,
    race_time: (row.race_time as string) || null,
    is_sprint_weekend: (row.is_sprint_weekend as number) === 1,
  }));
}

export async function save_schedule(season: number, races: F1RaceSchedule[]): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  const statements: Array<{ sql: string; args?: (string | number | null)[] }> = [
    { sql: 'DELETE FROM f1_seasons WHERE season = ?', args: [season] },
  ];

  for (const race of races) {
    statements.push({
      sql: `INSERT INTO f1_seasons
            (season, round, race_name, circuit_id, circuit_name, country, locality, race_date, race_time, is_sprint_weekend)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        season, race.round, race.race_name, race.circuit_id,
        race.circuit_name, race.country, race.locality,
        race.race_date, race.race_time, race.is_sprint_weekend ? 1 : 0,
      ],
    });
  }

  await db.batch(statements, 'write');
}

export async function get_cancelled_rounds(
  season: number,
  source?: CancelledRoundSource
): Promise<F1CancelledRound[]> {
  await ensure_f1_schema();
  const db = get_client();

  const result = source
    ? await db.execute({
      sql: `SELECT * FROM f1_cancelled_rounds
            WHERE season = ? AND source = ?
            ORDER BY cancelled_at DESC, round ASC`,
      args: [season, source],
    })
    : await db.execute({
      sql: `SELECT * FROM f1_cancelled_rounds
            WHERE season = ?
            ORDER BY cancelled_at DESC, round ASC`,
      args: [season],
    });

  return result.rows.map(row => ({
    season: row.season as number,
    round: row.round as number,
    race_name: row.race_name as string,
    circuit_id: row.circuit_id as string,
    source: row.source as CancelledRoundSource,
    cancelled_at: row.cancelled_at as string,
  }));
}

export async function upsert_cancelled_round(
  season: number,
  round: number,
  race_name: string,
  circuit_id: string,
  source: CancelledRoundSource
): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: `INSERT INTO f1_cancelled_rounds (season, round, race_name, circuit_id, source, cancelled_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(season, circuit_id, source)
          DO UPDATE SET round = excluded.round, race_name = excluded.race_name, cancelled_at = CURRENT_TIMESTAMP`,
    args: [season, round, race_name, circuit_id, source],
  });
}

export async function delete_admin_cancelled_round(
  season: number,
  circuit_id: string
): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: `DELETE FROM f1_cancelled_rounds
          WHERE season = ? AND circuit_id = ? AND source = 'admin'`,
    args: [season, circuit_id],
  });
}

// ΓöÇΓöÇ Drivers CRUD ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

// —— Scratched Drivers ——————————————————————————————————

export async function get_scratched_drivers(
  season: number, round: number
): Promise<string[]> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT driver_id FROM f1_scratched_drivers WHERE season = ? AND round = ?',
    args: [season, round],
  });

  return result.rows.map(row => row.driver_id as string);
}

export async function upsert_scratched_driver(
  season: number, round: number, driver_id: string
): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: `INSERT INTO f1_scratched_drivers (season, round, driver_id, scratched_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(season, round, driver_id) DO UPDATE SET scratched_at = CURRENT_TIMESTAMP`,
    args: [season, round, driver_id],
  });
}

export async function delete_scratched_driver(
  season: number, round: number, driver_id: string
): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: 'DELETE FROM f1_scratched_drivers WHERE season = ? AND round = ? AND driver_id = ?',
    args: [season, round, driver_id],
  });
}

export async function get_all_scratched_for_round(
  season: number, round: number
): Promise<{ driver_id: string; scratched_at: string }[]> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT driver_id, scratched_at FROM f1_scratched_drivers WHERE season = ? AND round = ? ORDER BY scratched_at DESC',
    args: [season, round],
  });

  return result.rows.map(row => ({
    driver_id: row.driver_id as string,
    scratched_at: row.scratched_at as string,
  }));
}

// —— Delete Prediction + Score ———————————————————————————

export async function delete_prediction_and_score(
  season: number, round: number, session_type: SessionType, player_name: string
): Promise<boolean> {
  await ensure_f1_schema();
  const db = get_client();

  const pred = await get_prediction(season, round, session_type, player_name);
  if (!pred) return false;

  // Delete score first (orphan prevention)
  await db.execute({
    sql: 'DELETE FROM f1_scores WHERE prediction_id = ?',
    args: [pred.id],
  });

  // Delete prediction
  await db.execute({
    sql: 'DELETE FROM f1_predictions WHERE id = ?',
    args: [pred.id],
  });

  return true;
}

export async function delete_player_state(
  season: number, round: number, session_type: SessionType, player_name: string
): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: `DELETE FROM f1_player_state
          WHERE season = ? AND round = ? AND session_type = ? AND player_name = ?`,
    args: [season, round, session_type, player_name],
  });
}

export async function get_cached_drivers(season: number): Promise<F1Driver[] | null> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM f1_drivers WHERE season = ? ORDER BY family_name ASC',
    args: [season],
  });

  if (result.rows.length === 0) return null;

  return result.rows.map(row => ({
    driver_id: row.driver_id as string,
    code: row.code as string,
    given_name: row.given_name as string,
    family_name: row.family_name as string,
    constructor_id: row.constructor_id as string,
    constructor_name: row.constructor_name as string,
  }));
}

export async function save_drivers(season: number, drivers: F1Driver[]): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  for (const d of drivers) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO f1_drivers
            (season, driver_id, code, given_name, family_name, constructor_name, constructor_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [season, d.driver_id, d.code, d.given_name, d.family_name, d.constructor_name, d.constructor_id],
    });
  }
}

// ΓöÇΓöÇ Session Results CRUD ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export async function get_cached_results(
  season: number, round: number, session_type: SessionType
): Promise<F1SessionResult | null> {
  await ensure_f1_schema();
  const db = get_client();

  const id = session_id(season, round, session_type);
  const result = await db.execute({
    sql: 'SELECT * FROM f1_sessions WHERE id = ?',
    args: [id],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    season: row.season as number,
    round: row.round as number,
    session_type: row.session_type as SessionType,
    race_name: '', // not stored separately, caller can join with schedule
    results: JSON.parse(row.results_json as string) as F1DriverResult[],
    fastest_lap_driver_id: (row.fastest_lap_driver_id as string) || null,
  };
}

export async function save_results(
  result: F1SessionResult,
  source: string = 'jolpica'
): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  const id = session_id(result.season, result.round, result.session_type);
  await db.execute({
    sql: `INSERT OR IGNORE INTO f1_sessions
          (id, season, round, session_type, results_json, fastest_lap_driver_id, source)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id, result.season, result.round, result.session_type,
      JSON.stringify(result.results),
      result.fastest_lap_driver_id, source,
    ],
  });
}

// ΓöÇΓöÇ Predictions CRUD ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export async function get_prediction(
  season: number, round: number, session_type: SessionType, player_name: string
): Promise<F1Prediction | null> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: `SELECT * FROM f1_predictions
          WHERE season = ? AND round = ? AND session_type = ? AND player_name = ?`,
    args: [season, round, session_type, player_name],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    id: row.id as string,
    season: row.season as number,
    round: row.round as number,
    session_type: row.session_type as SessionType,
    player_name: row.player_name as string,
    p1: row.p1 as string,
    p2: row.p2 as string,
    p3: row.p3 as string,
    fastest_lap: (row.fastest_lap as string) || null,
    is_locked: (row.is_locked as number) === 1,
    created_at: row.created_at as string,
  };
}

export async function save_prediction(
  season: number, round: number, session_type: SessionType,
  player_name: string, p1: string, p2: string, p3: string,
  fastest_lap: string | null
): Promise<string> {
  await ensure_f1_schema();
  const db = get_client();

  const id = generate_id();
  await db.execute({
    sql: `INSERT INTO f1_predictions
          (id, season, round, session_type, player_name, p1, p2, p3, fastest_lap)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, season, round, session_type, player_name, p1, p2, p3, fastest_lap],
  });

  return id;
}

export async function update_prediction(
  season: number, round: number, session_type: SessionType,
  player_name: string, p1: string, p2: string, p3: string,
  fastest_lap: string | null
): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: `UPDATE f1_predictions
          SET p1 = ?, p2 = ?, p3 = ?, fastest_lap = ?, created_at = CURRENT_TIMESTAMP
          WHERE season = ? AND round = ? AND session_type = ? AND player_name = ?`,
    args: [p1, p2, p3, fastest_lap, season, round, session_type, player_name],
  });
}

export async function get_predictions_for_session(
  season: number, round: number, session_type: SessionType
): Promise<F1Prediction[]> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: `SELECT * FROM f1_predictions
          WHERE season = ? AND round = ? AND session_type = ?`,
    args: [season, round, session_type],
  });

  return result.rows.map(row => ({
    id: row.id as string,
    season: row.season as number,
    round: row.round as number,
    session_type: row.session_type as SessionType,
    player_name: row.player_name as string,
    p1: row.p1 as string,
    p2: row.p2 as string,
    p3: row.p3 as string,
    fastest_lap: (row.fastest_lap as string) || null,
    is_locked: (row.is_locked as number) === 1,
    created_at: row.created_at as string,
  }));
}

export async function lock_prediction(
  season: number, round: number, session_type: SessionType, player_name: string
): Promise<boolean> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: `UPDATE f1_predictions SET is_locked = 1
          WHERE season = ? AND round = ? AND session_type = ? AND player_name = ?`,
    args: [season, round, session_type, player_name],
  });

  return result.rowsAffected > 0;
}

export async function is_prediction_locked(
  season: number, round: number, session_type: SessionType, player_name: string
): Promise<boolean> {
  const prediction = await get_prediction(season, round, session_type, player_name);
  return prediction !== null && prediction.is_locked;
}

//ΓöÇΓöÇ Scores CRUD ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export async function get_score(prediction_id: string): Promise<F1Score | null> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT * FROM f1_scores WHERE prediction_id = ?',
    args: [prediction_id],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    prediction_id: row.prediction_id as string,
    perfect_match: row.perfect_match as number,
    podium_lock: row.podium_lock as number,
    almost: row.almost as number,
    fastest_lap: row.fastest_lap as number,
    total: row.total as number,
    computed_at: row.computed_at as string,
  };
}

export async function save_score(score: F1Score): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: `INSERT OR REPLACE INTO f1_scores
          (prediction_id, perfect_match, podium_lock, almost, fastest_lap, total)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      score.prediction_id, score.perfect_match, score.podium_lock,
      score.almost, score.fastest_lap, score.total,
    ],
  });
}

// ΓöÇΓöÇ Player State CRUD ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

export async function get_player_state(
  season: number, round: number, session_type: SessionType, player_name: string
): Promise<F1PlayerState | null> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: `SELECT * FROM f1_player_state
          WHERE season = ? AND round = ? AND session_type = ? AND player_name = ?`,
    args: [season, round, session_type, player_name],
  });

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    season: row.season as number,
    round: row.round as number,
    session_type: row.session_type as SessionType,
    player_name: row.player_name as string,
    state: row.state as PlayerState,
    updated_at: row.updated_at as string,
  };
}

export async function set_player_state(
  season: number, round: number, session_type: SessionType,
  player_name: string, state: PlayerState
): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: `INSERT INTO f1_player_state (season, round, session_type, player_name, state, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(season, round, session_type, player_name)
          DO UPDATE SET state = excluded.state, updated_at = CURRENT_TIMESTAMP`,
    args: [season, round, session_type, player_name, state],
  });
}

export async function get_player_round_states(
  season: number, round: number, player_name: string
): Promise<F1PlayerState[]> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: `SELECT * FROM f1_player_state
          WHERE season = ? AND round = ? AND player_name = ?
          ORDER BY session_type ASC`,
    args: [season, round, player_name],
  });

  return result.rows.map(row => ({
    season: row.season as number,
    round: row.round as number,
    session_type: row.session_type as SessionType,
    player_name: row.player_name as string,
    state: row.state as PlayerState,
    updated_at: row.updated_at as string,
  }));
}

// —— Roster CRUD ——————————————————————————————————————

export async function get_roster(season: number): Promise<string[]> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: 'SELECT player_name FROM f1_roster WHERE season = ? ORDER BY player_name ASC',
    args: [season],
  });

  return result.rows.map(row => row.player_name as string);
}

export async function add_to_roster(season: number, player_name: string): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: 'INSERT OR IGNORE INTO f1_roster (season, player_name) VALUES (?, ?)',
    args: [season, player_name],
  });
}

export async function remove_from_roster(season: number, player_name: string): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: 'DELETE FROM f1_roster WHERE season = ? AND player_name = ?',
    args: [season, player_name],
  });
}

// —— Player Identity ——————————————————————————————————

export async function get_player_display_name(player_id: string): Promise<string | null> {
  await ensure_f1_schema();
  const db = get_client();
  const result = await db.execute({
    sql: 'SELECT display_name FROM f1_players WHERE player_id = ?',
    args: [player_id],
  });
  if (result.rows.length === 0) return null;
  return result.rows[0].display_name as string;
}

export async function upsert_player_name(player_id: string, display_name: string): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();
  await db.execute({
    sql: `INSERT INTO f1_players (player_id, display_name)
          VALUES (?, ?)
          ON CONFLICT(player_id) DO UPDATE SET display_name = excluded.display_name`,
    args: [player_id, display_name],
  });
}

export async function list_all_players(): Promise<{ player_id: string; display_name: string; created_at: string }[]> {
  await ensure_f1_schema();
  const db = get_client();
  const result = await db.execute('SELECT player_id, display_name, created_at FROM f1_players ORDER BY created_at ASC');
  return result.rows.map(row => ({
    player_id: row.player_id as string,
    display_name: row.display_name as string,
    created_at: row.created_at as string,
  }));
}

export async function get_all_player_states_for_round(
  season: number, round: number
): Promise<F1PlayerState[]> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: `SELECT * FROM f1_player_state
          WHERE season = ? AND round = ?
          ORDER BY player_name ASC, session_type ASC`,
    args: [season, round],
  });

  return result.rows.map(row => ({
    season: row.season as number,
    round: row.round as number,
    session_type: row.session_type as SessionType,
    player_name: row.player_name as string,
    state: row.state as PlayerState,
    updated_at: row.updated_at as string,
  }));
}

// —— Season Reset ————————————————————————————————————

export async function reset_season_data(season: number): Promise<{ predictions: number; scores: number; states: number; sessions: number }> {
  await ensure_f1_schema();
  const db = get_client();

  // Delete scores for this season's predictions
  const score_result = await db.execute({
    sql: `DELETE FROM f1_scores WHERE prediction_id IN (SELECT id FROM f1_predictions WHERE season = ?)`,
    args: [season],
  });

  // Delete predictions
  const pred_result = await db.execute({
    sql: 'DELETE FROM f1_predictions WHERE season = ?',
    args: [season],
  });

  // Delete player states
  const state_result = await db.execute({
    sql: 'DELETE FROM f1_player_state WHERE season = ?',
    args: [season],
  });

  // Delete cached results (so rounds don't show as completed)
  const session_result = await db.execute({
    sql: 'DELETE FROM f1_sessions WHERE season = ?',
    args: [season],
  });

  // Delete staged Mr Bear picks
  await db.execute({
    sql: 'DELETE FROM f1_mr_bear_staged WHERE season = ?',
    args: [season],
  });

  // Delete scratched drivers
  await db.execute({
    sql: 'DELETE FROM f1_scratched_drivers WHERE season = ?',
    args: [season],
  });

  return {
    predictions: pred_result.rowsAffected,
    scores: score_result.rowsAffected,
    states: state_result.rowsAffected,
    sessions: session_result.rowsAffected,
  };
}

// —— Mr Bear Staged Picks ————————————————————————————

export async function get_staged_picks(
  season: number, round: number, session_type: SessionType
): Promise<{ p1: string; p2: string; p3: string; fastest_lap: string | null } | null> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: `SELECT p1, p2, p3, fastest_lap FROM f1_mr_bear_staged
          WHERE season = ? AND round = ? AND session_type = ?`,
    args: [season, round, session_type],
  });

  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    p1: row.p1 as string,
    p2: row.p2 as string,
    p3: row.p3 as string,
    fastest_lap: (row.fastest_lap as string) || null,
  };
}

export async function save_staged_picks(
  season: number, round: number, session_type: SessionType,
  p1: string, p2: string, p3: string, fastest_lap: string | null
): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: `INSERT INTO f1_mr_bear_staged (season, round, session_type, p1, p2, p3, fastest_lap)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(season, round, session_type)
          DO UPDATE SET p1 = excluded.p1, p2 = excluded.p2, p3 = excluded.p3,
                        fastest_lap = excluded.fastest_lap, created_at = datetime('now')`,
    args: [season, round, session_type, p1, p2, p3, fastest_lap],
  });
}

export async function delete_staged_picks(
  season: number, round: number, session_type: SessionType
): Promise<void> {
  await ensure_f1_schema();
  const db = get_client();

  await db.execute({
    sql: 'DELETE FROM f1_mr_bear_staged WHERE season = ? AND round = ? AND session_type = ?',
    args: [season, round, session_type],
  });
}

export async function get_all_staged_picks(
  season: number, round?: number
): Promise<{ season: number; round: number; session_type: string; p1: string; p2: string; p3: string; fastest_lap: string | null; created_at: string }[]> {
  await ensure_f1_schema();
  const db = get_client();

  const sql = round
    ? 'SELECT * FROM f1_mr_bear_staged WHERE season = ? AND round = ? ORDER BY round, session_type'
    : 'SELECT * FROM f1_mr_bear_staged WHERE season = ? ORDER BY round, session_type';
  const args = round ? [season, round] : [season];

  const result = await db.execute({ sql, args });
  return result.rows.map(row => ({
    season: row.season as number,
    round: row.round as number,
    session_type: row.session_type as string,
    p1: row.p1 as string,
    p2: row.p2 as string,
    p3: row.p3 as string,
    fastest_lap: (row.fastest_lap as string) || null,
    created_at: row.created_at as string,
  }));
}

// —— Leaderboard Query ———————————————————————————————

export interface LeaderboardEntry {
  player_name: string;
  total_score: number;
  sessions_played: number;
}

export async function get_leaderboard(season: number): Promise<LeaderboardEntry[]> {
  await ensure_f1_schema();
  const db = get_client();

  const result = await db.execute({
    sql: `SELECT p.player_name, COALESCE(SUM(s.total), 0) as total_score, COUNT(s.prediction_id) as sessions_played
          FROM f1_predictions p
          LEFT JOIN f1_scores s ON p.id = s.prediction_id
          WHERE p.season = ?
          GROUP BY p.player_name
          ORDER BY total_score DESC`,
    args: [season],
  });

  return result.rows.map(row => ({
    player_name: row.player_name as string,
    total_score: (row.total_score as number) || 0,
    sessions_played: (row.sessions_played as number) || 0,
  }));
}
