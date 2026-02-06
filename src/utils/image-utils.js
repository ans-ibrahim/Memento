import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf?version=2.0';
import Soup from 'gi://Soup?version=3.0';

const session = new Soup.Session();

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

export async function loadTextureFromUrl(url) {
    if (!url)
        return null;

    const message = Soup.Message.new('GET', url);
    const bytes = await sendAndReadAsync(message);
    const status = message.get_status();
    if (status < 200 || status >= 300)
        throw new Error(`Image request failed with status ${status}.`);

    const inputStream = Gio.MemoryInputStream.new_from_bytes(bytes);
    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(inputStream, null);
    return Gdk.Texture.new_for_pixbuf(pixbuf);
}
