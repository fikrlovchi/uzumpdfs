import { google } from "googleapis";
import fs from "fs";

/*
 * OAuth2 — haqiqiy Google akkaunt (masalan uzbuyo@gmail.com) nomidan ishlaydi.
 * Service-account'da Drive kvotasi yo'q edi (403), shuning uchun OAuth ishlatamiz.
 * Fayllar refresh_token egasi bo'lgan akkauntga tegishli bo'ladi (15 GB kvota).
 *
 * oauth.json (git'da YO'Q, .gitignore'da):
 * {
 *   "client_id":     "....apps.googleusercontent.com",
 *   "client_secret": "....",
 *   "refresh_token": "1//...."
 * }
 */
const OAUTH_FILE = process.env.OAUTH_FILE || "oauth.json";
const creds = JSON.parse(fs.readFileSync(OAUTH_FILE, "utf8"));

const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    "https://developers.google.com/oauthplayground"
);
oauth2Client.setCredentials({ refresh_token: creds.refresh_token });

export const drive = google.drive({ version: "v3", auth: oauth2Client });
export const sheets = google.sheets({ version: "v4", auth: oauth2Client });
