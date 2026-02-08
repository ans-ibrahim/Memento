import Gtk from 'gi://Gtk';

import { loadTextureFromUrlWithFallback } from '../utils/image-utils.js';
import { buildProfileUrl } from '../services/tmdb-service.js';

export function createPersonStatCard(person, options = {}) {
    const onActivate = options.onActivate;

    const button = new Gtk.Button({
        css_classes: ['flat', 'person-card'],
    });

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        halign: Gtk.Align.CENTER,
    });

    const pictureFrame = new Gtk.Frame({
        css_classes: ['profile-photo'],
    });

    const picture = new Gtk.Picture({
        width_request: 64,
        height_request: 64,
        css_classes: ['circular'],
        can_shrink: false,
    });

    pictureFrame.set_child(picture);
    box.append(pictureFrame);

    if (person.profile_path) {
        const profileUrl = buildProfileUrl(person.profile_path);
        loadTextureFromUrlWithFallback(profileUrl, person.profile_path).then(texture => {
            if (texture) {
                picture.set_paintable(texture);
            }
        }).catch(() => {});
    }

    const nameLabel = new Gtk.Label({
        label: person.name || 'Unknown',
        wrap: true,
        wrap_mode: 2,
        max_width_chars: 14,
        justify: Gtk.Justification.CENTER,
        css_classes: ['caption', 'dim-label'],
    });
    box.append(nameLabel);

    const countLabel = new Gtk.Label({
        label: `${person.play_count || 0} plays`,
        css_classes: ['caption'],
    });
    box.append(countLabel);

    button.set_child(box);

    if (typeof onActivate === 'function') {
        button.connect('clicked', () => {
            if (person.tmdb_person_id) {
                onActivate(String(person.tmdb_person_id));
            }
        });
    }

    return button;
}
