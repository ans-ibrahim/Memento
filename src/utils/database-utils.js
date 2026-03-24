import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DATABASE_FILENAME = 'memento.db';

const MIGRATIONS = [
    {
        version: 1,
        name: 'initial_schema',
        sql: `
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
    budget INTEGER,
    genres TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS persons (
    id INTEGER PRIMARY KEY,
    tmdb_person_id INTEGER UNIQUE NOT NULL,
    name TEXT NOT NULL,
    profile_path TEXT,
    known_for TEXT,
    biography TEXT,
    birthday TEXT,
    place_of_birth TEXT,
    deathday TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS credits (
    id INTEGER PRIMARY KEY,
    movie_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    role_type TEXT NOT NULL,
    character_name TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES persons (id) ON DELETE CASCADE
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
    comment TEXT,
    FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE,
    FOREIGN KEY (place_id) REFERENCES places (id) ON DELETE SET NULL
);
`,
    },
    {
        version: 2,
        name: 'add_imdb_rating_cache',
        sql: `
ALTER TABLE movies ADD COLUMN imdb_rating REAL;
ALTER TABLE movies ADD COLUMN imdb_rating_updated_at TEXT;
`,
    },
    {
        version: 3,
        name: 'add_original_title',
        sql: `
ALTER TABLE movies ADD COLUMN original_title TEXT;
UPDATE movies
SET original_title = title
WHERE original_title IS NULL;
`,
    },
    {
        version: 4,
        name: 'add_dedicated_tv_schema',
        sql: `
CREATE TABLE IF NOT EXISTS tv_shows (
    id INTEGER PRIMARY KEY,
    tmdb_id INTEGER NOT NULL UNIQUE,
    imdb_id TEXT,
    name TEXT NOT NULL,
    original_name TEXT,
    poster_path TEXT,
    backdrop_path TEXT,
    tagline TEXT,
    overview TEXT,
    original_language TEXT,
    genres TEXT,
    first_air_date TEXT,
    last_air_date TEXT,
    status TEXT,
    number_of_seasons INTEGER,
    number_of_episodes INTEGER,
    tmdb_average REAL,
    tmdb_vote_count INTEGER,
    imdb_rating REAL,
    imdb_rating_updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tv_seasons (
    id INTEGER PRIMARY KEY,
    show_id INTEGER NOT NULL,
    tmdb_season_id INTEGER,
    season_number INTEGER NOT NULL,
    name TEXT,
    overview TEXT,
    air_date TEXT,
    poster_path TEXT,
    episode_count INTEGER,
    vote_average REAL,
    vote_count INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (show_id) REFERENCES tv_shows (id) ON DELETE CASCADE,
    UNIQUE (show_id, season_number)
);

CREATE TABLE IF NOT EXISTS tv_episodes (
    id INTEGER PRIMARY KEY,
    show_id INTEGER NOT NULL,
    season_id INTEGER NOT NULL,
    tmdb_episode_id INTEGER,
    season_number INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    overview TEXT,
    air_date TEXT,
    runtime INTEGER,
    still_path TEXT,
    director_names TEXT,
    writer_names TEXT,
    vote_average REAL,
    vote_count INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (show_id) REFERENCES tv_shows (id) ON DELETE CASCADE,
    FOREIGN KEY (season_id) REFERENCES tv_seasons (id) ON DELETE CASCADE,
    UNIQUE (show_id, season_number, episode_number)
);

CREATE TABLE IF NOT EXISTS tv_watchlist (
    id INTEGER PRIMARY KEY,
    show_id INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (show_id) REFERENCES tv_shows (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tv_episode_plays (
    id INTEGER PRIMARY KEY,
    show_id INTEGER NOT NULL,
    episode_id INTEGER NOT NULL,
    watched_at TEXT NOT NULL,
    watch_order INTEGER NOT NULL DEFAULT 1,
    place_id INTEGER,
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (show_id) REFERENCES tv_shows (id) ON DELETE CASCADE,
    FOREIGN KEY (episode_id) REFERENCES tv_episodes (id) ON DELETE CASCADE,
    FOREIGN KEY (place_id) REFERENCES places (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tv_credits (
    id INTEGER PRIMARY KEY,
    show_id INTEGER NOT NULL,
    person_id INTEGER NOT NULL,
    role_type TEXT NOT NULL,
    character_name TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    episode_count INTEGER,
    FOREIGN KEY (show_id) REFERENCES tv_shows (id) ON DELETE CASCADE,
    FOREIGN KEY (person_id) REFERENCES persons (id) ON DELETE CASCADE
);
`,
    },
];

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
    } catch {
        throw new Error('Failed to parse sqlite output.');
    }
}

function queryOne(sql) {
    const rows = queryAll(sql);
    return rows[0] ?? null;
}

function getCurrentSchemaVersion() {
    const row = queryOne('PRAGMA user_version;');
    const version = Number(row?.user_version);
    if (!Number.isFinite(version) || version < 0)
        return 0;
    return Math.floor(version);
}

function applyMigration(migration) {
    const sql = `
BEGIN;
${migration.sql}
PRAGMA user_version = ${migration.version};
COMMIT;
`;
    executeStatements(sql);
}

