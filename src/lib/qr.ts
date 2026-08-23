import "server-only";
import QRCode from "qrcode";

/**
 * Renders the QR code for a printed sign as an inline SVG string
 * (docs/GUEST-GALLERIES.md F7). Server-side and dependency-free of any canvas
 * or DOM API, so it runs in a Server Component and ships zero client JS for
 * something that never changes after render.
 *
 * `margin: 4` (modules, not px) keeps a real quiet zone around the code —
 * round-1 QA and design findings both flagged that a browser's own print
 * margin can be zero, and a QR code with no quiet zone of its own stops
 * scanning reliably at exactly the size a printed sign uses.
 *
 * Pure black on white, not a brand tint: round-1 findings (photographer,
 * designer) agreed low contrast is a real failure mode under evening
 * reception lighting, and it is not worth trading scan reliability for
 * branding on the one element of the sign that has no room for ambiguity.
 */
export async function renderSignQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: "svg",
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: "#111111", light: "#ffffff" },
  });
}
