import 'server-only';
import qrcode from 'qrcode-generator';

/** A QR code for an otpauth:// link, as an inline GIF data URL. Made on the server; nothing is sent to a third party. */
export function qrDataUrl(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(5, 4);
}
