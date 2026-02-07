import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const DEFAULT_LANGUAGE = 'en-US';
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const PROFILE_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w185';

const session = new Soup.Session();

function getApiKey() {
    try {
        const settings = new Gio.Settings({ schema_id: 'app.memento.memento' });
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

export async function searchMovies(query) {
    const apiKey = getApiKey();
    const encodedQuery = encodeURIComponent(query.trim());
    const url = `${TMDB_BASE_URL}/search/movie?query=${encodedQuery}&include_adult=false&language=${DEFAULT_LANGUAGE}&page=1&api_key=${apiKey}`;
    const payload = await fetchJson(url);
    return payload.results ?? [];
}

export async function getMovieDetails(tmdbId) {
    const apiKey = getApiKey();
    const url = `${TMDB_BASE_URL}/movie/${encodeURIComponent(tmdbId)}?language=${DEFAULT_LANGUAGE}&api_key=${apiKey}`;
    return fetchJson(url);
}

export async function getMovieCredits(tmdbId) {
    const apiKey = getApiKey();
    const url = `${TMDB_BASE_URL}/movie/${encodeURIComponent(tmdbId)}/credits?language=${DEFAULT_LANGUAGE}&api_key=${apiKey}`;
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

export function buildLetterboxdUrl(imdbId, title) {
    if (!imdbId)
        return null;
    // Letterboxd uses the IMDb ID in the URL
    const imdbNumber = imdbId.replace('tt', '');
    return `https://letterboxd.com/imdb/${imdbNumber}/`;
}

