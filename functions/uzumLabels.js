// Uzum FBS API'dan buyurtma label'ini (LARGE) olib, base64 -> PDF qiladi.
// Serverda orderId bo'yicha cache qilinadi (qayta so'ralsa API'ga chiqmaydi).
// Rate limit: Uzum ~2 req/sek (replenish 2, burst 2) -> ketma-ket ~500ms pacing.
import fs from "fs";
import path from "path";
import { withRetry } from "./retry.js";

// Umumiy (shared) cache papka — uzumOrderToMC ham shu yerga label yozadi.
// Serverda ikkala servisda ham LABEL_CACHE_DIR env bir xil bo'lishi kerak.
const LABELS_DIR = process.env.LABEL_CACHE_DIR || path.join(process.cwd(), "uploads", "labels");
if (!fs.existsSync(LABELS_DIR)) fs.mkdirSync(LABELS_DIR, { recursive: true });

// Eski label'larni tozalash (default 3 kun)
function cleanupOldLabels(maxAgeMs = 3 * 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let entries = [];
    try { entries = fs.readdirSync(LABELS_DIR); } catch { return; }
    for (const f of entries) {
        try {
            const p = path.join(LABELS_DIR, f);
            const st = fs.statSync(p);
            if (st.isFile() && now - st.mtimeMs > maxAgeMs) fs.unlinkSync(p);
        } catch (e) { console.error("label cleanup:", f, e.message); }
    }
}

// oddiy throttle: so'rovlar orasida kamida minGapMs
let lastCall = 0;
async function throttle(minGapMs = 600) {
    const wait = Math.max(0, lastCall + minGapMs - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastCall = Date.now();
}

// orderId uchun label PDF (Buffer). Avval cache, keyin Uzum API.
async function getLabelPdf(orderId, token, { size = "LARGE" } = {}) {
    const cachePath = path.join(LABELS_DIR, `${orderId}.pdf`);
    if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath);
    if (!token) throw new Error(`token yo'q (order ${orderId})`);

    await throttle();
    const apiUrl = `https://api-seller.uzum.uz/api/seller-openapi/v1/fbs/order/${orderId}/labels/print?size=${size}`;

    const buf = await withRetry(async () => {
        const resp = await fetch(apiUrl, { headers: { accept: "*/*", Authorization: token } });
        if (resp.status === 429 || resp.status === 503 || resp.status === 500) {
            const e = new Error(`Uzum ${resp.status}`); e.code = resp.status; throw e;
        }
        if (!resp.ok) throw new Error(`Uzum API ${resp.status} (order ${orderId})`);
        const json = await resp.json();
        const b64 = json?.payload?.document;
        if (!b64) throw new Error(`label bo'sh (order ${orderId})`);
        return Buffer.from(b64, "base64");
    }, { label: `uzum label ${orderId}` });

    fs.writeFileSync(cachePath, buf);
    return buf;
}

export { getLabelPdf, cleanupOldLabels };
