import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const DEFAULT_LANGUAGE = 'en-US';
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const PROFILE_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w185';
const STILL_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w780';
const SETTINGS_SCHEMA_ID = (GLib.getenv('FLATPAK_ID') || '').endsWith('.Devel')
    ? 'io.github.ans_ibrahim.Memento.Devel'
    : 'io.github.ans_ibrahim.Memento';

const session = new Soup.Session();

function normalizeTmdbLanguage(localeName) {
    const locale = String(localeName || '')
        .trim()
        .replace('.', '-')
        .replace('_', '-');
    if (!locale) {
        return null;
    }

    const [languagePart, regionPart] = locale.split('-');
    if (!/^[A-Za-z]{2}$/.test(languagePart || '')) {
        return null;
    }

    const languageCode = languagePart.toLowerCase();
    if (regionPart && /^[A-Za-z]{2}$/.test(regionPart)) {
        return `${languageCode}-${regionPart.toUpperCase()}`;
    }

    return languageCode;
}

function getTmdbLanguage() {
    try {
        const localeNames = GLib.get_language_names();
        for (const localeName of localeNames) {
            const normalizedLanguage = normalizeTmdbLanguage(localeName);
            if (normalizedLanguage) {
                return normalizedLanguage;
            }
        }
    } catch (error) {
        console.warn('Failed to detect system locale for TMDB language:', error);
    }

    return DEFAULT_LANGUAGE;
}

function getApiKey() {
    try {
        const settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA_ID });
        const customKey = settings.get_string('tmdb-api-key');
        
        if (customKey && customKey.length > 0) {
            return customKey;
        }
    } catch (error) {
        console.warn('Failed to read API key from settings:', error);
    }
    
    // No API key configured
    console.warn('TMDB API key not configured. Please set it in Preferences.');
    return '';
}

