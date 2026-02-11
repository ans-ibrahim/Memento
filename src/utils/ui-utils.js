export function clearGrid(grid) {
    if (!grid) {
        return;
    }

    let child = grid.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        grid.remove(child);
        child = next;
    }
}

export function formatDate(isoDate, options = {}) {
    try {
        const date = new Date(isoDate);
        const month = options.month || 'short';
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month,
            day: 'numeric'
        });
    } catch {
        return isoDate;
    }
}

export function formatRuntimeMinutes(minutes) {
    const totalMinutes = Number(minutes) || 0;
    if (totalMinutes <= 0) {
        return '0m';
    }

    const hours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;

    if (hours <= 0) {
        return `${remainingMinutes}m`;
    }
    if (remainingMinutes === 0) {
        return `${hours}h`;
    }

    return `${hours}h ${remainingMinutes}m`;
}

export function enforceFixedWidgetSize(widget, width, height) {
    if (!widget) {
        return;
    }

    if (typeof widget.set_size_request === 'function') {
        widget.set_size_request(width, height);
    }
    if (typeof widget.set_width_request === 'function') {
        widget.set_width_request(width);
    }
    if (typeof widget.set_height_request === 'function') {
        widget.set_height_request(height);
    }

    if ('hexpand' in widget) {
        widget.hexpand = false;
    }
    if ('vexpand' in widget) {
        widget.vexpand = false;
    }
}

export function enforceFixedPictureSize(picture, width, height) {
    if (!picture) {
        return;
    }

    enforceFixedWidgetSize(picture, width, height);
    picture.can_shrink = true;
}
