import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {buildPosterUrl} from '../services/tmdb-service.js';

const DATABASE_FILENAME = 'memento.db';

const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    imdb_id TEXT UNIQUE,
    tmdb_id INTEGER UNIQUE,
    poster TEXT,
    tagline TEXT,
    overview TEXT,
    original_language TEXT,
    runtime INTEGER,
    release_date TEXT,
    tmdb_average REAL,
    tmdb_vote_count INTEGER,
    revenue INTEGER,
    letterboxd_url TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credits (
    id INTEGER PRIMARY KEY,
    movie_id INTEGER NOT NULL,
    person_name TEXT NOT NULL,
    role_type TEXT NOT NULL,
    character_name TEXT,
    profile_path TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY,
    movie_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS places (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    is_cinema INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plays (
    id INTEGER PRIMARY KEY,
    movie_id INTEGER NOT NULL,
    watched_at TEXT NOT NULL,
    watch_order INTEGER NOT NULL DEFAULT 1,
    place_id INTEGER,
    FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE,
    FOREIGN KEY (place_id) REFERENCES places (id) ON DELETE SET NULL
);
`;

function ensureAppDataDir() {
    const dataDir = GLib.get_user_data_dir();
    if (!GLib.file_test(dataDir, GLib.FileTest.IS_DIR)) {
        const result = GLib.mkdir_with_parents(dataDir, 0o755);
        if (result !== 0) {
            throw new Error(`Failed to create data directory: ${dataDir}`);
        }
    }
    return dataDir;
}

function getDatabasePath() {
    const appDir = ensureAppDataDir();
    return GLib.build_filenamev([appDir, DATABASE_FILENAME]);
}

function runSql(sql, options = {}) {
    const databasePath = getDatabasePath();
    const args = ['sqlite3', '-batch'];
    if (options.expectJson)
        args.push('-json');
    args.push(databasePath);

    let subprocess;
    try {
        subprocess = Gio.Subprocess.new(
            args,
            Gio.SubprocessFlags.STDIN_PIPE |
            Gio.SubprocessFlags.STDOUT_PIPE |
            Gio.SubprocessFlags.STDERR_PIPE
        );
    } catch (error) {
        throw new Error(`Failed to start sqlite3: ${error.message}`);
    }

    const input = `PRAGMA foreign_keys = ON;\n${sql}\n`;
    let stdout;
    let stderr;
    try {
        [, stdout, stderr] = subprocess.communicate_utf8(input, null);
    } catch (error) {
        throw new Error(`Failed to run sqlite3: ${error.message}`);
    }

    if (!subprocess.get_successful()) {
        const message = stderr && stderr.trim()
            ? stderr.trim()
            : 'sqlite3 command failed';
        throw new Error(message);
    }

    return stdout ?? '';
}

function executeStatements(sql) {
    runSql(sql);
}

function execute(sql) {
    runSql(sql);
}

function queryAll(sql) {
    const output = runSql(sql, {expectJson: true}).trim();
    if (!output)
        return [];

    try {
        const rows = JSON.parse(output);
        return Array.isArray(rows) ? rows : [];
    } catch (error) {
        throw new Error('Failed to parse sqlite output.');
    }
}

function queryOne(sql) {
    const rows = queryAll(sql);
    return rows[0] ?? null;
}

function toSqlLiteral(value) {
    if (value === null || value === undefined)
        return 'NULL';
    if (typeof value === 'number')
        return String(value);
    if (typeof value === 'boolean')
        return value ? '1' : '0';
    const escaped = String(value).replace(/'/g, "''");
    return `'${escaped}'`;
}

export async function initializeDatabase() {
    try {
        executeStatements(SCHEMA_SQL);
    } catch (error) {
        throw new Error(`Failed to initialize database: ${error.message}`);
    }
}

export async function upsertMovieFromTmdb(details) {
    const tmdbId = Number(details?.id);
    if (!Number.isFinite(tmdbId)) {
        throw new Error('TMDB movie id is missing.');
    }

    const title =
        details.title ||
        details.original_title ||
        details.name ||
        'Untitled';

    const now = new Date().toISOString();
    const posterUrl = buildPosterUrl(details.poster_path);
    const sql = `
INSERT INTO movies (
    title,
    imdb_id,
    tmdb_id,
    poster,
    tagline,
    overview,
    original_language,
    runtime,
    release_date,
    tmdb_average,
    tmdb_vote_count,
    revenue,
    created_at,
    updated_at
) VALUES (
    ${toSqlLiteral(title)},
    ${toSqlLiteral(details.imdb_id)},
    ${toSqlLiteral(tmdbId)},
    ${toSqlLiteral(posterUrl)},
    ${toSqlLiteral(details.tagline)},
    ${toSqlLiteral(details.overview)},
    ${toSqlLiteral(details.original_language)},
    ${toSqlLiteral(details.runtime)},
    ${toSqlLiteral(details.release_date)},
    ${toSqlLiteral(details.vote_average)},
    ${toSqlLiteral(details.vote_count)},
    ${toSqlLiteral(details.revenue)},
    ${toSqlLiteral(now)},
    ${toSqlLiteral(now)}
)
ON CONFLICT(tmdb_id) DO UPDATE SET
    title = excluded.title,
    imdb_id = excluded.imdb_id,
    poster = excluded.poster,
    tagline = excluded.tagline,
    overview = excluded.overview,
    original_language = excluded.original_language,
    runtime = excluded.runtime,
    release_date = excluded.release_date,
    tmdb_average = excluded.tmdb_average,
    tmdb_vote_count = excluded.tmdb_vote_count,
    revenue = excluded.revenue,
    updated_at = excluded.updated_at;
`;

    execute(sql);

    const row = queryOne(
        `SELECT id FROM movies WHERE tmdb_id = ${toSqlLiteral(tmdbId)};`
    );
    if (!row)
        throw new Error('Failed to locate movie after upsert.');

    return row.id;
}

export async function addMovieToWatchlist(movieId) {
    const now = new Date().toISOString();
    const sql = `
INSERT INTO watchlist (movie_id, created_at)
SELECT ${toSqlLiteral(movieId)}, ${toSqlLiteral(now)}
WHERE NOT EXISTS (
    SELECT 1 FROM watchlist WHERE movie_id = ${toSqlLiteral(movieId)}
);
`;
    execute(sql);
}

export async function getWatchlistMovies() {
    const sql = `
SELECT
    movies.id,
    movies.title,
    movies.release_date,
    movies.poster,
    movies.tagline,
    movies.overview,
    movies.original_language,
    movies.runtime,
    movies.tmdb_average,
    movies.tmdb_vote_count,
    movies.tmdb_id,
    watchlist.created_at AS added_at
FROM watchlist
JOIN movies ON movies.id = watchlist.movie_id
ORDER BY watchlist.created_at DESC;
`;
    return queryAll(sql);
}

export async function findMovieByTmdbId(tmdbId) {
    return queryOne(`SELECT * FROM movies WHERE tmdb_id = ${toSqlLiteral(tmdbId)};`);
}

export async function getMovieById(movieId) {
    return queryOne(`SELECT * FROM movies WHERE id = ${toSqlLiteral(movieId)};`);
}

export async function getMovieCredits(movieId) {
    const sql = `
SELECT
    person_name,
    role_type,
    character_name,
    profile_path,
    display_order
FROM credits
WHERE movie_id = ${toSqlLiteral(movieId)}
ORDER BY role_type, display_order;
`;
    return queryAll(sql);
}

export async function upsertMovieCredits(movieId, credits) {
    if (!credits || credits.length === 0) return;

    // Delete existing credits for this movie
    execute(`DELETE FROM credits WHERE movie_id = ${toSqlLiteral(movieId)};`);

    // Insert new credits
    for (const credit of credits) {
        const sql = `
INSERT INTO credits (movie_id, person_name, role_type, character_name, profile_path, display_order)
VALUES (
    ${toSqlLiteral(movieId)},
    ${toSqlLiteral(credit.person_name)},
    ${toSqlLiteral(credit.role_type)},
    ${toSqlLiteral(credit.character_name)},
    ${toSqlLiteral(credit.profile_path)},
    ${toSqlLiteral(credit.display_order)}
);
`;
        execute(sql);
    }
}

export async function addPlay(movieId, watchedDate, placeId = null, watchOrder = null) {
    // If watch_order not provided, calculate it based on same-day plays
    if (watchOrder === null) {
        const sameDayPlays = await queryAll(`
            SELECT MAX(watch_order) as max_order
            FROM plays
            WHERE watched_at = ${toSqlLiteral(watchedDate)};
        `);
        watchOrder = (sameDayPlays[0]?.max_order || 0) + 1;
    }
    
    const sql = `
INSERT INTO plays (movie_id, watched_at, watch_order, place_id)
VALUES (${toSqlLiteral(movieId)}, ${toSqlLiteral(watchedDate)}, ${toSqlLiteral(watchOrder)}, ${toSqlLiteral(placeId)});
`;
    execute(sql);
}

export async function updatePlay(playId, watchedDate, placeId = null, watchOrder = 1) {
    const sql = `
UPDATE plays
SET watched_at = ${toSqlLiteral(watchedDate)}, place_id = ${toSqlLiteral(placeId)}, watch_order = ${toSqlLiteral(watchOrder)}
WHERE id = ${toSqlLiteral(playId)};
`;
    await execute(sql);
}

export async function getPlaysForMovie(movieId) {
    const sql = `
SELECT
    plays.id,
    plays.watched_at,
    plays.watch_order,
    plays.place_id,
    places.name as place_name,
    places.is_cinema
FROM plays
LEFT JOIN places ON plays.place_id = places.id
WHERE plays.movie_id = ${toSqlLiteral(movieId)}
ORDER BY plays.watched_at DESC, plays.watch_order DESC;
`;
    return queryAll(sql);
}

export async function deletePlay(playId) {
    await execute(`DELETE FROM plays WHERE id = ${toSqlLiteral(playId)};`);
}

export async function getAllPlays() {
    const sql = `
SELECT
    plays.id,
    plays.movie_id,
    plays.watched_at,
    plays.watch_order,
   plays.place_id,
    movies.title,
    movies.poster,
    movies.release_date,
    movies.tmdb_id,
    places.name as place_name,
    places.is_cinema
FROM plays
JOIN movies ON plays.movie_id = movies.id
LEFT JOIN places ON plays.place_id = places.id
ORDER BY plays.watched_at DESC, plays.watch_order DESC;
`;
    return queryAll(sql);
}

export async function removeFromWatchlist(movieId) {
    execute(`DELETE FROM watchlist WHERE movie_id = ${toSqlLiteral(movieId)};`);
}

export async function isInWatchlist(movieId) {
    const result = await queryOne(`SELECT id FROM watchlist WHERE movie_id = ${toSqlLiteral(movieId)};`);
    return result !== null;
}

// Places functions
export async function getAllPlaces() {
    return queryAll('SELECT * FROM places ORDER BY name;');
}

export async function addPlace(name, isCinema = false) {
    const now = new Date().toISOString();
    const sql = `
INSERT INTO places (name, is_cinema, created_at)
VALUES (${toSqlLiteral(name)}, ${toSqlLiteral(isCinema ? 1 : 0)}, ${toSqlLiteral(now)});
`;
    await execute(sql);
}

export async function updatePlace(id, name, isCinema) {
    const sql = `
UPDATE places
SET name = ${toSqlLiteral(name)}, is_cinema = ${toSqlLiteral(isCinema ? 1 : 0)}
WHERE id = ${toSqlLiteral(id)};
`;
    await execute(sql);
}

export async function deletePlace(id) {
await execute(`DELETE FROM places WHERE id = ${toSqlLiteral(id)};`);
}
