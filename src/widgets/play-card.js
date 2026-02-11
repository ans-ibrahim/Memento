import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import { loadTextureFromUrl } from '../utils/image-utils.js';
import { buildPosterUrl } from '../services/tmdb-service.js';
import { formatDate } from '../utils/ui-utils.js';
import {
    STANDARD_CARD_WIDTH,
    STANDARD_CARD_HEIGHT,
    STANDARD_CARD_TITLE_MAX_CHARS,
} from './movie-card.js';

export function createPlayCard(play, options = {}) {
    const width = options.width ?? STANDARD_CARD_WIDTH;
    const height = options.height ?? STANDARD_CARD_HEIGHT;
    const titleMaxChars = options.titleMaxChars ?? STANDARD_CARD_TITLE_MAX_CHARS;
    const marginStart = options.marginStart ?? 8;
    const marginEnd = options.marginEnd ?? 8;
    const marginBottom = options.marginBottom ?? 12;
    const onActivate = options.onActivate;
    const onDelete = options.onDelete;
    const dialogParent = options.dialogParent ?? null;

    const card = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        width_request: width,
        hexpand: false,
        vexpand: false,
        halign: Gtk.Align.CENTER,
        css_classes: ['movie-card'],
    });

    const posterFrame = new Gtk.Frame({
        css_classes: ['movie-poster-frame'],
    });

    const posterButton = new Gtk.Button({
        css_classes: ['flat', 'movie-card-button'],
    });

    const posterImage = new Gtk.Picture({
        content_fit: Gtk.ContentFit.COVER,
        width_request: width,
        height_request: height,
        hexpand: false,
        vexpand: false,
        css_classes: ['movie-poster'],
    });

    const fallbackPosterBox = new Gtk.CenterBox({
        width_request: width,
        height_request: height,
        css_classes: ['search-result-poster-fallback'],
    });
    const fallbackPosterIcon = new Gtk.Image({
        icon_name: 'camera-video-symbolic',
        pixel_size: 34,
    });
    fallbackPosterBox.set_center_widget(fallbackPosterIcon);

    const posterStack = new Gtk.Stack({
        transition_type: Gtk.StackTransitionType.CROSSFADE,
        width_request: width,
        height_request: height,
    });
    posterStack.add_named(fallbackPosterBox, 'fallback');
    posterStack.add_named(posterImage, 'poster');
    posterStack.set_visible_child_name('fallback');

    const posterPath = play.poster ?? null;
    const posterUrl = buildPosterUrl(posterPath);
    loadTextureFromUrl(posterUrl, posterPath).then(texture => {
        if (texture) {
            posterImage.set_paintable(texture);
            posterStack.set_visible_child_name('poster');
        }
    }).catch(() => {});

    posterButton.set_child(posterStack);
    if (typeof onActivate === 'function') {
        posterButton.connect('clicked', () => {
            onActivate(play.tmdb_id);
        });
    }

    posterFrame.set_child(posterButton);
    card.append(posterFrame);

    const infoBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_start: marginStart,
        margin_end: marginEnd,
        margin_bottom: marginBottom,
    });

    const titleLabel = new Gtk.Label({
        label: play.title || 'Unknown',
        css_classes: ['heading'],
        xalign: 0,
        ellipsize: 3,
        lines: 2,
        wrap: true,
        max_width_chars: titleMaxChars,
    });
    infoBox.append(titleLabel);

    const dateLabel = new Gtk.Label({
        label: formatDate(play.watched_at),
        css_classes: ['dim-label', 'caption'],
        xalign: 0,
    });
    infoBox.append(dateLabel);

    if (!options.compact && typeof onDelete === 'function') {
        const actionsBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 6,
            halign: Gtk.Align.START,
        });

        const deleteButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: 'Delete Play',
            css_classes: ['flat', 'destructive-action'],
        });

        deleteButton.connect('clicked', () => {
            const dialog = new Adw.AlertDialog({
                heading: 'Delete Play?',
                body: `Are you sure you want to delete this play of "${play.title}" from ${formatDate(play.watched_at)}?`,
            });

            dialog.add_response('cancel', 'Cancel');
            dialog.add_response('delete', 'Delete');
            dialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);

            dialog.connect('response', async (dlg, response) => {
                if (response === 'delete') {
                    try {
                        await onDelete(play);
                    } catch (error) {
                        console.error('Failed to delete play:', error);
                    }
                }
            });

            if (dialogParent) {
                dialog.present(dialogParent);
            } else {
                dialog.present(card.get_root());
            }
        });

        actionsBox.append(deleteButton);
        infoBox.append(actionsBox);
    }

    card.append(infoBox);
    return card;
}
