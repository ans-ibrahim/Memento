/* watchlist-page.js
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

import { clearGrid } from '../utils/ui-utils.js';
import { createMovieCard } from '../widgets/movie-card.js';

export const MementoWatchlistPage = GObject.registerClass({
    GTypeName: 'MementoWatchlistPage',
    Template: 'resource:///app/memento/memento/pages/watchlist-page.ui',
    InternalChildren: [
        'watchlist_search_entry',
        'watchlist_sort_dropdown',
        'watchlist_stack',
        'watchlist_grid',
        'watchlist_pagination_box',
        'watchlist_prev_button',
        'watchlist_page_label',
        'watchlist_next_button',
    ],
    Signals: {
        'view-details': { param_types: [GObject.TYPE_INT] },
    },
}, class MementoWatchlistPage extends Gtk.Box {
    constructor(params = {}) {
        super(params);
        this._movies = [];
        this._filteredMovies = [];
        this._currentPage = 0;
        this._itemsPerPage = 28;
        this._setupActions();
    }

    setMovies(movies) {
        this._movies = Array.isArray(movies) ? movies : [];
        this._applyFilters();
    }

    _setupActions() {
        this._watchlist_search_entry.connect('search-changed', () => {
            this._applyFilters();
        });
        this._watchlist_sort_dropdown.connect('notify::selected', () => {
            this._applyFilters();
        });
        this._watchlist_prev_button.connect('clicked', () => {
            if (this._currentPage > 0) {
                this._currentPage -= 1;
                this._renderCurrentPage();
            }
        });
        this._watchlist_next_button.connect('clicked', () => {
            const totalPages = Math.max(1, Math.ceil(this._filteredMovies.length / this._itemsPerPage));
            if (this._currentPage < totalPages - 1) {
                this._currentPage += 1;
                this._renderCurrentPage();
            }
        });
    }

    _applyFilters() {
        const query = this._watchlist_search_entry.get_text().trim().toLowerCase();
        const sortIndex = this._watchlist_sort_dropdown.get_selected();

        let movies = [...this._movies];
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

        this._filteredMovies = movies;
        this._currentPage = 0;
        this._renderCurrentPage();
    }

    _renderCurrentPage() {
        const movies = this._filteredMovies;
        clearGrid(this._watchlist_grid);

        if (movies.length === 0) {
            this._watchlist_stack.set_visible_child_name('empty');
            this._watchlist_pagination_box.set_visible(false);
            return;
        }

        const totalPages = Math.max(1, Math.ceil(movies.length / this._itemsPerPage));
        if (this._currentPage > totalPages - 1) {
            this._currentPage = totalPages - 1;
        }

        const startIndex = this._currentPage * this._itemsPerPage;
        const pageItems = movies.slice(startIndex, startIndex + this._itemsPerPage);

        for (const movie of pageItems) {
            const card = createMovieCard(movie, {
                onActivate: tmdbId => this.emit('view-details', tmdbId),
            });
            this._watchlist_grid.append(card);
        }

        this._watchlist_stack.set_visible_child_name('watchlist');
        this._watchlist_pagination_box.set_visible(totalPages > 1);
        this._watchlist_prev_button.set_sensitive(this._currentPage > 0);
        this._watchlist_next_button.set_sensitive(this._currentPage < totalPages - 1);
        this._watchlist_page_label.set_text(`Page ${this._currentPage + 1} of ${totalPages}`);
    }
});
