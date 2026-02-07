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
import { MementoPlaysPage } from './pages/plays-page.js';
import { MementoPreferencesPage } from './pages/preferences-page.js';
import { MementoPersonPage } from './pages/person-page.js';
import { MementoPlacesDialog } from './dialogs/places-dialog.js';
import { initializeDatabase, getWatchlistMovies } from './utils/database-utils.js';
import { loadTextureFromUrl } from './utils/image-utils.js';
import { buildPosterUrl } from './services/tmdb-service.js';

export const MementoWindow = GObject.registerClass({
    GTypeName: 'MementoWindow',
    Template: 'resource:///app/memento/memento/window.ui',
    InternalChildren: ['add_button', 'plays_button', 'main_stack', 'watchlist_grid', 'navigation_view'],
}, class MementoWindow extends Adw.ApplicationWindow {
    constructor(application) {
        super({ application });
        this._setupWindowActions();
        this._setupActions();
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

        this._plays_button.connect('clicked', () => {
            this._showPlaysPage();
        });
    }

    async _initApp() {
        try {
            await initializeDatabase();
            await this._loadWatchlist();
        } catch (error) {
            console.error('Failed to initialize app:', error);
        }
    }

    _showSearchDialog() {
        const dialog = new MementoSearchDialog();
        dialog.connect('movie-added', () => {
            this._loadWatchlist();
        });
        dialog.connect('view-details', (searchDialog, tmdbId) => {
            this._showMovieDetail(tmdbId);
        });
        dialog.present(this);
    }

    async _loadWatchlist() {
        try {
            const movies = await getWatchlistMovies();

            // Clear existing items
            let child = this._watchlist_grid.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                this._watchlist_grid.remove(child);
                child = next;
            }

            if (movies.length === 0) {
                this._main_stack.set_visible_child_name('empty');
                return;
            }

            // Add movie cards
            for (const movie of movies) {
                const card = this._createMovieCard(movie);
                this._watchlist_grid.append(card);
            }

            this._main_stack.set_visible_child_name('watchlist');
        } catch (error) {
            console.error('Failed to load watchlist:', error);
        }
    }

    _createMovieCard(movie) {
        // Create a clickable button wrapper
        const button = new Gtk.Button({
            css_classes: ['flat', 'movie-card-button'],
        });

        const card = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            width_request: 160,
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
            width_request: 160,
            height_request: 240,
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

    _showMovieDetail(tmdbId) {
        const detailPage = new MementoMovieDetailPage();
        detailPage.connect('watchlist-changed', () => {
            this._loadWatchlist();
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

    _showPlaysPage() {
        const playsPage = new MementoPlaysPage();
        
        playsPage.connect('play-deleted', () => {
            // Reload watchlist in case plays were deleted
            this._loadWatchlist();
        });

        playsPage.connect('view-movie', (page, tmdbId) => {
            this._showMovieDetail(tmdbId);
        });
        
        // Push the plays page onto the navigation stack
        this._navigation_view.push(playsPage);
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
