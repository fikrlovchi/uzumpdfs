// Diagnostika: OAuth akkaunt POST body'dagi Sheet va papkalarga kira oladimi?
// Ishga tushirish (serverda):  node check-access.js
import { drive, sheets } from "./google.js";

// Serverdagi natija sheet (main.js dagi RESULT_SHEET_ID bilan bir xil)
const RESULT_SHEET_ID = "18j8NDVJl9ZD-wuwlP3T1A1-sVoJlW_doFrwQrf-AvsE";

// Drive papkalari (main.js dagi qiymatlar bilan bir xil)
const GENERATE_FOLDER = "1sMssmy_ukXoo9ARSzguZUCjGjfYVVz8s";
const MERGE_FOLDER = "1mIg5g1r2mxYzzz7coZ-QSnD50as00prT";

const mark = ok => (ok ? "✅ OK" : "❌ RUXSAT YO'Q");

async function checkSheet(id, tab) {
    try {
        await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `${tab}!A1` });
        return true;
    } catch (e) {
        console.log("     ↳", e.message);
        return false;
    }
}

async function checkFolder(id) {
    try {
        const r = await drive.files.get({
            fileId: id,
            fields: "id,name",
            supportsAllDrives: true,
        });
        console.log("     ↳ nomi:", r.data.name);
        return true;
    } catch (e) {
        console.log("     ↳", e.message);
        return false;
    }
}

async function main() {
    try {
        const about = await drive.about.get({ fields: "user" });
        console.log("OAuth akkaunt:", about.data.user.emailAddress);
        console.log("(fayllar shu akkauntga tegishli bo'ladi)\n");
    } catch (e) {
        console.log("OAuth tekshiruvi xatosi:", e.message, "\n");
    }

    console.log("Natija Sheet 18j8... [uzum_generated]:");
    console.log("  ", mark(await checkSheet(RESULT_SHEET_ID, "uzum_generated")));

    console.log("Natija Sheet 18j8... [uzum_merged]:");
    console.log("  ", mark(await checkSheet(RESULT_SHEET_ID, "uzum_merged")));

    console.log("Generate papka 1y_O00...:");
    console.log("  ", mark(await checkFolder(GENERATE_FOLDER)));

    console.log("Merge papka 1mIg5g...:");
    console.log("  ", mark(await checkFolder(MERGE_FOLDER)));
}

main();