function sendAndReadAsync(message) {
    return new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            try {
                const bytes = session.send_and_read_finish(res);
                resolve(bytes);
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function fetchJson(url) {
    const message = Soup.Message.new('GET', url);
    const bytes = await sendAndReadAsync(message);
    const status = message.get_status();
    if (status < 200 || status >= 300) {
        throw new Error(`TMDB request failed with status ${status}.`);
    }
    const data = bytes.get_data();
    const decoded = new TextDecoder('utf-8').decode(data);
    return JSON.parse(decoded);
}

function normalizeTvStandardCredits(payload) {
    const cast = Array.isArray(payload?.cast) ? payload.cast.map(member => ({
        id: member?.id,
        name: member?.name,
        profile_path: member?.profile_path || null,
        character: member?.character || null,
        order: Number(member?.order) || 0,
        total_episode_count: Number(member?.total_episode_count) || Number(member?.episode_count) || null,
    })) : [];
    const crew = Array.isArray(payload?.crew) ? payload.crew.map(member => ({
        id: member?.id,
        name: member?.name,
        profile_path: member?.profile_path || null,
        job: member?.job || null,
        department: member?.department || null,
        total_episode_count: Number(member?.total_episode_count) || Number(member?.episode_count) || null,
    })) : [];
    return {cast, crew};
}

function normalizeTvAggregateCredits(payload) {
    const castSource = Array.isArray(payload?.cast) ? payload.cast : [];
    const cast = castSource.map(member => {
        const roles = Array.isArray(member?.roles) ? member.roles : [];
        const totalEpisodes = roles.reduce((sum, role) => sum + (Number(role?.episode_count) || 0), 0);
        const firstRoleWithCharacter = roles.find(role => String(role?.character || '').trim().length > 0) || roles[0] || null;
        return {
            id: member?.id,
            name: member?.name,
            profile_path: member?.profile_path || null,
            character: firstRoleWithCharacter?.character || member?.character || null,
            order: Number(member?.order) || 0,
            total_episode_count: totalEpisodes > 0 ? totalEpisodes : null,
        };
    });

    const crewSource = Array.isArray(payload?.crew) ? payload.crew : [];
    const crew = [];
    for (const member of crewSource) {
        const jobs = Array.isArray(member?.jobs) ? member.jobs : [];
        if (jobs.length === 0) {
            crew.push({
                id: member?.id,
                name: member?.name,
                profile_path: member?.profile_path || null,
                job: member?.job || member?.department || null,
                department: member?.department || null,
                total_episode_count: Number(member?.total_episode_count) || Number(member?.episode_count) || null,
            });
            continue;
        }
        for (const job of jobs) {
            crew.push({
                id: member?.id,
                name: member?.name,
                profile_path: member?.profile_path || null,
                job: job?.job || member?.department || null,
                department: member?.department || null,
                total_episode_count: Number(job?.episode_count) || Number(member?.total_episode_count) || Number(member?.episode_count) || null,
            });
        }
    }

    cast.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    return {cast, crew};
}

export async function searchMovies(query) {
    const apiKey = getApiKey();
    const tmdbLanguage = getTmdbLanguage();
    const encodedQuery = encodeURIComponent(query.trim());
    const url = `${TMDB_BASE_URL}/search/movie?query=${encodedQuery}&include_adult=false&language=${tmdbLanguage}&page=1&api_key=${apiKey}`;
    const payload = await fetchJson(url);
    return payload.results ?? [];
}

export async function searchTitles(query) {
    const apiKey = getApiKey();
    const tmdbLanguage = getTmdbLanguage();
    const encodedQuery = encodeURIComponent(query.trim());
    const url = `${TMDB_BASE_URL}/search/multi?query=${encodedQuery}&include_adult=false&language=${tmdbLanguage}&page=1&api_key=${apiKey}`;
    const payload = await fetchJson(url);
    const results = Array.isArray(payload.results) ? payload.results : [];
    return results.filter(item => item?.media_type === 'movie' || item?.media_type === 'tv');
}

export async function getMovieDetails(tmdbId) {
    const apiKey = getApiKey();
    const tmdbLanguage = getTmdbLanguage();
    const url = `${TMDB_BASE_URL}/movie/${encodeURIComponent(tmdbId)}?language=${tmdbLanguage}&api_key=${apiKey}`;
    return fetchJson(url);
}

export async function getTvDetails(tmdbId) {
    const apiKey = getApiKey();
    const tmdbLanguage = getTmdbLanguage();
    const url = `${TMDB_BASE_URL}/tv/${encodeURIComponent(tmdbId)}?language=${tmdbLanguage}&append_to_response=external_ids&api_key=${apiKey}`;
    const payload = await fetchJson(url);
    if (!payload.imdb_id && payload?.external_ids?.imdb_id) {
        payload.imdb_id = payload.external_ids.imdb_id;
    }
    return payload;
}

export async function getTitleDetails(tmdbId, mediaType = 'movie') {
    if (mediaType === 'tv')
        return getTvDetails(tmdbId);
    return getMovieDetails(tmdbId);
}

export async function getMovieCredits(tmdbId) {
    const apiKey = getApiKey();
    const tmdbLanguage = getTmdbLanguage();
    const url = `${TMDB_BASE_URL}/movie/${encodeURIComponent(tmdbId)}/credits?language=${tmdbLanguage}&api_key=${apiKey}`;
    return fetchJson(url);
}

export async function getTvCredits(tmdbId) {
    const apiKey = getApiKey();
    const tmdbLanguage = getTmdbLanguage();
    const aggregateUrl = `${TMDB_BASE_URL}/tv/${encodeURIComponent(tmdbId)}/aggregate_credits?language=${tmdbLanguage}&api_key=${apiKey}`;
    try {
        const aggregatePayload = await fetchJson(aggregateUrl);
        const normalizedAggregate = normalizeTvAggregateCredits(aggregatePayload);
        if (normalizedAggregate.cast.length > 0 || normalizedAggregate.crew.length > 0) {
            return normalizedAggregate;
        }
    } catch {
        // Fall through to regular credits endpoint for compatibility.
    }

    const creditsUrl = `${TMDB_BASE_URL}/tv/${encodeURIComponent(tmdbId)}/credits?language=${tmdbLanguage}&api_key=${apiKey}`;
    const creditsPayload = await fetchJson(creditsUrl);
    return normalizeTvStandardCredits(creditsPayload);
}

export async function getTitleCredits(tmdbId, mediaType = 'movie') {
    if (mediaType === 'tv')
        return getTvCredits(tmdbId);
    return getMovieCredits(tmdbId);
}

export async function getTvSeasonDetails(tvTmdbId, seasonNumber) {
    const apiKey = getApiKey();
    const tmdbLanguage = getTmdbLanguage();
    const url = `${TMDB_BASE_URL}/tv/${encodeURIComponent(tvTmdbId)}/season/${encodeURIComponent(seasonNumber)}?language=${tmdbLanguage}&api_key=${apiKey}`;
    return fetchJson(url);
}

export async function getPersonDetails(personId) {
    const apiKey = getApiKey();
    const tmdbLanguage = getTmdbLanguage();
    const url = `${TMDB_BASE_URL}/person/${encodeURIComponent(personId)}?language=${tmdbLanguage}&api_key=${apiKey}`;
    return fetchJson(url);
}

export async function getPersonMovieCredits(personId) {
    const apiKey = getApiKey();
    const tmdbLanguage = getTmdbLanguage();
    const url = `${TMDB_BASE_URL}/person/${encodeURIComponent(personId)}/movie_credits?language=${tmdbLanguage}&api_key=${apiKey}`;
    return fetchJson(url);
}

export async function getPersonTitleCredits(personId) {
    const apiKey = getApiKey();
    const tmdbLanguage = getTmdbLanguage();
    const url = `${TMDB_BASE_URL}/person/${encodeURIComponent(personId)}/combined_credits?language=${tmdbLanguage}&api_key=${apiKey}`;
    return fetchJson(url);
}

export function buildPosterUrl(posterPath) {
    if (!posterPath)
        return null;
    return `${IMAGE_BASE_URL}${posterPath}`;
}

export function buildProfileUrl(profilePath) {
    if (!profilePath)
        return null;
    return `${PROFILE_IMAGE_BASE_URL}${profilePath}`;
}

export function buildStillUrl(stillPath) {
    if (!stillPath)
        return null;
    return `${STILL_IMAGE_BASE_URL}${stillPath}`;
}

export function buildImdbUrl(imdbId) {
    if (!imdbId)
        return null;
    return `https://www.imdb.com/title/${imdbId}/`;
}

export function buildTmdbUrl(tmdbId) {
    if (!tmdbId)
        return null;
    return `https://www.themoviedb.org/movie/${tmdbId}`;
}

export function buildTmdbTitleUrl(tmdbId, mediaType = 'movie') {
    if (!tmdbId)
        return null;
    if (mediaType === 'tv')
        return `https://www.themoviedb.org/tv/${tmdbId}`;
    return `https://www.themoviedb.org/movie/${tmdbId}`;
}

export function buildLetterboxdUrl(imdbId) {
    const normalizedImdbId = String(imdbId || '').trim();
    if (!/^tt\d+$/.test(normalizedImdbId))
        return null;
    return `https://letterboxd.com/imdb/${normalizedImdbId}/`;
}
