import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { getTitleDetails, getTitleCredits, getTvSeasonDetails } from '../services/tmdb-service.js';
import { scrapeImdbRating } from '../services/imdb-service.js';
import {
    getAllTitlesForRefresh,
    getAllTitlesWithImdbIds,
    upsertMovieFromTmdb,
    findMovieByTmdbId,
    upsertTvShowFromTmdb,
    upsertTvSeasons,
    upsertSeasonEpisodes,
    upsertPerson,
    upsertMovieCredits,
    upsertTvCredits,
    updateMovieImdbRating,
    updateTvShowImdbRating,
    addMovieToWatchlist,
    addTvShowToWatchlist,
    addPlay,
    addTvEpisodePlay,
    hasMoviePlays,
    hasTvEpisodePlay,
    getTvEpisodeByShowSeasonEpisode,
    getAllPlaces,
    addPlace,
} from '../utils/database-utils.js';

const SETTINGS_SCHEMA_ID = (GLib.getenv('FLATPAK_ID') || '').endsWith('.Devel')
    ? 'io.github.ans_ibrahim.Memento.Devel'
    : 'io.github.ans_ibrahim.Memento';

const BACKUP_EXTENSION = '.backup';
const DATABASE_FILENAME = 'memento.db';
const SETTINGS_FILENAME = 'settings.json';
const TICKETBOOTH_DATA_FILENAME = 'data.json';
const TICKETBOOTH_PLAY_MODE_ADD = 'add';
const TICKETBOOTH_PLAY_MODE_SKIP_EXISTING = 'skip_existing';
const MOVARY_IMPORT_MODE_HISTORY = 'history';
const MOVARY_IMPORT_MODE_WATCHLIST = 'watchlist';

