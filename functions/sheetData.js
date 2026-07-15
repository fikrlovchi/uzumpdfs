// Google Sheets'dan bevosita o'qib, AppSheet virtual ustunlarini server ichida
// qayta hisoblaydi. AppSheet'siz ishlaydi.
import { sheets } from "../google.js";
import { withRetry } from "./retry.js";

// Manba spreadsheet (barcha tab'lar shu faylda)
const SOURCE_SHEET_ID = "18j8NDVJl9ZD-wuwlP3T1A1-sVoJlW_doFrwQrf-AvsE";

async function readRows(tab, range = "A:Z") {
    const resp = await withRetry(
        () => sheets.spreadsheets.values.get({
            spreadsheetId: SOURCE_SHEET_ID,
            range: `${tab}!${range}`,
        }),
        { label: `read ${tab}` }
    );
    return resp.data.values || [];
}

/* ---------- Paste'dan / massivdan order ID'lar ---------- */
// Qabul qiladi: massiv YOKI "116649323 ,\n116735910 ,\n..." kabi matn
function parseOrderIds(input) {
    if (Array.isArray(input)) {
        return input.map(x => String(x).trim()).filter(Boolean);
    }
    if (typeof input === "string") {
        return input.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    }
    return [];
}

/* ---------- mc_product: UUID(B) -> Name(E), 10 daqiqa cache ---------- */
let mcCache = { map: null, at: 0 };
const MC_TTL = 10 * 60 * 1000;

async function getProductNameMap() {
    if (mcCache.map && Date.now() - mcCache.at < MC_TTL) return mcCache.map;
    const rows = await readRows("mc_product", "A:E");
    const map = new Map();
    for (let i = 1; i < rows.length; i++) {      // 1-qator header
        const uuid = rows[i][1];                  // B: UUID
        const name = rows[i][4];                  // E: Name
        if (uuid) map.set(String(uuid).trim(), name != null ? String(name) : "");
    }
    mcCache = { map, at: Date.now() };
    return map;
}

/* ---------- Order ID'lardan PDF mahsulotlarini yasash ----------
 * uzum_order_detail (A:L):
 *   B=Barcode, C=uzum_product, H=uzum_order, I=Product href(UUID), K=Quantity for mc
 * Har detail:  title="uzum_product,Name", barcode="Barcode,uzum_order"
 *   va (Quantity for mc * 2) marta takrorlanadi.
 * Natija paste tartibida (order'lar ketma-ketligi) qaytadi.
 */
async function buildProductsFromOrders(orderIds) {
    const orderSet = new Set(orderIds);
    const [detailRows, nameMap] = await Promise.all([
        readRows("uzum_order_detail", "A:L"),
        getProductNameMap(),
    ]);

    // Detallarni order bo'yicha guruhlaymiz (sheet tartibini saqlab)
    const byOrder = new Map();
    for (let i = 1; i < detailRows.length; i++) {
        const r = detailRows[i];
        const uzumOrder = String(r[7] ?? "").trim();   // H
        if (!orderSet.has(uzumOrder)) continue;
        if (!byOrder.has(uzumOrder)) byOrder.set(uzumOrder, []);
        byOrder.get(uzumOrder).push(r);
    }

    const products = [];
    for (const oid of orderIds) {                     // paste tartibida
        const list = byOrder.get(oid);
        if (!list) continue;
        for (const r of list) {
            const barcode = String(r[1] ?? "").trim();      // B
            const uzumProduct = String(r[2] ?? "").trim();   // C
            const uzumOrder = String(r[7] ?? "").trim();     // H
            const productHref = String(r[8] ?? "").trim();   // I
            const rep = (Number(r[10]) || 0) * 2;            // K * 2
            const name = nameMap.get(productHref) || "";
            const title = `${uzumProduct},${name}`;
            const bc = `${barcode},${uzumOrder}`;
            for (let k = 0; k < rep; k++) products.push({ title, barcode: bc });
        }
    }
    return products;
}

/* ---------- Merge uchun: order ID'lardan BIG(N) Drive fileId'lari ---------- */
async function getBigFileIds(orderIds) {
    const orderSet = new Set(orderIds);
    const rows = await readRows("uzum_order", "A:N");
    const byOrder = new Map();
    for (let i = 1; i < rows.length; i++) {
        const id = String(rows[i][0] ?? "").trim();    // A: id
        const big = String(rows[i][13] ?? "").trim();  // N: BIG
        if (orderSet.has(id) && big) byOrder.set(id, big);
    }
    const ids = [];
    for (const oid of orderIds) {
        const b = byOrder.get(oid);
        if (b) ids.push(b);
    }
    return ids;
}

export { parseOrderIds, buildProductsFromOrders, getBigFileIds };
