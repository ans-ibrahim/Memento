import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { getMovieDetails, getMovieCredits } from '../services/tmdb-service.js';
import { scrapeImdbRating } from '../services/imdb-service.js';
import {getAllMovieTmdbIds,getAllMoviesWithImdbIds,upsertMovieFromTmdb,upsertPerson,upsertMovieCredits,updateMovieImdbRating,} from '../utils/database-utils.js';

const SETTINGS_SCHEMA_ID = (GLib.getenv('FLATPAK_ID') || '').endsWith('.Devel')
    ? 'io.github.ans_ibrahim.Memento.Devel'
    : 'io.github.ans_ibrahim.Memento';

export const MementoPreferencesPage = GObject.registerClass({
    GTypeName: 'MementoPreferencesPage',
    Template: 'resource:///app/memento/memento/pages/preferences-page.ui',
    InternalChildren: [
        'api_key_row',
        'auto_remove_switch',
        'tmdb_rating_switch',
        'imdb_rating_switch',
        'refresh_all_button',
        'refresh_progress_bar',
        'refresh_progress_row',
        'refresh_imdb_ratings_button',
        'refresh_imdb_progress_bar',
        'refresh_imdb_progress_row',
    ],
}, class MementoPreferencesPage extends Adw.NavigationPage {
    constructor(params = {}) {
        super(params);
        this._settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA_ID });
        this._refreshInProgress = false;
        this._refreshImdbInProgress = false;
        this._setupBindings();
        this._loadApiKey();
        this._setupRefreshAllMovies();
        this._setupRefreshAllImdbRatings();
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

    _setupRefreshAllMovies() {
        this._refresh_all_button.connect('clicked', () => {
            this._refreshAllMovies();
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

    async _refreshAllMovies() {
        if (this._refreshInProgress) {
            return;
        }

        this._refreshInProgress = true;
        this._setRefreshUiState(true);
        this._refresh_progress_bar.set_text(_('Starting...'));

        let tmdbIds = [];
        try {
            tmdbIds = await getAllMovieTmdbIds();
        } catch (error) {
            this._setRefreshUiState(false);
            this._refreshInProgress = false;
            this._showToast(_('Failed to load movies list'), 3);
            return;
        }

        if (tmdbIds.length === 0) {
            this._setRefreshUiState(false);
            this._refreshInProgress = false;
            this._showToast(_('No movies to refresh'), 2);
            return;
        }

        let completed = 0;
        let failed = 0;

        for (const tmdbId of tmdbIds) {
            try {
                const details = await getMovieDetails(tmdbId);
                const credits = await getMovieCredits(tmdbId);
                const movieId = await upsertMovieFromTmdb(details);
                await this._saveCredits(movieId, credits);
            } catch (error) {
                failed += 1;
                console.error(`Failed to refresh movie ${tmdbId}:`, error);
            }

            completed += 1;
            const fraction = completed / tmdbIds.length;
            this._refresh_progress_bar.set_fraction(fraction);
            this._refresh_progress_bar.set_text(`${completed}/${tmdbIds.length}`);
            await this._yieldToUi();
        }

        this._setRefreshUiState(false);
        this._refreshInProgress = false;

        if (failed > 0) {
            this._showToast(_('Refreshed %d/%d movies (%d failed)').format(
                completed - failed,
                tmdbIds.length,
                failed
            ), 4);
        } else {
            this._showToast(_('Refreshed %d movies').format(completed), 3);
        }
    }

    async _refreshAllImdbRatings() {
        if (this._refreshImdbInProgress) {
            return;
        }

        this._refreshImdbInProgress = true;
        this._setRefreshImdbUiState(true);
        this._refresh_imdb_progress_bar.set_text(_('Starting...'));

        let movies = [];
        try {
            movies = await getAllMoviesWithImdbIds();
        } catch (error) {
            this._setRefreshImdbUiState(false);
            this._refreshImdbInProgress = false;
            this._showToast(_('Failed to load movies list'), 3);
            return;
        }

        if (movies.length === 0) {
            this._setRefreshImdbUiState(false);
            this._refreshImdbInProgress = false;
            this._showToast(_('No movies with IMDb IDs to refresh'), 3);
            return;
        }

        let completed = 0;
        let failed = 0;

        for (const movie of movies) {
            try {
                const imdbRating = await scrapeImdbRating(movie.imdb_id);
                await updateMovieImdbRating(movie.id, imdbRating?.value ?? null);
            } catch (error) {
                failed += 1;
                console.error(`Failed to refresh IMDb rating for movie ${movie.id}:`, error);
            }

            completed += 1;
            const fraction = completed / movies.length;
            this._refresh_imdb_progress_bar.set_fraction(fraction);
            this._refresh_imdb_progress_bar.set_text(`${completed}/${movies.length}`);
            await this._yieldToUi();
        }

        this._setRefreshImdbUiState(false);
        this._refreshImdbInProgress = false;

        if (failed > 0) {
            this._showToast(_('Refreshed %d/%d IMDb ratings (%d failed)').format(
                completed - failed,
                movies.length,
                failed
            ), 4);
        } else {
            this._showToast(_('Refreshed %d IMDb ratings').format(completed), 3);
        }
    }

    async _saveCredits(movieId, creditsData) {
        if (!movieId || !creditsData) {
            return;
        }

        const credits = [];
        let order = 0;

        if (creditsData.crew) {
            const addCrewCredits = async (crewJobs, roleType, maxItems = 5) => {
                const members = creditsData.crew.filter(member => crewJobs.includes(member.job));
                for (const member of members.slice(0, maxItems)) {
                    const personId = await upsertPerson(member.id, {
                        name: member.name,
                        profile_path: member.profile_path || null
                    });

                    credits.push({
                        person_id: personId,
                        role_type: roleType,
                        character_name: null,
                        display_order: order++
                    });
                }
            };

            await addCrewCredits(['Director'], 'director', 5);
            await addCrewCredits(['Producer'], 'producer', 5);
            await addCrewCredits(['Director of Photography', 'Cinematography'], 'cinematographer', 5);
            await addCrewCredits(['Original Music Composer', 'Music', 'Composer'], 'music_composer', 5);
        }

        if (creditsData.cast) {
            for (const actor of creditsData.cast) {
                const personId = await upsertPerson(actor.id, {
                    name: actor.name,
                    profile_path: actor.profile_path || null
                });

                credits.push({
                    person_id: personId,
                    role_type: 'actor',
                    character_name: actor.character || null,
                    display_order: order++
                });
            }
        }

        await upsertMovieCredits(movieId, credits);
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
