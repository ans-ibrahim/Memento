import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    getTitleDetails,
    getTitleCredits,
    getTvSeasonDetails,
    buildPosterUrl,
    buildStillUrl,
    buildImdbUrl,
    buildTmdbTitleUrl,
} from '../services/tmdb-service.js';
import { scrapeImdbRating } from '../services/imdb-service.js';
import {
    upsertPerson,
    upsertTvShow,
    upsertTvShowSeasons,
    upsertTvShowSeasonEpisodes,
    upsertTvCredits,
    findTvShowByTmdbId,
    getTvShowById,
    getTvCredits,
    getTvSeasonsWithEpisodes,
    getTvProgress,
    addTvShowToWatchlist,
    removeTvShowFromWatchlist,
    isTvShowInWatchlist,
    addTvEpisodePlay,
    addTvSeasonPlays,
    getTvPlaysForShow,
    updateTvEpisodePlay,
    deleteTvEpisodePlay,
    getAllPlaces,
    updateTvShowImdbRating,
} from '../utils/database-utils.js';
import { loadTextureFromUrl, loadTextureFromUrlWithFallback } from '../utils/image-utils.js';
import { createPersonStatCard } from '../widgets/person-stat-card.js';
import { clearGrid, formatDate } from '../utils/ui-utils.js';

const SETTINGS_SCHEMA_ID = (GLib.getenv('FLATPAK_ID') || '').endsWith('.Devel')
    ? 'io.github.ans_ibrahim.Memento.Devel'
    : 'io.github.ans_ibrahim.Memento';
const EPISODE_IMAGE_WIDTH = 160;
const EPISODE_IMAGE_HEIGHT = 90;
const SEASON_IMAGE_WIDTH = 56;
const SEASON_IMAGE_HEIGHT = 84;

