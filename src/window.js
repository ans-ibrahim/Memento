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

import { MementoSearchDialog } from './dialogs/search-dialog.js';
import { MementoMovieDetailPage } from './pages/movie-detail-page.js';
import { MementoPreferencesPage } from './pages/preferences-page.js';
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
    deletePlay
} from './utils/database-utils.js';
import { clearGrid, formatRuntimeMinutes } from './utils/ui-utils.js';
import { createMovieCard } from './widgets/movie-card.js';
import { createPlayCard } from './widgets/play-card.js';
import { createPersonStatCard } from './widgets/person-stat-card.js';
import { createStatCard } from './widgets/stat-card.js';

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
        this._watchlistMovies = [];
        this._plays = [];
        this._filteredPlays = [];
        this._playsCurrentPage = 0;
        this._playsItemsPerPage = 28;
        this._setupWindowActions();
        this._setupActions();
        this._setupFilterActions();
        this._setupDashboardActions();
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

        this._watchlist_page.connect('view-details', (page, tmdbId) => {
            this._showMovieDetail(tmdbId);
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
        dialog.connect('view-details', (searchDialog, tmdbId) => {
            this._showMovieDetail(tmdbId);
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
                return title.includes(query);
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

        this._filteredPlays = plays;
        if (resetPage) {
            this._playsCurrentPage = 0;
        }
        this._renderPlaysPage();
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
                onActivate: tmdbId => this._showMovieDetail(tmdbId),
                onDelete: async playToDelete => {
                    await deletePlay(playToDelete.id);
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
        this._plays_page_label.set_text(`Page ${this._playsCurrentPage + 1} of ${totalPages}`);
    }

    async _renderDashboardPlaysPreview() {
        const plays = await getRecentPlays(6);
        clearGrid(this._dashboard_plays_grid);
        this._dashboard_plays_empty_label.set_visible(plays.length === 0);
        for (const play of plays) {
            const card = createPlayCard(play, {
                compact: true,
                titleMaxChars: 18,
                onActivate: tmdbId => this._showMovieDetail(tmdbId),
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
                onActivate: tmdbId => this._showMovieDetail(tmdbId),
            });
            this._dashboard_watchlist_grid.append(card);
        }
    }

    async _loadDashboardPeople() {
        const [directors, cast] = await Promise.all([
            getTopPeopleByRole('director', 6),
            getTopPeopleByRole('actor', 6),
        ]);

        this._dashboard_directors_toggle_button.set_label('See all');
        this._dashboard_cast_toggle_button.set_label('See all');

        clearGrid(this._dashboard_directors_grid);
        clearGrid(this._dashboard_cast_grid);

        this._dashboard_directors_empty_label.set_visible(directors.length === 0);
        this._dashboard_cast_empty_label.set_visible(cast.length === 0);

        for (const person of directors) {
            const card = createPersonStatCard(person, {
                onActivate: personId => this._showPersonPage(personId),
            });
            this._dashboard_directors_grid.append(card);
        }
        for (const person of cast) {
            const card = createPersonStatCard(person, {
                onActivate: personId => this._showPersonPage(personId),
            });
            this._dashboard_cast_grid.append(card);
        }
    }

    async _loadDashboardStats() {
        const stats = await getDashboardStats();
        clearGrid(this._dashboard_stats_grid);

        const items = [
            {label: 'Total Plays', value: String(stats.total_plays)},
            {label: 'Unique Movies', value: String(stats.unique_movies)},
            {label: 'Watchlist', value: String(stats.watchlist_count)},
            {label: 'Watch Time', value: formatRuntimeMinutes(stats.total_runtime_minutes)},
        ];

        for (const item of items) {
            this._dashboard_stats_grid.append(createStatCard(item.label, item.value));
        }
    }

    _showMovieDetail(tmdbId) {
        const detailPage = new MementoMovieDetailPage();
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
        detailPage.loadMovie(tmdbId);
    }

    _showPersonPage(personId) {
        const personPage = new MementoPersonPage();
        personPage.connect('view-movie', (page, tmdbId) => {
            this._showMovieDetail(tmdbId);
        });

        this._navigation_view.push(personPage);
        personPage.loadPerson(personId);
    }

    _showPreferencesPage() {
        const preferencesPage = new MementoPreferencesPage();
        this._navigation_view.push(preferencesPage);
    }

    _showPlacesDialog() {
        const dialog = new MementoPlacesDialog();
        dialog.present(this);
    }
});
