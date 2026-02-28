import Gtk from 'gi://Gtk';

import { loadTextureFromUrl } from '../utils/image-utils.js';
import { enforceFixedPictureSize, enforceFixedWidgetSize } from '../utils/ui-utils.js';
import { buildPosterUrl } from '../services/tmdb-service.js';

export const STANDARD_CARD_WIDTH = 160;
export const STANDARD_CARD_HEIGHT = 240;
export const STANDARD_CARD_TITLE_MAX_CHARS = 18;

export function createMovieCard(movie, options = {}) {
    const width = options.width ?? STANDARD_CARD_WIDTH;
    const height = options.height ?? STANDARD_CARD_HEIGHT;
    const titleMaxChars = options.titleMaxChars ?? STANDARD_CARD_TITLE_MAX_CHARS;
    const marginStart = options.marginStart ?? 8;
    const marginEnd = options.marginEnd ?? 8;
    const marginBottom = options.marginBottom ?? 12;
    const showYear = options.showYear !== false;
    const jobText = options.jobText ?? '';
    const onActivate = options.onActivate;

    const button = new Gtk.Button({
        css_classes: ['flat', 'movie-card-button'],
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.START,
        hexpand: false,
        vexpand: false,
    });

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
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.START,
        hexpand: false,
        vexpand: false,
    });
    enforceFixedWidgetSize(posterFrame, width, height);

    const posterImage = new Gtk.Picture({
        content_fit: Gtk.ContentFit.COVER,
        width_request: width,
        height_request: height,
        hexpand: false,
        vexpand: false,
        css_classes: ['movie-poster'],
    });
    enforceFixedPictureSize(posterImage, width, height);

    const fallbackPosterBox = new Gtk.CenterBox({
        css_classes: ['search-result-poster-fallback'],
    });
    enforceFixedWidgetSize(fallbackPosterBox, width, height);
    const fallbackPosterIcon = new Gtk.Image({
        icon_name: 'camera-video-symbolic',
        pixel_size: 34,
    });
    fallbackPosterBox.set_center_widget(fallbackPosterIcon);

    const posterStack = new Gtk.Stack({
        transition_type: Gtk.StackTransitionType.CROSSFADE,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.START,
        hexpand: false,
        vexpand: false,
    });
    enforceFixedWidgetSize(posterStack, width, height);
    posterStack.add_named(fallbackPosterBox, 'fallback');
    posterStack.add_named(posterImage, 'poster');
    posterStack.set_visible_child_name('fallback');

    const posterPath = options.posterPath ?? movie.poster_path ?? movie.poster ?? null;
    const posterUrl = buildPosterUrl(posterPath);
    loadTextureFromUrl(posterUrl, posterPath, width, height).then(texture => {
        if (texture) {
            posterImage.set_paintable(texture);
            posterStack.set_visible_child_name('poster');
        }
    }).catch(() => {});

    posterFrame.set_child(posterStack);
    card.append(posterFrame);

    const infoBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_start: marginStart,
        margin_end: marginEnd,
        margin_bottom: marginBottom,
    });

    const titleLabel = new Gtk.Label({
        label: movie.title || _('Unknown'),
        css_classes: ['heading'],
        xalign: 0,
        ellipsize: 3,
        lines: 2,
        wrap: true,
        width_chars: titleMaxChars,
        max_width_chars: titleMaxChars,
    });
    infoBox.append(titleLabel);

    if (jobText) {
        const jobLabel = new Gtk.Label({
            label: jobText,
            css_classes: ['caption', 'dim-label'],
            xalign: 0,
            ellipsize: 3,
            lines: 1,
        });
        infoBox.append(jobLabel);
    }

    const year = movie.release_date ? movie.release_date.substring(0, 4) : '';
    if (showYear && year) {
        const yearLabel = new Gtk.Label({
            label: year,
            css_classes: ['dim-label', 'caption'],
            xalign: 0,
        });
        infoBox.append(yearLabel);
    }

    card.append(infoBox);
    button.set_child(card);

    if (typeof onActivate === 'function') {
        button.connect('clicked', () => {
            onActivate(movie.tmdb_id ?? movie.id);
        });
    }

    return button;
}
