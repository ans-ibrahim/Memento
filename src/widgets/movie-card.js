import Gtk from 'gi://Gtk';

import { loadTextureFromUrl } from '../utils/image-utils.js';
import { buildPosterUrl } from '../services/tmdb-service.js';

export function createMovieCard(movie, options = {}) {
    const compact = Boolean(options.compact);
    const width = options.width ?? (compact ? 140 : 160);
    const height = options.height ?? (compact ? 210 : 240);
    const titleMaxChars = options.titleMaxChars ?? (compact ? 16 : 18);
    const marginStart = options.marginStart ?? 8;
    const marginEnd = options.marginEnd ?? 8;
    const marginBottom = options.marginBottom ?? 12;
    const showRating = options.showRating !== false;
    const showYear = options.showYear !== false;
    const jobText = options.jobText ?? '';
    const onActivate = options.onActivate;

    const button = new Gtk.Button({
        css_classes: ['flat', 'movie-card-button'],
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
    });

    const posterImage = new Gtk.Picture({
        content_fit: Gtk.ContentFit.COVER,
        width_request: width,
        height_request: height,
        hexpand: false,
        vexpand: false,
        css_classes: ['movie-poster'],
    });

    const posterPath = options.posterPath ?? movie.poster_path ?? movie.poster ?? null;
    if (posterPath) {
        const posterUrl = buildPosterUrl(posterPath);
        loadTextureFromUrl(posterUrl, posterPath).then(texture => {
            if (texture) {
                posterImage.set_paintable(texture);
            }
        }).catch(() => {});
    }

    posterFrame.set_child(posterImage);
    card.append(posterFrame);

    const infoBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 4,
        margin_start: marginStart,
        margin_end: marginEnd,
        margin_bottom: marginBottom,
    });

    const titleLabel = new Gtk.Label({
        label: movie.title || 'Unknown',
        css_classes: ['heading'],
        xalign: 0,
        ellipsize: 3,
        lines: 2,
        wrap: true,
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

    if (showRating && movie.tmdb_average) {
        const ratingBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
        });

        const starIcon = new Gtk.Image({
            icon_name: 'starred-symbolic',
            css_classes: ['star-icon'],
        });
        ratingBox.append(starIcon);

        const ratingLabel = new Gtk.Label({
            label: movie.tmdb_average.toFixed(1),
            css_classes: ['caption'],
        });
        ratingBox.append(ratingLabel);

        infoBox.append(ratingBox);
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