function applyPendingMigrations() {
    const orderedMigrations = [...MIGRATIONS].sort(
        (firstMigration, secondMigration) => firstMigration.version - secondMigration.version
    );
    let currentVersion = getCurrentSchemaVersion();

    for (const migration of orderedMigrations) {
        if (migration.version <= currentVersion)
            continue;
        applyMigration(migration);
        currentVersion = migration.version;
    }
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

function getNextGlobalWatchOrderForDate(watchedDate) {
    const row = queryOne(`
SELECT COALESCE(MAX(watch_order), 0) AS max_order
FROM (
    SELECT watch_order
    FROM plays
    WHERE watched_at = ${toSqlLiteral(watchedDate)}
    UNION ALL
    SELECT watch_order
    FROM tv_episode_plays
    WHERE watched_at = ${toSqlLiteral(watchedDate)}
);
`);
    return (Number(row?.max_order) || 0) + 1;
}

export async function initializeDatabase() {
    try {
        applyPendingMigrations();
    } catch (error) {
        throw new Error(`Failed to initialize database: ${error.message}`);
    }
}

export async function upsertMovieCredits(titleId, credits) {
    if (!credits || credits.length === 0)
        return;

    execute(`DELETE FROM credits WHERE movie_id = ${toSqlLiteral(titleId)};`);

    for (const credit of credits) {
        const sql = `
INSERT INTO credits (movie_id, person_id, role_type, character_name, display_order)
VALUES (
    ${toSqlLiteral(titleId)},
    ${toSqlLiteral(credit.person_id)},
    ${toSqlLiteral(credit.role_type)},
    ${toSqlLiteral(credit.character_name)},
    ${toSqlLiteral(credit.display_order)}
);
`;
        execute(sql);
    }
}

export async function upsertMovieFromTmdb(details) {
    const tmdbId = Number(details?.id);
    if (!Number.isFinite(tmdbId)) {
        throw new Error('TMDB movie id is missing.');
    }

    const title =
        details?.title ||
        details?.original_title ||
        details?.name ||
        'Untitled';
    const originalTitle =
        details?.original_title ||
        details?.title ||
        null;
    const genres = Array.isArray(details?.genres)
        ? details.genres
            .map(genre => genre?.name)
            .filter(genreName => Boolean(genreName))
            .join(', ')
        : '';

    const now = new Date().toISOString();
    const sql = `
INSERT INTO movies (
    title,
    original_title,
    imdb_id,
    tmdb_id,
    poster,
    tagline,
    overview,
    original_language,
    genres,
    runtime,
    release_date,
    budget,
    tmdb_average,
    tmdb_vote_count,
    revenue,
    created_at,
    updated_at
) VALUES (
    ${toSqlLiteral(title)},
    ${toSqlLiteral(originalTitle)},
    ${toSqlLiteral(details?.imdb_id)},
    ${toSqlLiteral(tmdbId)},
    ${toSqlLiteral(details?.poster_path)},
    ${toSqlLiteral(details?.tagline)},
    ${toSqlLiteral(details?.overview)},
    ${toSqlLiteral(details?.original_language)},
    ${toSqlLiteral(genres)},
    ${toSqlLiteral(details?.runtime)},
    ${toSqlLiteral(details?.release_date)},
    ${toSqlLiteral(details?.budget)},
    ${toSqlLiteral(details?.vote_average)},
    ${toSqlLiteral(details?.vote_count)},
    ${toSqlLiteral(details?.revenue)},
    ${toSqlLiteral(now)},
    ${toSqlLiteral(now)}
)
ON CONFLICT(tmdb_id) DO UPDATE SET
    title = excluded.title,
    original_title = excluded.original_title,
    imdb_id = excluded.imdb_id,
    poster = excluded.poster,
    tagline = excluded.tagline,
    overview = excluded.overview,
    original_language = excluded.original_language,
    genres = excluded.genres,
    runtime = excluded.runtime,
    release_date = excluded.release_date,
    budget = excluded.budget,
    tmdb_average = excluded.tmdb_average,
    tmdb_vote_count = excluded.tmdb_vote_count,
    revenue = excluded.revenue,
    updated_at = excluded.updated_at;
`;
    execute(sql);

    const row = queryOne(`SELECT id FROM movies WHERE tmdb_id = ${toSqlLiteral(tmdbId)};`);
    if (!row?.id) {
        throw new Error('Failed to locate movie after upsert.');
    }
    return row.id;
}

export async function upsertTvShowFromTmdb(details) {
    return upsertTvShow(details);
}

export async function upsertTvSeasons(titleId, seasons) {
    return upsertTvShowSeasons(titleId, seasons);
}

export async function upsertSeasonEpisodes(titleId, seasonNumber, episodes) {
    return upsertTvShowSeasonEpisodes(titleId, seasonNumber, episodes);
}

export async function getEpisodesForTitle(titleId) {
    return queryAll(`
SELECT
    id,
    season_number,
    episode_number,
    name,
    air_date
FROM tv_episodes
WHERE show_id = ${toSqlLiteral(titleId)}
ORDER BY season_number ASC, episode_number ASC;
`);
}

export async function getSeasonsForTitle(titleId) {
    return queryAll(`
SELECT
    tv_seasons.id,
    tv_seasons.show_id AS title_id,
    tv_seasons.season_number,
    tv_seasons.name,
    tv_seasons.episode_count,
    tv_seasons.air_date,
    COUNT(DISTINCT tv_episodes.id) AS total_episodes,
    COUNT(DISTINCT tv_episode_plays.episode_id) AS watched_episodes
FROM tv_seasons
LEFT JOIN tv_episodes ON tv_episodes.season_id = tv_seasons.id
LEFT JOIN tv_episode_plays ON tv_episode_plays.episode_id = tv_episodes.id
WHERE tv_seasons.show_id = ${toSqlLiteral(titleId)}
GROUP BY
    tv_seasons.id,
    tv_seasons.show_id,
    tv_seasons.season_number,
    tv_seasons.name,
    tv_seasons.episode_count,
    tv_seasons.air_date
ORDER BY tv_seasons.season_number ASC;
`);
}

export async function getTitleEpisodeProgress(titleId) {
    const row = queryOne(`
SELECT
    (SELECT COUNT(*) FROM tv_episodes WHERE show_id = ${toSqlLiteral(titleId)}) AS total_episodes,
    (SELECT COUNT(DISTINCT tv_episode_plays.episode_id)
     FROM tv_episode_plays
     WHERE tv_episode_plays.show_id = ${toSqlLiteral(titleId)}) AS watched_episodes,
    (SELECT COUNT(*) FROM tv_seasons WHERE show_id = ${toSqlLiteral(titleId)}) AS total_seasons,
    (SELECT COUNT(*)
     FROM (
        SELECT
            tv_seasons.id,
            COUNT(DISTINCT tv_episodes.id) AS total_in_season,
            COUNT(DISTINCT tv_episode_plays.episode_id) AS watched_in_season
        FROM tv_seasons
        LEFT JOIN tv_episodes ON tv_episodes.season_id = tv_seasons.id
        LEFT JOIN tv_episode_plays ON tv_episode_plays.episode_id = tv_episodes.id
        WHERE tv_seasons.show_id = ${toSqlLiteral(titleId)}
        GROUP BY tv_seasons.id
     )
     WHERE total_in_season > 0 AND watched_in_season >= total_in_season
    ) AS completed_seasons;
`) ?? {};
    return {
        total_episodes: Number(row.total_episodes) || 0,
        watched_episodes: Number(row.watched_episodes) || 0,
        total_seasons: Number(row.total_seasons) || 0,
        completed_seasons: Number(row.completed_seasons) || 0,
    };
}

export async function upsertPerson(tmdbPersonId, details) {
    const personId = Number(tmdbPersonId);
    if (!Number.isFinite(personId)) {
        throw new Error('TMDB person id is missing.');
    }

    const now = new Date().toISOString();
    const sql = `
INSERT INTO persons (
    tmdb_person_id,
    name,
    profile_path,
    known_for,
    biography,
    birthday,
    place_of_birth,
    deathday,
    created_at,
    updated_at
) VALUES (
    ${toSqlLiteral(personId)},
    ${toSqlLiteral(details.name)},
    ${toSqlLiteral(details.profile_path)},
    ${toSqlLiteral(details.known_for_department || details.known_for || '')},
    ${toSqlLiteral(details.biography)},
    ${toSqlLiteral(details.birthday)},
    ${toSqlLiteral(details.place_of_birth)},
    ${toSqlLiteral(details.deathday)},
    ${toSqlLiteral(now)},
    ${toSqlLiteral(now)}
)
ON CONFLICT(tmdb_person_id) DO UPDATE SET
    name = excluded.name,
    profile_path = excluded.profile_path,
    known_for = excluded.known_for,
    biography = excluded.biography,
    birthday = excluded.birthday,
    place_of_birth = excluded.place_of_birth,
    deathday = excluded.deathday,
    updated_at = excluded.updated_at;
`;

    execute(sql);

    const row = queryOne(
        `SELECT id FROM persons WHERE tmdb_person_id = ${toSqlLiteral(personId)};`
    );
    if (!row)
        throw new Error('Failed to locate person after upsert.');

    return row.id;
}

export async function getPersonById(personId) {
    return queryOne(`SELECT * FROM persons WHERE id = ${toSqlLiteral(personId)};`);
}

export async function getPersonByTmdbId(tmdbPersonId) {
    return queryOne(`SELECT * FROM persons WHERE tmdb_person_id = ${toSqlLiteral(tmdbPersonId)};`);
}

export async function getMoviesByPersonId(personId) {
    const sql = `
SELECT
    credits.id AS credit_id,
    credits.role_type,
    credits.character_name,
    NULL AS episode_count,
    credits.display_order,
    movies.id,
    movies.title,
    movies.original_title,
    movies.tmdb_id,
    movies.poster,
    NULL AS season_poster,
    movies.release_date,
    'movie' AS media_type
FROM movies
JOIN credits ON credits.movie_id = movies.id
WHERE credits.person_id = ${toSqlLiteral(personId)}
UNION ALL
SELECT
    tv_credits.id AS credit_id,
    tv_credits.role_type,
    tv_credits.character_name,
    tv_credits.episode_count,
    tv_credits.display_order,
    tv_shows.id + 1000000000 AS id,
    tv_shows.name AS title,
    tv_shows.original_name AS original_title,
    tv_shows.tmdb_id,
    tv_shows.poster_path AS poster,
    NULL AS season_poster,
    tv_shows.first_air_date AS release_date,
    'tv' AS media_type
FROM tv_shows
JOIN tv_credits ON tv_credits.show_id = tv_shows.id
WHERE tv_credits.person_id = ${toSqlLiteral(personId)}
ORDER BY release_date DESC, display_order ASC;
`;
    return queryAll(sql);
}

export async function addMovieToWatchlist(titleId) {
    const now = new Date().toISOString();
    const sql = `
INSERT INTO watchlist (movie_id, created_at)
SELECT ${toSqlLiteral(titleId)}, ${toSqlLiteral(now)}
WHERE NOT EXISTS (
    SELECT 1 FROM watchlist WHERE movie_id = ${toSqlLiteral(titleId)}
);
`;
    execute(sql);
}

export async function getWatchlistMovies() {
    const sql = `
SELECT
    movies.id,
    movies.title,
    movies.original_title,
    'movie' AS media_type,
    movies.release_date,
    NULL AS first_air_date,
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
UNION ALL
SELECT
    tv_shows.id + 1000000000 AS id,
    tv_shows.name AS title,
    tv_shows.original_name AS original_title,
    'tv' AS media_type,
    tv_shows.first_air_date AS release_date,
    tv_shows.first_air_date,
    tv_shows.poster_path AS poster,
    tv_shows.tagline,
    tv_shows.overview,
    tv_shows.original_language,
    NULL AS runtime,
    tv_shows.tmdb_average,
    tv_shows.tmdb_vote_count,
    tv_shows.tmdb_id,
    tv_watchlist.created_at AS added_at
FROM tv_watchlist
JOIN tv_shows ON tv_shows.id = tv_watchlist.show_id
ORDER BY added_at DESC;
`;
    return queryAll(sql);
}

export async function findTitleByTmdbId(tmdbId, mediaType = 'movie') {
    if (mediaType === 'tv') {
        const show = await findTvShowByTmdbId(tmdbId);
        if (!show) {
            return null;
        }
        return {
            ...show,
            title: show.name,
            original_title: show.original_name,
            poster: show.poster_path,
            release_date: show.first_air_date,
            media_type: 'tv',
            tmdb_average: show.tmdb_average,
            tmdb_vote_count: show.tmdb_vote_count,
        };
    }
    const movie = queryOne(`SELECT * FROM movies WHERE tmdb_id = ${toSqlLiteral(tmdbId)};`);
    if (!movie) {
        return null;
    }
    return {
        ...movie,
        media_type: 'movie',
    };
}

export async function findMovieByTmdbId(tmdbId) {
    return findTitleByTmdbId(tmdbId, 'movie');
}

export async function getMovieById(titleId) {
    return queryOne(`SELECT * FROM movies WHERE id = ${toSqlLiteral(titleId)};`);
}

export async function getMovieCredits(titleId) {
    const sql = `
SELECT
    credits.id,
    credits.role_type,
    credits.character_name,
    credits.display_order,
    persons.id as person_id,
    persons.tmdb_person_id,
    persons.name as person_name,
    persons.profile_path
FROM credits
JOIN persons ON credits.person_id = persons.id
WHERE credits.movie_id = ${toSqlLiteral(titleId)}
ORDER BY credits.role_type, credits.display_order;
`;
    return queryAll(sql);
}

export async function getAllMovieTmdbIds() {
    const rows = queryAll(`
SELECT tmdb_id
FROM movies
WHERE tmdb_id IS NOT NULL
ORDER BY updated_at ASC;
`);
    const ids = [];
    for (const row of rows) {
        const tmdbId = Number(row.tmdb_id);
        if (Number.isFinite(tmdbId)) {
            ids.push(tmdbId);
        }
    }
    return ids;
}

export async function getAllTitlesForRefresh() {
    const sql = `
SELECT tmdb_id, 'movie' AS media_type
FROM movies
WHERE tmdb_id IS NOT NULL
UNION ALL
SELECT tmdb_id, 'tv' AS media_type
FROM tv_shows
WHERE tmdb_id IS NOT NULL
ORDER BY tmdb_id ASC;
`;
    return queryAll(sql);
}

export async function getAllMoviesWithImdbIds() {
    const sql = `
SELECT id, title, imdb_id
FROM movies
WHERE imdb_id IS NOT NULL
  AND TRIM(imdb_id) <> ''
ORDER BY updated_at ASC;
`;
    return queryAll(sql);
}

export async function getAllTitlesWithImdbIds() {
    const sql = `
SELECT
    id,
    title,
    imdb_id,
    'movie' AS media_type
FROM movies
WHERE imdb_id IS NOT NULL
  AND TRIM(imdb_id) <> ''
UNION ALL
SELECT
    id,
    name AS title,
    imdb_id,
    'tv' AS media_type
FROM tv_shows
WHERE imdb_id IS NOT NULL
  AND TRIM(imdb_id) <> ''
ORDER BY title ASC;
`;
    return queryAll(sql);
}

export async function updateMovieImdbRating(titleId, imdbRating) {
    const normalizedTitleId = Number(titleId);
    if (!Number.isFinite(normalizedTitleId)) {
        throw new Error('Title id is missing.');
    }

    const normalizedRating = Number(imdbRating);
    const ratingValue = Number.isFinite(normalizedRating) ? normalizedRating : null;
    const updatedAt = new Date().toISOString();
    const sql = `
UPDATE movies
SET imdb_rating = ${toSqlLiteral(ratingValue)},
    imdb_rating_updated_at = ${toSqlLiteral(updatedAt)},
    updated_at = ${toSqlLiteral(updatedAt)}
WHERE id = ${toSqlLiteral(normalizedTitleId)};
`;
    execute(sql);
}

export async function updateTvShowImdbRating(showId, imdbRating) {
    const normalizedShowId = Number(showId);
    if (!Number.isFinite(normalizedShowId)) {
        throw new Error('Show id is missing.');
    }

    const normalizedRating = Number(imdbRating);
    const ratingValue = Number.isFinite(normalizedRating) ? normalizedRating : null;
    const updatedAt = new Date().toISOString();
    const sql = `
UPDATE tv_shows
SET imdb_rating = ${toSqlLiteral(ratingValue)},
    imdb_rating_updated_at = ${toSqlLiteral(updatedAt)},
    updated_at = ${toSqlLiteral(updatedAt)}
WHERE id = ${toSqlLiteral(normalizedShowId)};
`;
    execute(sql);
}

export async function addPlay(titleId, watchedDate, placeId = null, comment = null, episodeId = null) {
    const normalizedTitleId = Number(titleId);
    if (!Number.isFinite(normalizedTitleId) || normalizedTitleId <= 0) {
        throw new Error('Movie id is missing.');
    }
    if (episodeId !== null && episodeId !== undefined) {
        throw new Error('Movie plays do not support episode ids.');
    }

    const watchOrder = getNextGlobalWatchOrderForDate(watchedDate);

    const sql = `
INSERT INTO plays (movie_id, watched_at, watch_order, place_id, comment)
VALUES (
    ${toSqlLiteral(normalizedTitleId)},
    ${toSqlLiteral(watchedDate)},
    ${toSqlLiteral(watchOrder)},
    ${toSqlLiteral(placeId)},
    ${toSqlLiteral(comment)}
);
`;
    execute(sql);
}

export async function addSeasonPlays(titleId, seasonNumber, watchedDate, placeId = null, comment = null) {
    return addTvSeasonPlays(titleId, seasonNumber, watchedDate, placeId, comment);
}

export async function updatePlay(playId, watchedDate, placeId = null, watchOrder = 1, comment = null) {
    const sql = `
UPDATE plays
SET watched_at = ${toSqlLiteral(watchedDate)},
    place_id = ${toSqlLiteral(placeId)},
    watch_order = ${toSqlLiteral(watchOrder)},
    comment = ${toSqlLiteral(comment)}
WHERE id = ${toSqlLiteral(playId)};
`;
    execute(sql);
}

export async function getPlaysForMovie(titleId) {
    const sql = `
SELECT
    plays.id,
    plays.movie_id AS title_id,
    plays.watched_at,
    plays.watch_order,
    plays.place_id,
    plays.comment,
    'movie' AS media_type,
    NULL AS episode_id,
    NULL AS season_number,
    NULL AS episode_number,
    NULL AS episode_name,
    places.name as place_name,
    places.is_cinema
FROM plays
LEFT JOIN places ON plays.place_id = places.id
WHERE plays.movie_id = ${toSqlLiteral(titleId)}
ORDER BY plays.watched_at DESC, plays.watch_order DESC;
`;
    return queryAll(sql);
}

export async function deletePlay(playId) {
    execute(`DELETE FROM plays WHERE id = ${toSqlLiteral(playId)};`);
}

export async function getAllPlays() {
    const sql = `
SELECT
    plays.id,
    plays.id AS source_play_id,
    'movie' AS source_type,
    plays.movie_id AS movie_id,
    plays.movie_id AS title_id,
    NULL AS episode_id,
    plays.watched_at,
    plays.watch_order,
    NULL AS created_at,
    plays.place_id,
    plays.comment,
    movies.title,
    movies.original_title,
    movies.poster,
    NULL AS season_poster,
    movies.release_date,
    NULL AS first_air_date,
    movies.tmdb_id,
    'movie' AS media_type,
    NULL AS season_number,
    NULL AS episode_number,
    NULL AS episode_name,
    places.name as place_name,
    places.is_cinema
FROM plays
JOIN movies ON movies.id = plays.movie_id
LEFT JOIN places ON plays.place_id = places.id
UNION ALL
SELECT
    tv_episode_plays.id + 2000000000 AS id,
    tv_episode_plays.id AS source_play_id,
    'tv' AS source_type,
    tv_shows.id + 1000000000 AS movie_id,
    tv_shows.id + 1000000000 AS title_id,
    tv_episodes.id AS episode_id,
    tv_episode_plays.watched_at,
    tv_episode_plays.watch_order,
    tv_episode_plays.created_at AS created_at,
    tv_episode_plays.place_id,
    tv_episode_plays.comment,
    tv_shows.name AS title,
    tv_shows.original_name AS original_title,
    tv_shows.poster_path AS poster,
    tv_seasons.poster_path AS season_poster,
    tv_shows.first_air_date AS release_date,
    tv_shows.first_air_date,
    tv_shows.tmdb_id,
    'tv' AS media_type,
    tv_episodes.season_number,
    tv_episodes.episode_number,
    tv_episodes.name AS episode_name,
    places.name as place_name,
    places.is_cinema
FROM tv_episode_plays
JOIN tv_shows ON tv_episode_plays.show_id = tv_shows.id
JOIN tv_episodes ON tv_episode_plays.episode_id = tv_episodes.id
LEFT JOIN tv_seasons ON tv_episodes.season_id = tv_seasons.id
LEFT JOIN places ON tv_episode_plays.place_id = places.id
ORDER BY watched_at DESC, watch_order DESC;
`;
    return queryAll(sql);
}

export async function getRecentPlays(limit = 8, offset = 0) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 8;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    const sql = `
SELECT
    plays.id,
    plays.id AS source_play_id,
    'movie' AS source_type,
    plays.movie_id AS movie_id,
    plays.movie_id AS title_id,
    NULL AS episode_id,
    plays.watched_at,
    plays.watch_order,
    NULL AS created_at,
    plays.place_id,
    plays.comment,
    movies.title,
    movies.original_title,
    movies.poster,
    NULL AS season_poster,
    movies.release_date,
    NULL AS first_air_date,
    movies.tmdb_id,
    'movie' AS media_type,
    NULL AS season_number,
    NULL AS episode_number,
    NULL AS episode_name,
    places.name as place_name,
    places.is_cinema
FROM plays
JOIN movies ON movies.id = plays.movie_id
LEFT JOIN places ON plays.place_id = places.id
UNION ALL
SELECT
    tv_episode_plays.id + 2000000000 AS id,
    tv_episode_plays.id AS source_play_id,
    'tv' AS source_type,
    tv_shows.id + 1000000000 AS movie_id,
    tv_shows.id + 1000000000 AS title_id,
    tv_episodes.id AS episode_id,
    tv_episode_plays.watched_at,
    tv_episode_plays.watch_order,
    tv_episode_plays.created_at AS created_at,
    tv_episode_plays.place_id,
    tv_episode_plays.comment,
    tv_shows.name AS title,
    tv_shows.original_name AS original_title,
    tv_shows.poster_path AS poster,
    tv_seasons.poster_path AS season_poster,
    tv_shows.first_air_date AS release_date,
    tv_shows.first_air_date,
    tv_shows.tmdb_id,
    'tv' AS media_type,
    tv_episodes.season_number,
    tv_episodes.episode_number,
    tv_episodes.name AS episode_name,
    places.name as place_name,
    places.is_cinema
FROM tv_episode_plays
JOIN tv_shows ON tv_episode_plays.show_id = tv_shows.id
JOIN tv_episodes ON tv_episode_plays.episode_id = tv_episodes.id
LEFT JOIN tv_seasons ON tv_episodes.season_id = tv_seasons.id
LEFT JOIN places ON tv_episode_plays.place_id = places.id
ORDER BY watched_at DESC, watch_order DESC
LIMIT ${safeLimit}
OFFSET ${safeOffset};
`;
    return queryAll(sql);
}

