import { google } from "googleapis";

const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_KEY_FILE || "credentials.json",
    scopes: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/spreadsheets"
    ],
});

export const drive = google.drive({ version: "v3", auth });
export const sheets = google.sheets({ version: "v4", auth });

