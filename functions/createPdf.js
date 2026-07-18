import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import QRCode from "qrcode";
import fs from "fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import { withRetry } from "./retry.js";


async function generateQrCodeBase64(text) {
    return await QRCode.toDataURL(text);
}

// async function createProductPdf(product) {
//     const { title, barcode } = product;

//     const pdfDoc = await PDFDocument.create();
//     const page = pdfDoc.addPage([400, 400]);

//     const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

//     page.drawText(title, {
//         x: 80,
//         y: 350,
//         size: 40,
//         font,
//     });

//     const qrBase64 = await generateQrCodeBase64(barcode);
//     const qrImageBytes = Buffer.from(qrBase64.split(",")[1], "base64");
//     const qrImage = await pdfDoc.embedPng(qrImageBytes);

//     const qrSize = 280;
//     page.drawImage(qrImage, {
//         x: 60,
//         y: 60,
//         width: qrSize,
//         height: qrSize,
//     });

//     page.drawText(`${barcode}`, {
//         x: 80,
//         y: 50,
//         size: 40,
//         font,
//     });

//     return await pdfDoc.save();
// }

async function createProductPdf(product, options = {}) {
    const { title, barcode } = product;

    const {
        qrSize = 280,
        orientation = "landscape",
        qrPosition = null,
        titlePosition = null,
        barcodePosition = null,
        pageSize = { width: 400, height: 400 },
        textSize = { top: 24, bottom: 30 }
    } = options;

    const width = orientation === "portrait" ? pageSize.width : pageSize.height;
    const height = orientation === "portrait" ? pageSize.height : pageSize.width;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const page = pdfDoc.addPage([width, height]);

    const fontBytes = fs.readFileSync(
        path.resolve("./fonts/dejavu/ttf/DejaVuLGCSans.ttf")
    );
    const font = await pdfDoc.embedFont(fontBytes);

    // Title ni vertical (90 daraja burilgan) - chap pastdan tepaga. Uzun bo'lsa wrap qilamiz.
    const maxTitleWidth = height - 40; // Y padding qoldiramiz (masalan 20px har tomondan)

    const titleStr = title ? String(title) : '';
    const commaIdx = titleStr.indexOf(',');
    const titlePart1 = commaIdx >= 0 ? titleStr.slice(0, commaIdx).trim() : titleStr.trim();
    const titlePart2 = commaIdx >= 0 ? titleStr.slice(commaIdx + 1).trim() : '';

    const drawVerticalTitle = (text, startX, fontSize) => {
        if (!text) return startX;
        const words = text.split(' ');
        const partLines = [];
        let currentLine = words[0] || '';
        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const testLine = currentLine ? currentLine + " " + word : word;
            const testWidth = font.widthOfTextAtSize(testLine, fontSize);
            if (testWidth <= maxTitleWidth) {
                currentLine = testLine;
            } else {
                if (currentLine) partLines.push(currentLine);
                currentLine = word;
            }
        }
        if (currentLine) partLines.push(currentLine);

        const lh = fontSize * 1.2;
        partLines.forEach((line, index) => {
            const lineWidth = font.widthOfTextAtSize(line, fontSize);
            page.drawText(line, {
                x: startX + (index * lh),
                // titlePosition.y berilsa o'shani ishlatamiz, aks holda vertikal markaz
                y: (titlePosition && titlePosition.y != null ? titlePosition.y : height / 2) - lineWidth / 2,
                size: fontSize,
                font,
                rotate: degrees(90),
            });
        });
        return startX + (partLines.length * lh);
    };

    const titleStartX = titlePosition && titlePosition.x != null ? titlePosition.x : 30;
    const part1RightX = drawVerticalTitle(titlePart1, titleStartX, textSize.top);
    const part2StartX = titlePart2 ? part1RightX + 5 : part1RightX;
    const titleBlockRightX = drawVerticalTitle(titlePart2, part2StartX, textSize.top + 6);

    const qrBarcode = `${barcode}`.split(',')[0].trim();
    const qrBase64 = await generateQrCodeBase64(qrBarcode);
    const qrImageBytes = Buffer.from(qrBase64.split(",")[1], "base64");
    const qrImage = await pdfDoc.embedPng(qrImageBytes);

    // QR code ni markazda
    const finalQrPosition = qrPosition || {
        x: Math.max((width - qrSize) / 2 + 40, titleBlockRightX + 10), // title uchun joy qoldirish
        y: (height - qrSize) / 2,
    };

    page.drawImage(qrImage, {
        x: finalQrPosition.x,
        y: finalQrPosition.y,
        width: qrSize,
        height: qrSize,
    });

    // Barcode ni ham vertical - QR code o'ng tomonidan
    const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);


    const barcodeText = `${barcode}`;
    const barcodes = barcodeText.split(',').map(b => b.trim()).filter(b => b.length > 0);

    const baseX = barcodePosition && barcodePosition.x != null
        ? barcodePosition.x
        : finalQrPosition.x + qrSize + 20;
    const barcodeLineHeight = textSize.bottom * 1.2;

    barcodes.forEach((bc, index) => {
        const currentX = baseX + (index * barcodeLineHeight);

        const normalText = bc.slice(0, -4);
        const boldText = bc.slice(-4);

        const normalTextWidth = normalFont.widthOfTextAtSize(normalText, textSize.bottom);
        const boldTextWidth = boldFont.widthOfTextAtSize(boldText, textSize.bottom);

        // barcodePosition.y berilsa o'shani ishlatamiz, aks holda vertikal markaz
        const baseY = barcodePosition && barcodePosition.y != null
            ? barcodePosition.y - (normalTextWidth + boldTextWidth) / 2
            : (height - (normalTextWidth + boldTextWidth)) / 2;

        // Oddiy qism
        page.drawText(normalText, {
            x: currentX,
            y: baseY,
            size: textSize.bottom,
            font: normalFont,
            rotate: degrees(90),
        });

        // Bold qism (oxirgi 4 ta)
        page.drawText(boldText, {
            x: currentX,
            y: baseY + normalTextWidth,
            size: textSize.bottom,
            font: boldFont,
            rotate: degrees(90),
        });
    });


    return await pdfDoc.save();
}


