import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const session = new Soup.Session();

function sendAndReadAsync(message) {
    return new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (_session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                resolve(bytes);
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function fetchText(url) {
    const message = Soup.Message.new('GET', url);
    message.request_headers.append(
        'User-Agent',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );
    message.request_headers.append(
        'Accept',
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    );
    message.request_headers.append('Accept-Language', 'en-US,en;q=0.9');
    message.request_headers.append('Referer', 'https://www.imdb.com/');
    const bytes = await sendAndReadAsync(message);
    const status = message.get_status();
    if (status < 200 || status >= 300) {
        throw new Error(`HTTP request failed with status ${status}.`);
    }
    const data = bytes.get_data();
    return new TextDecoder('utf-8').decode(data);
}

function extractAggregateRating(jsonNode) {
    if (!jsonNode || typeof jsonNode !== 'object')
        return null;

    if (Array.isArray(jsonNode)) {
        for (const item of jsonNode) {
            const match = extractAggregateRating(item);
            if (match) {
                return match;
            }
        }
        return null;
    }

    const aggregateRating = jsonNode.aggregateRating;
    if (aggregateRating && typeof aggregateRating === 'object') {
        const ratingValue = Number(aggregateRating.ratingValue);
        const ratingCount = Number(String(aggregateRating.ratingCount || '').replace(/,/g, ''));
        const bestRating = Number(aggregateRating.bestRating || 10);
        if (Number.isFinite(ratingValue)) {
            return {
                value: ratingValue,
                count: Number.isFinite(ratingCount) ? ratingCount : null,
                best: Number.isFinite(bestRating) ? bestRating : 10,
            };
        }
    }

    if (Array.isArray(jsonNode['@graph'])) {
        const graphMatch = extractAggregateRating(jsonNode['@graph']);
        if (graphMatch) {
            return graphMatch;
        }
    }

    return null;
}

export async function scrapeImdbRating(imdbId) {
    const normalizedImdbId = String(imdbId || '').trim();
    if (!/^tt\d+$/.test(normalizedImdbId)) {
        return null;
    }

    const url = `https://www.imdb.com/title/${encodeURIComponent(normalizedImdbId)}/`;
    const html = await fetchText(url);
    const scriptPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

    for (const match of html.matchAll(scriptPattern)) {
        const scriptText = String(match[1] || '').trim();
        if (!scriptText) {
            continue;
        }

        try {
            const parsedJson = JSON.parse(scriptText);
            const rating = extractAggregateRating(parsedJson);
            if (rating) {
                return rating;
            }
        } catch {
            // Ignore malformed script tags and continue parsing.
        }
    }

    return null;
}
