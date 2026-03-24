import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { getPeopleAppearanceStats } from '../utils/database-utils.js';
import { clearGrid } from '../utils/ui-utils.js';
import { createPersonStatCard } from '../widgets/person-stat-card.js';

export const MementoTopPeoplePage = GObject.registerClass({
    GTypeName: 'MementoTopPeoplePage',
    Template: 'resource:///app/memento/memento/pages/top-people-page.ui',
    InternalChildren: [
        'people_search_entry',
        'people_role_dropdown',
        'people_sort_dropdown',
        'people_stack',
        'people_grid',
        'people_pagination_box',
        'people_prev_button',
        'people_page_label',
        'people_next_button',
    ],
    Signals: {
        'view-person': { param_types: [GObject.TYPE_STRING] },
    },
}, class MementoTopPeoplePage extends Gtk.Box {
    constructor(params = {}) {
        super(params);
        const settingsSchemaId = (GLib.getenv('FLATPAK_ID') || '').endsWith('.Devel')
            ? 'io.github.ans_ibrahim.Memento.Devel'
            : 'io.github.ans_ibrahim.Memento';
        this._settings = new Gio.Settings({ schema_id: settingsSchemaId });
        this._settings.connect('changed::dashboard-people-metric', () => {
            const defaultMetric = this._settings.get_string('dashboard-people-metric');
            this._people_sort_dropdown.set_selected(defaultMetric === 'unique' ? 2 : 0);
            this._applyFilters();
        });
        this._settings.connect('changed::dashboard-people-tv-episode-level', () => {
            this._applyFilters();
        });
        this._roleValues = ['director', 'actor', 'producer', 'cinematographer', 'music_composer'];
        this._allPeople = [];
        this._filteredPeople = [];
        this._currentPage = 0;
        this._itemsPerPage = 28;
        const defaultMetric = this._settings.get_string('dashboard-people-metric');
        this._people_sort_dropdown.set_selected(defaultMetric === 'unique' ? 2 : 0);
        this._setupActions();
    }

    async reload() {
        try {
            this._allPeople = await getPeopleAppearanceStats();
            this._applyFilters();
        } catch (error) {
            console.error('Failed to load people stats:', error);
            this._allPeople = [];
            this._applyFilters();
        }
    }

    showRole(roleType) {
        const selectedIndex = this._roleValues.indexOf(roleType);
        this._people_role_dropdown.set_selected(selectedIndex >= 0 ? selectedIndex : 0);
        this._applyFilters();
    }

    _setupActions() {
        this._people_search_entry.connect('search-changed', () => {
            this._applyFilters();
        });
        this._people_role_dropdown.connect('notify::selected', () => {
            this._applyFilters();
        });
        this._people_sort_dropdown.connect('notify::selected', () => {
            this._applyFilters();
        });
        this._people_prev_button.connect('clicked', () => {
            if (this._currentPage > 0) {
                this._currentPage -= 1;
                this._renderCurrentPage();
            }
        });
        this._people_next_button.connect('clicked', () => {
            const totalPages = Math.max(1, Math.ceil(this._filteredPeople.length / this._itemsPerPage));
            if (this._currentPage < totalPages - 1) {
                this._currentPage += 1;
                this._renderCurrentPage();
            }
        });
    }

    _applyFilters() {
        const query = this._people_search_entry.get_text().trim().toLowerCase();
        const selectedRole = this._roleValues[this._people_role_dropdown.get_selected()] || 'director';
        const sortIndex = this._people_sort_dropdown.get_selected();

        let people = this._allPeople.filter(person => person.role_type === selectedRole);

        if (query) {
            people = people.filter(person => {
                const name = (person.name || '').toLowerCase();
                return name.includes(query);
            });
        }

        const tvGranularity = this._getTvGranularity();
        const getCurrentTotal = person => {
            const moviePlays = Number(person.movie_total_plays) || 0;
            const tvEpisodes = Number(person.tv_episode_plays) || 0;
            const tvShows = Number(person.tv_unique_shows) || 0;
            return moviePlays + (tvGranularity === 'episode' ? tvEpisodes : tvShows);
        };
        const getCurrentUnique = person => {
            const movieUnique = Number(person.movie_unique_titles) || 0;
            const tvUniqueEpisodes = Number(person.tv_unique_episodes) || 0;
            const tvUniqueShows = Number(person.tv_unique_shows) || 0;
            return movieUnique + (tvGranularity === 'episode' ? tvUniqueEpisodes : tvUniqueShows);
        };

        people.sort((firstPerson, secondPerson) => {
            const firstName = firstPerson.name || '';
            const secondName = secondPerson.name || '';
            const firstDynamicTotal = getCurrentTotal(firstPerson);
            const secondDynamicTotal = getCurrentTotal(secondPerson);
            const firstDynamicUnique = getCurrentUnique(firstPerson);
            const secondDynamicUnique = getCurrentUnique(secondPerson);

            if (sortIndex === 1) {
                return firstDynamicTotal - secondDynamicTotal || firstName.localeCompare(secondName);
            }
            if (sortIndex === 2) {
                return secondDynamicUnique - firstDynamicUnique || secondDynamicTotal - firstDynamicTotal || firstName.localeCompare(secondName);
            }
            if (sortIndex === 3) {
                return firstDynamicUnique - secondDynamicUnique || firstName.localeCompare(secondName);
            }
            if (sortIndex === 4) {
                return firstName.localeCompare(secondName);
            }

            return secondDynamicTotal - firstDynamicTotal || secondDynamicUnique - firstDynamicUnique || firstName.localeCompare(secondName);
        });

        this._filteredPeople = people;
        this._currentPage = 0;
        this._renderCurrentPage();
    }

    _renderCurrentPage() {
        const people = this._filteredPeople;
        clearGrid(this._people_grid);

        if (people.length === 0) {
            this._people_stack.set_visible_child_name('empty');
            this._people_pagination_box.set_visible(false);
            return;
        }

        const totalPages = Math.max(1, Math.ceil(people.length / this._itemsPerPage));
        if (this._currentPage > totalPages - 1) {
            this._currentPage = totalPages - 1;
        }

        const startIndex = this._currentPage * this._itemsPerPage;
        const pageItems = people.slice(startIndex, startIndex + this._itemsPerPage);
        const sortIndex = Number(this._people_sort_dropdown.get_selected());
        const uniqueMode = sortIndex === 2 || sortIndex === 3;
        const tvGranularity = this._getTvGranularity();

        for (const person of pageItems) {
            const movieTotalPlays = Number(person.movie_total_plays) || 0;
            const movieUniqueTitles = Number(person.movie_unique_titles) || 0;
            const tvEpisodePlays = Number(person.tv_episode_plays) || 0;
            const tvUniqueEpisodes = Number(person.tv_unique_episodes) || 0;
            const tvUniqueShows = Number(person.tv_unique_shows) || 0;
            const statChips = [];
            if (uniqueMode) {
                if (movieUniqueTitles > 0) {
                    statChips.push(_('%d movies').format(movieUniqueTitles));
                }
                if (tvGranularity === 'episode') {
                    if (tvUniqueEpisodes > 0 || tvUniqueShows > 0) {
                        statChips.push(_('%d unique episodes • %d TV shows').format(tvUniqueEpisodes, tvUniqueShows));
                    }
                } else if (tvUniqueShows > 0) {
                    statChips.push(_('%d TV shows').format(tvUniqueShows));
                }
            } else {
                if (movieTotalPlays > 0) {
                    statChips.push(_('%d movie plays').format(movieTotalPlays));
                }
                if (tvGranularity === 'episode') {
                    if (tvEpisodePlays > 0 || tvUniqueShows > 0) {
                        statChips.push(_('%d episode plays • %d TV shows').format(tvEpisodePlays, tvUniqueShows));
                    }
                } else if (tvUniqueShows > 0) {
                    statChips.push(_('%d TV shows').format(tvUniqueShows));
                }
            }
            const cardData = {
                ...person,
                play_count: uniqueMode
                    ? (movieUniqueTitles + (tvGranularity === 'episode' ? tvUniqueEpisodes : tvUniqueShows))
                    : (movieTotalPlays + (tvGranularity === 'episode' ? tvEpisodePlays : tvUniqueShows)),
                unique_movies: movieUniqueTitles + (tvGranularity === 'episode' ? tvUniqueEpisodes : tvUniqueShows),
            };
            const card = createPersonStatCard(cardData, {
                statChips,
                onActivate: personId => this.emit('view-person', personId),
            });
            this._people_grid.append(card);
        }

        this._people_stack.set_visible_child_name('list');
        this._people_pagination_box.set_visible(totalPages > 1);
        this._people_prev_button.set_sensitive(this._currentPage > 0);
        this._people_next_button.set_sensitive(this._currentPage < totalPages - 1);
        const pageLabel = _('Page %d of %d').format(this._currentPage + 1, totalPages);
        this._people_page_label.set_text(pageLabel);
    }

    _getTvGranularity() {
        const isEpisodeLevel = this._settings.get_boolean('dashboard-people-tv-episode-level');
        return isEpisodeLevel ? 'episode' : 'show';
    }
});
