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
import Pango from 'gi://Pango';

import { searchMovies, getMovieDetails, buildPosterUrl } from '../services/tmdb-service.js';
import { loadTextureFromUrl } from '../utils/image-utils.js';

export const MementoSearchDialog = GObject.registerClass({
    GTypeName: 'MementoSearchDialog',
    Template: 'resource:///app/memento/memento/dialogs/search-dialog.ui',
    InternalChildren: ['search_entry', 'content_stack', 'results_list'],
    Signals: {
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
        const row = new Gtk.ListBoxRow({
            activatable: true,
            selectable: false,
            css_classes: ['search-result-row'],
        });

        // Make row clickable to view details
        row.connect('activate', () => {
            this._showMovieDetail(movie.id);
        });

        const rowContentBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            margin_start: 4,
            margin_end: 4,
            margin_top: 4,
            margin_bottom: 4,
        });
        row.set_child(rowContentBox);

        const posterStack = new Gtk.Stack({
            transition_type: Gtk.StackTransitionType.CROSSFADE,
            width_request: 84,
            height_request: 126,
            vexpand: false,
        });

        const fallbackPosterBox = new Gtk.CenterBox({
            width_request: 84,
            height_request: 126,
            css_classes: ['search-result-poster-fallback'],
        });
        const fallbackPosterIcon = new Gtk.Image({
            icon_name: 'camera-video-symbolic',
            pixel_size: 30,
        });
        fallbackPosterBox.set_center_widget(fallbackPosterIcon);

        const posterImage = new Gtk.Picture({
            width_request: 84,
            height_request: 126,
            can_shrink: true,
            content_fit: Gtk.ContentFit.COVER,
            css_classes: ['search-result-poster'],
        });

        posterStack.add_named(fallbackPosterBox, 'fallback');
        posterStack.add_named(posterImage, 'poster');
        posterStack.set_visible_child_name('fallback');

        const posterFrame = new Gtk.Frame({
            css_classes: ['movie-poster-frame', 'search-result-poster-frame'],
            valign: Gtk.Align.START,
            child: posterStack,
        });
        rowContentBox.append(posterFrame);

        // Load poster asynchronously
        const posterUrl = buildPosterUrl(movie.poster_path);
        if (posterUrl) {
            loadTextureFromUrl(posterUrl).then(texture => {
                if (texture) {
                    posterImage.set_paintable(texture);
                    posterStack.set_visible_child_name('poster');
                }
            }).catch(() => {});
        }

        const textContainer = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 6,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        rowContentBox.append(textContainer);

        const titleLabel = new Gtk.Label({
            label: movie.title || 'Unknown Title',
            xalign: 0,
            wrap: true,
            wrap_mode: Pango.WrapMode.WORD_CHAR,
            css_classes: ['heading'],
        });
        textContainer.append(titleLabel);

        const subtitleLabel = new Gtk.Label({
            label: this._buildSubtitle(movie),
            xalign: 0,
            wrap: true,
            wrap_mode: Pango.WrapMode.WORD_CHAR,
            css_classes: ['caption', 'dim-label'],
        });
        textContainer.append(subtitleLabel);

        const taglineLabel = new Gtk.Label({
            xalign: 0,
            wrap: true,
            wrap_mode: Pango.WrapMode.WORD_CHAR,
            ellipsize: Pango.EllipsizeMode.END,
            lines: 2,
            css_classes: ['caption'],
        });
        this._setOptionalLabel(taglineLabel, this._formatTagline(movie.tagline));
        textContainer.append(taglineLabel);

        const overviewLabel = new Gtk.Label({
            xalign: 0,
            wrap: true,
            wrap_mode: Pango.WrapMode.WORD_CHAR,
            ellipsize: Pango.EllipsizeMode.END,
            lines: 3,
            css_classes: ['caption', 'dim-label'],
        });
        this._setOptionalLabel(overviewLabel, this._trimText(movie.overview, 220));
        textContainer.append(overviewLabel);

        if (!movie.tagline) {
            this._loadTagline(movie.id, taglineLabel);
        }

        return row;
    }

    _buildSubtitle(movie) {
        const parts = [];
        
        if (movie.release_date) {
            parts.push(movie.release_date.substring(0, 4));
        }
        
        if (movie.vote_average && movie.vote_average > 0) {
            parts.push(`★ ${movie.vote_average.toFixed(1)}`);
        }
        
        return parts.join(' • ') || 'Unknown Year';
    }

    _formatTagline(tagline) {
        if (!tagline)
            return '';
        return `"${this._trimText(tagline, 140)}"`;
    }

    _trimText(value, maxLength) {
        if (!value)
            return '';
        const normalized = value.trim().replace(/\s+/g, ' ');
        if (normalized.length <= maxLength)
            return normalized;
        return `${normalized.substring(0, maxLength - 1)}…`;
    }

    _setOptionalLabel(labelWidget, text) {
        const textValue = text || '';
        labelWidget.set_label(textValue);
        labelWidget.set_visible(Boolean(textValue));
    }

    async _loadTagline(tmdbId, taglineLabel) {
        try {
            const movieDetails = await getMovieDetails(tmdbId);
            this._setOptionalLabel(taglineLabel, this._formatTagline(movieDetails?.tagline));
        } catch {
            // Ignore failures for optional tagline loading.
        }
    }

    _showMovieDetail(tmdbId) {
        this.emit('view-details', tmdbId);
        this.close();
    }
});
