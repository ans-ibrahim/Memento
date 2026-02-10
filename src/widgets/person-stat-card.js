import Gtk from 'gi://Gtk';

import { loadTextureFromUrlWithFallback } from '../utils/image-utils.js';
import { buildProfileUrl } from '../services/tmdb-service.js';

export function createPersonStatCard(person, options = {}) {
    const onActivate = options.onActivate;
    const width = options.width ?? 140;
    const height = options.height ?? 210;

    const button = new Gtk.Button({
        css_classes: ['flat', 'person-card'],
    });

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        halign: Gtk.Align.CENTER,
        width_request: width,
    });

    const pictureFrame = new Gtk.Frame({
        css_classes: ['movie-poster-frame'],
    });

    const picture = new Gtk.Picture({
        width_request: width,
        height_request: height,
        css_classes: ['movie-poster'],
        content_fit: Gtk.ContentFit.COVER,
        can_shrink: false,
    });

    pictureFrame.set_child(picture);
    box.append(pictureFrame);

    const profileUrl = buildProfileUrl(person.profile_path);
    loadTextureFromUrlWithFallback(profileUrl, person.profile_path, 'avatar-default-symbolic').then(texture => {
        if (texture) {
            picture.set_paintable(texture);
        }
    }).catch(() => {});

    const nameLabel = new Gtk.Label({
        label: person.name || 'Unknown',
        wrap: true,
        wrap_mode: 2,
        max_width_chars: 18,
        justify: Gtk.Justification.LEFT,
        xalign: 0,
        css_classes: ['heading'],
    });
    box.append(nameLabel);

    const countLabel = new Gtk.Label({
        label: `${person.play_count || 0} plays`,
        css_classes: ['caption', 'dim-label'],
        xalign: 0,
    });
    const uniqueMovies = Number(person.unique_movies) || 0;
    if (uniqueMovies > 0) {
        countLabel.set_label(`${person.play_count || 0} plays • ${uniqueMovies} unique`);
    }
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