export const MementoTvDetailPage = GObject.registerClass({
    GTypeName: 'MementoTvDetailPage',
    Template: 'resource:///app/memento/memento/pages/tv-detail-page.ui',
    InternalChildren: [
        'refresh_button',
        'poster_image',
        'watchlist_button',
        'add_play_button',
        'plays_count_label',
        'plays_list',
        'title_label',
        'tagline_label',
        'original_title_row',
        'first_air_row',
        'last_air_row',
        'language_row',
        'genre_row',
        'status_row',
        'season_count_row',
        'progress_row',
        'rating_row',
        'imdb_button',
        'tmdb_button',
        'overview_box',
        'overview_label',
        'seasons_list',
        'credits_group',
        'credits_grid',
        'series_crew_box',
        'directors_box',
        'directors_grid',
        'producers_box',
        'producers_grid',
        'cinematographers_box',
        'cinematographers_grid',
        'composers_box',
        'composers_grid',
    ],
    Signals: {
        'watchlist-changed': {},
        'plays-changed': {},
        'view-person': { param_types: [GObject.TYPE_STRING] },
    },
}, class MementoTvDetailPage extends Adw.NavigationPage {
    _tmdbId = null;
    _showId = null;
    _showData = null;
    _imdbRating = null;
    _settings = null;
    _refreshInProgress = false;

    _init(params = {}) {
        super._init(params);
        this._settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA_ID });

        this._refresh_button.connect('clicked', () => {
            this._refreshData().catch(error => this._showLoadError(error));
        });
        this._watchlist_button.connect('clicked', () => {
            this._toggleWatchlist().catch(error => this._showLoadError(error));
        });
        this._add_play_button.connect('clicked', () => {
            this._showAddPlayDialog().catch(error => this._showLoadError(error));
        });
        this._imdb_button.connect('clicked', () => {
            const url = buildImdbUrl(this._showData?.imdb_id);
            if (url) {
                this._openUrl(url);
            }
        });
        this._tmdb_button.connect('clicked', () => {
            const url = buildTmdbTitleUrl(this._tmdbId, 'tv');
            if (url) {
                this._openUrl(url);
            }
        });
    }

    async loadShow(tmdbId) {
        this._tmdbId = tmdbId;
        try {
            const existingShow = await findTvShowByTmdbId(tmdbId);
            if (existingShow) {
                this._showId = existingShow.id;
                this._showData = existingShow;
            } else {
                await this._refreshData();
                return;
            }

            await this._renderAll();
        } catch (error) {
            this._title_label.set_label(_('Error loading TV show'));
            this._overview_label.set_label(error.message || _('Could not load TV show details.'));
            this._overview_box.set_visible(true);
        }
    }

    async _refreshData() {
        if (!this._tmdbId || this._refreshInProgress) {
            return;
        }

        this._setRefreshUiState(true);
        try {
            const details = await getTitleDetails(this._tmdbId, 'tv');
            const credits = await getTitleCredits(this._tmdbId, 'tv');

            this._showId = await upsertTvShow(details);
            await upsertTvShowSeasons(this._showId, details?.seasons || []);

            const seasonNumbers = Array.isArray(details?.seasons)
                ? details.seasons.map(season => Number(season?.season_number)).filter(value => Number.isFinite(value) && value >= 0)
                : [];
            for (const seasonNumber of seasonNumbers) {
                try {
                    const seasonDetails = await getTvSeasonDetails(this._tmdbId, seasonNumber);
                    await upsertTvShowSeasons(this._showId, [{
                        id: seasonDetails?.id ?? null,
                        season_number: seasonDetails?.season_number ?? seasonNumber,
                        name: seasonDetails?.name ?? null,
                        overview: seasonDetails?.overview ?? null,
                        air_date: seasonDetails?.air_date ?? null,
                        poster_path: seasonDetails?.poster_path ?? null,
                        episode_count: Array.isArray(seasonDetails?.episodes)
                            ? seasonDetails.episodes.length
                            : (seasonDetails?.episode_count ?? null),
                        vote_average: seasonDetails?.vote_average ?? null,
                        vote_count: seasonDetails?.vote_count ?? null,
                    }]);
                    await upsertTvShowSeasonEpisodes(this._showId, seasonNumber, seasonDetails?.episodes || []);
                } catch {
                    // Keep refresh resilient when one season request fails.
                }
            }

            await this._saveCredits(credits);
            this._showData = await getTvShowById(this._showId);
            await this._renderAll();
        } catch (error) {
            this._showLoadError(error);
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

    async _saveCredits(creditsData) {
        const credits = [];
        const seenCreditKeys = new Set();
        let order = 0;

        if (Array.isArray(creditsData?.crew)) {
            const addCrew = async (jobs, roleType) => {
                const members = creditsData.crew.filter(member => jobs.includes(member.job));
                for (const member of members) {
                    const personId = await upsertPerson(member.id, {
                        name: member.name,
                        profile_path: member.profile_path || null,
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
                        episode_count: Number.isFinite(Number(member.total_episode_count))
                            ? Number(member.total_episode_count)
                            : (Number.isFinite(Number(member.episode_count)) ? Number(member.episode_count) : null),
                        display_order: order++,
                    });
                }
            };

            await addCrew(['Director'], 'director');
            await addCrew(['Producer'], 'producer');
            await addCrew(['Director of Photography', 'Cinematography'], 'cinematographer');
            await addCrew(['Original Music Composer', 'Music', 'Composer'], 'music_composer');
        }

        if (Array.isArray(creditsData?.cast)) {
            for (const actor of creditsData.cast) {
                const personId = await upsertPerson(actor.id, {
                    name: actor.name,
                    profile_path: actor.profile_path || null,
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
                    episode_count: Number.isFinite(Number(actor.total_episode_count))
                        ? Number(actor.total_episode_count)
                        : null,
                    display_order: order++,
                });
            }
        }

        await upsertTvCredits(this._showId, credits);
    }

    async _renderAll() {
        if (!this._showData) {
            return;
        }

        const show = this._showData;
        const displayTitle = show.name || _('Unknown TV Show');
        this._title_label.set_label(displayTitle);

        const originalTitle = String(show.original_name || '').trim();
        if (originalTitle && originalTitle !== displayTitle) {
            this._original_title_row.set_subtitle(this._escapeMarkup(originalTitle));
            this._original_title_row.set_visible(true);
        } else {
            this._original_title_row.set_visible(false);
        }

        const tagline = String(show.tagline || '').trim();
        this._tagline_label.set_visible(Boolean(tagline));
        this._tagline_label.set_label(tagline);

        this._setRow(this._first_air_row, show.first_air_date);
        this._setRow(this._last_air_row, show.last_air_date);
        this._setRow(this._language_row, this._getLanguageDisplayName(show.original_language));
        this._setRow(this._genre_row, this._extractGenresText(show));
        this._setRow(this._status_row, show.status);

        const seasonCount = Number(show.number_of_seasons) || 0;
        const episodeCount = Number(show.number_of_episodes) || 0;
        this._setRow(this._season_count_row, _('%d seasons • %d episodes').format(seasonCount, episodeCount));

        this._loadCachedRatings();
        this._updateRatingsRow();
        this._loadExternalRatingsInBackground();

        const progress = await getTvProgress(this._showId);
        this._setRow(this._progress_row, _('%d/%d episodes watched').format(progress.watched_episodes, progress.total_episodes));

        const overview = String(show.overview || '').trim();
        this._overview_box.set_visible(Boolean(overview));
        this._overview_label.set_label(overview);

        const posterUrl = buildPosterUrl(show.poster_path);
        loadTextureFromUrlWithFallback(posterUrl, show.poster_path, 'camera-video-symbolic', 250, 375)
            .then(texture => {
                if (texture) {
                    this._poster_image.set_paintable(texture);
                }
            })
            .catch(() => {});

        this._imdb_button.set_visible(Boolean(buildImdbUrl(show.imdb_id)));

        await this._renderSeasons();
        await this._renderCredits();
        await this._renderPlays();
        await this._updateWatchlistButton();
    }

    _extractGenresText(show) {
        const value = String(show.genres || '').trim();
        return value;
    }

    _setRow(row, value) {
        const text = String(value || '').trim();
        row.set_visible(Boolean(text));
        if (text) {
            row.set_subtitle(text);
        }
    }

    _getSettings() {
        if (this._settings) {
            return this._settings;
        }
        try {
            this._settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA_ID });
            return this._settings;
        } catch {
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

    _loadCachedRatings() {
        this._imdbRating = null;

        const cachedImdbRating = Number(this._showData?.imdb_rating);
        if (Number.isFinite(cachedImdbRating)) {
            this._imdbRating = {value: cachedImdbRating};
        }
    }

    _loadExternalRatingsInBackground() {
        const currentShowId = this._showId;
        const currentImdbId = this._showData?.imdb_id ?? null;
        this._loadExternalRatings(currentShowId, currentImdbId).then(() => {
            this._updateRatingsRow();
        }).catch(() => {});
    }

    async _loadExternalRatings(showId, imdbId) {
        if (!showId || !imdbId || !this._isImdbRatingEnabled()) {
            return;
        }

        const imdbRating = await scrapeImdbRating(imdbId).catch(() => null);
        if (this._showId !== showId) {
            return;
        }

        this._imdbRating = imdbRating;

        try {
            await updateTvShowImdbRating(showId, imdbRating?.value ?? null);
            if (this._showData && this._showId === showId) {
                this._showData.imdb_rating = imdbRating?.value ?? null;
            }
        } catch (error) {
            console.error(`TV IMDb cache update failed for show ${showId}:`, error);
        }
    }

    _updateRatingsRow() {
        const ratingParts = [];
        const tmdbAverage = Number(this._showData?.tmdb_average);
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

    async _renderCredits() {
        clearGrid(this._credits_grid);
        clearGrid(this._directors_grid);
        clearGrid(this._producers_grid);
        clearGrid(this._cinematographers_grid);
        clearGrid(this._composers_grid);

        this._credits_group.set_visible(false);
        this._series_crew_box.set_visible(false);
        this._directors_box.set_visible(false);
        this._producers_box.set_visible(false);
        this._cinematographers_box.set_visible(false);
        this._composers_box.set_visible(false);

        const credits = await getTvCredits(this._showId);
        if (credits.length === 0) {
            return;
        }

        const cast = credits.filter(credit => credit.role_type === 'actor');
        const directors = credits.filter(credit => credit.role_type === 'director');
        const producers = credits.filter(credit => credit.role_type === 'producer');
        const cinematographers = credits.filter(credit => credit.role_type === 'cinematographer');
        const composers = credits.filter(credit => credit.role_type === 'music_composer');

        if (cast.length > 0) {
            this._credits_group.set_visible(true);
        }
        for (const credit of cast) {
            const episodeCount = Number(credit.episode_count) || 0;
            const subtitleParts = [];
            if (episodeCount > 0) {
                subtitleParts.push(_('%d episodes').format(episodeCount));
            }
            if (credit.character_name) {
                subtitleParts.push(credit.character_name);
            }
            const subtitleText = subtitleParts.join(' • ');
            const card = createPersonStatCard(credit, {
                subtitleText,
                showCount: false,
                onActivate: personId => this.emit('view-person', personId),
            });
            this._credits_grid.append(card);
        }

        this._renderCrewSection(this._directors_box, this._directors_grid, directors);
        this._renderCrewSection(this._producers_box, this._producers_grid, producers);
        this._renderCrewSection(this._cinematographers_box, this._cinematographers_grid, cinematographers);
        this._renderCrewSection(this._composers_box, this._composers_grid, composers);

        if (directors.length > 0 || producers.length > 0 || cinematographers.length > 0 || composers.length > 0) {
            this._series_crew_box.set_visible(true);
        }
    }

    _renderCrewSection(sectionBox, grid, people) {
        if (!Array.isArray(people) || people.length === 0) {
            sectionBox.set_visible(false);
            return;
        }

        sectionBox.set_visible(true);
        for (const person of people) {
            const episodeCount = Number(person.episode_count) || 0;
            const subtitleText = episodeCount > 0
                ? _('%d episodes').format(episodeCount)
                : '';
            const card = createPersonStatCard(person, {
                subtitleText,
                showCount: false,
                onActivate: personId => this.emit('view-person', personId),
            });
            grid.append(card);
        }
    }

    async _renderSeasons() {
        let child = this._seasons_list.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._seasons_list.remove(child);
            child = next;
        }

        const seasons = await getTvSeasonsWithEpisodes(this._showId);
        const showTmdbRatings = this._isTmdbRatingEnabled();
        for (const season of seasons) {
            const seasonParts = [];
            if (season.air_date) {
                seasonParts.push(season.air_date);
            }
            const seasonEpisodeCount = Number(season.episode_count) || Number(season.total_episodes) || 0;
            if (seasonEpisodeCount > 0) {
                seasonParts.push(_('%d episodes').format(seasonEpisodeCount));
            }
            const seasonRating = Number(season.vote_average);
            if (showTmdbRatings && Number.isFinite(seasonRating) && seasonRating > 0) {
                seasonParts.push(_('TMDB %s/10').format(seasonRating.toFixed(1)));
            }
            const seasonOverview = String(season.overview || '').trim();
            const seasonMetadataText = seasonParts.join(' • ');
            const seasonSubtitle = seasonOverview
                ? (seasonMetadataText
                    ? `${seasonMetadataText}\n${seasonOverview}`
                    : seasonOverview)
                : seasonMetadataText;

            const expander = new Adw.ExpanderRow({
                title: this._escapeMarkup(season.name || _('Season %d').format(Number(season.season_number) || 0)),
                subtitle: this._escapeMarkup(seasonSubtitle),
            });
            expander.add_css_class('tv-season-expander');

            const seasonImageFrame = new Gtk.Frame({
                css_classes: ['movie-poster-frame'],
                width_request: SEASON_IMAGE_WIDTH,
                height_request: SEASON_IMAGE_HEIGHT,
                hexpand: false,
                vexpand: false,
                valign: Gtk.Align.CENTER,
            });
            const seasonImage = new Gtk.Picture({
                width_request: SEASON_IMAGE_WIDTH,
                height_request: SEASON_IMAGE_HEIGHT,
                can_shrink: true,
                content_fit: Gtk.ContentFit.COVER,
                css_classes: ['movie-poster'],
            });
            seasonImageFrame.set_child(seasonImage);
            const seasonPosterPath = season.poster_path || this._showData?.poster_path || null;
            const seasonPosterUrl = buildPosterUrl(seasonPosterPath);
            loadTextureFromUrlWithFallback(
                seasonPosterUrl,
                seasonPosterPath,
                'camera-video-symbolic',
                SEASON_IMAGE_WIDTH,
                SEASON_IMAGE_HEIGHT
            ).then(texture => {
                if (texture) {
                    seasonImage.set_paintable(texture);
                }
            }).catch(() => {});
            expander.add_prefix(seasonImageFrame);

            const seasonLogButton = new Gtk.Button({
                icon_name: 'list-add-symbolic',
                tooltip_text: _('Log whole season'),
                css_classes: ['flat'],
                valign: Gtk.Align.CENTER,
            });
            seasonLogButton.connect('clicked', () => {
                this._showSeasonLogDialog(season.season_number);
            });
            expander.add_suffix(seasonLogButton);

            const episodes = Array.isArray(season.episodes) ? season.episodes : [];
            for (const episode of episodes) {
                const episodeParts = [];
                if (episode.air_date) {
                    episodeParts.push(episode.air_date);
                }
                const episodeRuntime = Number(episode.runtime);
                if (Number.isFinite(episodeRuntime) && episodeRuntime > 0) {
                    episodeParts.push(_('%d min').format(episodeRuntime));
                }
                const episodeRating = Number(episode.vote_average);
                if (showTmdbRatings && Number.isFinite(episodeRating) && episodeRating > 0) {
                    episodeParts.push(_('TMDB %s/10').format(episodeRating.toFixed(1)));
                }

                const episodeOverview = String(episode.overview || '').trim();
                const episodeDirector = this._trimText(episode.director_names || '', 64);
                const episodeWriter = this._trimText(episode.writer_names || '', 64);
                const metadataText = episodeParts.join(' • ');
                const crewTextParts = [];
                if (episodeDirector) {
                    crewTextParts.push(_('Dir: %s').format(episodeDirector));
                }
                if (episodeWriter) {
                    crewTextParts.push(_('Writer: %s').format(episodeWriter));
                }
                const crewText = crewTextParts.join(' • ');
                const subtitleText = episodeOverview
                    ? [metadataText, crewText, episodeOverview]
                        .filter(part => String(part || '').trim().length > 0)
                        .join('\n')
                    : [metadataText, crewText]
                        .filter(part => String(part || '').trim().length > 0)
                        .join('\n');

                const episodeRow = new Adw.ActionRow({
                    title: this._escapeMarkup(_('E%s • %s').format(
                        String(episode.episode_number || 0).padStart(2, '0'),
                        this._trimText(episode.name || _('Untitled Episode'), 72)
                    )),
                    subtitle: this._escapeMarkup(subtitleText),
                });
                episodeRow.add_css_class('tv-episode-row');

                const episodeImageFrame = new Gtk.Frame({
                    css_classes: ['movie-poster-frame'],
                    width_request: EPISODE_IMAGE_WIDTH,
                    height_request: EPISODE_IMAGE_HEIGHT,
                    hexpand: false,
                    vexpand: false,
                    valign: Gtk.Align.CENTER,
                });
                const episodeImage = new Gtk.Picture({
                    width_request: EPISODE_IMAGE_WIDTH,
                    height_request: EPISODE_IMAGE_HEIGHT,
                    can_shrink: true,
                    content_fit: Gtk.ContentFit.COVER,
                    css_classes: ['movie-poster'],
                });
                episodeImageFrame.set_child(episodeImage);
                const stillPath = episode.still_path || null;
                const episodeFallbackPosterPath = season.poster_path || this._showData?.poster_path || null;
                this._loadEpisodeArtwork(episodeImage, stillPath, episodeFallbackPosterPath).catch(() => {});
                episodeRow.add_prefix(episodeImageFrame);

                const episodeLogButton = new Gtk.Button({
                    icon_name: 'list-add-symbolic',
                    tooltip_text: _('Log this episode'),
                    css_classes: ['flat'],
                    valign: Gtk.Align.CENTER,
                });
                episodeLogButton.connect('clicked', () => {
                    this._showEpisodeLogDialog(season.season_number, episode.id);
                });
                episodeRow.add_suffix(episodeLogButton);
                expander.add_row(episodeRow);
            }

            const row = new Gtk.ListBoxRow({ selectable: false, activatable: false });
            row.set_child(expander);
            this._seasons_list.append(row);
        }
    }

    _showLoadError(error) {
        this._title_label.set_label(_('Error loading TV show'));
        this._overview_label.set_label(error?.message || _('Could not load TV show details.'));
        this._overview_box.set_visible(true);
    }

    _trimText(value, maxLength) {
        const text = String(value || '').trim();
        if (text.length <= maxLength) {
            return text;
        }
        return `${text.slice(0, maxLength - 1).trimEnd()}…`;
    }

    _escapeMarkup(value) {
        return GLib.markup_escape_text(String(value || ''), -1);
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
            // Fallback below.
        }

        return normalizedCode.toUpperCase();
    }

    async _loadEpisodeArtwork(imageWidget, stillPath, fallbackPosterPath) {
        const stillUrl = buildStillUrl(stillPath);
        if (stillUrl && stillPath) {
            const stillCacheKey = `${stillPath}#w780`;
            const stillTexture = await loadTextureFromUrl(
                stillUrl,
                stillCacheKey,
                EPISODE_IMAGE_WIDTH,
                EPISODE_IMAGE_HEIGHT
            ).catch(() => null);
            if (stillTexture) {
                imageWidget.set_paintable(stillTexture);
                return;
            }
        }

        const fallbackPosterUrl = buildPosterUrl(fallbackPosterPath);
        const fallbackTexture = await loadTextureFromUrlWithFallback(
            fallbackPosterUrl,
            fallbackPosterPath,
            'camera-video-symbolic',
            EPISODE_IMAGE_WIDTH,
            EPISODE_IMAGE_HEIGHT
        );
        if (fallbackTexture) {
            imageWidget.set_paintable(fallbackTexture);
        }
    }

    async _updateWatchlistButton() {
        const inWatchlist = await isTvShowInWatchlist(this._showId);
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
        const inWatchlist = await isTvShowInWatchlist(this._showId);
        if (inWatchlist) {
            await removeTvShowFromWatchlist(this._showId);
        } else {
            await addTvShowToWatchlist(this._showId);
        }
        await this._updateWatchlistButton();
        this.emit('watchlist-changed');
    }

    async _showAddPlayDialog(initialSelection = {}) {
        const dialog = new Gtk.Dialog({
            title: _('Log TV Plays'),
            modal: true,
            transient_for: this.get_root(),
        });

        const contentArea = dialog.get_content_area();
        contentArea.set_margin_start(24);
        contentArea.set_margin_end(24);
        contentArea.set_margin_top(24);
        contentArea.set_margin_bottom(24);
        contentArea.set_spacing(12);

        const calendar = new Gtk.Calendar();
        contentArea.append(calendar);

        const episodesBySeason = await getTvSeasonsWithEpisodes(this._showId);

        const logTypeLabel = new Gtk.Label({
            label: _('Log type'),
            xalign: 0,
        });
        contentArea.append(logTypeLabel);

        const logTypeList = new Gtk.StringList();
        logTypeList.append(_('Episode'));
        logTypeList.append(_('Season'));
        const logTypeDropdown = new Gtk.DropDown({ model: logTypeList });
        logTypeDropdown.set_selected(0);
        contentArea.append(logTypeDropdown);

        const seasonLabel = new Gtk.Label({
            label: _('Season'),
            xalign: 0,
        });
        contentArea.append(seasonLabel);

        const seasonList = new Gtk.StringList();
        for (const season of episodesBySeason) {
            const seasonNumber = Number(season.season_number) || 0;
            seasonList.append(_('S%s • %s').format(
                String(seasonNumber).padStart(2, '0'),
                season.name || _('Season %d').format(seasonNumber)
            ));
        }
        const seasonDropdown = new Gtk.DropDown({ model: seasonList });
        seasonDropdown.set_selected(0);
        contentArea.append(seasonDropdown);

        const episodeLabel = new Gtk.Label({
            label: _('Episode'),
            xalign: 0,
        });
        contentArea.append(episodeLabel);

        const episodeDropdown = new Gtk.DropDown({ model: null });
        contentArea.append(episodeDropdown);

        let episodeTargets = [];
        const refreshEpisodesForSeason = () => {
            const selectedSeasonIndex = Number(seasonDropdown.get_selected());
            const selectedSeason = episodesBySeason[selectedSeasonIndex] || null;
            const episodeList = new Gtk.StringList();
            episodeTargets = [];

            if (selectedSeason) {
                for (const episode of selectedSeason.episodes || []) {
                    const seasonText = String(episode.season_number || selectedSeason.season_number || 0).padStart(2, '0');
                    const episodeText = String(episode.episode_number || 0).padStart(2, '0');
                    episodeList.append(_('E%s • %s').format(
                        episodeText,
                        episode.name || _('Untitled Episode')
                    ));
                    episodeTargets.push({
                        id: episode.id,
                    });
                }
            }

            if (episodeTargets.length === 0) {
                episodeList.append(_('No episodes available'));
            }

            episodeDropdown.set_model(episodeList);
            episodeDropdown.set_selected(0);
        };

        const syncModeVisibility = () => {
            const isEpisodeMode = Number(logTypeDropdown.get_selected()) === 0;
            episodeLabel.set_visible(isEpisodeMode);
            episodeDropdown.set_visible(isEpisodeMode);
        };

        const requestedSeasonNumber = Number(initialSelection?.seasonNumber);
        let requestedSeasonIndex = 0;
        if (Number.isFinite(requestedSeasonNumber)) {
            const matchedSeasonIndex = episodesBySeason.findIndex(season => Number(season?.season_number) === requestedSeasonNumber);
            if (matchedSeasonIndex >= 0) {
                requestedSeasonIndex = matchedSeasonIndex;
            }
        }
        seasonDropdown.set_selected(requestedSeasonIndex);

        refreshEpisodesForSeason();

        const requestedEpisodeId = Number(initialSelection?.episodeId);
        if (Number.isFinite(requestedEpisodeId) && episodeTargets.length > 0) {
            const matchedEpisodeIndex = episodeTargets.findIndex(target => Number(target?.id) === requestedEpisodeId);
            if (matchedEpisodeIndex >= 0) {
                episodeDropdown.set_selected(matchedEpisodeIndex);
            }
        }

        const initialMode = String(initialSelection?.mode || '').trim().toLowerCase();
        const isInitialSeasonMode = initialMode === 'season';
        logTypeDropdown.set_selected(isInitialSeasonMode ? 1 : 0);
        syncModeVisibility();

        seasonDropdown.connect('notify::selected', () => {
            refreshEpisodesForSeason();
        });
        logTypeDropdown.connect('notify::selected', () => {
            syncModeVisibility();
        });

        const places = await getAllPlaces();
        const placeDropdown = new Gtk.DropDown({ model: null });
        const placeList = new Gtk.StringList();
        placeList.append(_('None'));
        for (const place of places) {
            placeList.append(place.name);
        }
        placeDropdown.set_model(placeList);
        contentArea.append(placeDropdown);

        const commentEntry = new Gtk.Entry({ placeholder_text: _('Comment (optional)') });
        contentArea.append(commentEntry);

        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Save'), Gtk.ResponseType.OK);

        dialog.connect('response', async (dlg, response) => {
            if (response !== Gtk.ResponseType.OK) {
                dlg.close();
                return;
            }

            const selectedSeasonIndex = Number(seasonDropdown.get_selected());
            const selectedSeason = episodesBySeason[selectedSeasonIndex] || null;
            if (!selectedSeason) {
                dlg.close();
                return;
            }
            const isEpisodeMode = Number(logTypeDropdown.get_selected()) === 0;

            const date = calendar.get_date();
            const watchedAt = `${date.get_year()}-${String(date.get_month()).padStart(2, '0')}-${String(date.get_day_of_month()).padStart(2, '0')}`;
            const placeIndex = Number(placeDropdown.get_selected());
            const placeId = placeIndex > 0 ? places[placeIndex - 1].id : null;
            const comment = commentEntry.get_text().trim() || null;

            try {
                if (isEpisodeMode) {
                    const selectedEpisodeIndex = Number(episodeDropdown.get_selected());
                    const selectedEpisode = episodeTargets[selectedEpisodeIndex] || null;
                    if (!selectedEpisode) {
                        const validationDialog = new Adw.AlertDialog({
                            heading: _('Could not save play'),
                            body: _('Please select an episode to log.'),
                        });
                        validationDialog.add_response('ok', _('OK'));
                        validationDialog.present(this.get_root());
                        return;
                    }
                    await addTvEpisodePlay(this._showId, selectedEpisode.id, watchedAt, placeId, comment);
                } else {
                    await addTvSeasonPlays(this._showId, selectedSeason.season_number, watchedAt, placeId, comment);
                }
                await this._renderPlays();
                this.emit('plays-changed');

                const settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA_ID });
                const autoRemove = settings.get_boolean('auto-remove-from-watchlist');
                const inWatchlist = await isTvShowInWatchlist(this._showId);
                if (autoRemove && inWatchlist) {
                    await removeTvShowFromWatchlist(this._showId);
                    await this._updateWatchlistButton();
                    this.emit('watchlist-changed');
                }
            } catch (error) {
                const errorDialog = new Adw.AlertDialog({
                    heading: _('Could not save play'),
                    body: error.message || _('An unexpected error occurred while saving play logs.'),
                });
                errorDialog.add_response('ok', _('OK'));
                errorDialog.present(this.get_root());
            }

            dlg.close();
        });

        dialog.present();
    }

    _showSeasonLogDialog(seasonNumber) {
        this._showAddPlayDialog({
            mode: 'season',
            seasonNumber,
        }).catch(error => this._showLoadError(error));
    }

    _showEpisodeLogDialog(seasonNumber, episodeId) {
        this._showAddPlayDialog({
            mode: 'episode',
            seasonNumber,
            episodeId,
        }).catch(error => this._showLoadError(error));
    }

    async _renderPlays() {
        let child = this._plays_list.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._plays_list.remove(child);
            child = next;
        }

        const plays = await getTvPlaysForShow(this._showId);
        if (plays.length === 0) {
            this._plays_count_label.set_label(_('No plays recorded'));
            return;
        }

        const progress = await getTvProgress(this._showId);
        this._plays_count_label.set_label(_('%d play logs • %d/%d episodes watched').format(
            plays.length,
            progress.watched_episodes,
            progress.total_episodes
        ));

        for (const play of plays) {
            const row = new Gtk.Box({
                orientation: Gtk.Orientation.VERTICAL,
                spacing: 4,
                margin_top: 4,
                margin_bottom: 4,
            });
            const seasonText = String(play.season_number || 0).padStart(2, '0');
            const episodeText = String(play.episode_number || 0).padStart(2, '0');
            const titleLabel = new Gtk.Label({
                xalign: 0,
                label: _('S%sE%s • %s').format(
                    seasonText,
                    episodeText,
                    play.episode_name || _('Untitled Episode')
                ),
                wrap: true,
                max_width_chars: 28,
            });
            row.append(titleLabel);

            const subLabel = new Gtk.Label({
                xalign: 0,
                css_classes: ['dim-label', 'caption'],
                label: formatDate(play.watched_at, { month: 'long' }),
            });
            row.append(subLabel);

            if (play.place_name) {
                const placeLabel = new Gtk.Label({
                    xalign: 0,
                    css_classes: ['dim-label', 'caption'],
                    label: play.place_name,
                    wrap: true,
                    max_width_chars: 28,
                });
                row.append(placeLabel);
            }

            if (play.comment) {
                const commentLabel = new Gtk.Label({
                    xalign: 0,
                    css_classes: ['caption'],
                    label: play.comment,
                    wrap: true,
                    max_width_chars: 28,
                });
                row.append(commentLabel);
            }

            const actionsBox = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 6,
                halign: Gtk.Align.START,
            });

            const editButton = new Gtk.Button({
                icon_name: 'document-edit-symbolic',
                tooltip_text: _('Edit Play'),
                css_classes: ['flat'],
            });
            editButton.connect('clicked', async () => {
                await this._showEditPlayDialog(play);
            });
            actionsBox.append(editButton);

            const deleteButton = new Gtk.Button({
                icon_name: 'user-trash-symbolic',
                css_classes: ['flat', 'destructive-action'],
                tooltip_text: _('Delete Play'),
                halign: Gtk.Align.START,
            });
            deleteButton.connect('clicked', async () => {
                const dialog = new Adw.AlertDialog({
                    heading: _('Delete Play?'),
                    body: _('Are you sure you want to delete this play from %s?').format(
                        formatDate(play.watched_at)
                    ),
                });

                dialog.add_response('cancel', _('Cancel'));
                dialog.add_response('delete', _('Delete'));
                dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);

                dialog.connect('response', async (dlg, response) => {
                    if (response !== 'delete') {
                        return;
                    }

                    await deleteTvEpisodePlay(play.id);
                    await this._renderPlays();
                    this.emit('plays-changed');
                });

                dialog.present(this.get_root());
            });
            actionsBox.append(deleteButton);
            row.append(actionsBox);

            this._plays_list.append(row);
        }
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

        const dateLabel = new Gtk.Label({
            label: _('Watch Date:'),
            xalign: 0,
        });
        contentArea.append(dateLabel);

        const calendar = new Gtk.Calendar();
        try {
            const watchedDateText = String(play.watched_at || '').trim();
            const dateMatch = watchedDateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            const playYear = dateMatch ? Number(dateMatch[1]) : NaN;
            const playMonth = dateMatch ? Number(dateMatch[2]) : NaN;
            const playDay = dateMatch ? Number(dateMatch[3]) : NaN;
            if (!Number.isFinite(playYear) || !Number.isFinite(playMonth) || !Number.isFinite(playDay)) {
                throw new Error('Invalid watched_at date');
            }
            const gDateTime = GLib.DateTime.new_local(
                playYear,
                playMonth,
                playDay,
                0, 0, 0
            );
            calendar.select_day(gDateTime);
        } catch {
            // Ignore date prefill failures.
        }
        contentArea.append(calendar);

        const orderLabel = new Gtk.Label({
            label: _('Watch Order:'),
            xalign: 0,
            margin_top: 12,
        });
        contentArea.append(orderLabel);

        const currentWatchOrder = Number(play.watch_order);
        const maxWatchOrder = Number.isFinite(currentWatchOrder)
            ? Math.max(200, Math.floor(currentWatchOrder))
            : 200;
        const orderSpinButton = Gtk.SpinButton.new_with_range(1, maxWatchOrder, 1);
        orderSpinButton.set_value(Number.isFinite(currentWatchOrder) ? currentWatchOrder : 1);
        contentArea.append(orderSpinButton);

        const placeLabel = new Gtk.Label({
            label: _('Place (optional):'),
            xalign: 0,
            margin_top: 12,
        });
        contentArea.append(placeLabel);

        const places = await getAllPlaces();
        const placeDropdown = new Gtk.DropDown({ model: null });
        const placeList = new Gtk.StringList();
        placeList.append(_('None'));
        for (const place of places) {
            placeList.append(place.name);
        }
        placeDropdown.set_model(placeList);
        if (play.place_id) {
            const selectedPlaceIndex = places.findIndex(place => place.id === play.place_id);
            if (selectedPlaceIndex >= 0) {
                placeDropdown.set_selected(selectedPlaceIndex + 1);
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
            if (response !== Gtk.ResponseType.OK) {
                dlg.close();
                return;
            }

            const date = calendar.get_date();
            const isoDate = `${date.get_year()}-${String(date.get_month()).padStart(2, '0')}-${String(date.get_day_of_month()).padStart(2, '0')}`;
            const selectedIndex = Number(placeDropdown.get_selected());
            const placeId = selectedIndex > 0 ? places[selectedIndex - 1].id : null;
            const watchOrder = orderSpinButton.get_value_as_int();
            const trimmedComment = commentEntry.get_text().trim();
            const comment = trimmedComment ? trimmedComment : null;

            try {
                await updateTvEpisodePlay(play.id, isoDate, placeId, watchOrder, comment);
                await this._renderPlays();
                this.emit('plays-changed');
            } catch (error) {
                const errorDialog = new Adw.AlertDialog({
                    heading: _('Could not update play'),
                    body: error.message || _('An unexpected error occurred while updating play logs.'),
                });
                errorDialog.add_response('ok', _('OK'));
                errorDialog.present(this.get_root());
            }

            dlg.close();
        });

        dialog.present();
    }

    _openUrl(url) {
        if (!url) {
            return;
        }

        try {
            Gio.AppInfo.launch_default_for_uri(url, null);
        } catch {
            // Ignore launch failures.
        }
    }
});
