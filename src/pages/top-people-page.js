import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

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
        this._roleValues = ['director', 'actor', 'producer', 'cinematographer', 'music_composer'];
        this._allPeople = [];
        this._filteredPeople = [];
        this._currentPage = 0;
        this._itemsPerPage = 28;
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

        people.sort((firstPerson, secondPerson) => {
            const firstTotal = Number(firstPerson.total_appearances) || 0;
            const secondTotal = Number(secondPerson.total_appearances) || 0;
            const firstUnique = Number(firstPerson.unique_movies) || 0;
            const secondUnique = Number(secondPerson.unique_movies) || 0;
            const firstName = firstPerson.name || '';
            const secondName = secondPerson.name || '';

            if (sortIndex === 1) {
                return firstTotal - secondTotal || firstName.localeCompare(secondName);
            }
            if (sortIndex === 2) {
                return secondUnique - firstUnique || secondTotal - firstTotal || firstName.localeCompare(secondName);
            }
            if (sortIndex === 3) {
                return firstUnique - secondUnique || firstName.localeCompare(secondName);
            }
            if (sortIndex === 4) {
                return firstName.localeCompare(secondName);
            }

            return secondTotal - firstTotal || secondUnique - firstUnique || firstName.localeCompare(secondName);
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

        for (const person of pageItems) {
            const cardData = {
                ...person,
                play_count: Number(person.total_appearances) || 0,
            };
            const card = createPersonStatCard(cardData, {
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
});