// ⚡ TEZ: barcha mahsulotlarni BITTA PDFDocument'ga chizadi.
// Shrift bir marta embed qilinadi, QR kodlar parallel generatsiya qilinadi,
// merge bosqichi kerak emas — 100-400 bet uchun bir necha barobar tez.
async function createProductsPdf(products, options = {}) {
    const {
        qrSize = 280,
        orientation = "landscape",
        qrPosition = null,
        titlePosition = null,
        barcodePosition = null,
        pageSize = { width: 400, height: 400 },
        textSize = { top: 24, bottom: 30 }
    } = options;

    const width = orientation === "portrait" ? pageSize.width : pageSize.height;
    const height = orientation === "portrait" ? pageSize.height : pageSize.width;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    // Shriftlar BIR MARTA embed qilinadi (ilgari har bet uchun qayta-qayta edi)
    const fontBytes = fs.readFileSync(
        path.resolve("./fonts/dejavu/ttf/DejaVuLGCSans.ttf")
    );
    const font = await pdfDoc.embedFont(fontBytes);
    const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Barcha QR kodlarni PARALLEL generatsiya qilamiz (asosiy sekinlik shu edi)
    const qrBytesArr = await Promise.all(
        products.map(p => {
            const qrBarcode = `${p.barcode}`.split(',')[0].trim();
            return generateQrCodeBase64(qrBarcode).then(
                d => Buffer.from(d.split(",")[1], "base64")
            );
        })
    );

    const maxTitleWidth = height - 40;

    for (let i = 0; i < products.length; i++) {
        const { title, barcode } = products[i];
        const page = pdfDoc.addPage([width, height]);

        // ---- Title (vertikal, 90°) ----
        const titleStr = title ? String(title) : '';
        const commaIdx = titleStr.indexOf(',');
        const titlePart1 = commaIdx >= 0 ? titleStr.slice(0, commaIdx).trim() : titleStr.trim();
        const titlePart2 = commaIdx >= 0 ? titleStr.slice(commaIdx + 1).trim() : '';

        const drawVerticalTitle = (text, startX, fontSize) => {
            if (!text) return startX;
            const words = text.split(' ');
            const partLines = [];
            let currentLine = words[0] || '';
            for (let k = 1; k < words.length; k++) {
                const word = words[k];
                const testLine = currentLine ? currentLine + " " + word : word;
                const testWidth = font.widthOfTextAtSize(testLine, fontSize);
                if (testWidth <= maxTitleWidth) {
                    currentLine = testLine;
                } else {
                    if (currentLine) partLines.push(currentLine);
                    currentLine = word;
                }
            }
            if (currentLine) partLines.push(currentLine);

            const lh = fontSize * 1.2;
            partLines.forEach((line, index) => {
                const lineWidth = font.widthOfTextAtSize(line, fontSize);
                page.drawText(line, {
                    x: startX + (index * lh),
                    y: (titlePosition && titlePosition.y != null ? titlePosition.y : height / 2) - lineWidth / 2,
                    size: fontSize,
                    font,
                    rotate: degrees(90),
                });
            });
            return startX + (partLines.length * lh);
        };

        const titleStartX = titlePosition && titlePosition.x != null ? titlePosition.x : 30;
        const part1RightX = drawVerticalTitle(titlePart1, titleStartX, textSize.top);
        const part2StartX = titlePart2 ? part1RightX + 5 : part1RightX;
        const titleBlockRightX = drawVerticalTitle(titlePart2, part2StartX, textSize.top + 6);

        // ---- QR ----
        const qrImage = await pdfDoc.embedPng(qrBytesArr[i]);
        const finalQrPosition = qrPosition || {
            x: Math.max((width - qrSize) / 2 + 40, titleBlockRightX + 10),
            y: (height - qrSize) / 2,
        };
        page.drawImage(qrImage, {
            x: finalQrPosition.x,
            y: finalQrPosition.y,
            width: qrSize,
            height: qrSize,
        });

        // ---- Barcode (vertikal) ----
        const barcodes = `${barcode}`.split(',').map(b => b.trim()).filter(b => b.length > 0);
        const baseX = barcodePosition && barcodePosition.x != null
            ? barcodePosition.x
            : finalQrPosition.x + qrSize + 20;
        const barcodeLineHeight = textSize.bottom * 1.2;

        barcodes.forEach((bc, index) => {
            const currentX = baseX + (index * barcodeLineHeight);
            const normalText = bc.slice(0, -4);
            const boldText = bc.slice(-4);
            const normalTextWidth = normalFont.widthOfTextAtSize(normalText, textSize.bottom);
            const boldTextWidth = boldFont.widthOfTextAtSize(boldText, textSize.bottom);
            const baseY = barcodePosition && barcodePosition.y != null
                ? barcodePosition.y - (normalTextWidth + boldTextWidth) / 2
                : (height - (normalTextWidth + boldTextWidth)) / 2;

            page.drawText(normalText, {
                x: currentX, y: baseY, size: textSize.bottom, font: normalFont, rotate: degrees(90),
            });
            page.drawText(boldText, {
                x: currentX, y: baseY + normalTextWidth, size: textSize.bottom, font: boldFont, rotate: degrees(90),
            });
        });
    }

    return await pdfDoc.save();
}


async function mergePdfs(pdfBuffers) {
    const merged = await PDFDocument.create();

    for (const buf of pdfBuffers) {
        const pdf = await PDFDocument.load(buf);
        const pages = await merged.copyPages(pdf, pdf.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
    }

    return await merged.save();
}

async function uploadToDrive(buffer, fileName, folderId, drive) {
    const tempPath = `uploads/${fileName}`;
    fs.writeFileSync(tempPath, buffer);

    const res = await withRetry(
        () => drive.files.create({
            requestBody: {
                name: fileName,
                mimeType: "application/pdf",
                parents: [folderId],
            },
            media: {
                mimeType: "application/pdf",
                body: fs.createReadStream(tempPath),
            },
            supportsAllDrives: true,
        }),
        { label: "drive upload" }
    );

    const fileId = res.data.id;

    await withRetry(
        () => drive.permissions.create({
            fileId,
            requestBody: { role: "reader", type: "anyone" },
            supportsAllDrives: true,
        }),
        { label: "drive permission" }
    );

    return `https://drive.google.com/file/d/${fileId}/view`;
}


export { createProductPdf, createProductsPdf, mergePdfs, uploadToDrive };