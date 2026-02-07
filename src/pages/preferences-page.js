import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

export const MementoPreferencesPage = GObject.registerClass({
    GTypeName: 'MementoPreferencesPage',
    Template: 'resource:///app/memento/memento/pages/preferences-page.ui',
    InternalChildren: ['api_key_row', 'auto_remove_switch'],
}, class MementoPreferencesPage extends Adw.NavigationPage {
    constructor(params = {}) {
        super(params);
        this._settings = new Gio.Settings({ schema_id: 'app.memento.memento' });
        this._setupBindings();
        this._loadApiKey();
    }

    _setupBindings() {
        // Bind auto-remove switch to settings
        this._settings.bind(
            'auto-remove-from-watchlist',
            this._auto_remove_switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
    }

    _loadApiKey() {
        // Load API key into entry (load on demand, don't bind for security)
        const apiKey = this._settings.get_string('tmdb-api-key');
        if (apiKey) {
            this._api_key_row.set_text(apiKey);
        }
    }

    _onApiKeyApply() {
        // Save API key when apply button is clicked
        const apiKey = this._api_key_row.get_text();
        this._settings.set_string('tmdb-api-key', apiKey);
        
        // Show toast notification
        const toast = new Adw.Toast({
            title: 'API key saved',
            timeout: 2,
        });
        
        // Find the toast overlay in the widget hierarchy
        let widget = this;
        while (widget && !(widget instanceof Adw.ToastOverlay)) {
            widget = widget.get_parent();
        }
        if (widget) {
            widget.add_toast(toast);
        }
    }

    _onGetApiKeyActivated() {
        // Open TMDG API documentation
        const launcher = new Gtk.UriLauncher({
            uri: 'https://www.themoviedb.org/settings/api',
        });
        launcher.launch(this.get_root(), null, null);
    }
});
