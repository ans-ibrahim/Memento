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
import Adw from 'gi://Adw';

import { getPersonDetails, getPersonMovieCredits, buildProfileUrl } from '../services/tmdb-service.js';
import { getAllWatchedTmdbIds, getAllWatchlistTmdbIds, getPersonByTmdbId, upsertPerson, getMoviesByPersonId } from '../utils/database-utils.js';
import { loadTextureFromUrlWithFallback } from '../utils/image-utils.js';
import { clearGrid } from '../utils/ui-utils.js';
import { createMovieCard } from '../widgets/movie-card.js';

export const MementoPersonPage = GObject.registerClass({
    GTypeName: 'MementoPersonPage',
    Template: 'resource:///app/memento/memento/pages/person-page.ui',
    InternalChildren: [
        'profile_image',
        'refresh_button',
        'name_label',
        'birthday_label',
        'place_of_birth_label',
        'known_for_label',
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

        this._refresh_button.connect('clicked', () => {
            this._refreshPersonData();
        });
        
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
            
            // If not in DB or missing important fields, fetch from TMDB
            if (!details || !details.biography || details.known_for === null) {
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

    async _refreshPersonData() {
        if (!this._personId) {
            return;
        }

        try {
            const tmdbDetails = await getPersonDetails(this._personId);
            await upsertPerson(this._personId, tmdbDetails);

            const details = await getPersonByTmdbId(this._personId);
            if (!details) {
                throw new Error('Failed to load person data from database.');
            }

            const [watchedIds, watchlistIds] = await Promise.all([
                getAllWatchedTmdbIds(),
                getAllWatchlistTmdbIds()
            ]);

            this._displayPersonInfo(details);
            await this._loadWatchedAndWatchlistMovies(watchedIds, watchlistIds);

            this._exploreLoaded = false;
            clearGrid(this._explore_grid);
            this._explore_empty_label.set_label('Click to explore more movies...');
            this._explore_empty_label.set_visible(true);

            if (this._stack.get_visible_child_name() === 'explore') {
                await this._loadExploreMovies();
            }
        } catch (error) {
            console.error('Failed to refresh person details:', error);
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
        
        clearGrid(this._watched_grid);
        clearGrid(this._watchlist_grid);

        let watchedCount = 0;
        let watchlistCount = 0;

        for (const movie of dbMovies) {
            const card = createMovieCard(movie, {
                compact: true,
                width: 140,
                height: 210,
                titleMaxChars: 16,
                marginStart: 4,
                marginEnd: 4,
                marginBottom: 8,
                showRating: false,
                showYear: true,
                jobText: movie.character || movie.job || '',
                onActivate: tmdbId => this.emit('view-movie', String(tmdbId || movie.id)),
            });
            
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

            clearGrid(this._explore_grid);

            for (const movie of unwatchedMovies) {
                const card = createMovieCard(movie, {
                    compact: true,
                    width: 140,
                    height: 210,
                    titleMaxChars: 16,
                    marginStart: 4,
                    marginEnd: 4,
                    marginBottom: 8,
                    showRating: false,
                    showYear: true,
                    jobText: movie.character || movie.job || '',
                    onActivate: tmdbId => this.emit('view-movie', String(tmdbId || movie.id)),
                });
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
            this._birthday_label.set_visible(true);
        } else {
            this._birthday_label.set_visible(false);
        }

        if (details.place_of_birth) {
            this._place_of_birth_label.set_label(details.place_of_birth);
            this._place_of_birth_label.set_visible(true);
        } else {
            this._place_of_birth_label.set_visible(false);
        }

        if (details.known_for) {
            this._known_for_label.set_label(`Known for: ${details.known_for}`);
            this._known_for_label.set_visible(true);
        } else {
            this._known_for_label.set_visible(false);
        }

        if (details.biography) {
            this._biography_label.set_label(details.biography);
            this._bio_box.set_visible(true);
        } else {
            this._bio_box.set_visible(false);
        }

        if (details.profile_path) {
            const profileUrl = buildProfileUrl(details.profile_path);
            loadTextureFromUrlWithFallback(profileUrl, details.profile_path).then(texture => {
                this._profile_image.set_paintable(texture);
            }).catch(console.error);
        }
    }
});
