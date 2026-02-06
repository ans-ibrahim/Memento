/* movie-detail-dialog.js
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
import Gio from 'gi://Gio';

import { getMovieDetails, getMovieCredits, buildPosterUrl, buildImdbUrl, buildTmdbUrl, buildLetterboxdUrl } from '../services/tmdb-service.js';
import { 
    findMovieByTmdbId, 
    upsertMovieFromTmdb, 
    upsertMovieCredits,
    getMovieById,
    getMovieCredits as getDbCredits,
    addMovieToWatchlist,
    removeFromWatchlist,
    isInWatchlist,
    addPlay,
    getPlaysForMovie,
    deletePlay
} from '../utils/database-utils.js';
import { loadTextureFromUrl } from '../utils/image-utils.js';

export const MementoMovieDetailDialog = GObject.registerClass({
    GTypeName: 'MementoMovieDetailDialog',
    Template: 'resource:///app/memento/memento/dialogs/movie-detail-dialog.ui',
    InternalChildren: [
        'poster_image',
        'title_label',
        'tagline_label',
        'year_row',
        'runtime_row',
        'rating_row',
        'revenue_row',
        'overview_box',
        'overview_label',
        'imdb_button',
        'tmdb_button',
        'letterboxd_button',
        'credits_box',
        'directors_box',
        'directors_label',
        'producers_box',
        'producers_label',
        'cast_box',
        'cast_label',
        'watchlist_button',
        'add_play_button',
        'plays_count_label',
        'plays_list'
    ],
    Signals: {
        'watchlist-changed': {},
        'movie-added': {},
    },
}, class MementoMovieDetailDialog extends Adw.Dialog {
    _tmdbId = null;
    _movieId = null;
    _movieData = null;

    constructor(params = {}) {
        super(params);
    }

    async loadMovie(tmdbId) {
        this._tmdbId = tmdbId;
        
        try {
            // Fetch movie details from TMDB
            const details = await getMovieDetails(tmdbId);
            const credits = await getMovieCredits(tmdbId);
            
            // Save to database
            this._movieId = await upsertMovieFromTmdb(details);
            
            // Process and save credits
            await this._saveCredits(credits);
            
            // Load from database to get complete info
            this._movieData = await getMovieById(this._movieId);
            
            if (!this._movieData) {
                console.error('Failed to load movie data from database');
                return;
            }
            
            // Display the data
            this._displayMovieInfo();
            this._displayCredits();
            await this._updateWatchlistButton();
            await this._loadPlays();
            
            // Setup actions after data is loaded
            this._setupActions();
            
        } catch (error) {
            console.error('Failed to load movie:', error);
            // Show error to user
            this._title_label.set_label('Error loading movie');
            this._overview_label.set_label(error.message || 'An error occurred while loading movie details.');
            this._overview_box.set_visible(true);
        }
    }

    async _saveCredits(creditsData) {
        const credits = [];
        let order = 0;

        // Process directors
        if (creditsData.crew) {
            const directors = creditsData.crew.filter(c => c.job === 'Director');
            for (const director of directors) {
                credits.push({
                    person_name: director.name,
                    role_type: 'director',
                    character_name: null,
                    display_order: order++
                });
            }

            // Process producers
            const producers = creditsData.crew.filter(c => c.job === 'Producer');
            for (const producer of producers.slice(0, 5)) { // Limit to 5 producers
                credits.push({
                    person_name: producer.name,
                    role_type: 'producer',
                    character_name: null,
                    display_order: order++
                });
            }
        }

        // Process cast
        if (creditsData.cast) {
            for (const actor of creditsData.cast.slice(0, 10)) { // Limit to 10 cast members
                credits.push({
                    person_name: actor.name,
                    role_type: 'actor',
                    character_name: actor.character || null,
                    display_order: order++
                });
            }
        }

        await upsertMovieCredits(this._movieId, credits);
    }

    _displayMovieInfo() {
        // Title and tagline
        this._title_label.set_label(this._movieData.title || 'Unknown');
        
        if (this._movieData.tagline) {
            this._tagline_label.set_label(this._movieData.tagline);
            this._tagline_label.set_visible(true);
        }

        // Year
        if (this._movieData.release_date) {
            const year = this._movieData.release_date.substring(0, 4);
            this._year_row.set_subtitle(year);
            this._year_row.set_visible(true);
        }

        // Runtime
        if (this._movieData.runtime) {
            const hours = Math.floor(this._movieData.runtime / 60);
            const minutes = this._movieData.runtime % 60;
            const runtimeText = hours > 0 
                ? `${hours}h ${minutes}m` 
                : `${minutes}m`;
            this._runtime_row.set_subtitle(runtimeText);
            this._runtime_row.set_visible(true);
        }

        // Rating
        if (this._movieData.tmdb_average) {
            const ratingText = `${this._movieData.tmdb_average.toFixed(1)}/10`;
            this._rating_row.set_subtitle(ratingText);
            this._rating_row.set_visible(true);
        }

        // Revenue
        if (this._movieData.revenue && this._movieData.revenue > 0) {
            const revenueText = this._formatCurrency(this._movieData.revenue);
            this._revenue_row.set_subtitle(revenueText);
            this._revenue_row.set_visible(true);
        }

        // Overview
        if (this._movieData.overview) {
            this._overview_label.set_label(this._movieData.overview);
            this._overview_box.set_visible(true);
        }

        // Poster
        if (this._movieData.poster) {
            loadTextureFromUrl(this._movieData.poster).then(texture => {
                if (texture) {
                    this._poster_image.set_paintable(texture);
                }
            }).catch(() => {});
        }
    }

    async _displayCredits() {
        const credits = await getDbCredits(this._movieId);
        
        if (credits.length === 0) {
            return;
        }

        this._credits_box.set_visible(true);

        // Group credits by role
        const directors = credits.filter(c => c.role_type === 'director');
        const producers = credits.filter(c => c.role_type === 'producer');
        const cast = credits.filter(c => c.role_type === 'actor');

        // Display directors
        if (directors.length > 0) {
            const directorNames = directors.map(d => d.person_name).join(', ');
            this._directors_label.set_label(directorNames);
            this._directors_box.set_visible(true);
        }

        // Display producers
        if (producers.length > 0) {
            const producerNames = producers.map(p => p.person_name).join(', ');
            this._producers_label.set_label(producerNames);
            this._producers_box.set_visible(true);
        }

        // Display cast
        if (cast.length > 0) {
            const castText = cast.map(c => {
                if (c.character_name) {
                    return `${c.person_name} as ${c.character_name}`;
                }
                return c.person_name;
            }).join(', ');
            this._cast_label.set_label(castText);
            this._cast_box.set_visible(true);
        }
    }

    _setupActions() {
        if (!this._movieData) {
            return;
        }

        // External links
        this._imdb_button.connect('clicked', () => {
            const url = buildImdbUrl(this._movieData.imdb_id);
            if (url) {
                this._openUrl(url);
            }
        });

        this._tmdb_button.connect('clicked', () => {
            const url = buildTmdbUrl(this._movieData.tmdb_id);
            if (url) {
                this._openUrl(url);
            }
        });

        this._letterboxd_button.connect('clicked', () => {
            const url = buildLetterboxdUrl(this._movieData.imdb_id, this._movieData.title);
            if (url) {
                this._openUrl(url);
            }
        });

        // Watchlist button
        this._watchlist_button.connect('clicked', () => {
            this._toggleWatchlist();
        });

        // Add play button
        this._add_play_button.connect('clicked', () => {
            this._showAddPlayDialog();
        });
    }

    _openUrl(url) {
        try {
            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch (error) {
            console.error('Failed to open URL:', error);
        }
    }

    async _updateWatchlistButton() {
        const inWatchlist = await isInWatchlist(this._movieId);
        
        if (inWatchlist) {
            this._watchlist_button.set_label('Remove from Watchlist');
            this._watchlist_button.remove_css_class('suggested-action');
            this._watchlist_button.add_css_class('destructive-action');
        } else {
            this._watchlist_button.set_label('Add to Watchlist');
            this._watchlist_button.remove_css_class('destructive-action');
            this._watchlist_button.add_css_class('suggested-action');
        }
    }

    async _toggleWatchlist() {
        const inWatchlist = await isInWatchlist(this._movieId);
        
        if (inWatchlist) {
            await removeFromWatchlist(this._movieId);
        } else {
            await addMovieToWatchlist(this._movieId);
            this.emit('movie-added');
        }
        
        await this._updateWatchlistButton();
        this.emit('watchlist-changed');
    }

    async _showAddPlayDialog() {
        const dialog = new Gtk.Dialog({
            title: 'Add a Play',
            modal: true,
            transient_for: this.get_root(),
        });

        const contentArea = dialog.get_content_area();
        contentArea.set_margin_start(24);
        contentArea.set_margin_end(24);
        contentArea.set_margin_top(24);
        contentArea.set_margin_bottom(24);

        const calendar = new Gtk.Calendar();
        contentArea.append(calendar);

        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Add', Gtk.ResponseType.OK);

        dialog.connect('response', async (dlg, response) => {
            if (response === Gtk.ResponseType.OK) {
                const date = calendar.get_date();
                const isoDate = `${date.get_year()}-${String(date.get_month() + 1).padStart(2, '0')}-${String(date.get_day_of_month()).padStart(2, '0')}`;
                
                await addPlay(this._movieId, isoDate);
                await this._loadPlays();
            }
            dlg.close();
        });

        dialog.present();
    }

    async _loadPlays() {
        // Clear existing plays
        let child = this._plays_list.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._plays_list.remove(child);
            child = next;
        }

        const plays = await getPlaysForMovie(this._movieId);
        
        if (plays.length === 0) {
            this._plays_count_label.set_label('No plays recorded');
        } else {
            const countText = plays.length === 1 
                ? '1 play recorded' 
                : `${plays.length} plays recorded`;
            this._plays_count_label.set_label(countText);

            // Add play entries
            for (const play of plays) {
                const playEntry = this._createPlayEntry(play);
                this._plays_list.append(playEntry);
            }
        }
    }

    _createPlayEntry(play) {
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 12,
            margin_start: 12,
            margin_end: 12,
            margin_top: 6,
            margin_bottom: 6,
        });

        // Format date
        const dateLabel = new Gtk.Label({
            label: this._formatDate(play.watched_at),
            hexpand: true,
            xalign: 0,
        });
        box.append(dateLabel);

        // Delete button
        const deleteButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Delete Play',
            css_classes: ['flat', 'destructive-action'],
        });

        deleteButton.connect('clicked', async () => {
            await deletePlay(play.id);
            await this._loadPlays();
        });

        box.append(deleteButton);

        return box;
    }

    _formatDate(isoDate) {
        try {
            const date = new Date(isoDate);
            return date.toLocaleDateString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
            });
        } catch {
            return isoDate;
        }
    }

    _formatCurrency(amount) {
        if (amount >= 1000000000) {
            return `$${(amount / 1000000000).toFixed(2)}B`;
        } else if (amount >= 1000000) {
            return `$${(amount / 1000000).toFixed(2)}M`;
        } else if (amount >= 1000) {
            return `$${(amount / 1000).toFixed(2)}K`;
        }
        return `$${amount}`;
    }
});
