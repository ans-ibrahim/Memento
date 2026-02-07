/* person-page.js
 *
 * Copyright 2026 Ans Ibrahim
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import { getPersonDetails, getPersonMovieCredits, buildPosterUrl, buildProfileUrl } from '../services/tmdb-service.js';
import { getAllWatchedTmdbIds, getAllWatchlistTmdbIds } from '../utils/database-utils.js';
import { loadTextureFromUrlWithFallback, loadTextureFromUrl } from '../utils/image-utils.js';

export const MementoPersonPage = GObject.registerClass({
    GTypeName: 'MementoPersonPage',
    Template: 'resource:///app/memento/memento/pages/person-page.ui',
    InternalChildren: [
        'profile_image',
        'name_label',
        'birthday_label',
        'place_of_birth_label',
        'bio_box',
        'biography_label',
        'watched_grid',
        'watched_empty_label',
        'watchlist_grid',
        'watchlist_empty_label',
        'unwatched_grid',
        'unwatched_empty_label',
    ],
    Signals: {
        'view-movie': { param_types: [GObject.TYPE_STRING] },
    },
}, class MementoPersonPage extends Adw.NavigationPage {
    _init(params = {}) {
        super._init(params);
        this._personId = null;
    }

    async loadPerson(personId) {
        this._personId = personId;
        
        try {
            // Fetch all data in parallel
            const [details, credits, watchedIds, watchlistIds] = await Promise.all([
                getPersonDetails(personId),
                getPersonMovieCredits(personId),
                getAllWatchedTmdbIds(),
                getAllWatchlistTmdbIds()
            ]);

            this._displayPersonInfo(details);
            this._categorizeAndDisplayMovies(credits, watchedIds, watchlistIds);
            
        } catch (error) {
            console.error('Failed to load person details:', error);
            // TODO: Show error state
        }
    }

    _displayPersonInfo(details) {
        this.title = details.name;
        this._name_label.set_label(details.name);

        if (details.birthday) {
            let birthText = new Date(details.birthday).toLocaleDateString();
            if (details.deathday) {
                const deathText = new Date(details.deathday).toLocaleDateString();
                birthText += ` - ${deathText}`;
            } else {
                // Calculate age
                const age = new Date().getFullYear() - new Date(details.birthday).getFullYear();
                birthText += ` (${age} years old)`;
            }
            this._birthday_label.set_label(birthText);
        } else {
            this._birthday_label.set_visible(false);
        }

        if (details.place_of_birth) {
            this._place_of_birth_label.set_label(details.place_of_birth);
        } else {
            this._place_of_birth_label.set_visible(false);
        }

        if (details.biography) {
            this._biography_label.set_label(details.biography);
            this._bio_box.set_visible(true);
        }

        if (details.profile_path) {
            const profileUrl = buildProfileUrl(details.profile_path);
            loadTextureFromUrlWithFallback(profileUrl).then(texture => {
                this._profile_image.set_paintable(texture);
            }).catch(console.error);
        }
    }

    _categorizeAndDisplayMovies(credits, watchedIds, watchlistIds) {
        const seenIds = new Set();
        const allCredits = [];
        
        // Process cast (acting roles)
        if (credits.cast) {
            credits.cast.forEach(credit => {
                if (!seenIds.has(credit.id)) {
                    seenIds.add(credit.id);
                    allCredits.push(credit);
                }
            });
        }

        // Process crew - only directors
        if (credits.crew) {
            const directors = credits.crew.filter(c => c.job === 'Director');
            directors.forEach(credit => {
                if (!seenIds.has(credit.id)) {
                    seenIds.add(credit.id);
                    allCredits.push(credit);
                }
            });
        }

        // Sort by release date descending
        allCredits.sort((a, b) => {
            if (!a.release_date) return 1;
            if (!b.release_date) return -1;
            return new Date(b.release_date) - new Date(a.release_date);
        });

        // Clear existing grids
        this._clearGrid(this._watched_grid);
        this._clearGrid(this._watchlist_grid);
        this._clearGrid(this._unwatched_grid);

        let watchedCount = 0;
        let watchlistCount = 0;
        let unwatchedCount = 0;

        for (const movie of allCredits) {
            const card = this._createMovieCard(movie);
            
            if (watchedIds.has(movie.id)) {
                this._watched_grid.append(card);
                watchedCount++;
            } else if (watchlistIds.has(movie.id)) {
                this._watchlist_grid.append(card);
                watchlistCount++;
            } else {
                this._unwatched_grid.append(card);
                unwatchedCount++;
            }
        }

        this._watched_empty_label.set_visible(watchedCount === 0);
        this._watchlist_empty_label.set_visible(watchlistCount === 0);
        this._unwatched_empty_label.set_visible(unwatchedCount === 0);
    }

    _clearGrid(grid) {
        let child = grid.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            grid.remove(child);
            child = next;
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
            width_request: 140,
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
            width_request: 140,
            height_request: 210,
            hexpand: false,
            vexpand: false,
            css_classes: ['movie-poster'],
        });

        // Load poster image
        if (movie.poster_path) {
            const posterUrl = buildPosterUrl(movie.poster_path);
            loadTextureFromUrl(posterUrl).then(texture => {
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
            margin_start: 4,
            margin_end: 4,
            margin_bottom: 8,
        });

        // Title
        const titleLabel = new Gtk.Label({
            label: movie.title || 'Unknown',
            css_classes: ['heading'],
            xalign: 0,
            ellipsize: 3, // PANGO_ELLIPSIZE_END
            lines: 2,
            wrap: true,
            max_width_chars: 16,
        });
        infoBox.append(titleLabel);

        // Character/Job (if available)
        const jobText = movie.character || movie.job || '';
        if (jobText) {
             const jobLabel = new Gtk.Label({
                label: jobText,
                css_classes: ['caption', 'dim-label'],
                xalign: 0,
                ellipsize: 3,
                lines: 1,
            });
            infoBox.append(jobLabel);
        }

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

        card.append(infoBox);
        button.set_child(card);

        // Add click handler to emit signal
        button.connect('clicked', () => {
            this.emit('view-movie', String(movie.id));
        });

        return button;
    }
});
