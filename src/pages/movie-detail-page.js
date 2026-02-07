/* movie-detail-page.js
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

import { getMovieDetails, getMovieCredits, buildPosterUrl, buildProfileUrl, buildImdbUrl, buildTmdbUrl, buildLetterboxdUrl } from '../services/tmdb-service.js';
import { 
    findMovieByTmdbId, 
    upsertMovieFromTmdb, 
    upsertPerson,
    upsertMovieCredits,
    getMovieById,
    getMovieCredits as getDbCredits,
    addMovieToWatchlist,
    removeFromWatchlist,
    isInWatchlist,
    addPlay,
    updatePlay,
    getPlaysForMovie,
    deletePlay,
    getAllPlaces
} from '../utils/database-utils.js';
import { loadTextureFromUrlWithFallback } from '../utils/image-utils.js';

export const MementoMovieDetailPage = GObject.registerClass({
    GTypeName: 'MementoMovieDetailPage',
    Template: 'resource:///app/memento/memento/pages/movie-detail-page.ui',
    InternalChildren: [
        'title_label',
        'tagline_label',
        'poster_image',
        'watchlist_button',
        'add_play_button',
        'plays_count_label',
        'plays_list',
        'main_content_box',
        'left_sidebar',
        'right_content',
        'metadata_group',
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
    ],
    Signals: {
        'watchlist-changed': {},
        'view-person': { param_types: [GObject.TYPE_STRING] },
    },
}, class MementoMovieDetailPage extends Adw.NavigationPage {
    _tmdbId = null;
    _movieId = null;
    _movieData = null;

    _init(params = {}) {
        super._init(params);
        this._movieId = null;
        this._setupActions();
        this._setupResponsiveLayout();
    }

    _setupResponsiveLayout() {
        // Set up a breakpoint to switch layout on narrow screens
        const win = this.get_root();
        if (!win) return;

        // Use a size allocate signal to detect width changes
        this._main_content_box.connect('notify::allocation', () => {
            const width = this._main_content_box.get_allocation().width;
            
            // Switch to vertical layout on screens narrower than 700px
            if (width < 700) {
                this._main_content_box.set_orientation(Gtk.Orientation.VERTICAL);
                this._main_content_box.set_spacing(20);
                // Make poster smaller on mobile
                this._poster_image.set_width_request(200);
                this._poster_image.set_height_request(300);
                // Center sideb ar content
                this._left_sidebar.set_halign(Gtk.Align.CENTER);
            } else {
                this._main_content_box.set_orientation(Gtk.Orientation.HORIZONTAL);
                this._main_content_box.set_spacing(32);
                // Restore normal poster size
                this._poster_image.set_width_request(250);
                this._poster_image.set_height_request(375);
                this._left_sidebar.set_halign(Gtk.Align.FILL);
            }
        });
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
            
            // Check if movie is in watchlist
            this._isInWatchlist = await isInWatchlist(this._movieId);
            
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
                // Upsert person first
                const personId = await upsertPerson(director.id, {
                    name: director.name,
                    profile_path: director.profile_path || null
                });

                credits.push({
                    person_id: personId,
                    role_type: 'director',
                    character_name: null,
                    display_order: order++
                });
            }

            // Process producers
            const producers = creditsData.crew.filter(c => c.job === 'Producer');
            for (const producer of producers.slice(0, 5)) {
                // Upsert person first
                const personId = await upsertPerson(producer.id, {
                    name: producer.name,
                    profile_path: producer.profile_path || null
                });

                credits.push({
                    person_id: personId,
                    role_type: 'producer',
                    character_name: null,
                    display_order: order++
                });
            }
        }

        // Process cast
        if (creditsData.cast) {
            for (const actor of creditsData.cast.slice(0, 10)) {
                // Upsert person first
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
            loadTextureFromUrlWithFallback(this._movieData.poster).then(texture => {
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

        // Display directors with photos
        if (directors.length > 0) {
            this._displayPeopleGrid(directors, this._directors_label, this._directors_box);
        }

        // Display producers with photos
        if (producers.length > 0) {
            this._displayPeopleGrid(producers, this._producers_label, this._producers_box);
        }

        // Display cast with photos
        if (cast.length > 0) {
            this._displayPeopleGrid(cast, this._cast_label, this._cast_box);
        }
    }

    _displayPeopleGrid(people, label, box) {
        // Hide the text label
        label.set_visible(false);
        
        // Remove any existing grid (check if last child is a FlowBox)
        const parent = label.get_parent();
        const lastChild = parent.get_last_child();
        if (lastChild instanceof Gtk.FlowBox) {
            parent.remove(lastChild);
        }
        
        // Create a horizontal flow box for people
        const grid = new Gtk.FlowBox({
            selection_mode: Gtk.SelectionMode.NONE,
            max_children_per_line: 5,
            min_children_per_line: 2,
            column_spacing: 16,
            row_spacing: 16,
            homogeneous: true,
            margin_top: 12,
        });
        
        // Add people with photos
        for (const person of people) {
            const memberBox = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 8,
                halign: Gtk.Align.CENTER,
            });
            
            // Profile photo with circular frame
            const pictureFrame = new Gtk.Frame({
                css_classes: ['profile-photo'],
            });
            
            const picture = new Gtk.Picture({
                width_request: 80,
                height_request: 80,
                css_classes: ['circular'],
                can_shrink: false,
            });
            
            pictureFrame.set_child(picture);
            
            // Load profile photo asynchronously
            (async () => {
                try {
                    const profileUrl = buildProfileUrl(person.profile_path);
                    const texture = await loadTextureFromUrlWithFallback(profileUrl);
                    picture.set_paintable(texture);
                } catch (error) {
                    console.error('Failed to load profile photo:', error);
                }
            })();
            
            // Name label
            const nameLabel = new Gtk.Label({
                label: person.person_name,
                wrap: true,
                wrap_mode: 2, // WORD_CHAR
                max_width_chars: 15,
                justify: Gtk.Justification.CENTER,
                css_classes: ['caption', 'dim-label'],
            });
            
            // Make clickable
            // Use a button instead of just a box to make it clickable and provide visual feedback
            const button = new Gtk.Button({
                css_classes: ['flat', 'person-card'],
            });
            
            button.connect('clicked', () => {
                // Emit the TMDB person ID for navigation
                if (person.tmdb_person_id) {
                    this.emit('view-person', String(person.tmdb_person_id));
                } else {
                    console.warn('No TMDB person ID available for', person.person_name);
                }
            });

            // Character name label
            if (person.character_name) {
                const characterLabel = new Gtk.Label({
                    label: person.character_name,
                    wrap: true,
                    wrap_mode: 2,
                    max_width_chars: 15,
                    justify: Gtk.Justification.CENTER,
                    css_classes: ['caption-heading'],
                });
                memberBox.append(pictureFrame);
                memberBox.append(characterLabel);
                memberBox.append(nameLabel);
            } else {
                memberBox.append(pictureFrame);
                memberBox.append(nameLabel);
            }
            
            button.set_child(memberBox);
            grid.append(button);
        }
        
        // Add grid to box
        parent.append(grid);
        box.set_visible(true);
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
        this._isInWatchlist = inWatchlist;
        
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
        contentArea.set_spacing(12);

        // Date picker
        const dateLabel = new Gtk.Label({
            label: 'Watch Date:',
            xalign: 0,
        });
        contentArea.append(dateLabel);

        const calendar = new Gtk.Calendar();
        contentArea.append(calendar);

        // Watch order
        const orderLabel = new Gtk.Label({
            label: 'Watch Order (if multiple movies same day):',
            xalign: 0,
            margin_top: 12,
        });
        contentArea.append(orderLabel);

        const orderSpinButton = Gtk.SpinButton.new_with_range(1, 10, 1);
        orderSpinButton.set_value(1);
        contentArea.append(orderSpinButton);

        // Place selector
        const placeLabel = new Gtk.Label({
            label: 'Place (optional):',
            xalign: 0,
            margin_top: 12,
        });
        contentArea.append(placeLabel);

        const placeDropdown = new Gtk.DropDown({
            model: null,
        });

        // Load places
        const places = await getAllPlaces();
        const placeNames = ['None', ...places.map(p => p.name)];
        const stringList = new Gtk.StringList();
        for (const name of placeNames) {
            stringList.append(name);
        }
        placeDropdown.set_model(stringList);

        contentArea.append(placeDropdown);

        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Add', Gtk.ResponseType.OK);

        dialog.connect('response', async (dlg, response) => {
            if (response === Gtk.ResponseType.OK) {
                const date = calendar.get_date();
                const isoDate = `${date.get_year()}-${String(date.get_month() + 1).padStart(2, '0')}-${String(date.get_day_of_month()).padStart(2, '0')}`;
                
                // Get selected place
                const selectedIndex = placeDropdown.get_selected();
                let placeId = null;
                if (selectedIndex > 0) {
                    placeId = places[selectedIndex - 1].id;
                }
                
                const watchOrder = orderSpinButton.get_value_as_int();
                
                await addPlay(this._movieId, isoDate, placeId, watchOrder);
                await this._loadPlays();
                
                // Check if auto-remove from watchlist is enabled
                try {
                    const settings = new Gio.Settings({ schema_id: 'app.memento.memento' });
                    const autoRemove = settings.get_boolean('auto-remove-from-watchlist');
                    
                    console.log('Auto-remove setting:', autoRemove);
                    console.log('Is in watchlist:', this._isInWatchlist);
                    console.log('Movie ID:', this._movieId);
                    
                    if (autoRemove && this._isInWatchlist) {
                        console.log('Removing movie from watchlist...');
                        await removeFromWatchlist(this._movieId);
                        this._isInWatchlist = false;
                        this._updateWatchlistButton();
                        this.emit('watchlist-changed');
                        console.log('Movie removed from watchlist');
                    }
                } catch (error) {
                    console.error('Failed to check auto-remove setting:', error);
                }
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

        // Left side: Date and optional place
        const leftBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            hexpand: true,
            spacing: 4,
        });

        // Format date
        const dateLabel = new Gtk.Label({
            label: this._formatDate(play.watched_at),
            xalign: 0,
        });
        leftBox.append(dateLabel);

        // Show place if available
        if (play.place_id && play.place_name) {
            const placeLabel = new Gtk.Label({
                label: play.is_cinema ? `🎬 ${play.place_name}` : `🏠 ${play.place_name}`,
                xalign: 0,
                css_classes: ['dim-label', 'caption'],
            });
            leftBox.append(placeLabel);
        }

        box.append(leftBox);

        // Action buttons box
        const actionsBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
        });

        // Edit button
        const editButton = new Gtk.Button({
            icon_name: 'document-edit-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Edit Play',
            css_classes: ['flat'],
        });

        editButton.connect('clicked', () => {
            this._showEditPlayDialog(play).catch(error => {
                console.error('Failed to show edit dialog:', error);
            });
        });

        actionsBox.append(editButton);

        // Delete button
        const deleteButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Delete Play',
            css_classes: ['flat', 'destructive-action'],
        });

        deleteButton.connect('clicked', async () => {
            const dialog = new Adw.AlertDialog({
                heading: 'Delete Play?',
                body: `Are you sure you want to delete this play from ${this._formatDate(play.watched_at)}?`,
            });

            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('delete', 'Delete');
            dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);

            dialog.connect('response', async (dlg, response) => {
                if (response === 'delete') {
                    await deletePlay(play.id);
                    await this._loadPlays();
                }
            });

            dialog.present(this.get_root());
        });

        actionsBox.append(deleteButton);
        box.append(actionsBox);

        return box;
    }

    async _showEditPlayDialog(play) {
        console.log('Opening edit dialog for play:', play.id);
        
        const dialog = new Gtk.Dialog({
            title: 'Edit Play',
            modal: true,
            transient_for: this.get_root(),
        });

        const contentArea = dialog.get_content_area();
        contentArea.set_margin_start(24);
        contentArea.set_margin_end(24);
        contentArea.set_margin_top(24);
        contentArea.set_margin_bottom(24);
        contentArea.set_spacing(12);

        // Date picker
        const dateLabel = new Gtk.Label({
            label: 'Watch Date:',
            xalign: 0,
        });
        contentArea.append(dateLabel);

        const calendar = new Gtk.Calendar();
        
        // Set calendar to the play's date - GTK4 API uses GDateTime directly
        try {
            const playDate = new Date(play.watched_at);
            const gDateTime = GLib.DateTime.new_local(
                playDate.getFullYear(),
                playDate.getMonth() + 1,
                playDate.getDate(),
                0, 0, 0
            );
            calendar.select_day(gDateTime);
        } catch (error) {
            console.error('Failed to set calendar date:', error);
        }
        
        contentArea.append(calendar);

        // Watch order
        const orderLabel = new Gtk.Label({
            label: 'Watch Order:',
            xalign: 0,
            margin_top: 12,
        });
        contentArea.append(orderLabel);

        const orderSpinButton = Gtk.SpinButton.new_with_range(1, 10, 1);
        orderSpinButton.set_value(play.watch_order || 1);
        contentArea.append(orderSpinButton);

        // Place selector
        const placeLabel = new Gtk.Label({
            label: 'Place (optional):',
            xalign: 0,
            margin_top: 12,
        });
        contentArea.append(placeLabel);

        const placeDropdown = new Gtk.DropDown({
            model: null,
        });

        // Load places
        const places = await getAllPlaces();
        const placeNames = ['None', ...places.map(p => p.name)];
        const stringList = new Gtk.StringList();
        for (const name of placeNames) {
            stringList.append(name);
        }
        placeDropdown.set_model(stringList);

        // Set current place selection
        if (play.place_id) {
            const placeIndex = places.findIndex(p => p.id === play.place_id);
            if (placeIndex >= 0) {
                placeDropdown.set_selected(placeIndex + 1);
            }
        }

        contentArea.append(placeDropdown);

        dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
        dialog.add_button('Save', Gtk.ResponseType.OK);

        dialog.connect('response', async (dlg, response) => {
            if (response === Gtk.ResponseType.OK) {
                const date = calendar.get_date();
                const isoDate = `${date.get_year()}-${String(date.get_month() + 1).padStart(2, '0')}-${String(date.get_day_of_month()).padStart(2, '0')}`;
                
                // Get selected place
                const selectedIndex = placeDropdown.get_selected();
                let placeId = null;
                if (selectedIndex > 0) {
                    placeId = places[selectedIndex - 1].id;
                }
                
                const watchOrder = orderSpinButton.get_value_as_int();
                
                try {
                    await updatePlay(play.id, isoDate, placeId, watchOrder);
                    await this._loadPlays();
                } catch (error) {
                    console.error('Failed to update play:', error);
                }
            }
            dlg.close();
        });

        console.log('Presenting edit dialog');
        dialog.present();
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