export async function getDashboardStats() {
    const sql = `
SELECT
    (SELECT COUNT(*) FROM plays) AS movie_total_plays,
    (SELECT COUNT(*) FROM tv_episode_plays) AS tv_total_plays,
    (SELECT COUNT(DISTINCT movie_id) FROM plays) AS movie_unique_titles,
    (SELECT COUNT(DISTINCT show_id) FROM tv_episode_plays) AS tv_unique_shows,
    (SELECT COUNT(*) FROM watchlist) AS movie_watchlist_count,
    (SELECT COUNT(*) FROM tv_watchlist) AS tv_watchlist_count,
    (SELECT COALESCE(SUM(COALESCE(movies.runtime, 0)), 0)
     FROM plays
     JOIN movies ON movies.id = plays.movie_id)
    +
    (SELECT COALESCE(SUM(COALESCE(tv_episodes.runtime, 0)), 0)
     FROM tv_episode_plays
     LEFT JOIN tv_episodes ON tv_episode_plays.episode_id = tv_episodes.id) AS total_runtime_minutes;
`;
    const row = queryOne(sql) ?? {};
    const movieTotalPlays = Number(row.movie_total_plays) || 0;
    const tvTotalPlays = Number(row.tv_total_plays) || 0;
    const movieUniqueTitles = Number(row.movie_unique_titles) || 0;
    const tvUniqueShows = Number(row.tv_unique_shows) || 0;
    const movieWatchlistCount = Number(row.movie_watchlist_count) || 0;
    const tvWatchlistCount = Number(row.tv_watchlist_count) || 0;
    const totalRuntimeMinutes = Number(row.total_runtime_minutes) || 0;
    return {
        movie_total_plays: movieTotalPlays,
        tv_total_plays: tvTotalPlays,
        movie_unique_titles: movieUniqueTitles,
        tv_unique_shows: tvUniqueShows,
        movie_watchlist_count: movieWatchlistCount,
        tv_watchlist_count: tvWatchlistCount,
        total_runtime_minutes: totalRuntimeMinutes,
        total_plays: movieTotalPlays + tvTotalPlays,
        unique_movies: movieUniqueTitles + tvUniqueShows,
        watchlist_count: movieWatchlistCount + tvWatchlistCount,
    };
}

