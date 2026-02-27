/* main.js
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
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';

import { MementoWindow } from './window.js';

pkg.initGettext();
pkg.initFormat();

const DEFAULT_APP_ID = 'io.github.ans_ibrahim.Memento';
const APP_ID = GLib.getenv('FLATPAK_ID') || DEFAULT_APP_ID;
const PROJECT_WEBSITE_URL = 'https://github.com/ans-ibrahim/Memento';
const PROJECT_ISSUES_URL = 'https://github.com/ans-ibrahim/Memento/issues';

export const MementoApplication = GObject.registerClass(
    class MementoApplication extends Adw.Application {
        constructor() {
            super({
                application_id: APP_ID,
                flags: Gio.ApplicationFlags.DEFAULT_FLAGS,
                resource_base_path: '/app/memento/memento'
            });

            const quit_action = new Gio.SimpleAction({name: 'quit'});
                quit_action.connect('activate', action => {
                this.quit();
            });
            this.add_action(quit_action);
            this.set_accels_for_action('app.quit', ['<control>q']);

            const show_about_action = new Gio.SimpleAction({name: 'about'});
            show_about_action.connect('activate', action => {
                const aboutParams = {
                    application_name: 'Memento',
                    application_icon: APP_ID,
                    developer_name: 'Ans Ibrahim',
                    version: pkg.version,
                    website: PROJECT_WEBSITE_URL,
                    issue_url: PROJECT_ISSUES_URL,
                    license_type: Gtk.License.GPL_3_0,
                    developers: [
                        'Ans Ibrahim'
                    ],
                    translator_credits: _("translator-credits"),
                    copyright: '© 2026 Ans Ibrahim'
                };
                const aboutDialog = new Adw.AboutDialog(aboutParams);
                aboutDialog.present(this.active_window);
            });
            this.add_action(show_about_action);
        }

        vfunc_startup() {
            super.vfunc_startup();

            // Load CSS stylesheet
            const cssProvider = new Gtk.CssProvider();
            cssProvider.load_from_resource('/app/memento/memento/style.css');
            Gtk.StyleContext.add_provider_for_display(
                Gdk.Display.get_default(),
                cssProvider,
                Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
            );
        }

        vfunc_activate() {
            let {active_window} = this;

            if (!active_window)
                active_window = new MementoWindow(this);

            active_window.present();
        }
    }
);

export function main(argv) {
    const application = new MementoApplication();
    return application.runAsync(argv);
}
