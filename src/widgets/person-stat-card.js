import Gtk from 'gi://Gtk';

import { loadTextureFromUrlWithFallback } from '../utils/image-utils.js';
import { buildProfileUrl } from '../services/tmdb-service.js';
import {
    STANDARD_CARD_WIDTH,
    STANDARD_CARD_HEIGHT,
    STANDARD_CARD_TITLE_MAX_CHARS,
} from './movie-card.js';

export function createPersonStatCard(person, options = {}) {
    const onActivate = options.onActivate;
    const width = options.width ?? STANDARD_CARD_WIDTH;
    const height = options.height ?? STANDARD_CARD_HEIGHT;
    const titleMaxChars = options.titleMaxChars ?? STANDARD_CARD_TITLE_MAX_CHARS;
    const subtitleText = options.subtitleText ?? '';
    const showCount = options.showCount !== false;
    const marginStart = options.marginStart ?? 8;
    const marginEnd = options.marginEnd ?? 8;
    const marginBottom = options.marginBottom ?? 12;

    const button = new Gtk.Button({
        css_classes: ['flat', 'person-card', 'movie-card-button'],
    });

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        halign: Gtk.Align.CENTER,
        width_request: width,
        css_classes: ['movie-card'],
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

    const infoBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_start: marginStart,
        margin_end: marginEnd,
        margin_bottom: marginBottom,
    });
    box.append(infoBox);

    const nameLabel = new Gtk.Label({
        label: person.name || person.person_name || 'Unknown',
        wrap: true,
        wrap_mode: 2,
        max_width_chars: titleMaxChars,
        justify: Gtk.Justification.LEFT,
        xalign: 0,
        css_classes: ['heading'],
    });
    infoBox.append(nameLabel);

    if (subtitleText) {
        const subtitleLabel = new Gtk.Label({
            label: subtitleText,
            css_classes: ['caption', 'dim-label'],
            xalign: 0,
            ellipsize: 3,
            lines: 1,
        });
        infoBox.append(subtitleLabel);
    }

    if (showCount) {
        const countLabel = new Gtk.Label({
            label: `${person.play_count || 0} plays`,
            css_classes: ['caption', 'dim-label'],
            xalign: 0,
        });
        const uniqueMovies = Number(person.unique_movies) || 0;
        if (uniqueMovies > 0) {
            countLabel.set_label(`${person.play_count || 0} plays • ${uniqueMovies} unique`);
        }
        infoBox.append(countLabel);
    }

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