export async function getTopPeopleByRole(roleType, limit = 8, metricMode = 'total', tvGranularity = 'show') {
    if (!roleType || typeof roleType !== 'string') {
        return [];
    }
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 8;
    const normalizedMetric = metricMode === 'unique' ? 'unique' : 'total';
    const normalizedTvGranularity = tvGranularity === 'episode' ? 'episode' : 'show';
    const scoreExpression = normalizedMetric === 'unique'
        ? (normalizedTvGranularity === 'episode'
            ? '(movie_unique_titles + tv_unique_episodes)'
            : '(movie_unique_titles + tv_unique_shows)')
        : (normalizedTvGranularity === 'episode'
            ? '(movie_total_plays + tv_episode_plays)'
            : '(movie_total_plays + tv_unique_shows)');
    const sql = `
WITH movie_stats AS (
    SELECT
        credits.person_id,
        credits.role_type,
        COUNT(plays.id) AS movie_total_plays,
        COUNT(DISTINCT plays.movie_id) AS movie_unique_titles
    FROM plays
    JOIN credits ON credits.movie_id = plays.movie_id
    GROUP BY credits.person_id, credits.role_type
),
tv_credit_rows AS (
    SELECT
        tv_credits.show_id,
        tv_credits.person_id,
        tv_credits.role_type,
        MAX(COALESCE(tv_credits.episode_count, 0)) AS credited_episode_count
    FROM tv_credits
    GROUP BY tv_credits.show_id, tv_credits.person_id, tv_credits.role_type
),
tv_show_play_stats AS (
    SELECT
        tv_episode_plays.show_id,
        COUNT(DISTINCT tv_episode_plays.id) AS watched_episode_plays,
        COUNT(DISTINCT tv_episode_plays.episode_id) AS watched_unique_episodes,
        COUNT(DISTINCT tv_episode_plays.show_id || ':' || tv_episodes.season_number) AS watched_season_plays
    FROM tv_episode_plays
    JOIN tv_episodes ON tv_episodes.id = tv_episode_plays.episode_id
    GROUP BY tv_episode_plays.show_id
),
tv_stats AS (
    SELECT
        tv_credit_rows.person_id,
        tv_credit_rows.role_type,
        SUM(
            CASE
                WHEN tv_credit_rows.credited_episode_count > 0
                    THEN MIN(tv_show_play_stats.watched_episode_plays, tv_credit_rows.credited_episode_count)
                ELSE tv_show_play_stats.watched_episode_plays
            END
        ) AS tv_episode_plays,
        SUM(
            CASE
                WHEN tv_credit_rows.credited_episode_count > 0
                    THEN MIN(tv_show_play_stats.watched_unique_episodes, tv_credit_rows.credited_episode_count)
                ELSE tv_show_play_stats.watched_unique_episodes
            END
        ) AS tv_unique_episodes,
        SUM(
            CASE
                WHEN tv_credit_rows.credited_episode_count > 0
                    THEN MIN(tv_show_play_stats.watched_season_plays, tv_credit_rows.credited_episode_count)
                ELSE tv_show_play_stats.watched_season_plays
            END
        ) AS tv_season_plays,
        COUNT(DISTINCT tv_credit_rows.show_id) AS tv_unique_shows
    FROM tv_credit_rows
    JOIN tv_show_play_stats ON tv_show_play_stats.show_id = tv_credit_rows.show_id
    GROUP BY tv_credit_rows.person_id, tv_credit_rows.role_type
),
combined AS (
    SELECT
        persons.id,
        persons.tmdb_person_id,
        persons.name,
        persons.profile_path,
        role_type,
        SUM(movie_total_plays) AS movie_total_plays,
        SUM(movie_unique_titles) AS movie_unique_titles,
        SUM(tv_episode_plays) AS tv_episode_plays,
        SUM(tv_unique_episodes) AS tv_unique_episodes,
        SUM(tv_season_plays) AS tv_season_plays,
        SUM(tv_unique_shows) AS tv_unique_shows
    FROM (
        SELECT
            person_id,
            role_type,
            movie_total_plays,
            movie_unique_titles,
            0 AS tv_episode_plays,
            0 AS tv_unique_episodes,
            0 AS tv_season_plays,
            0 AS tv_unique_shows
        FROM movie_stats
        UNION ALL
        SELECT
            person_id,
            role_type,
            0 AS movie_total_plays,
            0 AS movie_unique_titles,
            tv_episode_plays,
            tv_unique_episodes,
            tv_season_plays,
            tv_unique_shows
        FROM tv_stats
    ) rows
    JOIN persons ON persons.id = rows.person_id
    GROUP BY persons.id, persons.tmdb_person_id, persons.name, persons.profile_path, role_type
)
SELECT
    id,
    tmdb_person_id,
    name,
    profile_path,
    role_type,
    movie_total_plays,
    movie_unique_titles,
    tv_episode_plays,
    tv_unique_episodes,
    tv_season_plays,
    tv_unique_shows,
    ${scoreExpression} AS play_count,
    CASE
        WHEN ${toSqlLiteral(normalizedTvGranularity)} = 'episode'
            THEN (movie_unique_titles + tv_unique_episodes)
        ELSE (movie_unique_titles + tv_unique_shows)
    END AS unique_movies
FROM combined
WHERE role_type = ${toSqlLiteral(roleType)}
ORDER BY play_count DESC, name ASC
LIMIT ${safeLimit};
`;
    return queryAll(sql);
}

