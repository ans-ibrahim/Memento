/* window.js
 *
 * Copyright 2026 Ans Ibrahim
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import GObject from 'gi://GObject';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { MementoSearchDialog } from './dialogs/search-dialog.js';
import { MementoMovieDetailPage } from './pages/movie-detail-page.js';
import { MementoTvDetailPage } from './pages/tv-detail-page.js';
import { MementoPreferencesDialog } from './pages/preferences-page.js';
import { MementoPersonPage } from './pages/person-page.js';
import { MementoTopPeoplePage } from './pages/top-people-page.js';
import { MementoWatchlistPage } from './pages/watchlist-page.js';
import { MementoPlacesDialog } from './dialogs/places-dialog.js';
import {
    initializeDatabase,
    getWatchlistMovies,
    getAllPlays,
    getRecentPlays,
    getDashboardStats,
    getTopPeopleByRole,
    deletePlay,
    deleteTvEpisodePlay
} from './utils/database-utils.js';
import { clearGrid, formatRuntimeMinutes } from './utils/ui-utils.js';
import { createMovieCard } from './widgets/movie-card.js';
import { createPlayCard } from './widgets/play-card.js';
import { createPersonStatCard } from './widgets/person-stat-card.js';
import { createStatCard } from './widgets/stat-card.js';

const SETTINGS_SCHEMA_ID = (GLib.getenv('FLATPAK_ID') || '').endsWith('.Devel')
    ? 'io.github.ans_ibrahim.Memento.Devel'
    : 'io.github.ans_ibrahim.Memento';

export const MementoWindow = GObject.registerClass({
    GTypeName: 'MementoWindow',
    Template: 'resource:///app/memento/memento/window.ui',
    InternalChildren: [
        'add_button',
        'main_stack',
        'watchlist_page',
        'top_people_page',
        'plays_grid',
        'plays_stack',
        'plays_search_entry',
        'plays_sort_dropdown',
        'plays_pagination_box',
        'plays_prev_button',
        'plays_page_label',
        'plays_next_button',
        'dashboard_plays_grid',
        'dashboard_plays_empty_label',
        'dashboard_watchlist_grid',
        'dashboard_watchlist_empty_label',
        'dashboard_plays_all_button',
        'dashboard_watchlist_all_button',
        'dashboard_directors_grid',
        'dashboard_directors_empty_label',
        'dashboard_directors_toggle_button',
        'dashboard_cast_grid',
        'dashboard_cast_empty_label',
        'dashboard_cast_toggle_button',
        'dashboard_stats_grid',
        'navigation_view',
    ],
}, class MementoWindow extends Adw.ApplicationWindow {
    constructor(application) {
        super({ application });
        this._settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA_ID });
        this._watchlistMovies = [];
        this._plays = [];
        this._filteredPlays = [];
        this._playsCurrentPage = 0;
        this._playsItemsPerPage = 28;
        this._setupWindowActions();
        this._setupActions();
        this._setupFilterActions();
        this._setupDashboardActions();
        this._setupSettingsActions();
        this._initApp();
    }

    _setupWindowActions() {
        // Create places action
        const placesAction = new Gio.SimpleAction({ name: 'places' });
        placesAction.connect('activate', () => {
            this._showPlacesDialog();
        });
        this.add_action(placesAction);

        // Create preferences action
        const preferencesAction = new Gio.SimpleAction({ name: 'preferences' });
        preferencesAction.connect('activate', () => {
            this._showPreferencesPage();
        });
        this.add_action(preferencesAction);
    }

    _setupActions() {
        this._add_button.connect('clicked', () => {
            this._showSearchDialog();
        });

        this._watchlist_page.connect('view-details', (page, tmdbId, mediaType) => {
            this._showMovieDetail(tmdbId, mediaType);
        });
        this._top_people_page.connect('view-person', (page, personId) => {
            this._showPersonPage(personId);
        });

        this._main_stack.connect('notify::visible-child-name', () => {
            if (this._main_stack.get_visible_child_name() === 'people') {
                this._top_people_page.reload();
            }
        });
    }

    _setupFilterActions() {
        this._plays_search_entry.connect('search-changed', () => {
            this._applyPlaysFilters(true);
        });
        this._plays_sort_dropdown.connect('notify::selected', () => {
            this._applyPlaysFilters(true);
        });
        this._plays_prev_button.connect('clicked', () => {
            if (this._playsCurrentPage > 0) {
                this._playsCurrentPage -= 1;
                this._renderPlaysPage();
            }
        });
        this._plays_next_button.connect('clicked', () => {
            const totalPages = Math.max(1, Math.ceil(this._filteredPlays.length / this._playsItemsPerPage));
            if (this._playsCurrentPage < totalPages - 1) {
                this._playsCurrentPage += 1;
                this._renderPlaysPage();
            }
        });
    }

    _setupDashboardActions() {
        this._dashboard_plays_all_button.connect('clicked', () => {
            this._main_stack.set_visible_child_name('plays');
        });
        this._dashboard_watchlist_all_button.connect('clicked', () => {
            this._main_stack.set_visible_child_name('watchlist');
        });
        this._dashboard_directors_toggle_button.connect('clicked', () => {
            this._top_people_page.showRole('director');
            this._main_stack.set_visible_child_name('people');
        });
        this._dashboard_cast_toggle_button.connect('clicked', () => {
            this._top_people_page.showRole('actor');
            this._main_stack.set_visible_child_name('people');
        });
    }

    _setupSettingsActions() {
        this._settings.connect('changed::dashboard-people-metric', () => {
            void this._loadDashboardPeople();
            void this._top_people_page.reload();
        });
        this._settings.connect('changed::dashboard-people-tv-episode-level', () => {
            void this._loadDashboardPeople();
            void this._top_people_page.reload();
        });
    }

    async _initApp() {
        try {
            await initializeDatabase();
            this._main_stack.set_visible_child_name('dashboard');
            await this._loadDashboard();
            await this._loadWatchlist();
            await this._loadPlays();
        } catch (error) {
            console.error('Failed to initialize app:', error);
        }
    }

    _showSearchDialog() {
        const dialog = new MementoSearchDialog();
        dialog.connect('view-details', (searchDialog, tmdbId, mediaType) => {
            this._showMovieDetail(tmdbId, mediaType);
        });
        dialog.present(this);
    }

    async _loadWatchlist() {
        try {
            this._watchlistMovies = await getWatchlistMovies();
            this._watchlist_page.setMovies(this._watchlistMovies);
            this._renderDashboardWatchlistPreview();
        } catch (error) {
            console.error('Failed to load watchlist:', error);
        }
    }

    async _loadPlays() {
        try {
            this._plays = await getAllPlays();
            this._applyPlaysFilters(true);
            this._renderDashboardPlaysPreview();
        } catch (error) {
            console.error('Failed to load plays:', error);
        }
    }

    async _loadDashboard() {
        try {
            await Promise.all([
                this._renderDashboardPlaysPreview(),
                this._renderDashboardWatchlistPreview(),
                this._loadDashboardPeople(),
                this._loadDashboardStats()
            ]);
        } catch (error) {
            console.error('Failed to load dashboard:', error);
        }
    }

    _applyPlaysFilters(resetPage = false) {
        const query = this._plays_search_entry.get_text().trim().toLowerCase();
        const sortIndex = this._plays_sort_dropdown.get_selected();

        let plays = [...this._plays];
        if (query) {
            plays = plays.filter(play => {
                const title = (play.title || '').toLowerCase();
                const originalTitle = (play.original_title || '').toLowerCase();
                return title.includes(query) || originalTitle.includes(query);
            });
        }

        plays.sort((firstPlay, secondPlay) => {
            if (sortIndex === 1) {
                return (firstPlay.watched_at || '').localeCompare(secondPlay.watched_at || '');
            }
            if (sortIndex === 2) {
                return (firstPlay.title || '').localeCompare(secondPlay.title || '');
            }
            return (secondPlay.watched_at || '').localeCompare(firstPlay.watched_at || '');
        });

        this._filteredPlays = this._groupPlaysForCards(plays);
        if (resetPage) {
            this._playsCurrentPage = 0;
        }
        this._renderPlaysPage();
    }

    _groupPlaysForCards(plays) {
        const output = [];

        for (let index = 0; index < plays.length; index += 1) {
            const play = plays[index];
            if (!play || play.media_type !== 'tv' || !play.episode_id) {
                output.push(play || null);
                continue;
            }

            const groupedPlays = [play];
            let nextIndex = index + 1;
            while (nextIndex < plays.length) {
                const nextPlay = plays[nextIndex];
                if (
                    !nextPlay ||
                    nextPlay.media_type !== 'tv' ||
                    !nextPlay.episode_id ||
                    String(nextPlay.tmdb_id || '') !== String(play.tmdb_id || '') ||
                    String(nextPlay.watched_at || '') !== String(play.watched_at || '') ||
                    String(nextPlay.season_number || '') !== String(play.season_number || '') ||
                    String(nextPlay.place_id || '') !== String(play.place_id || '') ||
                    String(nextPlay.comment || '') !== String(play.comment || '')
                ) {
                    break;
                }
                groupedPlays.push(nextPlay);
                nextIndex += 1;
            }

            if (groupedPlays.length <= 1) {
                output.push(play);
                continue;
            }

            const sortedEpisodes = [...groupedPlays].sort((firstPlay, secondPlay) => {
                return (Number(firstPlay.episode_number) || 0) - (Number(secondPlay.episode_number) || 0);
            });
            const firstPlay = sortedEpisodes[0];
            output.push({
                ...firstPlay,
                is_grouped_play: true,
                grouped_play_ids: sortedEpisodes.map(play => play.source_play_id ?? play.id),
                grouped_episode_count: sortedEpisodes.length,
                grouped_episode_start: sortedEpisodes[0]?.episode_number ?? null,
                grouped_episode_end: sortedEpisodes[sortedEpisodes.length - 1]?.episode_number ?? null,
            });
            index = nextIndex - 1;
        }

        return output.filter(play => Boolean(play));
    }

    _renderPlaysPage() {
        const plays = this._filteredPlays;
        clearGrid(this._plays_grid);

        if (plays.length === 0) {
            this._plays_stack.set_visible_child_name('empty');
            this._plays_pagination_box.set_visible(false);
            return;
        }

        const totalPages = Math.max(1, Math.ceil(plays.length / this._playsItemsPerPage));
        if (this._playsCurrentPage > totalPages - 1) {
            this._playsCurrentPage = totalPages - 1;
        }

        const startIndex = this._playsCurrentPage * this._playsItemsPerPage;
        const pageItems = plays.slice(startIndex, startIndex + this._playsItemsPerPage);

        for (const play of pageItems) {
            const card = createPlayCard(play, {
                onActivate: (tmdbId, mediaType) => this._showMovieDetail(tmdbId, mediaType),
                onDelete: async playToDelete => {
                    if (playToDelete.is_grouped_play && Array.isArray(playToDelete.grouped_play_ids)) {
                        for (const playId of playToDelete.grouped_play_ids) {
                            if (playToDelete.source_type === 'tv') {
                                await deleteTvEpisodePlay(playId);
                            } else {
                                await deletePlay(playId);
                            }
                        }
                    } else {
                        if (playToDelete.source_type === 'tv') {
                            await deleteTvEpisodePlay(playToDelete.source_play_id ?? playToDelete.id);
                        } else {
                            await deletePlay(playToDelete.source_play_id ?? playToDelete.id);
                        }
                    }
                    await this._loadPlays();
                    await this._loadDashboard();
                },
                dialogParent: this.get_root(),
            });
            this._plays_grid.append(card);
        }

        this._plays_stack.set_visible_child_name('plays');
        this._plays_pagination_box.set_visible(totalPages > 1);
        this._plays_prev_button.set_sensitive(this._playsCurrentPage > 0);
        this._plays_next_button.set_sensitive(this._playsCurrentPage < totalPages - 1);
        const pageLabel = _('Page %d of %d').format(this._playsCurrentPage + 1, totalPages);
        this._plays_page_label.set_text(pageLabel);
    }

    async _renderDashboardPlaysPreview() {
        const targetCardCount = 6;
        const batchSize = 24;
        const maxBatches = 8;
        let offset = 0;
        let rawPlays = [];
        let groupedPlays = [];

        for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
            const nextBatch = await getRecentPlays(batchSize, offset);
            if (nextBatch.length === 0) {
                break;
            }

            rawPlays = rawPlays.concat(nextBatch);
            groupedPlays = this._groupPlaysForCards(rawPlays);
            if (groupedPlays.length >= targetCardCount || nextBatch.length < batchSize) {
                break;
            }
            offset += batchSize;
        }

        const plays = groupedPlays.slice(0, targetCardCount);
        clearGrid(this._dashboard_plays_grid);
        this._dashboard_plays_empty_label.set_visible(plays.length === 0);
        for (const play of plays) {
            const card = createPlayCard(play, {
                compact: true,
                titleMaxChars: 18,
                onActivate: (tmdbId, mediaType) => this._showMovieDetail(tmdbId, mediaType),
            });
            this._dashboard_plays_grid.append(card);
        }
    }

    async _renderDashboardWatchlistPreview() {
        const movies = this._watchlistMovies.length > 0
            ? this._watchlistMovies.slice(0, 6)
            : (await getWatchlistMovies()).slice(0, 6);

        clearGrid(this._dashboard_watchlist_grid);
        this._dashboard_watchlist_empty_label.set_visible(movies.length === 0);
        for (const movie of movies) {
            const card = createMovieCard(movie, {
                titleMaxChars: 18,
                onActivate: (tmdbId, mediaType) => this._showMovieDetail(tmdbId, mediaType),
            });
            this._dashboard_watchlist_grid.append(card);
        }
    }

    async _loadDashboardPeople() {
        const metricMode = this._settings.get_string('dashboard-people-metric') === 'unique' ? 'unique' : 'total';
        const tvGranularity = this._settings.get_boolean('dashboard-people-tv-episode-level') ? 'episode' : 'show';
        const [directors, cast] = await Promise.all([
            getTopPeopleByRole('director', 6, metricMode, tvGranularity),
            getTopPeopleByRole('actor', 6, metricMode, tvGranularity),
        ]);

        this._dashboard_directors_toggle_button.set_label(_('See all'));
        this._dashboard_cast_toggle_button.set_label(_('See all'));

        clearGrid(this._dashboard_directors_grid);
        clearGrid(this._dashboard_cast_grid);

        this._dashboard_directors_empty_label.set_visible(directors.length === 0);
        this._dashboard_cast_empty_label.set_visible(cast.length === 0);

        for (const person of directors) {
            const movieTotalPlays = Number(person.movie_total_plays) || 0;
            const movieUniqueTitles = Number(person.movie_unique_titles) || 0;
            const tvEpisodePlays = Number(person.tv_episode_plays) || 0;
            const tvUniqueEpisodes = Number(person.tv_unique_episodes) || 0;
            const tvUniqueShows = Number(person.tv_unique_shows) || 0;
            const statChips = [];
            if (metricMode === 'unique') {
                if (movieUniqueTitles > 0) {
                    statChips.push(_('%d movies').format(movieUniqueTitles));
                }
                if (tvGranularity === 'episode') {
                    if (tvUniqueEpisodes > 0 || tvUniqueShows > 0) {
                        statChips.push(_('%d unique episodes • %d TV shows').format(tvUniqueEpisodes, tvUniqueShows));
                    }
                } else if (tvUniqueShows > 0) {
                    statChips.push(_('%d TV shows').format(tvUniqueShows));
                }
            } else {
                if (movieTotalPlays > 0) {
                    statChips.push(_('%d movie plays').format(movieTotalPlays));
                }
                if (tvGranularity === 'episode') {
                    if (tvEpisodePlays > 0 || tvUniqueShows > 0) {
                        statChips.push(_('%d episode plays • %d TV shows').format(tvEpisodePlays, tvUniqueShows));
                    }
                } else if (tvUniqueShows > 0) {
                    statChips.push(_('%d TV shows').format(tvUniqueShows));
                }
            }
            const card = createPersonStatCard(person, {
                statChips,
                onActivate: personId => this._showPersonPage(personId),
            });
            this._dashboard_directors_grid.append(card);
        }
        for (const person of cast) {
            const movieTotalPlays = Number(person.movie_total_plays) || 0;
            const movieUniqueTitles = Number(person.movie_unique_titles) || 0;
            const tvEpisodePlays = Number(person.tv_episode_plays) || 0;
            const tvUniqueEpisodes = Number(person.tv_unique_episodes) || 0;
            const tvUniqueShows = Number(person.tv_unique_shows) || 0;
            const statChips = [];
            if (metricMode === 'unique') {
                if (movieUniqueTitles > 0) {
                    statChips.push(_('%d movies').format(movieUniqueTitles));
                }
                if (tvGranularity === 'episode') {
                    if (tvUniqueEpisodes > 0 || tvUniqueShows > 0) {
                        statChips.push(_('%d unique episodes • %d TV shows').format(tvUniqueEpisodes, tvUniqueShows));
                    }
                } else if (tvUniqueShows > 0) {
                    statChips.push(_('%d TV shows').format(tvUniqueShows));
                }
            } else {
                if (movieTotalPlays > 0) {
                    statChips.push(_('%d movie plays').format(movieTotalPlays));
                }
                if (tvGranularity === 'episode') {
                    if (tvEpisodePlays > 0 || tvUniqueShows > 0) {
                        statChips.push(_('%d episode plays • %d TV shows').format(tvEpisodePlays, tvUniqueShows));
                    }
                } else if (tvUniqueShows > 0) {
                    statChips.push(_('%d TV shows').format(tvUniqueShows));
                }
            }
            const card = createPersonStatCard(person, {
                statChips,
                onActivate: personId => this._showPersonPage(personId),
            });
            this._dashboard_cast_grid.append(card);
        }
    }

    async _loadDashboardStats() {
        const stats = await getDashboardStats();
        clearGrid(this._dashboard_stats_grid);

        const items = [
            {label: _('Movie Plays'), value: String(stats.movie_total_plays)},
            {label: _('TV Episode Plays'), value: String(stats.tv_total_plays)},
            {label: _('Movies Watched'), value: String(stats.movie_unique_titles)},
            {label: _('TV Shows Watched'), value: String(stats.tv_unique_shows)},
            {label: _('Movie Watchlist'), value: String(stats.movie_watchlist_count)},
            {label: _('TV Watchlist'), value: String(stats.tv_watchlist_count)},
            {label: _('Total Time Watched'), value: formatRuntimeMinutes(stats.total_runtime_minutes)},
        ];

        for (const item of items) {
            this._dashboard_stats_grid.append(createStatCard(item.label, item.value));
        }
    }

    _showMovieDetail(tmdbId, mediaType = 'movie') {
        const detailPage = mediaType === 'tv'
            ? new MementoTvDetailPage()
            : new MementoMovieDetailPage();
        detailPage.connect('watchlist-changed', () => {
            this._loadWatchlist();
            this._loadDashboard();
        });
        detailPage.connect('plays-changed', () => {
            this._loadPlays();
            this._loadDashboard();
        });
        detailPage.connect('view-person', (page, personId) => {
            this._showPersonPage(personId);
        });
        
        // Push the detail page onto the navigation stack
        this._navigation_view.push(detailPage);
        
        // Load the movie data
        if (mediaType === 'tv') {
            detailPage.loadShow(tmdbId);
        } else {
            detailPage.loadTitle(tmdbId, mediaType);
        }
    }

    _showPersonPage(personId) {
        const personPage = new MementoPersonPage();
        personPage.connect('view-movie', (page, tmdbId, mediaType) => {
            this._showMovieDetail(tmdbId, mediaType || 'movie');
        });

        this._navigation_view.push(personPage);
        personPage.loadPerson(personId);
    }

    _showPreferencesPage() {
        const preferencesDialog = new MementoPreferencesDialog();
        preferencesDialog.present(this);
    }

    _showPlacesDialog() {
        const dialog = new MementoPlacesDialog();
        dialog.present(this);
    }
});
