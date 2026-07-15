import express from "express";
import { PDFDocument, } from "pdf-lib";
import fs from "fs";
import path from "path";
import { createProductsPdf, uploadToDrive } from './functions/createPdf.js'
import { parseOrderIds, buildProductsFromOrders, getBigFileIds } from './functions/sheetData.js'
import { withRetry } from './functions/retry.js'
import { drive, sheets } from "./google.js";

const app = express();
app.use(express.json({ limit: "50mb" }));

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

/* ============ FAYL SAQLASH (serverda) + HTTP orqali berish ============ */
// Chiquvchi PDF'lar serverda saqlanadi va shu manzildan ochiladi:
//   {PUBLIC_BASE_URL}/files/<name>.pdf
// uzum.fikrlovchi.uz domeni ulangach, PUBLIC_BASE_URL ni env orqali bering.
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://64.226.69.129:4040";
app.use("/files", express.static(uploadDir));

// Standart PDF sozlamasi (dashboard keyin body.pdfConfig orqali o'zgartira oladi)
const DEFAULT_PDF_CONFIG = {
    qrSize: 360,
    pageSize: { width: 594, height: 420 },
    textSize: { top: 24, bottom: 50 },
    orientation: "portrait",
    qrPosition: { x: 90, y: 40 },
};

// PDF'ni diskka saqlab, ochiq URL qaytaradi
function saveGeneratedPdf(buffer, prefix) {
    const fileName = `${prefix}_${Date.now()}.pdf`;
    fs.writeFileSync(path.join(uploadDir, fileName), buffer);
    return { fileName, url: `${PUBLIC_BASE_URL}/files/${fileName}` };
}

// Eski fayllarni avto-tozalash (disk to'lmasligi uchun)
const FILE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 kun
function cleanupOldFiles() {
    try {
        const now = Date.now();
        for (const f of fs.readdirSync(uploadDir)) {
            const p = path.join(uploadDir, f);
            if (now - fs.statSync(p).mtimeMs > FILE_RETENTION_MS) fs.unlinkSync(p);
        }
    } catch (e) {
        console.error("cleanup xato:", e.message);
    }
}
cleanupOldFiles();
setInterval(cleanupOldFiles, 6 * 60 * 60 * 1000);

// Drive'dagi fileId'larni yuklab olib bitta PDF'ga merge qiladi
async function mergeDriveFiles(fileIds) {
    const merged = await PDFDocument.create();
    for (const fileId of fileIds) {
        const file = await withRetry(
            () => drive.files.get(
                { fileId, alt: "media", supportsAllDrives: true },
                { responseType: "arraybuffer" }
            ),
            { label: `drive get ${fileId}` }
        );
        const pdf = await PDFDocument.load(Buffer.from(file.data));
        const pages = await merged.copyPages(pdf, pdf.getPageIndices());
        pages.forEach(p => merged.addPage(p));
    }
    return await merged.save();
}

/* ================== NATIJA SHEET SOZLAMALARI ==================
 * Ilgari bu ish GAS ichida bajarilardi. Endi AppSheet to'g'ridan-to'g'ri
 * serverga POST qiladi, server esa natijani shu sheetga yozadi.
 * AppSheet aynan shu sheetdan (id + url) o'qiydi.
 */
const RESULT_SHEET_ID = "18j8NDVJl9ZD-wuwlP3T1A1-sVoJlW_doFrwQrf-AvsE";
const GENERATE_RESULT_TAB = "uzum_generated";
const MERGE_RESULT_TAB = "uzum_merged";

// Generate PDF'lar saqlanadigan Drive papka (AppSheet yubormasa shu ishlatiladi)
const GENERATE_TARGET_FOLDER_ID = "1sMssmy_ukXoo9ARSzguZUCjGjfYVVz8s";

const MERGE_PASSWORD = "5e59a31e-e0d6-436a-8df2-174b6fe9fa24";

/* ---------------- HELPERS (GAS'dan ko'chirildi) ---------------- */

// AppSheet'dan keladigan stringni vergul bo'yicha massivga ajratish
function splitAndClean(text) {
    if (!text) return [];
    return String(text).split(",").map(v => v.trim()).filter(Boolean);
}

// Massiv elementlarini har 2 tadan vergul bilan qo'shib guruhlash
function groupInPairs(arr) {
    const grouped = [];
    for (let i = 0; i < arr.length; i += 2) {
        let pair = arr[i];
        if (arr[i + 1]) pair += "," + arr[i + 1];
        grouped.push(pair);
    }
    return grouped;
}