export async function getPeopleAppearanceStats() {
    const sql = `
WITH movie_stats AS (
    SELECT
        credits.person_id,
        credits.role_type,
        COUNT(plays.id) AS movie_total_plays,
        COUNT(DISTINCT plays.movie_id) AS movie_unique_titles
    FROM plays
    JOIN credits ON credits.movie_id = plays.movie_id
    GROUP BY credits.person_id, credits.role_type
),
tv_credit_rows AS (
    SELECT
        tv_credits.show_id,
        tv_credits.person_id,
        tv_credits.role_type,
        MAX(COALESCE(tv_credits.episode_count, 0)) AS credited_episode_count
    FROM tv_credits
    GROUP BY tv_credits.show_id, tv_credits.person_id, tv_credits.role_type
),
tv_show_play_stats AS (
    SELECT
        tv_episode_plays.show_id,
        COUNT(DISTINCT tv_episode_plays.id) AS watched_episode_plays,
        COUNT(DISTINCT tv_episode_plays.episode_id) AS watched_unique_episodes,
        COUNT(DISTINCT tv_episode_plays.show_id || ':' || tv_episodes.season_number) AS watched_season_plays
    FROM tv_episode_plays
    JOIN tv_episodes ON tv_episodes.id = tv_episode_plays.episode_id
    GROUP BY tv_episode_plays.show_id
),
tv_stats AS (
    SELECT
        tv_credit_rows.person_id,
        tv_credit_rows.role_type,
        SUM(
            CASE
                WHEN tv_credit_rows.credited_episode_count > 0
                    THEN MIN(tv_show_play_stats.watched_episode_plays, tv_credit_rows.credited_episode_count)
                ELSE tv_show_play_stats.watched_episode_plays
            END
        ) AS tv_episode_plays,
        SUM(
            CASE
                WHEN tv_credit_rows.credited_episode_count > 0
                    THEN MIN(tv_show_play_stats.watched_unique_episodes, tv_credit_rows.credited_episode_count)
                ELSE tv_show_play_stats.watched_unique_episodes
            END
        ) AS tv_unique_episodes,
        SUM(
            CASE
                WHEN tv_credit_rows.credited_episode_count > 0
                    THEN MIN(tv_show_play_stats.watched_season_plays, tv_credit_rows.credited_episode_count)
                ELSE tv_show_play_stats.watched_season_plays
            END
        ) AS tv_season_plays,
        COUNT(DISTINCT tv_credit_rows.show_id) AS tv_unique_shows
    FROM tv_credit_rows
    JOIN tv_show_play_stats ON tv_show_play_stats.show_id = tv_credit_rows.show_id
    GROUP BY tv_credit_rows.person_id, tv_credit_rows.role_type
),
combined AS (
    SELECT
        persons.id,
        persons.tmdb_person_id,
        persons.name,
        persons.profile_path,
        role_type,
        SUM(movie_total_plays) AS movie_total_plays,
        SUM(movie_unique_titles) AS movie_unique_titles,
        SUM(tv_episode_plays) AS tv_episode_plays,
        SUM(tv_unique_episodes) AS tv_unique_episodes,
        SUM(tv_season_plays) AS tv_season_plays,
        SUM(tv_unique_shows) AS tv_unique_shows
    FROM (
        SELECT
            person_id,
            role_type,
            movie_total_plays,
            movie_unique_titles,
            0 AS tv_episode_plays,
            0 AS tv_unique_episodes,
            0 AS tv_season_plays,
            0 AS tv_unique_shows
        FROM movie_stats
        UNION ALL
        SELECT
            person_id,
            role_type,
            0 AS movie_total_plays,
            0 AS movie_unique_titles,
            tv_episode_plays,
            tv_unique_episodes,
            tv_season_plays,
            tv_unique_shows
        FROM tv_stats
    ) rows
    JOIN persons ON persons.id = rows.person_id
    GROUP BY persons.id, persons.tmdb_person_id, persons.name, persons.profile_path, role_type
)
SELECT
    id,
    tmdb_person_id,
    name,
    profile_path,
    role_type,
    movie_total_plays + tv_season_plays AS total_appearances,
    movie_unique_titles + tv_unique_shows AS unique_movies,
    movie_total_plays,
    movie_unique_titles,
    tv_episode_plays,
    tv_unique_episodes,
    tv_season_plays,
    tv_unique_shows
FROM combined
WHERE role_type IN ('director', 'actor', 'producer', 'cinematographer', 'music_composer');
`;
    return queryAll(sql);
}

