import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import { loadTextureFromUrl } from '../utils/image-utils.js';
import { buildPosterUrl } from '../services/tmdb-service.js';
import { formatDate } from '../utils/ui-utils.js';

export function createPlayCard(play, options = {}) {
    const compact = Boolean(options.compact);
    const width = options.width ?? (compact ? 140 : 160);
    const height = options.height ?? (compact ? 210 : 240);
    const titleMaxChars = options.titleMaxChars ?? (compact ? 16 : 18);
    const marginStart = options.marginStart ?? 8;
    const marginEnd = options.marginEnd ?? 8;
    const marginBottom = options.marginBottom ?? 8;
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
        css_classes: ['flat'],
    });

    const posterImage = new Gtk.Picture({
        content_fit: Gtk.ContentFit.COVER,
        width_request: width,
        height_request: height,
        hexpand: false,
        vexpand: false,
        css_classes: ['movie-poster'],
    });

    const posterPath = play.poster ?? null;
    if (posterPath) {
        const posterUrl = buildPosterUrl(posterPath);
        loadTextureFromUrl(posterUrl, posterPath).then(texture => {
            if (texture) {
                posterImage.set_paintable(texture);
            }
        }).catch(() => {});
    }

    posterButton.set_child(posterImage);
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

    if (!compact && typeof onDelete === 'function') {
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