// 🔒 Natija sheetdagi A ustunda shu id allaqachon bormi? (dublikat webhookdan himoya)
async function isDuplicate(spreadsheetId, tabName, id) {
    const resp = await withRetry(
        () => sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${tabName}!A:A`,
        }),
        { label: `dup check ${tabName}` }
    );
    const rows = resp.data.values || [];
    // 1-qator sarlavha (header), 2-qatordan boshlab tekshiramiz
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] != null && String(rows[i][0]) === String(id)) return true;
    }
    return false;
}

// Natija sheetga [id, url] qatorini yozish
async function appendResult(spreadsheetId, tabName, id, url) {
    await withRetry(
        () => sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${tabName}!A:B`,
            valueInputOption: "RAW",
            requestBody: { values: [[id, url]] },
        }),
        { label: `append ${tabName}` }
    );
}

app.post("/generate-product-pdfs", async (req, res) => {
    try {
        const data = req.body || {};
        const { id } = data;
        const TargetFolderId = data.TargetFolderId || GENERATE_TARGET_FOLDER_ID;

        if (!id) {
            return res.status(400).json({ status: "error", message: "ID missing" });
        }

        /* --------- 🔒 DUPLICATE CHECK --------- */
        if (await isDuplicate(RESULT_SHEET_ID, GENERATE_RESULT_TAB, id)) {
            return res.json({ status: "ignored", message: "Duplicate webhook call", id });
        }

        /* --------- 📦 JUFTLASH LOGIKASI (Details & Barcodes) --------- */
        let products = [];
        if (Array.isArray(data.products) && data.products.length) {
            products = data.products;
        } else {
            const groupedTitles = groupInPairs(splitAndClean(data.Details || ""));
            const groupedBarcodes = groupInPairs(splitAndClean(data.Barcodes || ""));
            const finalLength = Math.min(groupedTitles.length, groupedBarcodes.length);
            for (let j = 0; j < finalLength; j++) {
                products.push({ title: groupedTitles[j], barcode: groupedBarcodes[j] });
            }
        }

        if (!products.length) {
            return res.status(400).json({ status: "error", message: "products required" });
        }

        const pdfConfig = data.pdfConfig || {
            qrSize: 360,
            columns: 2,
            rows: 10,
            pageSize: { width: 594, height: 420 },
            textSize: { top: 24, bottom: 50 },
            orientation: "portrait",
            qrPosition: { x: 90, y: 40 }
        };

        const mergedPdf = await createProductsPdf(products, pdfConfig);

        const fileName = `products_${Date.now()}.pdf`;
        const url = await uploadToDrive(Buffer.from(mergedPdf), fileName, TargetFolderId, drive);

        /* --------- NATIJA SHEETGA [id, url] --------- */
        await appendResult(RESULT_SHEET_ID, GENERATE_RESULT_TAB, id, url);

        return res.json({ status: "ok", id, url });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: "error", message: err.message });
    }
});

app.post("/merge-drive-pdfs", async (req, res) => {
    try {
        const data = req.body || {};
        const { id, TargetFolderId, password } = data;

        if (password !== MERGE_PASSWORD) {
            return res.status(403).json({ status: "error", message: "Unauthorized" });
        }

        if (!id) {
            return res.status(400).json({ status: "error", message: "ID missing" });
        }

        /* --------- 🔒 DUPLICATE CHECK --------- */
        if (await isDuplicate(RESULT_SHEET_ID, MERGE_RESULT_TAB, id)) {
            return res.json({ status: "ignored", message: "Duplicate webhook call", id });
        }

        /* --------- fileIds: TEXT → ARRAY --------- */
        const fileIds = Array.isArray(data.fileIds)
            ? data.fileIds
            : splitAndClean(data.fileIds);

        if (!fileIds.length) {
            return res.status(400).json({ status: "error", message: "fileIds required" });
        }

        const pdfBuffers = [];

        for (const fileId of fileIds) {
            const file = await drive.files.get(
                { fileId, alt: "media", supportsAllDrives: true },
                { responseType: "arraybuffer" }
            );
            pdfBuffers.push(Buffer.from(file.data));
        }

        const mergedPdf = await PDFDocument.create();
        for (const buf of pdfBuffers) {
            const pdf = await PDFDocument.load(buf);
            const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            pages.forEach((p) => mergedPdf.addPage(p));
        }
        const mergedPdfBytes = await mergedPdf.save();

        const fileName = `merged_${Date.now()}.pdf`;
        const tempPath = `uploads/${fileName}`;
        fs.writeFileSync(tempPath, mergedPdfBytes);

        const uploaded = await drive.files.create({
            requestBody: {
                name: fileName,
                mimeType: "application/pdf",
                parents: [TargetFolderId],
            },
            media: {
                mimeType: "application/pdf",
                body: fs.createReadStream(tempPath),
            },
            supportsAllDrives: true,
        });

        const newFileId = uploaded.data.id;

        await drive.permissions.create({
            fileId: newFileId,
            requestBody: { role: "reader", type: "anyone" },
            supportsAllDrives: true,
        });

        const url = `https://drive.google.com/file/d/${newFileId}/view`;

        /* --------- NATIJA SHEETGA [id, url] --------- */
        await appendResult(RESULT_SHEET_ID, MERGE_RESULT_TAB, id, url);

        return res.json({ status: "ok", id, url });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ status: "error", message: err.message });
    }
});

