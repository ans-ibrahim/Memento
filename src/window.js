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
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import { MementoSearchDialog } from './dialogs/search-dialog.js';
import { MementoMovieDetailPage } from './pages/movie-detail-page.js';
import { MementoPreferencesPage } from './pages/preferences-page.js';
import { MementoPersonPage } from './pages/person-page.js';
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
import { loadTextureFromUrl, loadTextureFromUrlWithFallback } from './utils/image-utils.js';
import { buildPosterUrl, buildProfileUrl } from './services/tmdb-service.js';

export const MementoWindow = GObject.registerClass({
    GTypeName: 'MementoWindow',
    Template: 'resource:///app/memento/memento/window.ui',
    InternalChildren: [
        'add_button',
        'main_stack',
        'watchlist_grid',
        'watchlist_stack',
        'watchlist_search_entry',
        'watchlist_sort_dropdown',
        'plays_grid',
        'plays_stack',
        'plays_search_entry',
        'plays_sort_dropdown',
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
        this._dashboardDirectorsExpanded = false;
        this._dashboardCastExpanded = false;
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
    }

    _setupFilterActions() {
        this._watchlist_search_entry.connect('search-changed', () => {
            this._applyWatchlistFilters();
        });
        this._watchlist_sort_dropdown.connect('notify::selected', () => {
            this._applyWatchlistFilters();
        });
        this._plays_search_entry.connect('search-changed', () => {
            this._applyPlaysFilters();
        });
        this._plays_sort_dropdown.connect('notify::selected', () => {
            this._applyPlaysFilters();
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
            this._dashboardDirectorsExpanded = !this._dashboardDirectorsExpanded;
            this._loadDashboardPeople();
        });
        this._dashboard_cast_toggle_button.connect('clicked', () => {
            this._dashboardCastExpanded = !this._dashboardCastExpanded;
            this._loadDashboardPeople();
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
        dialog.connect('movie-added', () => {
            this._loadWatchlist();
            this._loadDashboard();
        });
        dialog.connect('view-details', (searchDialog, tmdbId) => {
            this._showMovieDetail(tmdbId);
        });
        dialog.present(this);
    }

    async _loadWatchlist() {
        try {
            this._watchlistMovies = await getWatchlistMovies();
            this._applyWatchlistFilters();
            this._renderDashboardWatchlistPreview();
        } catch (error) {
            console.error('Failed to load watchlist:', error);
        }
    }

    async _loadPlays() {
        try {
            this._plays = await getAllPlays();
            this._applyPlaysFilters();
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

    _applyWatchlistFilters() {
        const query = this._watchlist_search_entry.get_text().trim().toLowerCase();
        const sortIndex = this._watchlist_sort_dropdown.get_selected();

        let movies = [...this._watchlistMovies];
        if (query) {
            movies = movies.filter(movie => {
                const title = (movie.title || '').toLowerCase();
                return title.includes(query);
            });
        }

        movies.sort((firstMovie, secondMovie) => {
            if (sortIndex === 1) {
                return (firstMovie.title || '').localeCompare(secondMovie.title || '');
            }
            if (sortIndex === 2) {
                return (secondMovie.release_date || '').localeCompare(firstMovie.release_date || '');
            }
            if (sortIndex === 3) {
                return (secondMovie.tmdb_average || 0) - (firstMovie.tmdb_average || 0);
            }
            return (secondMovie.added_at || '').localeCompare(firstMovie.added_at || '');
        });

        this._renderWatchlistGrid(movies);
    }

    _applyPlaysFilters() {
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

        this._renderPlaysGrid(plays);
    }

    _renderWatchlistGrid(movies) {
        this._clearGrid(this._watchlist_grid);

        if (movies.length === 0) {
            this._watchlist_stack.set_visible_child_name('empty');
            return;
        }

        for (const movie of movies) {
            const card = this._createMovieCard(movie);
            this._watchlist_grid.append(card);
        }

        this._watchlist_stack.set_visible_child_name('watchlist');
    }

    _renderPlaysGrid(plays) {
        this._clearGrid(this._plays_grid);

        if (plays.length === 0) {
            this._plays_stack.set_visible_child_name('empty');
            return;
        }

        for (const play of plays) {
            const card = this._createPlayCard(play);
            this._plays_grid.append(card);
        }

        this._plays_stack.set_visible_child_name('plays');
    }

    async _renderDashboardPlaysPreview() {
        const plays = await getRecentPlays(8);
        this._clearGrid(this._dashboard_plays_grid);
        this._dashboard_plays_empty_label.set_visible(plays.length === 0);
        for (const play of plays) {
            const card = this._createPlayCard(play, {compact: true});
            this._dashboard_plays_grid.append(card);
        }
    }

    async _renderDashboardWatchlistPreview() {
        const movies = this._watchlistMovies.length > 0
            ? this._watchlistMovies.slice(0, 8)
            : (await getWatchlistMovies()).slice(0, 8);

        this._clearGrid(this._dashboard_watchlist_grid);
        this._dashboard_watchlist_empty_label.set_visible(movies.length === 0);
        for (const movie of movies) {
            const card = this._createMovieCard(movie, {compact: true});
            this._dashboard_watchlist_grid.append(card);
        }
    }

    async _loadDashboardPeople() {
        const directorsLimit = this._dashboardDirectorsExpanded ? 50 : 8;
        const castLimit = this._dashboardCastExpanded ? 50 : 8;

        const [directors, cast] = await Promise.all([
            getTopPeopleByRole('director', directorsLimit),
            getTopPeopleByRole('actor', castLimit),
        ]);

        this._dashboard_directors_toggle_button.set_label(
            this._dashboardDirectorsExpanded ? 'Show less' : 'See all'
        );
        this._dashboard_cast_toggle_button.set_label(
            this._dashboardCastExpanded ? 'Show less' : 'See all'
        );

        this._clearGrid(this._dashboard_directors_grid);
        this._clearGrid(this._dashboard_cast_grid);

        this._dashboard_directors_empty_label.set_visible(directors.length === 0);
        this._dashboard_cast_empty_label.set_visible(cast.length === 0);

        for (const person of directors) {
            const card = this._createPersonStatCard(person);
            this._dashboard_directors_grid.append(card);
        }
        for (const person of cast) {
            const card = this._createPersonStatCard(person);
            this._dashboard_cast_grid.append(card);
        }
    }

    async _loadDashboardStats() {
        const stats = await getDashboardStats();
        this._clearGrid(this._dashboard_stats_grid);

        const items = [
            {label: 'Total Plays', value: String(stats.total_plays)},
            {label: 'Unique Movies', value: String(stats.unique_movies)},
            {label: 'Watchlist', value: String(stats.watchlist_count)},
            {label: 'Watch Time', value: this._formatRuntimeMinutes(stats.total_runtime_minutes)},
        ];

        for (const item of items) {
            this._dashboard_stats_grid.append(this._createStatCard(item.label, item.value));
        }
    }

    _createMovieCard(movie, options = {}) {
        const isCompact = Boolean(options.compact);
        // Create a clickable button wrapper
        const button = new Gtk.Button({
            css_classes: ['flat', 'movie-card-button'],
        });

        const card = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            width_request: isCompact ? 140 : 160,
            hexpand: false,
            vexpand: false,
            halign: Gtk.Align.CENTER,
            css_classes: ['movie-card'],
        });

        // Poster container with fixed aspect ratio
        const posterFrame = new Gtk.Frame({
            css_classes: ['movie-poster-frame'],
        });

        const posterImage = new Gtk.Picture({
            content_fit: Gtk.ContentFit.COVER,
            width_request: isCompact ? 140 : 160,
            height_request: isCompact ? 210 : 240,
            hexpand: false,
            vexpand: false,
            css_classes: ['movie-poster'],
        });

        // Load poster image
        if (movie.poster) {
            const posterUrl = buildPosterUrl(movie.poster);
            loadTextureFromUrl(posterUrl, movie.poster).then(texture => {
                if (texture) {
                    posterImage.set_paintable(texture);
                }
            }).catch(() => {});
        }

        posterFrame.set_child(posterImage);
        card.append(posterFrame);

        // Movie info section
        const infoBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_start: 8,
            margin_end: 8,
            margin_bottom: 12,
        });

        // Title
        const titleLabel = new Gtk.Label({
            label: movie.title || 'Unknown',
            css_classes: ['heading'],
            xalign: 0,
            ellipsize: 3, // PANGO_ELLIPSIZE_END
            lines: 2,
            wrap: true,
            max_width_chars: 18,
        });
        infoBox.append(titleLabel);

        // Year
        const year = movie.release_date ? movie.release_date.substring(0, 4) : '';
        if (year) {
            const yearLabel = new Gtk.Label({
                label: year,
                css_classes: ['dim-label', 'caption'],
                xalign: 0,
            });
            infoBox.append(yearLabel);
        }

        // Rating
        if (movie.tmdb_average) {
            const ratingBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 4,
            });

            const starIcon = new Gtk.Image({
                icon_name: 'starred-symbolic',
                css_classes: ['star-icon'],
            });
            ratingBox.append(starIcon);

            const ratingLabel = new Gtk.Label({
                label: movie.tmdb_average.toFixed(1),
                css_classes: ['caption'],
            });
            ratingBox.append(ratingLabel);

            infoBox.append(ratingBox);
        }

        card.append(infoBox);
        button.set_child(card);

        // Add click handler to open detail page
        button.connect('clicked', () => {
            this._showMovieDetail(movie.tmdb_id);
        });

        return button;
    }

    _createPlayCard(play, options = {}) {
        const isCompact = Boolean(options.compact);
        const card = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            width_request: isCompact ? 140 : 160,
            hexpand: false,
            vexpand: false,
            halign: Gtk.Align.CENTER,
            css_classes: ['movie-card'],
        });

        const posterFrame = new Gtk.Frame({
            css_classes: ['movie-poster-frame'],
        });

        const posterButton = new Gtk.Button({
            css_classes: ['flat'],
        });

        const posterImage = new Gtk.Picture({
            content_fit: Gtk.ContentFit.COVER,
            width_request: isCompact ? 140 : 160,
            height_request: isCompact ? 210 : 240,
            hexpand: false,
            vexpand: false,
            css_classes: ['movie-poster'],
        });

        if (play.poster) {
            const posterUrl = buildPosterUrl(play.poster);
            loadTextureFromUrl(posterUrl, play.poster).then(texture => {
                if (texture) {
                    posterImage.set_paintable(texture);
                }
            }).catch(() => {});
        }

        posterButton.set_child(posterImage);
        posterButton.connect('clicked', () => {
            this._showMovieDetail(play.tmdb_id);
        });

        posterFrame.set_child(posterButton);
        card.append(posterFrame);

        const infoBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_start: 8,
            margin_end: 8,
            margin_bottom: 8,
        });

        const titleLabel = new Gtk.Label({
            label: play.title || 'Unknown',
            css_classes: ['heading'],
            xalign: 0,
            ellipsize: 3,
            lines: 2,
            wrap: true,
            max_width_chars: 18,
        });
        infoBox.append(titleLabel);

        const dateLabel = new Gtk.Label({
            label: this._formatDate(play.watched_at),
            css_classes: ['dim-label', 'caption'],
            xalign: 0,
        });
        infoBox.append(dateLabel);

        if (!isCompact) {
            const actionsBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                halign: Gtk.Align.START,
            });

            const deleteButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                tooltip_text: 'Delete Play',
                css_classes: ['flat', 'destructive-action'],
            });

            deleteButton.connect('clicked', async () => {
                const dialog = new Adw.AlertDialog({
                    heading: 'Delete Play?',
                    body: `Are you sure you want to delete this play of \"${play.title}\" from ${this._formatDate(play.watched_at)}?`,
                });

                dialog.add_response('cancel', 'Cancel');
                dialog.add_response('delete', 'Delete');
                dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);

                dialog.connect('response', async (dlg, response) => {
                    if (response === 'delete') {
                        await deletePlay(play.id);
                        await this._loadPlays();
                        await this._loadDashboard();
                    }
                });

                dialog.present(this.get_root());
            });

            actionsBox.append(deleteButton);
            infoBox.append(actionsBox);
        }

        card.append(infoBox);
        return card;
    }

    _createPersonStatCard(person) {
        const button = new Gtk.Button({
            css_classes: ['flat', 'person-card'],
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            halign: Gtk.Align.CENTER,
        });

        const pictureFrame = new Gtk.Frame({
            css_classes: ['profile-photo'],
        });

        const picture = new Gtk.Picture({
            width_request: 64,
            height_request: 64,
            css_classes: ['circular'],
            can_shrink: false,
        });

        pictureFrame.set_child(picture);
        box.append(pictureFrame);

        if (person.profile_path) {
            const profileUrl = buildProfileUrl(person.profile_path);
            loadTextureFromUrlWithFallback(profileUrl, person.profile_path).then(texture => {
                if (texture) {
                    picture.set_paintable(texture);
                }
            }).catch(() => {});
        }

        const nameLabel = new Gtk.Label({
            label: person.name || 'Unknown',
            wrap: true,
            wrap_mode: 2,
            max_width_chars: 14,
            justify: Gtk.Justification.CENTER,
            css_classes: ['caption', 'dim-label'],
        });
        box.append(nameLabel);

        const countLabel = new Gtk.Label({
            label: `${person.play_count || 0} plays`,
            css_classes: ['caption'],
        });
        box.append(countLabel);

        button.set_child(box);
        button.connect('clicked', () => {
            if (person.tmdb_person_id) {
                this._showPersonPage(String(person.tmdb_person_id));
            }
        });

        return button;
    }

    _createStatCard(label, value) {
        const frame = new Gtk.Frame({
            css_classes: ['stats-card'],
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_start: 12,
            margin_end: 12,
            margin_top: 12,
            margin_bottom: 12,
        });

        const valueLabel = new Gtk.Label({
            label: value,
            css_classes: ['title-2'],
            xalign: 0,
        });
        box.append(valueLabel);

        const labelLabel = new Gtk.Label({
            label,
            css_classes: ['caption', 'dim-label'],
            xalign: 0,
        });
        box.append(labelLabel);

        frame.set_child(box);
        return frame;
    }

    _clearGrid(grid) {
        let child = grid.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            grid.remove(child);
            child = next;
        }
    }

    _formatDate(isoDate) {
        try {
            const date = new Date(isoDate);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return isoDate;
        }
    }

    _formatRuntimeMinutes(minutes) {
        const totalMinutes = Number(minutes) || 0;
        if (totalMinutes <= 0) {
            return '0m';
        }
        const hours = Math.floor(totalMinutes / 60);
        const remainingMinutes = totalMinutes % 60;
        if (hours <= 0) {
            return `${remainingMinutes}m`;
        }
        if (remainingMinutes === 0) {
            return `${hours}h`;
        }
        return `${hours}h ${remainingMinutes}m`;
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
