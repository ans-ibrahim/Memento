/* search-dialog.js
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
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import { searchMovies, getMovieDetails, buildPosterUrl } from '../services/tmdb-service.js';
import { upsertMovieFromTmdb, addMovieToWatchlist } from '../utils/database-utils.js';
import { loadTextureFromUrl } from '../utils/image-utils.js';

export const MementoSearchDialog = GObject.registerClass({
    GTypeName: 'MementoSearchDialog',
    Template: 'resource:///app/memento/memento/dialogs/search-dialog.ui',
    InternalChildren: ['search_entry', 'content_stack', 'results_list'],
    Signals: {
        'movie-added': {},
        'view-details': {param_types: [GObject.TYPE_INT]},
    },
}, class MementoSearchDialog extends Adw.Dialog {
    _searchTimeoutId = null;

    constructor(params = {}) {
        super(params);
        this._setupSearch();
    }

    _setupSearch() {
        this._search_entry.connect('search-changed', () => {
            this._onSearchChanged();
        });
    }

    _onSearchChanged() {
        if (this._searchTimeoutId) {
            GLib.source_remove(this._searchTimeoutId);
            this._searchTimeoutId = null;
        }

        const query = this._search_entry.get_text().trim();

        if (!query) {
            this._content_stack.set_visible_child_name('empty');
            return;
        }

        this._searchTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._searchTimeoutId = null;
            this._performSearch(query);
            return GLib.SOURCE_REMOVE;
        });
    }

    async _performSearch(query) {
        this._content_stack.set_visible_child_name('loading');

        try {
            const results = await searchMovies(query);

            if (results.length === 0) {
                this._content_stack.set_visible_child_name('no-results');
                return;
            }

            this._populateResults(results);
            this._content_stack.set_visible_child_name('results');
        } catch (error) {
            console.error('Search failed:', error);
            this._content_stack.set_visible_child_name('no-results');
        }
    }

    _populateResults(results) {
        // Clear existing results
        let child = this._results_list.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._results_list.remove(child);
            child = next;
        }

        // Add new results
        for (const movie of results.slice(0, 10)) {
            const row = this._createResultRow(movie);
            this._results_list.append(row);
        }
    }

    _createResultRow(movie) {
        const row = new Adw.ActionRow({
            title: movie.title || 'Unknown Title',
            subtitle: movie.release_date ? movie.release_date.substring(0, 4) : 'Unknown Year',
            activatable: true,
        });

        // Make row clickable to view details
        row.connect('activated', () => {
            this._showMovieDetail(movie.id);
        });

        // Poster image
        const avatar = new Adw.Avatar({
            size: 48,
            text: movie.title || '?',
        });
        row.add_prefix(avatar);

        // Load poster asynchronously
        const posterUrl = buildPosterUrl(movie.poster_path);
        if (posterUrl) {
            loadTextureFromUrl(posterUrl).then(texture => {
                if (texture) {
                    avatar.set_custom_image(texture);
                }
            }).catch(() => {});
        }

        // Button box for actions
        const buttonBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
        });

        // View details button
        const detailsButton = new Gtk.Button({
            icon_name: 'dialog-information-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'View Details',
        });

        detailsButton.connect('clicked', () => {
            this._showMovieDetail(movie.id);
        });

        buttonBox.append(detailsButton);

        // Add button
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: 'Add to Watchlist',
        });

        addButton.connect('clicked', () => {
            this._addMovie(movie, addButton);
        });

        buttonBox.append(addButton);
        row.add_suffix(buttonBox);

        return row;
    }

    _showMovieDetail(tmdbId) {
        this.emit('view-details', tmdbId);
        this.close();
    }

    async _addMovie(movie, button) {
        button.set_sensitive(false);
        button.set_icon_name('emblem-ok-symbolic');

        try {
            // Get full movie details
            const details = await getMovieDetails(movie.id);

            // Save to database
            const movieId = await upsertMovieFromTmdb(details);
            await addMovieToWatchlist(movieId);

            // Emit signal and close
            this.emit('movie-added');
            this.close();
        } catch (error) {
            console.error('Failed to add movie:', error);
            button.set_sensitive(true);
            button.set_icon_name('list-add-symbolic');
        }
    }
});
