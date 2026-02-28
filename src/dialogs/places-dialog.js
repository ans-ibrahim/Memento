/* places-dialog.js
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
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import { getAllPlaces, addPlace, updatePlace, deletePlace } from '../utils/database-utils.js';

export const MementoPlacesDialog = GObject.registerClass({
    GTypeName: 'MementoPlacesDialog',
    Template: 'resource:///app/memento/memento/dialogs/places-dialog.ui',
    InternalChildren: ['places_list', 'add_button'],
}, class MementoPlacesDialog extends Adw.Dialog {
    
    constructor(params = {}) {
        super(params);
        this._loadPlaces();
        this._setupActions();
    }

    _setupActions() {
        this._add_button.connect('clicked', () => {
            this._showAddDialog();
        });
    }

    async _loadPlaces() {
        try {
            const places = await getAllPlaces();

            // Clear existing items
            let child = this._places_list.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                this._places_list.remove(child);
                child = next;
            }

            // Add place rows
            for (const place of places) {
                const row = this._createPlaceRow(place);
                this._places_list.append(row);
            }
        } catch (error) {
            console.error('Failed to load places:', error);
        }
    }

    _createPlaceRow(place) {
        const row = new Adw.ActionRow({
            title: place.name,
            subtitle: place.is_cinema ? _('🎬 Cinema') : _('🏠 Home'),
        });

        // Edit button
        const editButton = new Gtk.Button({
            icon_name: 'document-edit-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Edit'),
        });

        editButton.connect('clicked', () => {
            this._showEditDialog(place);
        });

        row.add_suffix(editButton);

        // Delete button
        const deleteButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'destructive-action'],
            tooltip_text: _('Delete'),
        });

        deleteButton.connect('clicked', async () => {
            await deletePlace(place.id);
            this._loadPlaces();
        });

        row.add_suffix(deleteButton);

        return row;
    }

    _showAddDialog() {
        const dialog = new Adw.AlertDialog({
            heading: _('Add Place'),
            body: _('Enter the place name'),
        });

        const entry = new Adw.EntryRow({
            title: _('Place Name'),
        });

        const checkButton = new Adw.SwitchRow({
            title: _('Is Cinema'),
        });

        const prefGroup = new Adw.PreferencesGroup();
        prefGroup.add(entry);
        prefGroup.add(checkButton);

        dialog.set_extra_child(prefGroup);
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('add', _('Add'));
        dialog.set_response_appearance('add', Adw.ResponseAppearance.SUGGESTED);

        dialog.connect('response', async (dlg, response) => {
            if (response === 'add') {
                const name = entry.get_text().trim();
                if (name) {
                    try {
                        await addPlace(name, checkButton.get_active());
                        this._loadPlaces();
                    } catch (error) {
                        console.error('Failed to add place:', error);
                    }
                }
            }
        });

        dialog.present(this);
    }

    _showEditDialog(place) {
        const dialog = new Adw.AlertDialog({
            heading: _('Edit Place'),
            body: _('Update the place details'),
        });

        const entry = new Adw.EntryRow({
            title: _('Place Name'),
            text: place.name,
        });

        const checkButton = new Adw.SwitchRow({
            title: _('Is Cinema'),
            active: place.is_cinema === 1,
        });

        const prefGroup = new Adw.PreferencesGroup();
        prefGroup.add(entry);
        prefGroup.add(checkButton);

        dialog.set_extra_child(prefGroup);
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('save', _('Save'));
        dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);

        dialog.connect('response', async (dlg, response) => {
            if (response === 'save') {
                const name = entry.get_text().trim();
                if (name) {
                    try {
                        await updatePlace(place.id, name, checkButton.get_active());
                        this._loadPlaces();
                    } catch (error) {
                        console.error('Failed to update place:', error);
                    }
                }
            }
        });

        dialog.present(this);
    }
});
