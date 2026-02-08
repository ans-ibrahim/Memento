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
