/* plays-page.js
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

import { getAllPlays, deletePlay } from '../utils/database-utils.js';
import { loadTextureFromUrl } from '../utils/image-utils.js';

export const MementoPlaysPage = GObject.registerClass({
    GTypeName: 'MementoPlaysPage',
    Template: 'resource:///app/memento/memento/pages/plays-page.ui',
    InternalChildren: ['plays_stack', 'plays_grid'],
    Signals: {
        'play-deleted': {},
        'view-movie': {param_types: [GObject.TYPE_INT]},
    },
}, class MementoPlaysPage extends Adw.NavigationPage {
    
    constructor(params = {}) {
        super(params);
        this._loadPlays();
    }

    async _loadPlays() {
        try {
            const plays = await getAllPlays();

            // Clear existing items
            let child = this._plays_grid.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                this._plays_grid.remove(child);
                child = next;
            }

            if (plays.length === 0) {
                this._plays_stack.set_visible_child_name('empty');
                return;
            }

            // Add play cards
            for (const play of plays) {
                const card = this._createPlayCard(play);
                this._plays_grid.append(card);
            }

            this._plays_stack.set_visible_child_name('plays');
        } catch (error) {
            console.error('Failed to load plays:', error);
        }
    }

    _createPlayCard(play) {
        const card = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            width_request: 160,
            hexpand: false,
            vexpand: false,
            halign: Gtk.Align.CENTER,
            css_classes: ['movie-card'],
        });

        // Poster container
        const posterFrame = new Gtk.Frame({
            css_classes: ['movie-poster-frame'],
        });

        const posterButton = new Gtk.Button({
            css_classes: ['flat'],
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
        if (play.poster) {
            loadTextureFromUrl(play.poster).then(texture => {
                if (texture) {
                    posterImage.set_paintable(texture);
                }
            }).catch(() => {});
        }

        posterButton.set_child(posterImage);
        posterButton.connect('clicked', () => {
            this.emit('view-movie', play.tmdb_id);
        });

        posterFrame.set_child(posterButton);
        card.append(posterFrame);

        // Movie info section
        const infoBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            margin_start: 8,
            margin_end: 8,
            margin_bottom: 8,
        });

        // Title
        const titleLabel = new Gtk.Label({
            label: play.title || 'Unknown',
            css_classes: ['heading'],
            xalign: 0,
            ellipsize: 3, // PANGO_ELLIPSIZE_END
            lines: 2,
            wrap: true,
            max_width_chars: 18,
        });
        infoBox.append(titleLabel);

        // Watch date
        const dateLabel = new Gtk.Label({
            label: this._formatDate(play.watched_at),
            css_classes: ['dim-label', 'caption'],
            xalign: 0,
        });
        infoBox.append(dateLabel);

        // Actions box
        const actionsBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.START,
        });

        // Delete button
        const deleteButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: 'Delete Play',
            css_classes: ['flat', 'destructive-action'],
        });

        deleteButton.connect('clicked', async () => {
            await deletePlay(play.id);
            this.emit('play-deleted');
            this._loadPlays();
        });

        actionsBox.append(deleteButton);
        infoBox.append(actionsBox);

        card.append(infoBox);

        return card;
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

    reload() {
        this._loadPlays();
    }
});
