import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { getTitleDetails, getTitleCredits, getTvSeasonDetails } from '../services/tmdb-service.js';
import { scrapeImdbRating } from '../services/imdb-service.js';
import {
    getAllTitlesForRefresh,
    getAllTitlesWithImdbIds,
    upsertMovieFromTmdb,
    upsertTvShowFromTmdb,
    upsertTvSeasons,
    upsertSeasonEpisodes,
    upsertPerson,
    upsertMovieCredits,
    upsertTvCredits,
    updateMovieImdbRating,
    updateTvShowImdbRating,
} from '../utils/database-utils.js';

const SETTINGS_SCHEMA_ID = (GLib.getenv('FLATPAK_ID') || '').endsWith('.Devel')
    ? 'io.github.ans_ibrahim.Memento.Devel'
    : 'io.github.ans_ibrahim.Memento';

export const MementoPreferencesDialog = GObject.registerClass({
    GTypeName: 'MementoPreferencesDialog',
    Template: 'resource:///app/memento/memento/pages/preferences-page.ui',
    InternalChildren: [
        'api_key_row',
        'auto_remove_switch',
        'tmdb_rating_switch',
        'imdb_rating_switch',
        'people_metric_dropdown',
        'people_tv_episode_level_switch',
        'refresh_all_button',
        'refresh_progress_bar',
        'refresh_progress_row',
        'refresh_imdb_ratings_button',
        'refresh_imdb_progress_bar',
        'refresh_imdb_progress_row',
    ],
}, class MementoPreferencesDialog extends Adw.Dialog {
    constructor(params = {}) {
        super(params);
        this._settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA_ID });
        this._refreshInProgress = false;
        this._refreshImdbInProgress = false;
        this._setupBindings();
        this._loadApiKey();
        this._loadPeopleMetricPreference();
        this._setupPeopleMetricPreference();
        this._setupRefreshAllTitles();
        this._setupRefreshAllImdbRatings();
    }

    _loadPeopleMetricPreference() {
        const metric = this._settings.get_string('dashboard-people-metric');
        this._people_metric_dropdown.set_selected(metric === 'unique' ? 1 : 0);
    }

    _setupPeopleMetricPreference() {
        this._people_metric_dropdown.connect('notify::selected', () => {
            const selectedIndex = Number(this._people_metric_dropdown.get_selected());
            const metric = selectedIndex === 1 ? 'unique' : 'total';
            this._settings.set_string('dashboard-people-metric', metric);
        });
    }

    _setupBindings() {
        // Bind auto-remove switch to settings
        this._settings.bind(
            'auto-remove-from-watchlist',
            this._auto_remove_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'enable-tmdb-rating',
            this._tmdb_rating_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'enable-imdb-rating',
            this._imdb_rating_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'dashboard-people-tv-episode-level',
            this._people_tv_episode_level_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
    }

    _loadApiKey() {
        // Load API key into entry (load on demand, don't bind for security)
        const apiKey = this._settings.get_string('tmdb-api-key');
        if (apiKey) {
            this._api_key_row.set_text(apiKey);
        }
    }

    _onApiKeyApply() {
        // Save API key when apply button is clicked
        const apiKey = this._api_key_row.get_text();
        this._settings.set_string('tmdb-api-key', apiKey);

        this._showToast(_('API key saved'), 2);
    }

    _onGetApiKeyActivated() {
        // Open TMDG API documentation
        const launcher = new Gtk.UriLauncher({
            uri: 'https://www.themoviedb.org/settings/api',
        });
        launcher.launch(this.get_root(), null, null);
    }

    _setupRefreshAllTitles() {
        this._refresh_all_button.connect('clicked', () => {
            this._refreshAllTitles();
        });
    }

    _setupRefreshAllImdbRatings() {
        this._refresh_imdb_ratings_button.connect('clicked', () => {
            this._refreshAllImdbRatings();
        });
    }

    _setRefreshUiState(isRunning) {
        this._refresh_progress_row.set_visible(isRunning);
        this._refresh_all_button.set_sensitive(!isRunning);

        if (!isRunning) {
            this._refresh_progress_bar.set_fraction(0);
            this._refresh_progress_bar.set_text('');
        }
    }

    _setRefreshImdbUiState(isRunning) {
        this._refresh_imdb_progress_row.set_visible(isRunning);
        this._refresh_imdb_ratings_button.set_sensitive(!isRunning);

        if (!isRunning) {
            this._refresh_imdb_progress_bar.set_fraction(0);
            this._refresh_imdb_progress_bar.set_text('');
        }
    }

    async _refreshAllTitles() {
        if (this._refreshInProgress) {
            return;
        }

        this._refreshInProgress = true;
        this._setRefreshUiState(true);
        this._refresh_progress_bar.set_text(_('Starting...'));

        let titleRefs = [];
        try {
            titleRefs = await getAllTitlesForRefresh();
        } catch (error) {
            this._setRefreshUiState(false);
            this._refreshInProgress = false;
            this._showToast(_('Failed to load titles list'), 3);
            return;
        }

        if (titleRefs.length === 0) {
            this._setRefreshUiState(false);
            this._refreshInProgress = false;
            this._showToast(_('No titles to refresh'), 2);
            return;
        }

        let completed = 0;
        let failed = 0;

        for (const titleRef of titleRefs) {
            try {
                const tmdbId = Number(titleRef.tmdb_id);
                const mediaType = titleRef.media_type === 'tv' ? 'tv' : 'movie';
                const details = await getTitleDetails(tmdbId, mediaType);
                const credits = await getTitleCredits(tmdbId, mediaType);
                const titleId = mediaType === 'tv'
                    ? await upsertTvShowFromTmdb(details)
                    : await upsertMovieFromTmdb(details);
                if (mediaType === 'tv') {
                    await this._refreshTvSeasonsAndEpisodes(titleId, tmdbId, details);
                }
                await this._saveCredits(titleId, credits, mediaType);
            } catch (error) {
                failed += 1;
                console.error('Failed to refresh title:', error);
            }

            completed += 1;
            const fraction = completed / titleRefs.length;
            this._refresh_progress_bar.set_fraction(fraction);
            this._refresh_progress_bar.set_text(`${completed}/${titleRefs.length}`);
            await this._yieldToUi();
        }

        this._setRefreshUiState(false);
        this._refreshInProgress = false;

        if (failed > 0) {
            this._showToast(_('Refreshed %d/%d titles (%d failed)').format(
                completed - failed,
                titleRefs.length,
                failed
            ), 4);
        } else {
            this._showToast(_('Refreshed %d titles').format(completed), 3);
        }
    }

    async _refreshAllImdbRatings() {
        if (this._refreshImdbInProgress) {
            return;
        }

        this._refreshImdbInProgress = true;
        this._setRefreshImdbUiState(true);
        this._refresh_imdb_progress_bar.set_text(_('Starting...'));

        let titles = [];
        try {
            titles = await getAllTitlesWithImdbIds();
        } catch (error) {
            this._setRefreshImdbUiState(false);
            this._refreshImdbInProgress = false;
            this._showToast(_('Failed to load titles list'), 3);
            return;
        }

        if (titles.length === 0) {
            this._setRefreshImdbUiState(false);
            this._refreshImdbInProgress = false;
            this._showToast(_('No titles with IMDb IDs to refresh'), 3);
            return;
        }

        let completed = 0;
        let failed = 0;

        for (const title of titles) {
            try {
                const imdbRating = await scrapeImdbRating(title.imdb_id);
                if (title.media_type === 'tv') {
                    await updateTvShowImdbRating(title.id, imdbRating?.value ?? null);
                } else {
                    await updateMovieImdbRating(title.id, imdbRating?.value ?? null);
                }
            } catch (error) {
                failed += 1;
                console.error('Failed to refresh IMDb rating for title:', error);
            }

            completed += 1;
            const fraction = completed / titles.length;
            this._refresh_imdb_progress_bar.set_fraction(fraction);
            this._refresh_imdb_progress_bar.set_text(`${completed}/${titles.length}`);
            await this._yieldToUi();
        }

        this._setRefreshImdbUiState(false);
        this._refreshImdbInProgress = false;

        if (failed > 0) {
            this._showToast(_('Refreshed %d/%d IMDb ratings (%d failed)').format(
                completed - failed,
                titles.length,
                failed
            ), 4);
        } else {
            this._showToast(_('Refreshed %d IMDb ratings').format(completed), 3);
        }
    }

    async _refreshTvSeasonsAndEpisodes(showId, tmdbId, showDetails) {
        const seasons = Array.isArray(showDetails?.seasons) ? showDetails.seasons : [];
        await upsertTvSeasons(showId, seasons);

        const seasonNumbers = seasons
            .map(season => Number(season?.season_number))
            .filter(seasonNumber => Number.isFinite(seasonNumber) && seasonNumber >= 0);

        for (const seasonNumber of seasonNumbers) {
            try {
                const seasonDetails = await getTvSeasonDetails(tmdbId, seasonNumber);
                const episodes = Array.isArray(seasonDetails?.episodes) ? seasonDetails.episodes : [];
                await upsertSeasonEpisodes(showId, seasonNumber, episodes);
            } catch {
                // Keep bulk refresh resilient when a season request fails.
            }
        }
    }

    async _saveCredits(titleId, creditsData, mediaType = 'movie') {
        if (!titleId || !creditsData) {
            return;
        }

        const credits = [];
        const seenCreditKeys = new Set();
        let order = 0;

        if (creditsData.crew) {
            const addCrewCredits = async (crewJobs, roleType) => {
                const members = creditsData.crew.filter(member => crewJobs.includes(member.job));
                for (const member of members) {
                    const personId = await upsertPerson(member.id, {
                        name: member.name,
                        profile_path: member.profile_path || null
                    });
                    const creditKey = `${personId}:${roleType}:crew`;
                    if (seenCreditKeys.has(creditKey)) {
                        continue;
                    }
                    seenCreditKeys.add(creditKey);

                    credits.push({
                        person_id: personId,
                        role_type: roleType,
                        character_name: null,
                        episode_count: mediaType === 'tv' && Number.isFinite(Number(member.total_episode_count))
                            ? Number(member.total_episode_count)
                            : (mediaType === 'tv' && Number.isFinite(Number(member.episode_count))
                                ? Number(member.episode_count)
                                : null),
                        display_order: order++
                    });
                }
            };

            await addCrewCredits(['Director'], 'director');
            await addCrewCredits(['Producer'], 'producer');
            await addCrewCredits(['Director of Photography', 'Cinematography'], 'cinematographer');
            await addCrewCredits(['Original Music Composer', 'Music', 'Composer'], 'music_composer');
        }

        if (creditsData.cast) {
            for (const actor of creditsData.cast) {
                const personId = await upsertPerson(actor.id, {
                    name: actor.name,
                    profile_path: actor.profile_path || null
                });
                const characterName = actor.character || null;
                const creditKey = `${personId}:actor:${characterName || ''}`;
                if (seenCreditKeys.has(creditKey)) {
                    continue;
                }
                seenCreditKeys.add(creditKey);

                credits.push({
                    person_id: personId,
                    role_type: 'actor',
                    character_name: characterName,
                    episode_count: mediaType === 'tv' && Number.isFinite(Number(actor.total_episode_count))
                        ? Number(actor.total_episode_count)
                        : null,
                    display_order: order++
                });
            }
        }

        if (mediaType === 'tv') {
            await upsertTvCredits(titleId, credits);
            return;
        }
        await upsertMovieCredits(titleId, credits);
    }

    _yieldToUi() {
        return new Promise(resolve => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _showToast(message, timeout = 3) {
        const toast = new Adw.Toast({
            title: message,
            timeout,
        });

        let widget = this;
        while (widget && !(widget instanceof Adw.ToastOverlay)) {
            widget = widget.get_parent();
        }
        if (widget) {
            widget.add_toast(toast);
        }
    }
});
