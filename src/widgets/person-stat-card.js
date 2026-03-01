import Gtk from 'gi://Gtk';

import { loadTextureFromUrlWithFallback } from '../utils/image-utils.js';
import { buildProfileUrl } from '../services/tmdb-service.js';
import { enforceFixedPictureSize, enforceFixedWidgetSize } from '../utils/ui-utils.js';
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
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.START,
        hexpand: false,
        vexpand: false,
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
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.START,
        hexpand: false,
        vexpand: false,
    });
    enforceFixedWidgetSize(pictureFrame, width, height);

    const picture = new Gtk.Picture({
        css_classes: ['movie-poster'],
        content_fit: Gtk.ContentFit.COVER,
    });
    enforceFixedPictureSize(picture, width, height);

    pictureFrame.set_child(picture);
    box.append(pictureFrame);

    const profileUrl = buildProfileUrl(person.profile_path);
    loadTextureFromUrlWithFallback(
        profileUrl,
        person.profile_path,
        'avatar-default-symbolic',
        width,
        height
    ).then(texture => {
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
        label: person.name || person.person_name || _('Unknown'),
        wrap: true,
        wrap_mode: 2,
        width_chars: titleMaxChars,
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
            width_chars: titleMaxChars,
            max_width_chars: titleMaxChars,
        });
        infoBox.append(subtitleLabel);
    }

    if (showCount) {
        const countLabel = new Gtk.Label({
            label: _('%d plays').format(person.play_count || 0),
            css_classes: ['caption', 'dim-label'],
            xalign: 0,
        });
        const uniqueMovies = Number(person.unique_movies) || 0;
        if (uniqueMovies > 0) {
            countLabel.set_label(_('%d plays • %d unique').format(person.play_count || 0, uniqueMovies));
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
