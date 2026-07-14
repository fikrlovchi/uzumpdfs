import express from "express";
import { PDFDocument, } from "pdf-lib";
import fs from "fs";
import path from "path";
import { createProductsPdf, uploadToDrive } from './functions/createPdf.js'
import { drive, sheets } from "./google.js";

const app = express();
app.use(express.json({ limit: "50mb" }));

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
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
    const resp = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tabName}!A:A`,
    });
    const rows = resp.data.values || [];
    // 1-qator sarlavha (header), 2-qatordan boshlab tekshiramiz
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] != null && String(rows[i][0]) === String(id)) return true;
    }
    return false;
}

// Natija sheetga [id, url] qatorini yozish
async function appendResult(spreadsheetId, tabName, id, url) {
    await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${tabName}!A:B`,
        valueInputOption: "RAW",
        requestBody: { values: [[id, url]] },
    });
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

app.post("/mc-customerorder", async (req, res) => {
    try {
        const { id, type = "CustomerOrder" } = { ...req.query, ...req.body };

        if (!id) {
            return res.status(400).json({ success: false, error: "Order ID required" });
        }

        if (type !== "CustomerOrder") {
            return res.json({ success: true, ignored: type });
        }

        const SPREADSHEET_ID = "1qLlZXdRoDSfk9DWWi3mnJjASCv6HCMVGj8Gs8cVVx4w";
        // const SPREADSHEET_ID = "1_aUppmMG99xrYwk8Z5i-cXyLQ507LoW1vm6IPe8wczc"

        const now = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: "ImportedIDs!A:C",
            valueInputOption: "USER_ENTERED",
            requestBody: {
                values: [[id, now, "NEW"]],
            },
        });

        return res.json({ success: true, queued: id });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: err.message });
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
