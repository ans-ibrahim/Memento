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
import { getAllWatchedTmdbIds, getAllWatchlistTmdbIds, getPersonByTmdbId, upsertPerson, getMoviesByPersonId } from '../utils/database-utils.js';
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
        'stack',
        'watched_grid',
        'watched_empty_label',
        'watchlist_grid',
        'watchlist_empty_label',
        'explore_grid',
        'explore_empty_label',
    ],
    Signals: {
        'view-movie': { param_types: [GObject.TYPE_STRING] },
    },
}, class MementoPersonPage extends Adw.NavigationPage {
    _init(params = {}) {
        super._init(params);
        this._personId = null;
        this._exploreLoaded = false;
        
        // Connect to stack page changes to detect when Explore More tab is shown
        this._stack.connect('notify::visible-child-name', () => {
            this._onTabChanged();
        });
    }

    async loadPerson(personId) {
        this._personId = personId;
        this._exploreLoaded = false;
        
        try {
            // Check local database first
            let details = await getPersonByTmdbId(personId);
            
            // If not in DB or missing biography, fetch from TMDB
            if (!details || !details.biography) {
                const tmdbDetails = await getPersonDetails(personId);
                
                // Save to database for future use
                await upsertPerson(personId, tmdbDetails);
                
                // Re-fetch from DB to get consistent format
                details = await getPersonByTmdbId(personId);
            }

            // Fetch watch status
            const [watchedIds, watchlistIds] = await Promise.all([
                getAllWatchedTmdbIds(),
                getAllWatchlistTmdbIds()
            ]);

            this._displayPersonInfo(details);
            
            // Load only watched and watchlist movies from database (no API call)
            await this._loadWatchedAndWatchlistMovies(watchedIds, watchlistIds);
            
        } catch (error) {
            console.error('Failed to load person details:', error);
            // TODO: Show error state
        }
    }

    async _onTabChanged() {
        const currentPage = this._stack.get_visible_child_name();
        
        // When user switches to Explore More tab and we haven't loaded it yet
        if (currentPage === 'explore' && !this._exploreLoaded && this._personId) {
            this._exploreLoaded = true;
            await this._loadExploreMovies();
        }
    }

    async _loadWatchedAndWatchlistMovies(watchedIds, watchlistIds) {
        // Get person's credits from database only (movies we know about)
        const dbMovies = await this._getPersonMoviesFromDb();
        
        this._clearGrid(this._watched_grid);
        this._clearGrid(this._watchlist_grid);

        let watchedCount = 0;
        let watchlistCount = 0;

        for (const movie of dbMovies) {
            const card = this._createMovieCard(movie);
            
            if (watchedIds.has(movie.tmdb_id)) {
                this._watched_grid.append(card);
                watchedCount++;
            } else if (watchlistIds.has(movie.tmdb_id)) {
                this._watchlist_grid.append(card);
                watchlistCount++;
            }
        }

        this._watched_empty_label.set_visible(watchedCount === 0);
        this._watchlist_empty_label.set_visible(watchlistCount === 0);
    }

    async _loadExploreMovies() {
        try {
            // Fetch full filmography from TMDB (only when needed)
            const credits = await getPersonMovieCredits(this._personId);
            
            const [watchedIds, watchlistIds] = await Promise.all([
                getAllWatchedTmdbIds(),
                getAllWatchlistTmdbIds()
            ]);
            
            // Filter to only show unwatched movies (acting & directing only)
            const seenIds = new Set();
            const unwatchedMovies = [];
            
            // Process cast (acting roles)
            if (credits.cast) {
                credits.cast.forEach(credit => {
                    if (!seenIds.has(credit.id) && !watchedIds.has(credit.id) && !watchlistIds.has(credit.id)) {
                        seenIds.add(credit.id);
                        unwatchedMovies.push(credit);
                    }
                });
            }

            // Process crew - only directors
            if (credits.crew) {
                const directors = credits.crew.filter(c => c.job === 'Director');
                directors.forEach(credit => {
                    if (!seenIds.has(credit.id) && !watchedIds.has(credit.id) && !watchlistIds.has(credit.id)) {
                        seenIds.add(credit.id);
                        unwatchedMovies.push(credit);
                    }
                });
            }

            // Sort by release date descending
            unwatchedMovies.sort((a, b) => {
                if (!a.release_date) return 1;
                if (!b.release_date) return -1;
                return new Date(b.release_date) - new Date(a.release_date);
            });

            this._clearGrid(this._explore_grid);

            for (const movie of unwatchedMovies) {
                const card = this._createMovieCard(movie);
                this._explore_grid.append(card);
            }

            this._explore_empty_label.set_visible(unwatchedMovies.length === 0);
            if (unwatchedMovies.length === 0) {
                this._explore_empty_label.set_label('No other movies found.');
            }
            
        } catch (error) {
            console.error('Failed to load explore movies:', error);
            this._explore_empty_label.set_label('Failed to load movies.');
        }
    }

    async _getPersonMoviesFromDb() {
        // Get the local person record first
        const person = await getPersonByTmdbId(this._personId);
        if (!person) {
            return [];
        }
        
        // Query movies this person is credited in
        return await getMoviesByPersonId(person.id);
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
