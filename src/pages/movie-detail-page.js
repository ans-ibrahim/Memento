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
import Pango from 'gi://Pango';

import { getTitleDetails, getTitleCredits, buildPosterUrl, buildImdbUrl, buildTmdbTitleUrl, buildLetterboxdUrl, getTvSeasonDetails } from '../services/tmdb-service.js';
import { scrapeImdbRating } from '../services/imdb-service.js';
import {
    findTitleByTmdbId,
    upsertMovieFromTmdb,
    upsertTvShowFromTmdb,
    upsertPerson,
    upsertMovieCredits,
    upsertTvSeasons,
    upsertSeasonEpisodes,
    getMovieById,
    getTvShowById,
    getMovieCredits as getDbCredits,
    addMovieToWatchlist,
    removeFromWatchlist,
    isInWatchlist,
    addPlay,
    updatePlay,
    getPlaysForMovie,
    getEpisodesForTitle,
    getSeasonsForTitle,
    getTitleEpisodeProgress,
    deletePlay,
    getAllPlaces,
    updateMovieImdbRating,
    addSeasonPlays,
    addTvEpisodePlay
} from '../utils/database-utils.js';
import { loadTextureFromUrlWithFallback } from '../utils/image-utils.js';
import { enforceFixedPictureSize, enforceFixedWidgetSize, formatDate } from '../utils/ui-utils.js';
import { createPersonStatCard } from '../widgets/person-stat-card.js';

const SETTINGS_SCHEMA_ID = (GLib.getenv('FLATPAK_ID') || '').endsWith('.Devel')
    ? 'io.github.ans_ibrahim.Memento.Devel'
    : 'io.github.ans_ibrahim.Memento';

const PLAY_ENTRY_HORIZONTAL_MARGIN = 12;

