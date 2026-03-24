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
import Gtk from 'gi://Gtk';

import { getPersonDetails, getPersonTitleCredits, buildProfileUrl } from '../services/tmdb-service.js';
import {
    getAllWatchedTitleKeys,
    getAllWatchlistTitleKeys,
    getPersonByTmdbId,
    upsertPerson,
    getMoviesByPersonId
} from '../utils/database-utils.js';
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
        'watched_role_dropdown',
        'watched_grid',
        'watched_empty_label',
        'watchlist_role_dropdown',
        'watchlist_grid',
        'watchlist_empty_label',
        'explore_role_dropdown',
        'explore_grid',
        'explore_empty_label',
    ],
    Signals: {
        'view-movie': { param_types: [GObject.TYPE_STRING, GObject.TYPE_STRING] },
    },
}, class MementoPersonPage extends Adw.NavigationPage {
    _refreshInProgress = false;

    _init(params = {}) {
        super._init(params);
        this._personId = null;
        this._exploreLoaded = false;
        this._personMovies = [];
        this._unwatchedExploreMovies = [];
        this._watchedIds = new Set();
        this._watchlistIds = new Set();

        this._refresh_button.connect('clicked', () => {
            this._refreshPersonData();
        });

        this._watched_role_dropdown.connect('notify::selected', () => {
            this._renderWatchedAndWatchlistMovies();
        });
        this._watchlist_role_dropdown.connect('notify::selected', () => {
            this._renderWatchedAndWatchlistMovies();
        });
        this._explore_role_dropdown.connect('notify::selected', () => {
            this._renderExploreMovies();
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
                getAllWatchedTitleKeys(),
                getAllWatchlistTitleKeys()
            ]);
            this._watchedIds = watchedIds;
            this._watchlistIds = watchlistIds;

            this._displayPersonInfo(details);

            this._setDefaultRoleSelection(this._mapKnownForToRole(details.known_for));
            
            // Load only watched and watchlist movies from database (no API call)
            await this._loadWatchedAndWatchlistMovies();
            
        } catch (error) {
            console.error('Failed to load person details:', error);
            // TODO: Show error state
        }
    }

    async _refreshPersonData() {
        if (!this._personId || this._refreshInProgress) {
            return;
        }

        this._setRefreshUiState(true);
        try {
            const tmdbDetails = await getPersonDetails(this._personId);
            await upsertPerson(this._personId, tmdbDetails);

            const details = await getPersonByTmdbId(this._personId);
            if (!details) {
                throw new Error('Failed to load person data from database.');
            }

            const [watchedIds, watchlistIds] = await Promise.all([
                getAllWatchedTitleKeys(),
                getAllWatchlistTitleKeys()
            ]);
            this._watchedIds = watchedIds;
            this._watchlistIds = watchlistIds;

            this._displayPersonInfo(details);
            await this._loadWatchedAndWatchlistMovies();

            this._exploreLoaded = false;
            clearGrid(this._explore_grid);
            this._explore_empty_label.set_label(_('Click to explore more titles...'));
            this._explore_empty_label.set_visible(true);

            if (this._stack.get_visible_child_name() === 'explore') {
                await this._loadExploreMovies();
            }
        } catch (error) {
            console.error('Failed to refresh person details:', error);
        } finally {
            this._setRefreshUiState(false);
        }
    }

    _setRefreshUiState(isRefreshing) {
        this._refreshInProgress = isRefreshing;
        this._refresh_button.set_sensitive(!isRefreshing);
        this._refresh_button.set_tooltip_text(isRefreshing ? _('Refreshing...') : _('Refresh'));

        if (isRefreshing) {
            if (!this._refreshSpinner) {
                this._refreshSpinner = new Gtk.Spinner({
                    width_request: 16,
                    height_request: 16,
                    halign: Gtk.Align.CENTER,
                    valign: Gtk.Align.CENTER,
                });
            }
            this._refresh_button.set_child(this._refreshSpinner);
            this._refreshSpinner.start();
            return;
        }

        if (this._refreshSpinner) {
            this._refreshSpinner.stop();
        }
        this._refresh_button.set_child(null);
        this._refresh_button.set_icon_name('view-refresh-symbolic');
    }

    async _onTabChanged() {
        const currentPage = this._stack.get_visible_child_name();
        
        // When user switches to Explore More tab and we haven't loaded it yet
        if (currentPage === 'explore' && !this._exploreLoaded && this._personId) {
            this._exploreLoaded = true;
            await this._loadExploreMovies();
        }
    }

    async _loadWatchedAndWatchlistMovies() {
        // Get person's credits from database only (titles we know about)
        this._personMovies = await this._getPersonMoviesFromDb();
        this._renderWatchedAndWatchlistMovies();
    }

    _renderWatchedAndWatchlistMovies() {
        clearGrid(this._watched_grid);
        clearGrid(this._watchlist_grid);

        const watchedRole = this._getRoleFromDropdown(this._watched_role_dropdown);
        const watchlistRole = this._getRoleFromDropdown(this._watchlist_role_dropdown);

        let watchedCount = 0;
        let watchlistCount = 0;

        for (const movie of this._personMovies) {
            const roleType = movie.role_type || '';
            const mediaType = movie.media_type === 'tv' ? 'tv' : 'movie';
            const titleKey = `${mediaType}:${movie.tmdb_id}`;

            if (roleType !== watchedRole && roleType !== watchlistRole)
                continue;

            const card = createMovieCard(movie, {
                showRating: false,
                showYear: true,
                jobText: this._formatPersonCardJobText(
                    movie.character_name || '',
                    mediaType,
                    movie.episode_count
                ),
                onActivate: (tmdbId, selectedMediaType) => this.emit('view-movie', String(tmdbId || movie.id), selectedMediaType || mediaType),
            });
            
            if (this._watchedIds.has(titleKey) && roleType === watchedRole) {
                this._watched_grid.append(card);
                watchedCount++;
            } else if (this._watchlistIds.has(titleKey) && roleType === watchlistRole) {
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
            const credits = await getPersonTitleCredits(this._personId);
            
            const [watchedIds, watchlistIds] = await Promise.all([
                getAllWatchedTitleKeys(),
                getAllWatchlistTitleKeys()
            ]);
            
            // Filter to only show unwatched titles for supported roles
            const seenKeys = new Set();
            const unwatchedMovies = [];

            if (credits.cast) {
                for (const credit of credits.cast) {
                    const mediaType = credit.media_type === 'tv' ? 'tv' : 'movie';
                    const tmdbId = Number(credit.id);
                    const titleKey = `${mediaType}:${tmdbId}`;
                    const key = `${mediaType}:${tmdbId}:actor`;
                    if (seenKeys.has(key) || watchedIds.has(titleKey) || watchlistIds.has(titleKey))
                        continue;
                    seenKeys.add(key);
                    unwatchedMovies.push({
                        ...credit,
                        media_type: mediaType,
                        role_type: 'actor',
                    });
                }
            }

            if (credits.crew) {
                for (const credit of credits.crew) {
                    const roleType = this._mapCrewJobToRole(credit.job);
                    if (!roleType)
                        continue;
                    const mediaType = credit.media_type === 'tv' ? 'tv' : 'movie';
                    const tmdbId = Number(credit.id);
                    const titleKey = `${mediaType}:${tmdbId}`;
                    const key = `${mediaType}:${tmdbId}:${roleType}`;
                    if (seenKeys.has(key) || watchedIds.has(titleKey) || watchlistIds.has(titleKey))
                        continue;
                    seenKeys.add(key);
                    unwatchedMovies.push({
                        ...credit,
                        media_type: mediaType,
                        role_type: roleType,
                    });
                }
            }

            // Sort by release date descending
            unwatchedMovies.sort((a, b) => {
                const firstDate = a.release_date || a.first_air_date;
                const secondDate = b.release_date || b.first_air_date;
                if (!firstDate) return 1;
                if (!secondDate) return -1;
                return new Date(secondDate) - new Date(firstDate);
            });

            this._unwatchedExploreMovies = unwatchedMovies;
            this._renderExploreMovies();
            
        } catch (error) {
            console.error('Failed to load explore titles:', error);
            this._explore_empty_label.set_label(_('Failed to load titles.'));
        }
    }

    _renderExploreMovies() {
        clearGrid(this._explore_grid);

        if (!this._exploreLoaded) {
            this._explore_empty_label.set_label(_('Click to explore more titles...'));
            this._explore_empty_label.set_visible(true);
            return;
        }

        const selectedRole = this._getRoleFromDropdown(this._explore_role_dropdown);
        const filteredMovies = this._unwatchedExploreMovies.filter(movie => (movie.role_type || '') === selectedRole);

        for (const movie of filteredMovies) {
            const mediaType = movie.media_type === 'tv' ? 'tv' : 'movie';
            const card = createMovieCard(movie, {
                showRating: false,
                showYear: true,
                jobText: this._formatPersonCardJobText(
                    movie.character || movie.job || '',
                    mediaType,
                    movie.total_episode_count ?? movie.episode_count
                ),
                onActivate: (tmdbId, selectedMediaType) => this.emit('view-movie', String(tmdbId || movie.id), selectedMediaType || mediaType),
            });
            this._explore_grid.append(card);
        }

        this._explore_empty_label.set_visible(filteredMovies.length === 0);
        if (filteredMovies.length === 0) {
            this._explore_empty_label.set_label(_('No other titles found.'));
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
            const birthDate = new Date(details.birthday);
            let birthText = birthDate.toLocaleDateString();
            if (details.deathday) {
                const deathDate = new Date(details.deathday);
                const deathText = deathDate.toLocaleDateString();
                const ageAtDeath = this._calculateAge(birthDate, deathDate);
                birthText += ` - ${deathText}`;
                if (ageAtDeath !== null) {
                    birthText += ` (${_('%d years').format(ageAtDeath)})`;
                }
            } else {
                const age = this._calculateAge(birthDate, new Date());
                if (age !== null) {
                    birthText += ` (${_('%d years old').format(age)})`;
                }
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
            this._known_for_label.set_label(_('Known for: %s').format(details.known_for));
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

        const profileUrl = buildProfileUrl(details.profile_path);
        loadTextureFromUrlWithFallback(
            profileUrl,
            details.profile_path,
            'avatar-default-symbolic',
            170,
            230
        ).then(texture => {
            this._profile_image.set_paintable(texture);
        }).catch(console.error);
    }

    _calculateAge(birthDate, endDate) {
        if (!(birthDate instanceof Date) || Number.isNaN(birthDate.getTime()))
            return null;
        if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime()))
            return null;

        let age = endDate.getFullYear() - birthDate.getFullYear();
        const hasHadBirthdayThisYear =
            endDate.getMonth() > birthDate.getMonth() ||
            (endDate.getMonth() === birthDate.getMonth() && endDate.getDate() >= birthDate.getDate());

        if (!hasHadBirthdayThisYear)
            age -= 1;

        return age >= 0 ? age : null;
    }

    _setDefaultRoleSelection(roleType) {
        const selectedIndex = this._roleTypeToIndex(roleType);
        this._watched_role_dropdown.set_selected(selectedIndex);
        this._watchlist_role_dropdown.set_selected(selectedIndex);
        this._explore_role_dropdown.set_selected(selectedIndex);
    }

    _getRoleFromDropdown(dropdown) {
        const selectedIndex = Number(dropdown.get_selected());
        const roleTypes = ['director', 'actor', 'producer', 'cinematographer', 'music_composer'];
        return roleTypes[selectedIndex] || 'director';
    }

    _roleTypeToIndex(roleType) {
        const roleTypes = ['director', 'actor', 'producer', 'cinematographer', 'music_composer'];
        const index = roleTypes.indexOf(roleType);
        return index >= 0 ? index : 0;
    }

    _mapKnownForToRole(knownFor) {
        const value = String(knownFor || '').toLowerCase();
        if (value === 'acting')
            return 'actor';
        if (value === 'production')
            return 'producer';
        if (value === 'camera' || value === 'cinematography')
            return 'cinematographer';
        if (value === 'sound' || value === 'music')
            return 'music_composer';
        return 'director';
    }

    _mapCrewJobToRole(job) {
        const normalizedJob = String(job || '').trim().toLowerCase();
        if (normalizedJob === 'director')
            return 'director';
        if (normalizedJob === 'producer')
            return 'producer';
        if (normalizedJob === 'director of photography' || normalizedJob === 'cinematography')
            return 'cinematographer';
        if (normalizedJob === 'original music composer' || normalizedJob === 'music' || normalizedJob === 'composer')
            return 'music_composer';
        return null;
    }

    _formatPersonCardJobText(baseText, mediaType, episodeCountValue) {
        const primaryText = String(baseText || '').trim();
        if (mediaType !== 'tv') {
            return primaryText;
        }

        const episodeCount = Number(episodeCountValue) || 0;
        if (episodeCount <= 0) {
            return primaryText;
        }

        const episodeText = _('%d episodes').format(episodeCount);
        return primaryText ? `${primaryText} • ${episodeText}` : episodeText;
    }
});
