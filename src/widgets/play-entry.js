import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

export const MementoPlayEntry = GObject.registerClass({
    GTypeName: 'MementoPlayEntry',
    Template: 'resource:///app/memento/memento/widgets/play-entry.ui',
    InternalChildren: ['delete_button'],
    Signals: {
        'delete-requested': {},
    },
}, class MementoPlayEntry extends Gtk.Box {
    constructor(params = {}) {
        super(params);
        this._setupActions();
    }

    _setupActions() {
        this._delete_button.connect('clicked', () => {
            this.emit('delete-requested');
        });
    }
});