export async function removeFromWatchlist(titleId) {
    execute(`DELETE FROM watchlist WHERE movie_id = ${toSqlLiteral(titleId)};`);
}

export async function isInWatchlist(titleId) {
    const result = queryOne(`SELECT id FROM watchlist WHERE movie_id = ${toSqlLiteral(titleId)};`);
    return result !== null;
}

export async function getAllPlaces() {
    return queryAll('SELECT * FROM places ORDER BY name;');
}

export async function getAllWatchedTmdbIds() {
    const sql = `
SELECT DISTINCT movies.tmdb_id
FROM plays
JOIN movies ON movies.id = plays.movie_id;
`;
    const rows = queryAll(sql);
    return new Set(rows.map(row => row.tmdb_id));
}

export async function getAllWatchlistTmdbIds() {
    const sql = `
SELECT DISTINCT movies.tmdb_id
FROM watchlist
JOIN movies ON watchlist.movie_id = movies.id;
`;
    const rows = queryAll(sql);
    return new Set(rows.map(row => row.tmdb_id));
}

export async function getAllWatchedTitleKeys() {
    const rows = queryAll(`
SELECT movies.tmdb_id, 'movie' AS media_type
FROM plays
JOIN movies ON movies.id = plays.movie_id
WHERE movies.tmdb_id IS NOT NULL
UNION ALL
SELECT tv_shows.tmdb_id, 'tv' AS media_type
FROM tv_episode_plays
JOIN tv_shows ON tv_shows.id = tv_episode_plays.show_id
WHERE tv_shows.tmdb_id IS NOT NULL;
`);
    return new Set(rows.map(row => `${row.media_type}:${row.tmdb_id}`));
}

export async function getAllWatchlistTitleKeys() {
    const rows = queryAll(`
SELECT movies.tmdb_id, 'movie' AS media_type
FROM watchlist
JOIN movies ON watchlist.movie_id = movies.id
WHERE movies.tmdb_id IS NOT NULL
UNION ALL
SELECT tv_shows.tmdb_id, 'tv' AS media_type
FROM tv_watchlist
JOIN tv_shows ON tv_watchlist.show_id = tv_shows.id
WHERE tv_shows.tmdb_id IS NOT NULL;
`);
    return new Set(rows.map(row => `${row.media_type}:${row.tmdb_id}`));
}

export async function addPlace(name, isCinema = false) {
    const now = new Date().toISOString();
    const sql = `
INSERT INTO places (name, is_cinema, created_at)
VALUES (${toSqlLiteral(name)}, ${toSqlLiteral(isCinema ? 1 : 0)}, ${toSqlLiteral(now)});
`;
    execute(sql);
}

export async function updatePlace(id, name, isCinema) {
    const sql = `
UPDATE places
SET name = ${toSqlLiteral(name)}, is_cinema = ${toSqlLiteral(isCinema ? 1 : 0)}
WHERE id = ${toSqlLiteral(id)};
`;
    execute(sql);
}

export async function deletePlace(id) {
    execute(`DELETE FROM places WHERE id = ${toSqlLiteral(id)};`);
}

