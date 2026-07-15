// Google API'ning vaqtinchalik xatolarida (503/429/500) avto qayta urinish.
// Exponential backoff: 0.5s, 1s, 2s, 4s ...
export async function withRetry(fn, { retries = 4, baseDelay = 500, label = "google" } = {}) {
    let attempt = 0;
    for (;;) {
        try {
            return await fn();
        } catch (err) {
            const code = err?.code || err?.response?.status;
            const retryable = code === 503 || code === 429 || code === 500;
            if (!retryable || attempt >= retries) throw err;
            const delay = baseDelay * Math.pow(2, attempt);
            console.warn(`[retry:${label}] ${code} — urinish ${attempt + 1}/${retries}, ${delay}ms kutiladi`);
            await new Promise(r => setTimeout(r, delay));
            attempt++;
        }
    }
}