export const MementoMovieDetailPage = GObject.registerClass({
    GTypeName: 'MementoMovieDetailPage',
    Template: 'resource:///app/memento/memento/pages/movie-detail-page.ui',
    InternalChildren: [
        'title_label',
        'tagline_label',
        'poster_frame',
        'poster_image',
        'refresh_button',
        'watchlist_button',
        'add_play_button',
        'plays_count_label',
        'plays_list',
        'main_content_box',
        'left_sidebar',
        'right_content',
        'metadata_group',
        'year_row',
        'original_title_row',
        'runtime_row',
        'language_row',
        'genre_row',
        'budget_row',
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
        'cinematographers_box',
        'cinematographers_label',
        'composers_box',
        'composers_label',
        'cast_box',
        'cast_label',
    ],
    Signals: {
        'watchlist-changed': {},
        'plays-changed': {},
        'view-person': { param_types: [GObject.TYPE_STRING] },
    },
}, class MementoMovieDetailPage extends Adw.NavigationPage {
    _tmdbId = null;
    _mediaType = 'movie';
    _movieId = null;
    _movieData = null;
    _imdbRating = null;
    _settings = null;
    _refreshInProgress = false;

    _init(params = {}) {
        super._init(params);
        this._settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA_ID });
        this._movieId = null;
        this._refresh_button.connect('clicked', () => {
            this._refreshMovieData();
        });
        this._poster_frame.connect('notify::allocation', () => {
            this._syncPlayEntryWidthsToPoster();
        });
        this._setPosterSize(250, 375);
        this._setupActions();
        this._setupResponsiveLayout();
    }

    _setupResponsiveLayout() {
        this._main_content_box.connect('notify::allocation', () => {
            const root = this.get_root();
            const width = root ? root.get_width() : this._main_content_box.get_allocation().width;
            
            // Switch to vertical layout on screens narrower than 700px
            if (width < 700) {
                this._main_content_box.set_orientation(Gtk.Orientation.VERTICAL);
                this._main_content_box.set_spacing(20);
                // Make poster smaller on mobile
                this._setPosterSize(200, 300);
                this._left_sidebar.set_halign(Gtk.Align.CENTER);
            } else {
                this._main_content_box.set_orientation(Gtk.Orientation.HORIZONTAL);
                this._main_content_box.set_spacing(32);
                // Restore normal poster size
                this._setPosterSize(250, 375);
                this._left_sidebar.set_halign(Gtk.Align.START);
            }
        });
    }

    _setPosterSize(width, height) {
        enforceFixedWidgetSize(this._poster_frame, width, height);
        enforceFixedPictureSize(this._poster_image, width, height);
        enforceFixedWidgetSize(this._left_sidebar, width, -1);

        this._poster_frame.set_hexpand(false);
        this._poster_frame.set_vexpand(false);
        this._poster_frame.set_halign(Gtk.Align.START);
        this._poster_frame.set_valign(Gtk.Align.START);

        this._poster_image.set_hexpand(false);
        this._poster_image.set_vexpand(false);
        this._poster_image.set_halign(Gtk.Align.FILL);
        this._poster_image.set_valign(Gtk.Align.FILL);

        this._left_sidebar.set_hexpand(false);
        this._left_sidebar.set_vexpand(false);
        this._left_sidebar.set_halign(Gtk.Align.START);
        this._left_sidebar.set_valign(Gtk.Align.START);
        this._syncPlayEntryWidthsToPoster();
    }

    _getPosterDisplayWidth() {
        const frameAllocation = this._poster_frame.get_allocation();
        const allocatedWidth = Number(frameAllocation?.width) || 0;
        if (allocatedWidth > 0) {
            return allocatedWidth;
        }

        const requestedWidth = Number(this._poster_frame.width_request) || 0;
        if (requestedWidth > 0) {
            return requestedWidth;
        }

        return 250;
    }

    _syncPlayEntryWidthsToPoster() {
        if (!this._plays_list) {
            return;
        }

        const posterWidth = this._getPosterDisplayWidth();
        const rowWidth = Math.max(1, posterWidth - (PLAY_ENTRY_HORIZONTAL_MARGIN * 2));
        const textColumnWidth = rowWidth;
        this._plays_list.width_request = posterWidth;
        let child = this._plays_list.get_first_child();
        while (child) {
            child.width_request = rowWidth;
            const leftColumn = child.get_first_child();
            if (leftColumn) {
                leftColumn.width_request = textColumnWidth;
                let textChild = leftColumn.get_first_child();
                while (textChild) {
                    textChild.width_request = textColumnWidth;
                    textChild = textChild.get_next_sibling();
                }
            }
            child = child.get_next_sibling();
        }
    }

    async loadMovie(tmdbId) {
        return this.loadTitle(tmdbId, 'movie');
    }

    async loadTitle(tmdbId, mediaType = 'movie') {
        this._tmdbId = tmdbId;
        this._mediaType = mediaType === 'tv' ? 'tv' : 'movie';

        try {
            const existingTitle = await findTitleByTmdbId(tmdbId, this._mediaType);

            if (existingTitle) {
                this._movieId = existingTitle.id;
                this._movieData = existingTitle;
            } else {
                const details = await getTitleDetails(tmdbId, this._mediaType);
                const credits = await getTitleCredits(tmdbId, this._mediaType);
                this._movieId = await this._upsertTitleByType(details);
                await this._saveCredits(credits);
                await this._saveTvSeasons(details);
                this._movieData = await this._getTitleByTypeId(this._movieId);
            }

            if (!this._movieData) {
                console.error('Failed to load title data from database');
                return;
            }

            this._loadCachedRatings();
            this._isInWatchlist = await isInWatchlist(this._movieId);

            this._displayMovieInfo();
            this._displayCredits();
            this._loadExternalRatingsInBackground();
            await this._updateWatchlistButton();
            await this._loadPlays();
            this._setupActions();
        } catch (error) {
            console.error('Failed to load title:', error);
            this._title_label.set_label(_('Error loading title'));
            this._overview_label.set_label(error.message || _('An error occurred while loading title details.'));
        }
    }

    async _refreshMovieData() {
        if (!this._tmdbId || this._refreshInProgress) {
            return;
        }

        this._setRefreshUiState(true);
        try {
            const details = await getTitleDetails(this._tmdbId, this._mediaType);
            const credits = await getTitleCredits(this._tmdbId, this._mediaType);

            this._movieId = await this._upsertTitleByType(details);
            await this._saveCredits(credits);
            await this._saveTvSeasons(details);

            this._movieData = await this._getTitleByTypeId(this._movieId);
            if (!this._movieData) {
                throw new Error(_('Failed to load title data from database.'));
            }

            this._loadCachedRatings();
            this._displayMovieInfo();
            this._loadExternalRatingsInBackground();
            await this._displayCredits();
            await this._updateWatchlistButton();
            await this._loadPlays();
        } catch (error) {
            console.error('Failed to refresh title:', error);
            this._title_label.set_label(_('Error refreshing title'));
            this._overview_label.set_label(error.message || _('An error occurred while refreshing title details.'));
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

    async _upsertTitleByType(details) {
        if (this._mediaType === 'tv') {
            return upsertTvShowFromTmdb(details);
        }
        return upsertMovieFromTmdb(details);
    }

    async _getTitleByTypeId(titleId) {
        if (this._mediaType === 'tv') {
            return getTvShowById(titleId);
        }
        return getMovieById(titleId);
    }

    async _saveTvSeasons(details) {
        if (this._mediaType !== 'tv' || !this._movieId) {
            return;
        }
        const seasons = Array.isArray(details?.seasons) ? details.seasons : [];
        await upsertTvSeasons(this._movieId, seasons);

        const seasonCandidates = seasons
            .map(season => Number(season?.season_number))
            .filter(seasonNumber => Number.isFinite(seasonNumber) && seasonNumber >= 0);

        for (const seasonNumber of seasonCandidates) {
            try {
                const seasonDetails = await getTvSeasonDetails(this._tmdbId, seasonNumber);
                const episodes = Array.isArray(seasonDetails?.episodes) ? seasonDetails.episodes : [];
                await upsertSeasonEpisodes(this._movieId, seasonNumber, episodes);
            } catch {
                // Keep TV support resilient even when individual season requests fail.
            }
        }
    }

    _loadCachedRatings() {
        this._imdbRating = null;

        const cachedImdbRating = Number(this._movieData?.imdb_rating);
        if (Number.isFinite(cachedImdbRating)) {
            this._imdbRating = { value: cachedImdbRating };
        }
    }

    _getSettings() {
        if (this._settings) {
            return this._settings;
        }
        try {
            this._settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA_ID });
            return this._settings;
        } catch (error) {
            console.error('Failed to initialize settings:', error);
            return null;
        }
    }

    _isImdbRatingEnabled() {
        const settings = this._getSettings();
        if (!settings) {
            return false;
        }
        return settings.get_boolean('enable-imdb-rating');
    }

    _isTmdbRatingEnabled() {
        const settings = this._getSettings();
        if (!settings) {
            return true;
        }
        return settings.get_boolean('enable-tmdb-rating');
    }

    _loadExternalRatingsInBackground() {
        const currentMovieId = this._movieId;
        const currentImdbId = this._movieData?.imdb_id ?? null;
        this._loadExternalRatings(currentMovieId, currentImdbId).then(() => {
            this._updateRatingsRow();
        }).catch(error => {
            console.error('Failed to load external ratings:', error);
        });
    }

    async _loadExternalRatings(movieId, imdbId) {
        if (!movieId || !imdbId || !this._isImdbRatingEnabled()) {
            return;
        }

        const imdbRating = await scrapeImdbRating(imdbId).catch(() => null);
        if (this._movieId !== movieId) {
            return;
        }

        this._imdbRating = imdbRating;

        try {
            await updateMovieImdbRating(movieId, imdbRating?.value ?? null);
            if (this._movieData && this._movieId === movieId) {
                this._movieData.imdb_rating = imdbRating?.value ?? null;
            }
        } catch (error) {
            console.error(`Failed to store IMDb rating for movie ${movieId}:`, error);
        }
    }


    async _saveCredits(creditsData) {
        const credits = [];
        const seenCreditKeys = new Set();
        let order = 0;

        if (creditsData.crew) {
            const addCrewCredits = async (crewJobs, roleType) => {
                const members = creditsData.crew.filter(member => crewJobs.includes(member.job));
                for (const member of members) {
                    const personId = await upsertPerson(member.id, {
                        name: member.name,
                        profile_path: member.profile_path || null
                    });
                    const creditKey = `${personId}:${roleType}:crew`;
                    if (seenCreditKeys.has(creditKey)) {
                        continue;
                    }
                    seenCreditKeys.add(creditKey);

                    credits.push({
                        person_id: personId,
                        role_type: roleType,
                        character_name: null,
                        display_order: order++
                    });
                }
            };

            await addCrewCredits(['Director'], 'director');
            await addCrewCredits(['Producer'], 'producer');
            await addCrewCredits(['Director of Photography', 'Cinematography'], 'cinematographer');
            await addCrewCredits(['Original Music Composer', 'Music', 'Composer'], 'music_composer');
        }

        // Process cast
        if (creditsData.cast) {
            for (const actor of creditsData.cast) {
                // Upsert person first
                const personId = await upsertPerson(actor.id, {
                    name: actor.name,
                    profile_path: actor.profile_path || null
                });
                const characterName = actor.character || null;
                const creditKey = `${personId}:actor:${characterName || ''}`;
                if (seenCreditKeys.has(creditKey)) {
                    continue;
                }
                seenCreditKeys.add(creditKey);

                credits.push({
                    person_id: personId,
                    role_type: 'actor',
                    character_name: characterName,
                    display_order: order++
                });
            }
        }

        await upsertMovieCredits(this._movieId, credits);
    }

    _displayMovieInfo() {
        // Title and tagline
        const displayTitle = this._movieData.title || _('Unknown');
        this._title_label.set_label(displayTitle);

        const originalTitle = String(this._movieData.original_title || '').trim();
        if (originalTitle && originalTitle !== displayTitle) {
            this._original_title_row.set_subtitle(originalTitle);
            this._original_title_row.set_visible(true);
        } else {
            this._original_title_row.set_visible(false);
        }
        
        if (this._movieData.tagline) {
            this._tagline_label.set_label(this._movieData.tagline);
            this._tagline_label.set_visible(true);
        } else {
            this._tagline_label.set_visible(false);
        }

        // Year
        const releaseDate = this._movieData.release_date || this._movieData.first_air_date;
        if (releaseDate) {
            const year = releaseDate.substring(0, 4);
            this._year_row.set_subtitle(year);
            this._year_row.set_visible(true);
        } else {
            this._year_row.set_visible(false);
        }

        // Runtime
        if (this._movieData.runtime) {
            const hours = Math.floor(this._movieData.runtime / 60);
            const minutes = this._movieData.runtime % 60;
            const runtimeText = hours > 0 
                ? `${hours}h ${minutes}m` 
                : `${minutes}m`;
            this._runtime_row.set_title(this._mediaType === 'tv' ? _('Episode Runtime') : _('Runtime'));
            this._runtime_row.set_subtitle(runtimeText);
            this._runtime_row.set_visible(true);
        } else {
            this._runtime_row.set_visible(false);
        }

        // Original language
        if (this._movieData.original_language) {
            this._language_row.set_subtitle(this._getLanguageDisplayName(this._movieData.original_language));
            this._language_row.set_visible(true);
        } else {
            this._language_row.set_visible(false);
        }

        // Genre
        if (this._movieData.genres) {
            this._genre_row.set_subtitle(this._movieData.genres);
            this._genre_row.set_visible(true);
        } else {
            this._genre_row.set_visible(false);
        }

        if (this._mediaType === 'tv') {
            const seasonCount = Number(this._movieData.number_of_seasons) || 0;
            const episodeCount = Number(this._movieData.number_of_episodes) || 0;
            this._budget_row.set_title(_('Seasons'));
            if (seasonCount > 0 || episodeCount > 0) {
                this._budget_row.set_subtitle(_('%d seasons • %d episodes').format(seasonCount, episodeCount));
                this._budget_row.set_visible(true);
            } else {
                this._budget_row.set_visible(false);
            }
        } else if (this._movieData.budget && this._movieData.budget > 0) {
            const budgetText = this._formatCurrency(this._movieData.budget);
            this._budget_row.set_title(_('Budget'));
            this._budget_row.set_subtitle(budgetText);
            this._budget_row.set_visible(true);
        } else {
            this._budget_row.set_visible(false);
        }

        // Ratings section
        this._updateRatingsRow();

        if (this._mediaType === 'tv') {
            const statusText = String(this._movieData.status || '').trim();
            this._revenue_row.set_title(_('Status'));
            if (statusText) {
                this._revenue_row.set_subtitle(statusText);
                this._revenue_row.set_visible(true);
            } else {
                this._revenue_row.set_visible(false);
            }
        } else if (this._movieData.revenue && this._movieData.revenue > 0) {
            const revenueText = this._formatCurrency(this._movieData.revenue);
            this._revenue_row.set_title(_('Revenue'));
            this._revenue_row.set_subtitle(revenueText);
            this._revenue_row.set_visible(true);
        } else {
            this._revenue_row.set_visible(false);
        }

        // Overview
        if (this._movieData.overview) {
            this._overview_label.set_label(this._movieData.overview);
            this._overview_box.set_visible(true);
        }

        // Poster
        const posterUrl = buildPosterUrl(this._movieData.poster);
        const requestedWidth = Number(this._poster_image.width_request) || 0;
        const requestedHeight = Number(this._poster_image.height_request) || 0;
        const posterWidth = requestedWidth > 0 ? requestedWidth : 250;
        const posterHeight = requestedHeight > 0 ? requestedHeight : 375;
        loadTextureFromUrlWithFallback(
            posterUrl,
            this._movieData.poster,
            'camera-video-symbolic',
            posterWidth,
            posterHeight
        ).then(texture => {
            if (texture) {
                this._poster_image.set_paintable(texture);
            }
        }).catch(() => {});
    }

    _updateRatingsRow() {
        const ratingParts = [];
        const tmdbAverage = Number(this._movieData?.tmdb_average);
        if (this._isTmdbRatingEnabled() && Number.isFinite(tmdbAverage) && tmdbAverage > 0) {
            ratingParts.push(`TMDB ${tmdbAverage.toFixed(1)}/10`);
        }

        if (this._isImdbRatingEnabled() && this._imdbRating?.value) {
            ratingParts.push(`IMDb ${this._imdbRating.value.toFixed(1)}/10`);
        }

        if (ratingParts.length === 0) {
            this._rating_row.set_visible(false);
            return;
        }

        this._rating_row.set_title(_('Ratings'));
        this._rating_row.set_subtitle(ratingParts.join(' | '));
        this._rating_row.set_visible(true);
    }

    async _displayCredits() {
        const credits = await getDbCredits(this._movieId);

        this._directors_box.set_visible(false);
        this._producers_box.set_visible(false);
        this._cinematographers_box.set_visible(false);
        this._composers_box.set_visible(false);
        this._cast_box.set_visible(false);
        
        if (credits.length === 0) {
            this._credits_box.set_visible(false);
            return;
        }

        this._credits_box.set_visible(true);

        // Group credits by role
        const directors = credits.filter(c => c.role_type === 'director');
        const producers = credits.filter(c => c.role_type === 'producer');
        const cinematographers = credits.filter(c => c.role_type === 'cinematographer');
        const composers = credits.filter(c => c.role_type === 'music_composer');
        const cast = credits.filter(c => c.role_type === 'actor');

        // Display directors with photos
        if (directors.length > 0) {
            this._displayPeopleGrid(directors, this._directors_label, this._directors_box);
        }

        // Display producers with photos
        if (producers.length > 0) {
            this._displayPeopleGrid(producers, this._producers_label, this._producers_box);
        }

        // Display cinematographers with photos
        if (cinematographers.length > 0) {
            this._displayPeopleGrid(cinematographers, this._cinematographers_label, this._cinematographers_box);
        }

        // Display music composers with photos
        if (composers.length > 0) {
            this._displayPeopleGrid(composers, this._composers_label, this._composers_box);
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
            max_children_per_line: 7,
            min_children_per_line: 2,
            column_spacing: 20,
            row_spacing: 28,
            homogeneous: true,
            margin_top: 12,
            margin_bottom: 12,
        });
        
        // Add people using the shared person card style
        for (const person of people) {
            const subtitleText = person.character_name || person.job || '';
            const card = createPersonStatCard(person, {
                subtitleText,
                showCount: false,
                onActivate: personId => this.emit('view-person', personId),
            });
            grid.append(card);
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
            const url = buildTmdbTitleUrl(this._movieData.tmdb_id, this._mediaType);
            if (url) {
                this._openUrl(url);
            }
        });

        this._letterboxd_button.connect('clicked', () => {
            const url = buildLetterboxdUrl(this._movieData.imdb_id);
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
            this._watchlist_button.set_label(_('Remove from Watchlist'));
            this._watchlist_button.remove_css_class('suggested-action');
            this._watchlist_button.add_css_class('destructive-action');
        } else {
            this._watchlist_button.set_label(_('Add to Watchlist'));
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
            title: _('Add a Play'),
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
            label: _('Watch Date:'),
            xalign: 0,
        });
        contentArea.append(dateLabel);

        const useDateCheck = new Gtk.CheckButton({
            label: _('Don’t store watch date'),
            active: false,
        });
        contentArea.append(useDateCheck);

        const calendar = new Gtk.Calendar();
        calendar.set_sensitive(!useDateCheck.get_active());
        useDateCheck.connect('toggled', checkButton => {
            calendar.set_sensitive(!checkButton.get_active());
        });
        contentArea.append(calendar);

        const getSelectedDateIsoString = () => {
            const date = calendar.get_date();
            return `${date.get_year()}-${String(date.get_month()).padStart(2, '0')}-${String(date.get_day_of_month()).padStart(2, '0')}`;
        };

        let episodeRows = [];
        let seasonRows = [];
        let targetDropdown = null;
        const tvPlayTargets = [];
        if (this._mediaType === 'tv') {
            const episodeLabel = new Gtk.Label({
                label: _('What to log:'),
                xalign: 0,
                margin_top: 12,
            });
            contentArea.append(episodeLabel);

            targetDropdown = new Gtk.DropDown({
                model: null,
            });

            episodeRows = await getEpisodesForTitle(this._movieId);
            seasonRows = await getSeasonsForTitle(this._movieId);
            const targetNames = [_('Select target')];
            tvPlayTargets.push({type: 'none'});

            for (const season of seasonRows) {
                const seasonNumber = Number(season.season_number) || 0;
                const seasonName = season.name || _('Season %d').format(seasonNumber);
                const totalEpisodes = Number(season.total_episodes) || Number(season.episode_count) || 0;
                targetNames.push(_('%s (all %d episodes)').format(seasonName, totalEpisodes));
                tvPlayTargets.push({
                    type: 'season',
                    season_number: seasonNumber,
                });
            }

            for (const episode of episodeRows) {
                const seasonNumber = String(episode.season_number || 0).padStart(2, '0');
                const episodeNumber = String(episode.episode_number || 0).padStart(2, '0');
                const episodeName = episode.name || _('Untitled Episode');
                targetNames.push(`S${seasonNumber}E${episodeNumber} • ${episodeName}`);
                tvPlayTargets.push({
                    type: 'episode',
                    episode_id: episode.id,
                });
            }

            const targetList = new Gtk.StringList();
            for (const name of targetNames) {
                targetList.append(name);
            }
            targetDropdown.set_model(targetList);
            contentArea.append(targetDropdown);
        }

        // Place selector
        const placeLabel = new Gtk.Label({
            label: _('Place (optional):'),
            xalign: 0,
            margin_top: 12,
        });
        contentArea.append(placeLabel);

        const placeDropdown = new Gtk.DropDown({
            model: null,
        });

        // Load places
        const places = await getAllPlaces();
        const placeNames = [_('None'), ...places.map(p => p.name)];
        const stringList = new Gtk.StringList();
        for (const name of placeNames) {
            stringList.append(name);
        }
        placeDropdown.set_model(stringList);

        contentArea.append(placeDropdown);

        const commentLabel = new Gtk.Label({
            label: _('Comment (optional):'),
            xalign: 0,
            margin_top: 12,
        });
        contentArea.append(commentLabel);

        const commentEntry = new Gtk.Entry({
            placeholder_text: _('Add a note about this play'),
        });
        contentArea.append(commentEntry);

        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Add'), Gtk.ResponseType.OK);

        dialog.connect('response', async (dlg, response) => {
            if (response === Gtk.ResponseType.OK) {
                const isoDate = useDateCheck.get_active()
                    ? null
                    : getSelectedDateIsoString();
                
                // Get selected place
                const selectedIndex = placeDropdown.get_selected();
                let placeId = null;
                if (selectedIndex > 0) {
                    placeId = places[selectedIndex - 1].id;
                }
                
                const trimmedComment = commentEntry.get_text().trim();
                const comment = trimmedComment ? trimmedComment : null;

                try {
                    if (this._mediaType === 'tv') {
                        const selectedIndex = Number(targetDropdown?.get_selected() ?? 0);
                        const selectedTarget = tvPlayTargets[selectedIndex] || {type: 'none'};

                        if (selectedTarget.type === 'episode') {
                            await addTvEpisodePlay(this._movieId, selectedTarget.episode_id, isoDate, placeId, comment);
                        } else if (selectedTarget.type === 'season') {
                            await addSeasonPlays(
                                this._movieId,
                                selectedTarget.season_number,
                                isoDate,
                                placeId,
                                comment
                            );
                        } else {
                            throw new Error(_('Please select an episode or season.'));
                        }
                    } else {
                        await addPlay(this._movieId, isoDate, placeId, comment);
                    }

                    await this._loadPlays();
                    this.emit('plays-changed');
                
                    const settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA_ID });
                    const autoRemove = settings.get_boolean('auto-remove-from-watchlist');

                    if (autoRemove && this._isInWatchlist) {
                        await removeFromWatchlist(this._movieId);
                        this._isInWatchlist = false;
                        this._updateWatchlistButton();
                        this.emit('watchlist-changed');
                    }
                } catch (error) {
                    const errorDialog = new Adw.AlertDialog({
                        heading: _('Could not save play'),
                        body: error.message || _('An unexpected error occurred while saving the play.'),
                    });
                    errorDialog.add_response('ok', _('OK'));
                    errorDialog.present(this.get_root());
                    return;
                }

                dlg.close();
                return;
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
            this._plays_count_label.set_label(_('No plays recorded'));
        } else {
            let countText = plays.length === 1
                ? _('1 play recorded')
                : _('%d plays recorded').format(plays.length);

            if (this._mediaType === 'tv') {
                const progress = await getTitleEpisodeProgress(this._movieId);
                countText = _('%d play logs • %d/%d episodes watched • %d/%d seasons completed').format(
                    plays.length,
                    progress.watched_episodes,
                    progress.total_episodes,
                    progress.completed_seasons,
                    progress.total_seasons
                );
            }
            this._plays_count_label.set_label(countText);

            // Add play entries
            for (const play of plays) {
                const playEntry = this._createPlayEntry(play);
                this._plays_list.append(playEntry);
            }
            this._syncPlayEntryWidthsToPoster();
        }
    }

    _createPlayEntry(play) {
        const posterWidth = this._getPosterDisplayWidth();
        const rowWidth = Math.max(1, posterWidth - (PLAY_ENTRY_HORIZONTAL_MARGIN * 2));
        const textColumnWidth = rowWidth;

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            width_request: rowWidth,
            hexpand: false,
            halign: Gtk.Align.START,
            margin_start: PLAY_ENTRY_HORIZONTAL_MARGIN,
            margin_end: PLAY_ENTRY_HORIZONTAL_MARGIN,
            margin_top: 6,
            margin_bottom: 6,
        });

        // Left side: Date and optional place
        const leftBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            hexpand: true,
            halign: Gtk.Align.START,
            spacing: 4,
            width_request: textColumnWidth,
        });

        // Format date
        const dateLabel = new Gtk.Label({
            label: formatDate(play.watched_at, {month: 'long'}),
            xalign: 0,
            width_request: textColumnWidth,
        });
        leftBox.append(dateLabel);

        if (play.episode_id) {
            const seasonNumber = String(play.season_number || 0).padStart(2, '0');
            const episodeNumber = String(play.episode_number || 0).padStart(2, '0');
            const episodeName = play.episode_name || _('Untitled Episode');
            const episodeText = `S${seasonNumber}E${episodeNumber} • ${episodeName}`;
            const episodeLabel = new Gtk.Label({
                label: episodeText,
                xalign: 0,
                css_classes: ['dim-label', 'caption'],
                wrap: true,
                wrap_mode: Pango.WrapMode.WORD_CHAR,
                max_width_chars: 28,
                width_request: textColumnWidth,
            });
            leftBox.append(episodeLabel);
        }

        // Show place if available
        if (play.place_id && play.place_name) {
            const placeLabel = new Gtk.Label({
                label: play.is_cinema ? `🎬 ${play.place_name}` : `🏠 ${play.place_name}`,
                xalign: 0,
                css_classes: ['dim-label', 'caption'],
                wrap: true,
                wrap_mode: Pango.WrapMode.WORD_CHAR,
                max_width_chars: 28,
                width_request: textColumnWidth,
            });
            leftBox.append(placeLabel);
        }

        if (play.comment) {
            const commentLabel = new Gtk.Label({
                label: play.comment,
                xalign: 0,
                css_classes: ['caption'],
                wrap: true,
                wrap_mode: Pango.WrapMode.WORD_CHAR,
                max_width_chars: 28,
                width_request: textColumnWidth,
            });
            leftBox.append(commentLabel);
        }

        box.append(leftBox);

        // Action buttons box
        const actionsBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.START,
        });

        // Edit button
        const editButton = new Gtk.Button({
            icon_name: 'document-edit-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Edit Play'),
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
            tooltip_text: _('Delete Play'),
            css_classes: ['flat', 'destructive-action'],
        });

        deleteButton.connect('clicked', async () => {
            const dialog = new Adw.AlertDialog({
                heading: _('Delete Play?'),
                body: _('Are you sure you want to delete this play from %s?').format(
                    formatDate(play.watched_at, {month: 'long'})
                ),
            });

            dialog.add_response('cancel', _('Cancel'));
            dialog.add_response('delete', _('Delete'));
            dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);

            dialog.connect('response', async (dlg, response) => {
                if (response === 'delete') {
                    await deletePlay(play.id);
                    await this._loadPlays();
                    this.emit('plays-changed');
                }
            });

            dialog.present(this.get_root());
        });

        actionsBox.append(deleteButton);
        leftBox.append(actionsBox);

        return box;
    }

    async _showEditPlayDialog(play) {
        const dialog = new Gtk.Dialog({
            title: _('Edit Play'),
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
            label: _('Watch Date:'),
            xalign: 0,
        });
        contentArea.append(dateLabel);

        const watchedDateText = String(play.watched_at || '').trim();
        const hasExistingDate = /^\d{4}-\d{2}-\d{2}$/.test(watchedDateText);
        const useDateCheck = new Gtk.CheckButton({
            label: _('Don’t store watch date'),
            active: !hasExistingDate,
        });
        contentArea.append(useDateCheck);

        const calendar = new Gtk.Calendar();
        calendar.set_sensitive(!useDateCheck.get_active());
        useDateCheck.connect('toggled', checkButton => {
            calendar.set_sensitive(!checkButton.get_active());
        });
        
        // Prefill only when the stored date is valid.
        if (hasExistingDate) {
            const dateMatch = watchedDateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            const playYear = Number(dateMatch[1]);
            const playMonth = Number(dateMatch[2]);
            const playDay = Number(dateMatch[3]);
            const gDateTime = GLib.DateTime.new_local(
                playYear,
                playMonth,
                playDay,
                0, 0, 0
            );
            calendar.select_day(gDateTime);
        }
        
        contentArea.append(calendar);

        // Watch order
        const orderLabel = new Gtk.Label({
            label: _('Watch Order:'),
            xalign: 0,
            margin_top: 12,
        });
        contentArea.append(orderLabel);

        const orderSpinButton = Gtk.SpinButton.new_with_range(1, 10, 1);
        orderSpinButton.set_value(play.watch_order || 1);
        contentArea.append(orderSpinButton);

        // Place selector
        const placeLabel = new Gtk.Label({
            label: _('Place (optional):'),
            xalign: 0,
            margin_top: 12,
        });
        contentArea.append(placeLabel);

        const placeDropdown = new Gtk.DropDown({
            model: null,
        });

        // Load places
        const places = await getAllPlaces();
        const placeNames = [_('None'), ...places.map(p => p.name)];
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

        const commentLabel = new Gtk.Label({
            label: _('Comment (optional):'),
            xalign: 0,
            margin_top: 12,
        });
        contentArea.append(commentLabel);

        const commentEntry = new Gtk.Entry({
            placeholder_text: _('Add a note about this play'),
            text: play.comment || '',
        });
        contentArea.append(commentEntry);

        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Save'), Gtk.ResponseType.OK);

        dialog.connect('response', async (dlg, response) => {
            if (response === Gtk.ResponseType.OK) {
                let isoDate = null;
                if (!useDateCheck.get_active()) {
                    const date = calendar.get_date();
                    isoDate = `${date.get_year()}-${String(date.get_month()).padStart(2, '0')}-${String(date.get_day_of_month()).padStart(2, '0')}`;
                }
                
                // Get selected place
                const selectedIndex = placeDropdown.get_selected();
                let placeId = null;
                if (selectedIndex > 0) {
                    placeId = places[selectedIndex - 1].id;
                }
                
                const watchOrder = orderSpinButton.get_value_as_int();
                const trimmedComment = commentEntry.get_text().trim();
                const comment = trimmedComment ? trimmedComment : null;
                
                try {
                    await updatePlay(play.id, isoDate, placeId, watchOrder, comment);
                    await this._loadPlays();
                    this.emit('plays-changed');
                } catch (error) {
                    console.error('Failed to update play:', error);
                }
            }
            dlg.close();
        });

        dialog.present();
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

    _getLanguageDisplayName(languageCode) {
        const normalizedCode = String(languageCode || '').trim().toLowerCase();
        if (!normalizedCode) {
            return '';
        }

        try {
            const displayNames = new Intl.DisplayNames(undefined, {type: 'language'});
            const languageName = displayNames.of(normalizedCode);
            if (languageName) {
                return languageName;
            }
        } catch {
            // Fallback to code below.
        }

        return normalizedCode.toUpperCase();
    }
});
