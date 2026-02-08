/* plays-page.js
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
import Adw from 'gi://Adw';

import { getAllPlays, deletePlay } from '../utils/database-utils.js';
import { clearGrid } from '../utils/ui-utils.js';
import { createPlayCard } from '../widgets/play-card.js';

export const MementoPlaysPage = GObject.registerClass({
    GTypeName: 'MementoPlaysPage',
    Template: 'resource:///app/memento/memento/pages/plays-page.ui',
    InternalChildren: ['plays_stack', 'plays_grid'],
    Signals: {
        'play-deleted': {},
        'view-movie': {param_types: [GObject.TYPE_INT]},
    },
}, class MementoPlaysPage extends Adw.NavigationPage {
    
    constructor(params = {}) {
        super(params);
        this._loadPlays();
    }

    async _loadPlays() {
        try {
            const plays = await getAllPlays();

            // Clear existing items
            clearGrid(this._plays_grid);

            if (plays.length === 0) {
                this._plays_stack.set_visible_child_name('empty');
                return;
            }

            // Add play cards
            for (const play of plays) {
                const card = createPlayCard(play, {
                    onActivate: tmdbId => this.emit('view-movie', tmdbId),
                    onDelete: async playToDelete => {
                        await deletePlay(playToDelete.id);
                        this.emit('play-deleted');
                        await this._loadPlays();
                    },
                    dialogParent: this.get_root(),
                });
                this._plays_grid.append(card);
            }

            this._plays_stack.set_visible_child_name('plays');
        } catch (error) {
            console.error('Failed to load plays:', error);
        }
    }

    reload() {
        this._loadPlays();
    }
});