export async function upsertTvShow(details) {
    const tmdbId = Number(details?.id);
    if (!Number.isFinite(tmdbId)) {
        throw new Error('TMDB TV show id is missing.');
    }

    const now = new Date().toISOString();
    const sql = `
INSERT INTO tv_shows (
    tmdb_id,
    imdb_id,
    name,
    original_name,
    poster_path,
    backdrop_path,
    tagline,
    overview,
    original_language,
    genres,
    first_air_date,
    last_air_date,
    status,
    number_of_seasons,
    number_of_episodes,
    tmdb_average,
    tmdb_vote_count,
    created_at,
    updated_at
) VALUES (
    ${toSqlLiteral(tmdbId)},
    ${toSqlLiteral(details?.imdb_id || details?.external_ids?.imdb_id || null)},
    ${toSqlLiteral(details?.name || details?.title || 'Untitled')},
    ${toSqlLiteral(details?.original_name || details?.name || null)},
    ${toSqlLiteral(details?.poster_path || null)},
    ${toSqlLiteral(details?.backdrop_path || null)},
    ${toSqlLiteral(details?.tagline || null)},
    ${toSqlLiteral(details?.overview || null)},
    ${toSqlLiteral(details?.original_language || null)},
    ${toSqlLiteral(Array.isArray(details?.genres) ? details.genres.map(genre => genre?.name).filter(name => Boolean(name)).join(', ') : '')},
    ${toSqlLiteral(details?.first_air_date || null)},
    ${toSqlLiteral(details?.last_air_date || null)},
    ${toSqlLiteral(details?.status || null)},
    ${toSqlLiteral(details?.number_of_seasons || null)},
    ${toSqlLiteral(details?.number_of_episodes || null)},
    ${toSqlLiteral(details?.vote_average || null)},
    ${toSqlLiteral(details?.vote_count || null)},
    ${toSqlLiteral(now)},
    ${toSqlLiteral(now)}
)
ON CONFLICT(tmdb_id) DO UPDATE SET
    imdb_id = excluded.imdb_id,
    name = excluded.name,
    original_name = excluded.original_name,
    poster_path = excluded.poster_path,
    backdrop_path = excluded.backdrop_path,
    tagline = excluded.tagline,
    overview = excluded.overview,
    original_language = excluded.original_language,
    genres = excluded.genres,
    first_air_date = excluded.first_air_date,
    last_air_date = excluded.last_air_date,
    status = excluded.status,
    number_of_seasons = excluded.number_of_seasons,
    number_of_episodes = excluded.number_of_episodes,
    tmdb_average = excluded.tmdb_average,
    tmdb_vote_count = excluded.tmdb_vote_count,
    updated_at = excluded.updated_at;
`;
    execute(sql);

    const row = queryOne(`
SELECT id
FROM tv_shows
WHERE tmdb_id = ${toSqlLiteral(tmdbId)};
`);
    if (!row?.id) {
        throw new Error('Failed to locate tv show after upsert.');
    }
    return row.id;
}

export async function findTvShowByTmdbId(tmdbId) {
    return queryOne(`
SELECT *
FROM tv_shows
WHERE tmdb_id = ${toSqlLiteral(tmdbId)};
`);
}

export async function getTvShowById(showId) {
    return queryOne(`
SELECT *
FROM tv_shows
WHERE id = ${toSqlLiteral(showId)};
`);
}

export async function upsertTvShowSeasons(showId, seasons) {
    if (!Number.isFinite(Number(showId)) || !Array.isArray(seasons)) {
        return;
    }

    for (const season of seasons) {
        const sql = `
INSERT INTO tv_seasons (
    show_id,
    tmdb_season_id,
    season_number,
    name,
    overview,
    air_date,
    poster_path,
    episode_count,
    vote_average,
    vote_count,
    updated_at
) VALUES (
    ${toSqlLiteral(showId)},
    ${toSqlLiteral(season?.id ?? null)},
    ${toSqlLiteral(season?.season_number ?? 0)},
    ${toSqlLiteral(season?.name ?? null)},
    ${toSqlLiteral(season?.overview ?? null)},
    ${toSqlLiteral(season?.air_date ?? null)},
    ${toSqlLiteral(season?.poster_path ?? null)},
    ${toSqlLiteral(season?.episode_count ?? null)},
    ${toSqlLiteral(season?.vote_average ?? null)},
    ${toSqlLiteral(season?.vote_count ?? null)},
    ${toSqlLiteral(new Date().toISOString())}
)
ON CONFLICT(show_id, season_number) DO UPDATE SET
    tmdb_season_id = excluded.tmdb_season_id,
    name = excluded.name,
    overview = excluded.overview,
    air_date = excluded.air_date,
    poster_path = excluded.poster_path,
    episode_count = excluded.episode_count,
    vote_average = excluded.vote_average,
    vote_count = excluded.vote_count,
    updated_at = excluded.updated_at;
`;
        execute(sql);
    }
}

export async function upsertTvShowSeasonEpisodes(showId, seasonNumber, episodes) {
    if (!Number.isFinite(Number(showId)) || !Number.isFinite(Number(seasonNumber)) || !Array.isArray(episodes)) {
        return;
    }

    const seasonRow = queryOne(`
SELECT id
FROM tv_seasons
WHERE show_id = ${toSqlLiteral(showId)}
  AND season_number = ${toSqlLiteral(seasonNumber)};
`);
    if (!seasonRow?.id) {
        return;
    }

    for (const episode of episodes) {
        const episodeCrew = Array.isArray(episode?.crew) ? episode.crew : [];
        const directorNames = [...new Set(episodeCrew
            .filter(member => String(member?.job || '').trim() === 'Director')
            .map(member => String(member?.name || '').trim())
            .filter(name => name.length > 0)
        )].join(', ') || null;
        const writerNames = [...new Set(episodeCrew
            .filter(member => {
                const normalizedJob = String(member?.job || '').trim();
                const normalizedDepartment = String(member?.department || '').trim();
                return normalizedDepartment === 'Writing'
                    || normalizedJob === 'Writer'
                    || normalizedJob === 'Screenplay'
                    || normalizedJob === 'Story'
                    || normalizedJob === 'Teleplay';
            })
            .map(member => String(member?.name || '').trim())
            .filter(name => name.length > 0)
        )].join(', ') || null;

        const sql = `
INSERT INTO tv_episodes (
    show_id,
    season_id,
    tmdb_episode_id,
    season_number,
    episode_number,
    name,
    overview,
    air_date,
    runtime,
    still_path,
    director_names,
    writer_names,
    vote_average,
    vote_count,
    updated_at
) VALUES (
    ${toSqlLiteral(showId)},
    ${toSqlLiteral(seasonRow.id)},
    ${toSqlLiteral(episode?.id ?? null)},
    ${toSqlLiteral(seasonNumber)},
    ${toSqlLiteral(episode?.episode_number ?? 0)},
    ${toSqlLiteral(episode?.name || 'Untitled Episode')},
    ${toSqlLiteral(episode?.overview ?? null)},
    ${toSqlLiteral(episode?.air_date ?? null)},
    ${toSqlLiteral(episode?.runtime ?? null)},
    ${toSqlLiteral(episode?.still_path ?? null)},
    ${toSqlLiteral(directorNames)},
    ${toSqlLiteral(writerNames)},
    ${toSqlLiteral(episode?.vote_average ?? null)},
    ${toSqlLiteral(episode?.vote_count ?? null)},
    ${toSqlLiteral(new Date().toISOString())}
)
ON CONFLICT(show_id, season_number, episode_number) DO UPDATE SET
    tmdb_episode_id = excluded.tmdb_episode_id,
    name = excluded.name,
    overview = excluded.overview,
    air_date = excluded.air_date,
    runtime = excluded.runtime,
    still_path = excluded.still_path,
    director_names = excluded.director_names,
    writer_names = excluded.writer_names,
    vote_average = excluded.vote_average,
    vote_count = excluded.vote_count,
    updated_at = excluded.updated_at;
`;
        execute(sql);
    }
}