// NOTE: /mc-customerorder endpointi alohida servisga ko'chirildi
// (receiveMCPost loyihasi, port 4041). Bu yerda takrorlanmaydi.

/* ==================================================================
 * YANGI (AppSheet'siz): dashboard order ID'larni yuboradi, server
 * Google Sheets'dan bevosita o'qib PDF yasaydi va serverda saqlaydi.
 * ================================================================== */

// order ID'lardan QR-yorliqlar PDF'ini yasaydi
app.post("/generate", async (req, res) => {
    try {
        const orderIds = parseOrderIds(req.body.orderIds ?? req.body.orders);
        if (!orderIds.length) {
            return res.status(400).json({ status: "error", message: "orderIds required" });
        }

        const products = await buildProductsFromOrders(orderIds);
        if (!products.length) {
            return res.status(400).json({ status: "error", message: "Berilgan orderlar uchun detail topilmadi" });
        }

        const pdfConfig = req.body.pdfConfig || DEFAULT_PDF_CONFIG;
        const pdfBytes = await createProductsPdf(products, pdfConfig);
        const { fileName, url } = saveGeneratedPdf(Buffer.from(pdfBytes), "shk");

        console.log(`[generate] ${orderIds.length} order -> ${products.length} bet -> ${fileName}`);
        return res.json({ status: "ok", orders: orderIds.length, pages: products.length, fileName, url });

    } catch (err) {
        console.error("[generate]", err);
        return res.status(500).json({ status: "error", message: err.message });
    }
});

// order ID'lardan BIG(N) Drive fayllarini merge qiladi
app.post("/merge", async (req, res) => {
    try {
        const orderIds = parseOrderIds(req.body.orderIds ?? req.body.orders);
        if (!orderIds.length) {
            return res.status(400).json({ status: "error", message: "orderIds required" });
        }

        const fileIds = await getBigFileIds(orderIds);
        if (!fileIds.length) {
            return res.status(400).json({ status: "error", message: "Berilgan orderlar uchun BIG fayl topilmadi" });
        }

        const mergedBytes = await mergeDriveFiles(fileIds);
        const { fileName, url } = saveGeneratedPdf(Buffer.from(mergedBytes), "big");

        console.log(`[merge] ${orderIds.length} order -> ${fileIds.length} fayl -> ${fileName}`);
        return res.json({ status: "ok", orders: orderIds.length, merged: fileIds.length, fileName, url });

    } catch (err) {
        console.error("[merge]", err);
        return res.status(500).json({ status: "error", message: err.message });
    }
});

app.listen(4040, () => {
    console.log("Server running on 4040");
});


// 1-funksiya Bu yerda google drive file id beriladi ularni merge qilish bo'ladi. Faqat pdf bo'lishi kerak.

// 1- PDF IDlarni olib ularni merge qilish

// Post orqali yuborish:
// GoogleDrive Target Folder_ID
// GoogleDrive PDF ID


// 2-funksiyada postda o'lchamlarni berish va joylashuvlarni berish. Albomniy/Knejniy holati typeni berish

// O'zgaruvchilarni POST orqali olish:
// QR o'lchami
// QR joylashuvi

// PDF o'lchami
// PDF orientatsiyasi (Albom; Kitob)

// GoogleDrive PDF saqlanadigan folder_IDni yuborish

// Serverni sotib olish va sozlash
// Serverda dasturni ishga tushurish
// API chiqarib berish

// APIlarga login parolli qilish. Login and password yuboradi.
