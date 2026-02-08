import Gtk from 'gi://Gtk';

export function createStatCard(label, value) {
    const frame = new Gtk.Frame({
        css_classes: ['stats-card'],
    });

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_start: 12,
        margin_end: 12,
        margin_top: 12,
        margin_bottom: 12,
    });

    const valueLabel = new Gtk.Label({
        label: value,
        css_classes: ['title-2'],
        xalign: 0,
    });
    box.append(valueLabel);

    const labelLabel = new Gtk.Label({
        label,
        css_classes: ['caption', 'dim-label'],
        xalign: 0,
    });
    box.append(labelLabel);

    frame.set_child(box);
    return frame;
}