export async function upsertTvCredits(showId, credits) {
    if (!Number.isFinite(Number(showId)) || !Array.isArray(credits)) {
        return;
    }

    execute(`DELETE FROM tv_credits WHERE show_id = ${toSqlLiteral(showId)};`);
    for (const credit of credits) {
        const sql = `
INSERT INTO tv_credits (show_id, person_id, role_type, character_name, display_order, episode_count)
VALUES (
    ${toSqlLiteral(showId)},
    ${toSqlLiteral(credit.person_id)},
    ${toSqlLiteral(credit.role_type)},
    ${toSqlLiteral(credit.character_name)},
    ${toSqlLiteral(credit.display_order)},
    ${toSqlLiteral(credit.episode_count ?? null)}
);
`;
        execute(sql);
    }
}

export async function getTvCredits(showId) {
    const sql = `
SELECT
    tv_credits.id,
    tv_credits.role_type,
    tv_credits.character_name,
    tv_credits.display_order,
    tv_credits.episode_count,
    persons.id as person_id,
    persons.tmdb_person_id,
    persons.name as person_name,
    persons.profile_path
FROM tv_credits
JOIN persons ON tv_credits.person_id = persons.id
WHERE tv_credits.show_id = ${toSqlLiteral(showId)}
ORDER BY tv_credits.role_type, tv_credits.display_order;
`;
    return queryAll(sql);
}

export async function getTvSeasonsWithEpisodes(showId) {
    const seasons = queryAll(`
SELECT
    id,
    season_number,
    name,
    overview,
    air_date,
    poster_path,
    episode_count,
    vote_average,
    vote_count
FROM tv_seasons
WHERE show_id = ${toSqlLiteral(showId)}
ORDER BY season_number ASC;
`);

    const output = [];
    for (const season of seasons) {
        const episodes = queryAll(`
SELECT
    id,
    season_number,
    episode_number,
    name,
    overview,
    air_date,
    runtime,
    still_path,
    director_names,
    writer_names,
    vote_average,
    vote_count
FROM tv_episodes
WHERE show_id = ${toSqlLiteral(showId)}
  AND season_number = ${toSqlLiteral(season.season_number)}
ORDER BY episode_number ASC;
`);

        output.push({
            ...season,
            episodes,
        });
    }
    return output;
}

export async function getTvProgress(showId) {
    const row = queryOne(`
SELECT
    (SELECT COUNT(*) FROM tv_episodes WHERE show_id = ${toSqlLiteral(showId)}) AS total_episodes,
    (SELECT COUNT(DISTINCT tv_episode_plays.episode_id)
     FROM tv_episode_plays
     WHERE tv_episode_plays.show_id = ${toSqlLiteral(showId)}) AS watched_episodes
`);
    return {
        total_episodes: Number(row?.total_episodes) || 0,
        watched_episodes: Number(row?.watched_episodes) || 0,
    };
}

export async function addTvShowToWatchlist(showId) {
    const now = new Date().toISOString();
    execute(`
INSERT INTO tv_watchlist (show_id, created_at)
SELECT ${toSqlLiteral(showId)}, ${toSqlLiteral(now)}
WHERE NOT EXISTS (
    SELECT 1 FROM tv_watchlist WHERE show_id = ${toSqlLiteral(showId)}
);
`);
}

export async function removeTvShowFromWatchlist(showId) {
    execute(`DELETE FROM tv_watchlist WHERE show_id = ${toSqlLiteral(showId)};`);
}

export async function isTvShowInWatchlist(showId) {
    return queryOne(`SELECT id FROM tv_watchlist WHERE show_id = ${toSqlLiteral(showId)};`) !== null;
}

export async function addTvEpisodePlay(showId, episodeId, watchedDate, placeId = null, comment = null) {
    const watchOrder = getNextGlobalWatchOrderForDate(watchedDate);
    execute(`
INSERT INTO tv_episode_plays (show_id, episode_id, watched_at, watch_order, place_id, comment)
VALUES (
    ${toSqlLiteral(showId)},
    ${toSqlLiteral(episodeId)},
    ${toSqlLiteral(watchedDate)},
    ${toSqlLiteral(watchOrder)},
    ${toSqlLiteral(placeId)},
    ${toSqlLiteral(comment)}
);
`);
}

export async function addTvSeasonPlays(showId, seasonNumber, watchedDate, placeId = null, comment = null) {
    const episodes = queryAll(`
SELECT id
FROM tv_episodes
WHERE show_id = ${toSqlLiteral(showId)}
  AND season_number = ${toSqlLiteral(seasonNumber)}
ORDER BY episode_number ASC;
`);
    if (episodes.length === 0) {
        throw new Error('No episodes found for selected season.');
    }

    let currentOrder = getNextGlobalWatchOrderForDate(watchedDate) - 1;

    for (const episode of episodes) {
        currentOrder += 1;
        execute(`
INSERT INTO tv_episode_plays (show_id, episode_id, watched_at, watch_order, place_id, comment)
VALUES (
    ${toSqlLiteral(showId)},
    ${toSqlLiteral(episode.id)},
    ${toSqlLiteral(watchedDate)},
    ${toSqlLiteral(currentOrder)},
    ${toSqlLiteral(placeId)},
    ${toSqlLiteral(comment)}
);
`);
    }
}

export async function getTvPlaysForShow(showId) {
    return queryAll(`
SELECT
    tv_episode_plays.id,
    tv_episode_plays.watched_at,
    tv_episode_plays.watch_order,
    tv_episode_plays.place_id,
    tv_episode_plays.comment,
    tv_episodes.season_number,
    tv_episodes.episode_number,
    tv_episodes.name AS episode_name,
    places.name AS place_name,
    places.is_cinema
FROM tv_episode_plays
JOIN tv_episodes ON tv_episode_plays.episode_id = tv_episodes.id
LEFT JOIN places ON tv_episode_plays.place_id = places.id
WHERE tv_episode_plays.show_id = ${toSqlLiteral(showId)}
ORDER BY tv_episode_plays.watched_at DESC, tv_episode_plays.watch_order DESC;
`);
}

export async function updateTvEpisodePlay(playId, watchedDate, placeId = null, watchOrder = 1, comment = null) {
    execute(`
UPDATE tv_episode_plays
SET watched_at = ${toSqlLiteral(watchedDate)},
    place_id = ${toSqlLiteral(placeId)},
    watch_order = ${toSqlLiteral(watchOrder)},
    comment = ${toSqlLiteral(comment)}
WHERE id = ${toSqlLiteral(playId)};
`);
}

export async function deleteTvEpisodePlay(playId) {
    execute(`DELETE FROM tv_episode_plays WHERE id = ${toSqlLiteral(playId)};`);
}
