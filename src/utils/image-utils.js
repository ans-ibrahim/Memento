import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Soup from 'gi://Soup?version=3.0';
import Gtk from 'gi://Gtk';

const session = new Soup.Session();

// Cache directory
let cacheDir = null;

function getCacheDir() {
    if (!cacheDir) {
        const cacheBaseDir = GLib.get_user_cache_dir();
        cacheDir = Gio.File.new_for_path(GLib.build_filenamev([cacheBaseDir, 'memento', 'images']));
        
        // Create cache directory if it doesn't exist
        try {
            cacheDir.make_directory_with_parents(null);
        } catch (e) {
            // Directory might already exist, that's fine
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                console.error('Failed to create cache directory:', e.message);
            }
        }
    }
    return cacheDir;
}

function sanitizePathForFilename(relativePath) {
    if (!relativePath) return null;
    
    // Remove leading slash and replace remaining slashes with underscores
    // Example: /w500/abc123.jpg -> w500_abc123.jpg
    return relativePath.replace(/^\//, '').replace(/\//g, '_');
}

function getCachedImagePath(relativePath) {
    if (!relativePath) return null;
    
    const sanitized = sanitizePathForFilename(relativePath);
    if (!sanitized) return null;
    
    const cacheDir = getCacheDir();
    return cacheDir.get_child(sanitized);
}

function isCached(relativePath) {
    const cachedFile = getCachedImagePath(relativePath);
    return cachedFile && cachedFile.query_exists(null);
}

async function loadTextureFromFile(file) {
    try {
        const [, contents] = file.load_contents(null);
        const bytes = GLib.Bytes.new(contents);
        const inputStream = Gio.MemoryInputStream.new_from_bytes(bytes);
        const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(inputStream, null);
        return Gdk.Texture.new_for_pixbuf(pixbuf);
    } catch (error) {
        console.error('Failed to load texture from file:', error.message);
        return null;
    }
}

function sendAndReadAsync(message) {
    return new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, res) => {
            try {
                const bytes = session.send_and_read_finish(res);
                resolve(bytes);
            } catch (error) {
                reject(error);
            }
        });
    });
}

function getFallbackTexture() {
    const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    const iconPaintable = iconTheme.lookup_icon(
        'application-x-executable',
        null,
        64,
        1,
        Gtk.TextDirection.NONE,
        0
    );
    return iconPaintable;
}

export async function loadTextureFromUrlWithFallback(url, relativePath = null) {
    try {
        if (!url) {
            return getFallbackTexture();
        }
        
        const texture = await loadTextureFromUrl(url, relativePath);
        return texture || getFallbackTexture();
    } catch (error) {
        console.warn(`Failed to load image from ${url}, using fallback:`, error.message);
        return getFallbackTexture();
    }
}

export async function loadTextureFromUrl(url, relativePath = null) {
    if (!url)
        return null;

    // Check cache first if we have a relative path
    if (relativePath && isCached(relativePath)) {
        const cachedFile = getCachedImagePath(relativePath);
        const texture = await loadTextureFromFile(cachedFile);
        if (texture) {
            return texture;
        }
        // If cache read failed, fall through to download
    }

    // Download image
    const message = Soup.Message.new('GET', url);
    const bytes = await sendAndReadAsync(message);
    const status = message.get_status();
    if (status < 200 || status >= 300)
        throw new Error(`Image request failed with status ${status}.`);

    // Save to cache if we have a relative path
    if (relativePath) {
        try {
            const cachedFile = getCachedImagePath(relativePath);
            const data = bytes.get_data();
            cachedFile.replace_contents(data, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (error) {
            console.warn('Failed to cache image:', error.message);
            // Continue even if caching fails
        }
    }

    // Load texture from downloaded bytes
    const inputStream = Gio.MemoryInputStream.new_from_bytes(bytes);
    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(inputStream, null);
    return Gdk.Texture.new_for_pixbuf(pixbuf);
}
