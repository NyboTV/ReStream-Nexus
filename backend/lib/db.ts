import sqlite3 from 'sqlite3';
import { DB_PATH } from './config';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface Target {
    id: number;
    name: string;
    url: string;
    stream_key: string;
    enabled: 0 | 1;
}

// ─── DB Setup ─────────────────────────────────────────────────────────────────
const db = new (sqlite3.verbose().Database)(DB_PATH);

db.serialize(() => {
    db.run(`
    CREATE TABLE IF NOT EXISTS targets (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      url        TEXT    NOT NULL,
      stream_key TEXT    NOT NULL,
      enabled    INTEGER DEFAULT 1
    )
  `);

    // Safe migration — ignore if column already exists
    db.run(`ALTER TABLE targets ADD COLUMN enabled INTEGER DEFAULT 1`, () => { });

    db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
});

// ─── Targets ──────────────────────────────────────────────────────────────────
export function getTargets(): Promise<Target[]> {
    return new Promise((resolve, reject) => {
        db.all<Target>('SELECT * FROM targets', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

export function getEnabledTargets(): Promise<Target[]> {
    return new Promise((resolve, reject) => {
        db.all<Target>('SELECT * FROM targets WHERE enabled = 1', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

export function addTarget(name: string, url: string, stream_key: string): Promise<Target> {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO targets (name, url, stream_key, enabled) VALUES (?, ?, ?, 1)',
            [name, url, stream_key],
            function (err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, name, url, stream_key, enabled: 1 });
            }
        );
    });
}

export function updateTargetStatus(id: number, enabled: boolean): Promise<number> {
    return new Promise((resolve, reject) => {
        db.run(
            'UPDATE targets SET enabled = ? WHERE id = ?',
            [enabled ? 1 : 0, id],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

export function removeTarget(id: number): Promise<number> {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM targets WHERE id = ?', [id], function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

// ─── Settings ─────────────────────────────────────────────────────────────────
export function getSetting(key: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
        db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.value : null);
        });
    });
}

export function setSetting(key: string, value: string): Promise<number> {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            [key, value],
            function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            }
        );
    });
}

// ─── Setup Helpers ───────────────────────────────────────────────────────────
export function isSetupComplete(): Promise<boolean> {
    return getSetting('setup_finished').then(v => v === '1');
}

export function setSetupFinished(): Promise<number> {
    return setSetting('setup_finished', '1');
}

export function getPasswordHash(): Promise<string | null> {
    return getSetting('password_hash');
}

export function setPasswordHash(hash: string): Promise<number> {
    return setSetting('password_hash', hash);
}

export function setStreamKeyDb(key: string): Promise<number> {
    return setSetting('stream_key', key);
}

export function getStreamKeyDb(): Promise<string | null> {
    return getSetting('stream_key');
}

export function getSetupStep(): Promise<number> {
    return getSetting('setup_step').then(v => v ? parseInt(v, 10) : 1);
}

export function setSetupStep(step: number): Promise<number> {
    return setSetting('setup_step', String(step));
}

export { db };