export const MementoPreferencesDialog = GObject.registerClass({
    GTypeName: 'MementoPreferencesDialog',
    Template: 'resource:///app/memento/memento/pages/preferences-page.ui',
    InternalChildren: [
        'api_key_row',
        'auto_remove_switch',
        'tmdb_rating_switch',
        'imdb_rating_switch',
        'people_metric_dropdown',
        'people_tv_episode_level_switch',
        'refresh_all_button',
        'refresh_progress_bar',
        'refresh_progress_row',
        'refresh_imdb_ratings_button',
        'refresh_imdb_progress_bar',
        'refresh_imdb_progress_row',
        'export_backup_button',
        'import_backup_button',
        'import_ticketbooth_button',
        'import_movary_button',
    ],
}, class MementoPreferencesDialog extends Adw.Dialog {
    constructor(params = {}) {
        super(params);
        this._settings = new Gio.Settings({ schema_id: SETTINGS_SCHEMA_ID });
        this._refreshInProgress = false;
        this._refreshImdbInProgress = false;
        this._setupBindings();
        this._loadApiKey();
        this._loadPeopleMetricPreference();
        this._setupPeopleMetricPreference();
        this._setupRefreshAllTitles();
        this._setupRefreshAllImdbRatings();
        this._setupBackupActions();
        this._setupTicketboothImportAction();
        this._setupMovaryImportAction();
    }

    _loadPeopleMetricPreference() {
        const metric = this._settings.get_string('dashboard-people-metric');
        this._people_metric_dropdown.set_selected(metric === 'unique' ? 1 : 0);
    }

    _setupPeopleMetricPreference() {
        this._people_metric_dropdown.connect('notify::selected', () => {
            const selectedIndex = Number(this._people_metric_dropdown.get_selected());
            const metric = selectedIndex === 1 ? 'unique' : 'total';
            this._settings.set_string('dashboard-people-metric', metric);
        });
    }

    _setupBindings() {
        // Bind auto-remove switch to settings
        this._settings.bind(
            'auto-remove-from-watchlist',
            this._auto_remove_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'enable-tmdb-rating',
            this._tmdb_rating_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'enable-imdb-rating',
            this._imdb_rating_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._settings.bind(
            'dashboard-people-tv-episode-level',
            this._people_tv_episode_level_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
    }

    _loadApiKey() {
        // Load API key into entry (load on demand, don't bind for security)
        const apiKey = this._settings.get_string('tmdb-api-key');
        this._api_key_row.set_text(apiKey || '');
    }

    _onApiKeyApply() {
        // Save API key when apply button is clicked
        const apiKey = this._api_key_row.get_text();
        this._settings.set_string('tmdb-api-key', apiKey);

        this._showToast(_('API key saved'), 2);
    }

    _onGetApiKeyActivated() {
        // Open TMDG API documentation
        const launcher = new Gtk.UriLauncher({
            uri: 'https://www.themoviedb.org/settings/api',
        });
        launcher.launch(this.get_root(), null, null);
    }

    _setupRefreshAllTitles() {
        this._refresh_all_button.connect('clicked', () => {
            this._refreshAllTitles();
        });
    }

    _setupRefreshAllImdbRatings() {
        this._refresh_imdb_ratings_button.connect('clicked', () => {
            this._refreshAllImdbRatings();
        });
    }

    _setupBackupActions() {
        this._export_backup_button.connect('clicked', () => {
            this._onExportBackupClicked();
        });
        this._import_backup_button.connect('clicked', () => {
            this._onImportBackupClicked();
        });
    }

    _setupTicketboothImportAction() {
        this._import_ticketbooth_button.connect('clicked', () => {
            this._onImportTicketboothClicked();
        });
    }

    _setupMovaryImportAction() {
        this._import_movary_button.connect('clicked', () => {
            this._onImportMovaryClicked();
        });
    }

    _onExportBackupClicked() {
        const chooser = new Gtk.FileChooserNative({
            title: _('Export backup'),
            action: Gtk.FileChooserAction.SAVE,
            transient_for: this.get_root(),
            modal: true,
            accept_label: _('Export'),
            cancel_label: _('Cancel'),
        });

        chooser.set_current_name(`memento-${GLib.DateTime.new_now_local().format('%Y%m%d-%H%M%S')}${BACKUP_EXTENSION}`);

        const filter = new Gtk.FileFilter();
        filter.set_name(_('Backup files'));
        filter.add_pattern(`*${BACKUP_EXTENSION}`);
        chooser.add_filter(filter);
        chooser.set_filter(filter);

        chooser.connect('response', (_dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const file = chooser.get_file();
                if (file) {
                    this._exportBackupToFile(file).catch(error => {
                        console.error('Failed to export backup:', error);
                        this._showToast(_('Failed to export backup'), 4);
                    });
                }
            }
            chooser.destroy();
        });

        chooser.show();
    }

    _onImportBackupClicked() {
        const chooser = new Gtk.FileChooserNative({
            title: _('Import backup'),
            action: Gtk.FileChooserAction.OPEN,
            transient_for: this.get_root(),
            modal: true,
            accept_label: _('Import'),
            cancel_label: _('Cancel'),
        });

        const filter = new Gtk.FileFilter();
        filter.set_name(_('Backup files'));
        filter.add_pattern(`*${BACKUP_EXTENSION}`);
        chooser.add_filter(filter);
        chooser.set_filter(filter);

        chooser.connect('response', (_dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const file = chooser.get_file();
                if (file) {
                    this._importBackupFromFile(file).catch(error => {
                        console.error('Failed to import backup:', error);
                        this._showToast(_('Failed to import backup'), 4);
                    });
                }
            }
            chooser.destroy();
        });

        chooser.show();
    }

    _onImportTicketboothClicked() {
        const chooser = new Gtk.FileChooserNative({
            title: _('Import Ticket Booth backup'),
            action: Gtk.FileChooserAction.OPEN,
            transient_for: this.get_root(),
            modal: true,
            accept_label: _('Import'),
            cancel_label: _('Cancel'),
        });

        const filter = new Gtk.FileFilter();
        filter.set_name(_('ZIP files'));
        filter.add_pattern('*.zip');
        chooser.add_filter(filter);
        chooser.set_filter(filter);

        chooser.connect('response', (_dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const file = chooser.get_file();
                if (file) {
                    const archivePath = file.get_path();
                    this._promptTicketboothPlayImportMode().then(playImportMode => {
                        if (!playImportMode) {
                            return;
                        }
                        return this._importTicketboothFromFile(archivePath, { playImportMode });
                    }).catch(error => {
                        console.error('Failed to import Ticket Booth backup:', error);
                        this._showToast(_('Failed to import Ticket Booth backup'), 4);
                    });
                }
            }
            chooser.destroy();
        });

        chooser.show();
    }

    _onImportMovaryClicked() {
        const chooser = new Gtk.FileChooserNative({
            title: _('Import Movary CSV'),
            action: Gtk.FileChooserAction.OPEN,
            transient_for: this.get_root(),
            modal: true,
            accept_label: _('Import'),
            cancel_label: _('Cancel'),
        });

        const filter = new Gtk.FileFilter();
        filter.set_name(_('CSV files'));
        filter.add_pattern('*.csv');
        chooser.add_filter(filter);
        chooser.set_filter(filter);

        chooser.connect('response', (_dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const file = chooser.get_file();
                if (file) {
                    const csvPath = file.get_path();
                    this._promptMovaryImportMode().then(importMode => {
                        if (!importMode) {
                            return;
                        }
                        return this._importMovaryFromFile(csvPath, importMode);
                    }).catch(error => {
                        console.error('Failed to import Movary export:', error);
                        this._showToast(_('Failed to import Movary export'), 4);
                    });
                }
            }
            chooser.destroy();
        });

        chooser.show();
    }

    _promptTicketboothPlayImportMode() {
        const dialog = new Adw.AlertDialog({
            heading: _('Import watched plays'),
            body: _('If a watched title already has plays in Memento, should import add another play or skip it?'),
            close_response: 'cancel',
        });
        dialog.add_response('add', _('Add new plays'));
        dialog.add_response('skip', _('Skip existing'));
        dialog.add_response('cancel', _('Cancel'));
        dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);

        return new Promise((resolve, reject) => {
            dialog.choose(this.get_root(), null, (_dialog, result) => {
                try {
                    const response = dialog.choose_finish(result);
                    if (response === 'add') {
                        resolve(TICKETBOOTH_PLAY_MODE_ADD);
                        return;
                    }
                    if (response === 'skip') {
                        resolve(TICKETBOOTH_PLAY_MODE_SKIP_EXISTING);
                        return;
                    }
                    resolve(null);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    _promptMovaryImportMode() {
        const dialog = new Adw.AlertDialog({
            heading: _('Import Movary CSV'),
            body: _('Select what this CSV contains.'),
            close_response: 'cancel',
        });
        dialog.add_response('history', _('History (plays)'));
        dialog.add_response('watchlist', _('Watchlist'));
        dialog.add_response('cancel', _('Cancel'));
        dialog.set_response_appearance('history', Adw.ResponseAppearance.SUGGESTED);

        return new Promise((resolve, reject) => {
            dialog.choose(this.get_root(), null, (_dialog, result) => {
                try {
                    const response = dialog.choose_finish(result);
                    if (response === 'history') {
                        resolve(MOVARY_IMPORT_MODE_HISTORY);
                        return;
                    }
                    if (response === 'watchlist') {
                        resolve(MOVARY_IMPORT_MODE_WATCHLIST);
                        return;
                    }
                    resolve(null);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    async _exportBackupToFile(targetFile) {
        const sourceDatabasePath = this._getDatabasePath();
        if (!GLib.file_test(sourceDatabasePath, GLib.FileTest.EXISTS)) {
            throw new Error('Database file does not exist.');
        }

        const targetPath = this._checkBackupExtension(targetFile.get_path());
        if (!targetPath) {
            throw new Error('Invalid export path.');
        }

        const tempDir = this._createTempDir('memento-backup-export-XXXXXX');
        const tempDatabasePath = GLib.build_filenamev([tempDir, DATABASE_FILENAME]);
        const tempSettingsPath = GLib.build_filenamev([tempDir, SETTINGS_FILENAME]);

        try {
            this._copyFile(sourceDatabasePath, tempDatabasePath);

            const settingsPayload = this._serializeSettings();
            GLib.file_set_contents(tempSettingsPath, JSON.stringify(settingsPayload, null, 2));

            this._runSubprocess([
                'zip',
                '-j',
                '-q',
                targetPath,
                tempDatabasePath,
                tempSettingsPath,
            ]);
        } finally {
            this._removePathRecursive(tempDir);
        }

        this._showToast(_('Backup exported successfully'), 3);
    }

    async _importBackupFromFile(backupFile) {
        const backupPath = backupFile.get_path();
        if (!backupPath || !GLib.file_test(backupPath, GLib.FileTest.EXISTS)) {
            throw new Error('Backup file does not exist.');
        }

        const tempDir = this._createTempDir('memento-backup-import-XXXXXX');
        const extractedDatabasePath = GLib.build_filenamev([tempDir, DATABASE_FILENAME]);
        const extractedSettingsPath = GLib.build_filenamev([tempDir, SETTINGS_FILENAME]);

        try {
            this._validateBackupArchiveEntries(backupPath);
            this._runSubprocess([
                'unzip',
                '-j',
                '-o',
                '-q',
                backupPath,
                DATABASE_FILENAME,
                SETTINGS_FILENAME,
                '-d',
                tempDir,
            ]);

            if (!GLib.file_test(extractedDatabasePath, GLib.FileTest.EXISTS)) {
                throw new Error('Backup is missing database file.');
            }
            if (!GLib.file_test(extractedSettingsPath, GLib.FileTest.EXISTS)) {
                throw new Error('Backup is missing settings file.');
            }

            const [, rawSettings] = GLib.file_get_contents(extractedSettingsPath);
            const parsedSettings = JSON.parse(new TextDecoder().decode(rawSettings));
            const importSettingsState = this._buildImportSettingsState(parsedSettings);
            const currentSettingsState = this._buildImportSettingsState(this._serializeSettings());

            const destinationDatabasePath = this._getDatabasePath();
            const existingDatabasePath = GLib.build_filenamev([tempDir, `existing-${DATABASE_FILENAME}`]);
            const hadExistingDatabase = GLib.file_test(destinationDatabasePath, GLib.FileTest.EXISTS);
            if (hadExistingDatabase) {
                this._copyFile(destinationDatabasePath, existingDatabasePath);
            }

            try {
                this._copyFile(extractedDatabasePath, destinationDatabasePath);
                this._applyImportSettingsState(importSettingsState);
                this._loadApiKey();
                this._loadPeopleMetricPreference();
            } catch (error) {
                if (hadExistingDatabase) {
                    this._copyFile(existingDatabasePath, destinationDatabasePath);
                } else if (GLib.file_test(destinationDatabasePath, GLib.FileTest.EXISTS)) {
                    Gio.File.new_for_path(destinationDatabasePath).delete(null);
                }
                this._applyImportSettingsState(currentSettingsState);
                this._loadApiKey();
                this._loadPeopleMetricPreference();
                throw error;
            }
        } finally {
            this._removePathRecursive(tempDir);
        }

        this._showRestartPromptAfterImport();
    }

    async _importTicketboothFromFile(archivePath, options = {}) {
        const playImportMode = options?.playImportMode || TICKETBOOTH_PLAY_MODE_ADD;
        const tempDir = this._createTempDir('memento-ticketbooth-import-XXXXXX');
        const extractedDataPath = GLib.build_filenamev([tempDir, TICKETBOOTH_DATA_FILENAME]);

        try {
            const ticketboothDataEntry = this._findArchiveEntryByBasename(
                archivePath,
                TICKETBOOTH_DATA_FILENAME
            );
            if (!ticketboothDataEntry) {
                throw new Error('Ticket Booth backup is missing data.json.');
            }

            this._runSubprocess([
                'unzip',
                '-j',
                '-o',
                '-q',
                archivePath,
                ticketboothDataEntry,
                '-d',
                tempDir,
            ]);

            if (!GLib.file_test(extractedDataPath, GLib.FileTest.EXISTS)) {
                throw new Error('Ticket Booth backup is missing data.json.');
            }

            const [, rawData] = GLib.file_get_contents(extractedDataPath);
            const payload = JSON.parse(new TextDecoder().decode(rawData));

            const movies = Array.isArray(payload?.movies) ? payload.movies : [];
            const series = Array.isArray(payload?.series) ? payload.series : [];

            for (const movie of movies) {
                await this._importTicketboothMovie(movie, playImportMode);
            }
            for (const show of series) {
                await this._importTicketboothSeries(show, playImportMode);
            }
        } finally {
            this._removePathRecursive(tempDir);
        }

        this._showRestartPromptAfterImport();
    }

    async _importMovaryFromFile(csvPath, importMode) {
        if (!csvPath || !GLib.file_test(csvPath, GLib.FileTest.EXISTS)) {
            throw new Error('Movary CSV file does not exist.');
        }
        if (
            importMode !== MOVARY_IMPORT_MODE_HISTORY &&
            importMode !== MOVARY_IMPORT_MODE_WATCHLIST
        ) {
            throw new Error('Invalid Movary import mode.');
        }

        const movieIdCache = new Map();
        const placeIdCache = await this._buildPlaceIdCache();

        if (importMode === MOVARY_IMPORT_MODE_WATCHLIST) {
            const watchlistRows = this._readCsvRows(csvPath);
            for (const row of watchlistRows) {
                const titleId = await this._resolveMovaryMovieId(row, movieIdCache);
                if (!titleId) {
                    continue;
                }
                await addMovieToWatchlist(titleId);
            }
            this._showRestartPromptAfterImport();
            return;
        }

        if (importMode === MOVARY_IMPORT_MODE_HISTORY) {
            const historyRows = this._readCsvRows(csvPath);
            const datedRows = historyRows.filter(row => {
                const watchedAt = String(row?.watchedAt || '').trim();
                return /^\d{4}-\d{2}-\d{2}$/.test(watchedAt);
            });

            for (let index = datedRows.length - 1; index >= 0; index -= 1) {
                const row = datedRows[index];
                const titleId = await this._resolveMovaryMovieId(row, movieIdCache);
                if (!titleId) {
                    continue;
                }
                const watchedAt = String(row.watchedAt).trim();
                const comment = this._toOptionalCsvField(row?.comment);
                const placeId = await this._resolvePlaceId(row?.location, placeIdCache);
                await addPlay(titleId, watchedAt, placeId, comment);
            }
        }

        this._showRestartPromptAfterImport();
    }

    async _resolveMovaryMovieId(row, movieIdCache) {
        const tmdbId = Number(row?.tmdbId);
        if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
            return null;
        }

        if (movieIdCache.has(tmdbId)) {
            return movieIdCache.get(tmdbId);
        }

        const existingMovie = await findMovieByTmdbId(tmdbId);
        if (existingMovie?.id) {
            const existingId = Number(existingMovie.id);
            movieIdCache.set(tmdbId, existingId);
            return existingId;
        }

        const titleId = await upsertMovieFromTmdb(this._buildMovaryMoviePayload(row, tmdbId));
        movieIdCache.set(tmdbId, titleId);
        return titleId;
    }

    _buildMovaryMoviePayload(row, tmdbId) {
        const title = this._toOptionalCsvField(row?.title) || 'Untitled';
        const rawImdbId = this._toOptionalCsvField(row?.imdbId);
        const normalizedImdbId = /^tt\d+$/.test(String(rawImdbId || '')) ? rawImdbId : null;

        return {
            id: tmdbId,
            title,
            original_title: title,
            imdb_id: normalizedImdbId,
            release_date: null,
            overview: null,
            tagline: null,
            original_language: null,
            poster_path: null,
            runtime: null,
            budget: null,
            vote_average: null,
            vote_count: null,
            revenue: null,
            genres: [],
        };
    }

    _readCsvRows(csvPath) {
        if (!GLib.file_test(csvPath, GLib.FileTest.EXISTS)) {
            return [];
        }

        const [, rawData] = GLib.file_get_contents(csvPath);
        const parsedRows = this._parseCsv(new TextDecoder().decode(rawData));
        if (parsedRows.length === 0) {
            return [];
        }

        const headers = parsedRows[0].map(header => String(header).trim());
        const rows = [];
        for (let rowIndex = 1; rowIndex < parsedRows.length; rowIndex += 1) {
            const values = parsedRows[rowIndex];
            const row = {};
            let hasAnyValue = false;
            for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
                const header = headers[columnIndex];
                if (!header) {
                    continue;
                }
                const value = values[columnIndex] ?? '';
                if (String(value).trim().length > 0) {
                    hasAnyValue = true;
                }
                row[header] = value;
            }
            if (hasAnyValue) {
                rows.push(row);
            }
        }
        return rows;
    }

    _parseCsv(content) {
        const rows = [];
        let currentRow = [];
        let currentValue = '';
        let insideQuotes = false;

        for (let index = 0; index < content.length; index += 1) {
            const character = content[index];

            if (character === '"') {
                const nextCharacter = content[index + 1];
                if (insideQuotes && nextCharacter === '"') {
                    currentValue += '"';
                    index += 1;
                    continue;
                }
                insideQuotes = !insideQuotes;
                continue;
            }

            if (character === ',' && !insideQuotes) {
                currentRow.push(currentValue);
                currentValue = '';
                continue;
            }

            if ((character === '\n' || character === '\r') && !insideQuotes) {
                if (character === '\r' && content[index + 1] === '\n') {
                    index += 1;
                }
                currentRow.push(currentValue);
                rows.push(currentRow);
                currentRow = [];
                currentValue = '';
                continue;
            }

            currentValue += character;
        }

        const hasTrailingData = currentValue.length > 0 || currentRow.length > 0;
        if (hasTrailingData) {
            currentRow.push(currentValue);
            rows.push(currentRow);
        }

        return rows;
    }

    _toOptionalCsvField(value) {
        const trimmedValue = String(value ?? '').trim();
        return trimmedValue.length > 0 ? trimmedValue : null;
    }

    async _buildPlaceIdCache() {
        const places = await getAllPlaces();
        const placeIdCache = new Map();

        for (const place of places) {
            const normalizedName = this._normalizePlaceName(place?.name);
            if (!normalizedName) {
                continue;
            }
            placeIdCache.set(normalizedName, Number(place.id));
        }

        return placeIdCache;
    }

    async _resolvePlaceId(rawPlaceName, placeIdCache) {
        const normalizedName = this._normalizePlaceName(rawPlaceName);
        if (!normalizedName) {
            return null;
        }

        if (placeIdCache.has(normalizedName)) {
            return placeIdCache.get(normalizedName);
        }

        await addPlace(normalizedName, false);
        const places = await getAllPlaces();
        const createdPlace = places.find(place => this._normalizePlaceName(place?.name) === normalizedName);
        const createdPlaceId = Number(createdPlace?.id);
        if (!Number.isFinite(createdPlaceId) || createdPlaceId <= 0) {
            throw new Error(`Failed to resolve place id for location '${normalizedName}'.`);
        }

        placeIdCache.set(normalizedName, createdPlaceId);
        return createdPlaceId;
    }

    _normalizePlaceName(rawPlaceName) {
        const trimmedName = String(rawPlaceName ?? '').trim();
        return trimmedName.length > 0 ? trimmedName : null;
    }

    _findArchiveEntryByBasename(archivePath, filename) {
        const output = this._runSubprocessAndCaptureStdout([
            'unzip',
            '-Z1',
            archivePath,
        ]);
        const entries = output
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        for (const entry of entries) {
            const baseName = entry.split('/').pop() || entry;
            if (baseName === filename) {
                return entry;
            }
        }
        return null;
    }

    async _importTicketboothMovie(movie, playImportMode) {
        const tmdbId = Number(movie?.id);
        if (!Number.isFinite(tmdbId)) {
            return;
        }

        const titleId = await upsertMovieFromTmdb({
            id: tmdbId,
            title: movie?.title || movie?.original_title || null,
            original_title: movie?.original_title || movie?.title || null,
            overview: movie?.overview || null,
            tagline: movie?.tagline || null,
            original_language: movie?.original_language || null,
            poster_path: this._normalizeTicketboothImagePath(movie?.poster_path),
            backdrop_path: this._normalizeTicketboothImagePath(movie?.backdrop_path),
            runtime: Number.isFinite(Number(movie?.runtime)) ? Number(movie.runtime) : null,
            release_date: movie?.release_date || null,
            vote_average: null,
            vote_count: null,
            budget: Number.isFinite(Number(movie?.budget)) ? Number(movie.budget) : null,
            revenue: Number.isFinite(Number(movie?.revenue)) ? Number(movie.revenue) : null,
            genres: this._toTmdbGenres(movie?.genres),
        });

        await addMovieToWatchlist(titleId);
        if (Number(movie?.watched) === 1) {
            if (playImportMode === TICKETBOOTH_PLAY_MODE_SKIP_EXISTING) {
                const alreadyHasPlays = await hasMoviePlays(titleId);
                if (alreadyHasPlays) {
                    return;
                }
            }
            await addPlay(titleId, null);
        }
    }

    async _importTicketboothSeries(show, playImportMode) {
        const tmdbId = Number(show?.id);
        if (!Number.isFinite(tmdbId)) {
            return;
        }

        const seasons = Array.isArray(show?.seasons) ? show.seasons : [];

        const showId = await upsertTvShowFromTmdb({
            id: tmdbId,
            name: show?.title || show?.original_title || null,
            original_name: show?.original_title || show?.title || null,
            overview: show?.overview || null,
            tagline: show?.tagline || null,
            original_language: show?.original_language || null,
            poster_path: this._normalizeTicketboothImagePath(show?.poster_path),
            backdrop_path: this._normalizeTicketboothImagePath(show?.backdrop_path),
            genres: this._toTmdbGenres(show?.genres),
            first_air_date: show?.release_date || null,
            last_air_date: show?.last_air_date || null,
            status: show?.status || null,
            number_of_seasons: Number.isFinite(Number(show?.seasons_number)) ? Number(show.seasons_number) : null,
            number_of_episodes: Number.isFinite(Number(show?.episodes_number)) ? Number(show.episodes_number) : null,
            seasons: seasons.map(season => ({
                id: Number.isFinite(Number(season?.id)) ? Number(season.id) : null,
                season_number: Number.isFinite(Number(season?.number)) ? Number(season.number) : 0,
                name: season?.title || null,
                overview: season?.overview || null,
                poster_path: this._normalizeTicketboothImagePath(season?.poster_path),
                episode_count: Number.isFinite(Number(season?.episodes_number)) ? Number(season.episodes_number) : null,
            })),
        });

        await upsertTvSeasons(showId, seasons.map(season => ({
            id: Number.isFinite(Number(season?.id)) ? Number(season.id) : null,
            season_number: Number.isFinite(Number(season?.number)) ? Number(season.number) : 0,
            name: season?.title || null,
            overview: season?.overview || null,
            poster_path: this._normalizeTicketboothImagePath(season?.poster_path),
            episode_count: Number.isFinite(Number(season?.episodes_number)) ? Number(season.episodes_number) : null,
        })));

        for (const season of seasons) {
            const seasonNumber = Number(season?.number);
            if (!Number.isFinite(seasonNumber)) {
                continue;
            }

            const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
            await upsertSeasonEpisodes(showId, seasonNumber, episodes.map(episode => ({
                id: Number.isFinite(Number(episode?.id)) ? Number(episode.id) : null,
                episode_number: Number.isFinite(Number(episode?.number)) ? Number(episode.number) : 0,
                name: episode?.title || null,
                overview: episode?.overview || null,
                runtime: Number.isFinite(Number(episode?.runtime)) ? Number(episode.runtime) : null,
                season_number: seasonNumber,
                still_path: this._normalizeTicketboothImagePath(episode?.still_path),
            })));
        }

        const watchedEpisodes = await this._getImportedWatchedEpisodes(showId, seasons);
        for (const episodeId of watchedEpisodes) {
            if (playImportMode === TICKETBOOTH_PLAY_MODE_SKIP_EXISTING) {
                const alreadyHasEpisodePlay = await hasTvEpisodePlay(showId, episodeId);
                if (alreadyHasEpisodePlay) {
                    continue;
                }
            }
            await addTvEpisodePlay(showId, episodeId, null);
        }

        await addTvShowToWatchlist(showId);
    }

    async _getImportedWatchedEpisodes(showId, seasons) {
        const watchedEpisodeIds = [];

        for (const season of seasons) {
            const seasonNumber = Number(season?.number);
            if (!Number.isFinite(seasonNumber)) {
                continue;
            }
            const episodes = Array.isArray(season?.episodes) ? season.episodes : [];
            for (const episode of episodes) {
                if (Number(episode?.watched) !== 1) {
                    continue;
                }
                const episodeNumber = Number(episode?.number);
                if (!Number.isFinite(episodeNumber)) {
                    continue;
                }
                const episodeRow = await getTvEpisodeByShowSeasonEpisode(showId, seasonNumber, episodeNumber);
                if (episodeRow?.id) {
                    watchedEpisodeIds.push(Number(episodeRow.id));
                }
            }
        }

        return watchedEpisodeIds;
    }

    _toTmdbGenres(rawGenres) {
        if (!rawGenres) {
            return [];
        }

        const genreNames = String(rawGenres)
            .split(',')
            .map(genre => genre.trim())
            .filter(genre => genre.length > 0);

        return genreNames.map(name => ({ name }));
    }

    _normalizeTicketboothImagePath(rawPath) {
        const value = String(rawPath || '').trim();
        if (!value) {
            return null;
        }

        const filename = value.split('/').pop() || '';
        if (!filename || !filename.includes('.')) {
            return null;
        }

        return filename.startsWith('/') ? filename : `/${filename}`;
    }

    _serializeSettings() {
        const schema = this._settings.settings_schema;
        const keys = schema.list_keys();
        const values = {};

        for (const key of keys) {
            const value = this._settings.get_value(key);
            values[key] = {
                type: value.get_type_string(),
                value: value.deepUnpack(),
            };
        }

        return {
            schema: SETTINGS_SCHEMA_ID,
            values,
        };
    }

    _restoreSettings(payload) {
        const state = this._buildImportSettingsState(payload);
        this._applyImportSettingsState(state);
    }

    _buildImportSettingsState(payload) {
        const values = payload?.values;
        if (!values || typeof values !== 'object') {
            throw new Error('Invalid settings payload in backup.');
        }

        const knownKeys = new Set(this._settings.settings_schema.list_keys());
        const state = [];

        for (const [key, entry] of Object.entries(values)) {
            if (!knownKeys.has(key)) {
                continue;
            }

            const variantType = entry?.type;
            const rawValue = entry?.value;
            if (!variantType) {
                continue;
            }

            try {
                const variant = new GLib.Variant(variantType, rawValue);
                state.push([key, variant]);
            } catch (error) {
                throw new Error(`Invalid value for setting '${key}': ${error.message}`);
            }
        }

        return state;
    }

    _applyImportSettingsState(state) {
        for (const [key, variant] of state) {
            this._settings.set_value(key, variant);
        }
    }

    _getDatabasePath() {
        const dataDir = GLib.get_user_data_dir();
        if (!GLib.file_test(dataDir, GLib.FileTest.IS_DIR)) {
            const mkdirResult = GLib.mkdir_with_parents(dataDir, 0o755);
            if (mkdirResult !== 0) {
                throw new Error(`Failed to create data directory: ${dataDir}`);
            }
        }
        return GLib.build_filenamev([dataDir, DATABASE_FILENAME]);
    }

    _copyFile(sourcePath, destinationPath) {
        const source = Gio.File.new_for_path(sourcePath);
        const destination = Gio.File.new_for_path(destinationPath);
        source.copy(destination, Gio.FileCopyFlags.OVERWRITE, null, null);
    }

    _createTempDir(template) {
        try {
            return GLib.dir_make_tmp(template);
        } catch (error) {
            throw new Error(`Failed to create temporary directory: ${error.message}`);
        }
    }

    _runSubprocess(argv) {
        let process;
        try {
            process = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (error) {
            throw new Error(`Failed to start command '${argv[0]}': ${error.message}`);
        }

        let stderr = '';
        try {
            const [, , processStderr] = process.communicate_utf8(null, null);
            stderr = processStderr ?? '';
        } catch (error) {
            throw new Error(`Failed to run command '${argv[0]}': ${error.message}`);
        }

        if (!process.get_successful()) {
            const message = stderr.trim() || `${argv[0]} command failed.`;
            throw new Error(message);
        }
    }

    _validateBackupArchiveEntries(backupPath) {
        const output = this._runSubprocessAndCaptureStdout([
            'unzip',
            '-Z1',
            backupPath,
        ]);

        const entries = output
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);

        for (const entry of entries) {
            if (
                entry !== DATABASE_FILENAME &&
                entry !== SETTINGS_FILENAME
            ) {
                throw new Error('Backup archive contains unsupported files.');
            }
        }
    }

    _runSubprocessAndCaptureStdout(argv) {
        let process;
        try {
            process = Gio.Subprocess.new(
                argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
        } catch (error) {
            throw new Error(`Failed to start command '${argv[0]}': ${error.message}`);
        }

        let stdout = '';
        let stderr = '';
        try {
            const [, processStdout, processStderr] = process.communicate_utf8(null, null);
            stdout = processStdout ?? '';
            stderr = processStderr ?? '';
        } catch (error) {
            throw new Error(`Failed to run command '${argv[0]}': ${error.message}`);
        }

        if (!process.get_successful()) {
            const message = stderr.trim() || `${argv[0]} command failed.`;
            throw new Error(message);
        }

        return stdout;
    }

    _removePathRecursive(path) {
        const file = Gio.File.new_for_path(path);
        try {
            file.delete(null);
        } catch {
            const enumerator = file.enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                null
            );

            let info = enumerator.next_file(null);
            while (info) {
                const child = file.get_child(info.get_name());
                this._removePathRecursive(child.get_path());
                info = enumerator.next_file(null);
            }
            enumerator.close(null);
            file.delete(null);
        }
    }

    _checkBackupExtension(path) {
        if (!path) {
            return null;
        }
        if (path.endsWith(BACKUP_EXTENSION)) {
            return path;
        }
        return `${path}${BACKUP_EXTENSION}`;
    }

    _setRefreshUiState(isRunning) {
        this._refresh_progress_row.set_visible(isRunning);
        this._refresh_all_button.set_sensitive(!isRunning);

        if (!isRunning) {
            this._refresh_progress_bar.set_fraction(0);
            this._refresh_progress_bar.set_text('');
        }
    }

    _setRefreshImdbUiState(isRunning) {
        this._refresh_imdb_progress_row.set_visible(isRunning);
        this._refresh_imdb_ratings_button.set_sensitive(!isRunning);

        if (!isRunning) {
            this._refresh_imdb_progress_bar.set_fraction(0);
            this._refresh_imdb_progress_bar.set_text('');
        }
    }

    async _refreshAllTitles() {
        if (this._refreshInProgress) {
            return;
        }

        this._refreshInProgress = true;
        this._setRefreshUiState(true);
        this._refresh_progress_bar.set_text(_('Starting...'));

        let titleRefs = [];
        try {
            titleRefs = await getAllTitlesForRefresh();
        } catch (error) {
            this._setRefreshUiState(false);
            this._refreshInProgress = false;
            this._showToast(_('Failed to load titles list'), 3);
            return;
        }

        if (titleRefs.length === 0) {
            this._setRefreshUiState(false);
            this._refreshInProgress = false;
            this._showToast(_('No titles to refresh'), 2);
            return;
        }

        let completed = 0;
        let failed = 0;

        for (const titleRef of titleRefs) {
            try {
                const tmdbId = Number(titleRef.tmdb_id);
                const mediaType = titleRef.media_type === 'tv' ? 'tv' : 'movie';
                const details = await getTitleDetails(tmdbId, mediaType);
                const credits = await getTitleCredits(tmdbId, mediaType);
                const titleId = mediaType === 'tv'
                    ? await upsertTvShowFromTmdb(details)
                    : await upsertMovieFromTmdb(details);
                if (mediaType === 'tv') {
                    await this._refreshTvSeasonsAndEpisodes(titleId, tmdbId, details);
                }
                await this._saveCredits(titleId, credits, mediaType);
            } catch (error) {
                failed += 1;
                console.error('Failed to refresh title:', error);
            }

            completed += 1;
            const fraction = completed / titleRefs.length;
            this._refresh_progress_bar.set_fraction(fraction);
            this._refresh_progress_bar.set_text(`${completed}/${titleRefs.length}`);
            await this._yieldToUi();
        }

        this._setRefreshUiState(false);
        this._refreshInProgress = false;

        if (failed > 0) {
            this._showToast(_('Refreshed %d/%d titles (%d failed)').format(
                completed - failed,
                titleRefs.length,
                failed
            ), 4);
        } else {
            this._showToast(_('Refreshed %d titles').format(completed), 3);
        }
    }

    async _refreshAllImdbRatings() {
        if (this._refreshImdbInProgress) {
            return;
        }

        this._refreshImdbInProgress = true;
        this._setRefreshImdbUiState(true);
        this._refresh_imdb_progress_bar.set_text(_('Starting...'));

        let titles = [];
        try {
            titles = await getAllTitlesWithImdbIds();
        } catch (error) {
            this._setRefreshImdbUiState(false);
            this._refreshImdbInProgress = false;
            this._showToast(_('Failed to load titles list'), 3);
            return;
        }

        if (titles.length === 0) {
            this._setRefreshImdbUiState(false);
            this._refreshImdbInProgress = false;
            this._showToast(_('No titles with IMDb IDs to refresh'), 3);
            return;
        }

        let completed = 0;
        let failed = 0;

        for (const title of titles) {
            try {
                const imdbRating = await scrapeImdbRating(title.imdb_id);
                if (title.media_type === 'tv') {
                    await updateTvShowImdbRating(title.id, imdbRating?.value ?? null);
                } else {
                    await updateMovieImdbRating(title.id, imdbRating?.value ?? null);
                }
            } catch (error) {
                failed += 1;
                console.error('Failed to refresh IMDb rating for title:', error);
            }

            completed += 1;
            const fraction = completed / titles.length;
            this._refresh_imdb_progress_bar.set_fraction(fraction);
            this._refresh_imdb_progress_bar.set_text(`${completed}/${titles.length}`);
            await this._yieldToUi();
        }

        this._setRefreshImdbUiState(false);
        this._refreshImdbInProgress = false;

        if (failed > 0) {
            this._showToast(_('Refreshed %d/%d IMDb ratings (%d failed)').format(
                completed - failed,
                titles.length,
                failed
            ), 4);
        } else {
            this._showToast(_('Refreshed %d IMDb ratings').format(completed), 3);
        }
    }

    async _refreshTvSeasonsAndEpisodes(showId, tmdbId, showDetails) {
        const seasons = Array.isArray(showDetails?.seasons) ? showDetails.seasons : [];
        await upsertTvSeasons(showId, seasons);

        const seasonNumbers = seasons
            .map(season => Number(season?.season_number))
            .filter(seasonNumber => Number.isFinite(seasonNumber) && seasonNumber >= 0);

        for (const seasonNumber of seasonNumbers) {
            try {
                const seasonDetails = await getTvSeasonDetails(tmdbId, seasonNumber);
                const episodes = Array.isArray(seasonDetails?.episodes) ? seasonDetails.episodes : [];
                await upsertSeasonEpisodes(showId, seasonNumber, episodes);
            } catch {
                // Keep bulk refresh resilient when a season request fails.
            }
        }
    }

    async _saveCredits(titleId, creditsData, mediaType = 'movie') {
        if (!titleId || !creditsData) {
            return;
        }

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
                        episode_count: mediaType === 'tv' && Number.isFinite(Number(member.total_episode_count))
                            ? Number(member.total_episode_count)
                            : (mediaType === 'tv' && Number.isFinite(Number(member.episode_count))
                                ? Number(member.episode_count)
                                : null),
                        display_order: order++
                    });
                }
            };

            await addCrewCredits(['Director'], 'director');
            await addCrewCredits(['Producer'], 'producer');
            await addCrewCredits(['Director of Photography', 'Cinematography'], 'cinematographer');
            await addCrewCredits(['Original Music Composer', 'Music', 'Composer'], 'music_composer');
        }

        if (creditsData.cast) {
            for (const actor of creditsData.cast) {
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
                    episode_count: mediaType === 'tv' && Number.isFinite(Number(actor.total_episode_count))
                        ? Number(actor.total_episode_count)
                        : null,
                    display_order: order++
                });
            }
        }

        if (mediaType === 'tv') {
            await upsertTvCredits(titleId, credits);
            return;
        }
        await upsertMovieCredits(titleId, credits);
    }

    _yieldToUi() {
        return new Promise(resolve => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                resolve();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _showToast(message, timeout = 3) {
        const toast = new Adw.Toast({
            title: message,
            timeout,
        });

        let widget = this;
        while (widget && !(widget instanceof Adw.ToastOverlay)) {
            widget = widget.get_parent();
        }
        if (widget) {
            widget.add_toast(toast);
            return;
        }

        this._showInfoDialog(message);
    }

    _showInfoDialog(message) {
        const dialog = new Adw.AlertDialog({
            heading: _('Notice'),
            body: message,
            close_response: 'ok',
        });
        dialog.add_response('ok', _('OK'));
        dialog.present(this.get_root());
    }

    _showRestartPromptAfterImport() {
        const dialog = new Adw.AlertDialog({
            heading: _('Backup imported'),
            body: _('Import completed successfully. Restart the app now to reload the imported data.'),
            close_response: 'later',
        });

        dialog.add_response('later', _('Later'));
        dialog.add_response('restart', _('Restart now'));
        dialog.set_response_appearance('restart', Adw.ResponseAppearance.SUGGESTED);

        dialog.choose(this.get_root(), null, (_dialog, result) => {
            try {
                const response = dialog.choose_finish(result);
                if (response === 'restart') {
                    const root = this.get_root();
                    const app = root?.get_application?.();
                    if (app) {
                        app.quit();
                    }
                }
            } catch (error) {
                console.error('Failed to handle restart prompt:', error);
            }
        });
    }
});
