# uzumPDFs — PDF generate & merge server

AppSheet → shu server → Google Sheets/Drive.

Endpointlar (port `4040`):
- `POST /generate-product-pdfs` — QR/PDF yasab, natijani `uzum_generated` sheetga yozadi.
- `POST /merge-drive-pdfs` — Drive'dagi PDFlarni birlashtiradi, `uzum_merged` sheetga yozadi.

## 🔐 Maxfiy kalit (git'da YO'Q)

Google service-account kaliti git'ga kirmaydi (`.gitignore`da). Serverda loyiha
papkasida shu fayl bo'lishi shart:

```
bubbly-anvil-451415-b6-4ead68b4423a.json
```

Yoki boshqa nom bilan qo'yib, yo'lini env orqali bering:

```bash
export GOOGLE_KEY_FILE=/absolute/path/to/key.json
```

Bu service-account email'iga kerakli Drive papkalari va Sheet'lar
"Editor" qilib ulashilgan bo'lishi kerak.

## Ishga tushirish

```bash
npm install
npm start        # yoki: pm2 start main.js --name uzumpdfs
```
