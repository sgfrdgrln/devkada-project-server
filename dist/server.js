"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express = require("express");
const multer = require("multer");
const tesseract_js_1 = require("tesseract.js");
const sharp_1 = __importDefault(require("sharp"));
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
/* -----------------------------
   OCR WORKER (REUSED = FAST)
------------------------------*/
let worker = null;
async function getWorker() {
    if (!worker) {
        worker = await (0, tesseract_js_1.createWorker)({
            logger: () => { },
        });
        await worker.loadLanguage("eng");
        await worker.initialize("eng");
        // 🚀 SPEED + RECEIPT OPTIMIZATION
        await worker.setParameters({
            tessedit_pageseg_mode: tesseract_js_1.PSM.SINGLE_BLOCK, // block of text (best for receipts)
            // 🚀 SPEED BOOST TRICK (you asked for this)
            tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz₱.,:/- ",
        });
    }
    return worker;
}
/* -----------------------------
   IMAGE PREPROCESSING
------------------------------*/
const preprocessImage = async (buffer) => {
    return (0, sharp_1.default)(buffer)
        .grayscale()
        .normalize()
        .resize({ width: 1600 }) // improves OCR accuracy
        .sharpen()
        .toBuffer();
};
const numberRegex = /-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/g;
const yearRegex = /\b(19|20)\d{2}\b/;
const dateNumericRegex = /\b\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\b/;
const monthRegex = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;
const timeRegex = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;
const dateKeywordRegex = /\b(date|time)\b/i;
const idRefRegex = /\b(id|ref|reference|order|transaction|trans|trx|tnx|rrn|stan|approval|auth|invoice|inv|terminal|serial|trace)\b/i;
const accountRegex = /\b(customer account|account number|acct number|can)\b/i;
const phoneRegex = /\+?\d[\d\s-]{9,}/;
const currencyRegex = /(\$|\u20B1|\bphp\b|\bpeso(?:s)?\b|\bP\s*\d)/i;
const keywordWeights = [
    { pattern: /\bplease pay\b/i, score: 140 },
    { pattern: /\btotal amount sent\b/i, score: 130 },
    { pattern: /\bgrand total\b/i, score: 120 },
    { pattern: /\btotal amount\b/i, score: 120 },
    { pattern: /\bamount due\b/i, score: 110 },
    { pattern: /\bbalance due\b/i, score: 110 },
    { pattern: /\btotal paid\b/i, score: 110 },
    { pattern: /\bamount sent\b/i, score: 100 },
    { pattern: /\btotal\b/i, score: 80 },
];
const getKeywordScore = (text) => {
    let best = 0;
    for (const entry of keywordWeights) {
        if (entry.pattern.test(text)) {
            best = Math.max(best, entry.score);
        }
    }
    return best;
};
const hasKeyword = (text) => getKeywordScore(text) > 0;
const hasCurrency = (text) => currencyRegex.test(text);
const hasDateTime = (line) => dateNumericRegex.test(line) ||
    monthRegex.test(line) ||
    timeRegex.test(line) ||
    dateKeywordRegex.test(line);
/* -----------------------------
   SCORING ENGINE
------------------------------*/
const scoreCandidates = (raw) => {
    const lines = raw.split(/\r?\n/);
    const totalLines = Math.max(lines.length, 1);
    const candidates = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line)
            continue;
        const region = [
            lines[i - 1] ?? "",
            lines[i],
            lines[i + 1] ?? "",
        ].join(" ");
        const keywordScore = getKeywordScore(region);
        const keywordNear = keywordScore > 0;
        const currencyNear = hasCurrency(region);
        const lineHasDateTime = hasDateTime(lines[i]);
        const lineHasIdRef = idRefRegex.test(lines[i]);
        const lineHasAccount = accountRegex.test(lines[i]);
        const lineHasPhone = phoneRegex.test(lines[i]);
        const isLastThird = i >= Math.floor(totalLines * 0.7);
        const matches = lines[i].match(numberRegex) || [];
        for (const match of matches) {
            const digitsOnly = match.replace(/\D/g, "");
            if (!digitsOnly)
                continue;
            const value = Number(match.replace(/,/g, ""));
            if (Number.isNaN(value))
                continue;
            // ignore years
            if (digitsOnly.length === 4 && yearRegex.test(digitsOnly))
                continue;
            // filter noisy lines
            if (lineHasDateTime && !keywordNear && !currencyNear)
                continue;
            if (lineHasPhone && !keywordNear && !currencyNear)
                continue;
            if (digitsOnly.length >= 8 && lineHasIdRef)
                continue;
            if (digitsOnly.length >= 8 && lineHasAccount && !keywordNear)
                continue;
            let score = 0;
            if (keywordScore > 0)
                score += keywordScore;
            if (currencyNear)
                score += 80;
            if (isLastThird)
                score += 50;
            if (lineHasDateTime || lineHasIdRef || lineHasAccount)
                score -= 100;
            if (digitsOnly.length > 6)
                score -= 50;
            if (/\.\d{2}$/.test(match))
                score += 20;
            candidates.push({
                value,
                score,
                line,
                lineIndex: i,
                keywordHit: keywordNear,
            });
        }
    }
    return candidates;
};
/* -----------------------------
   API ROUTE
------------------------------*/
app.post("/api/extract-receipt", upload.single("image"), async (req, res) => {
    let ocrText = "";
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({
                total_amount: null,
                raw_text: "",
                top_candidates: [],
                error: "Image file is required",
            });
        }
        // 🚀 PREPROCESS IMAGE (CRITICAL BOOST)
        const cleanBuffer = await preprocessImage(file.buffer);
        // 🚀 REUSE WORKER (FAST)
        const w = await getWorker();
        const { data: { text }, } = await w.recognize(cleanBuffer);
        ocrText = text ?? "";
        const candidates = scoreCandidates(ocrText);
        const keywordCandidates = candidates.filter((c) => c.keywordHit);
        const selectionPool = keywordCandidates.length > 0
            ? keywordCandidates
            : candidates;
        const sortedSelection = [...selectionPool].sort((a, b) => b.score - a.score || b.value - a.value);
        const sortedAll = [...candidates].sort((a, b) => b.score - a.score || b.value - a.value);
        const total = sortedSelection.length > 0
            ? sortedSelection[0].value
            : null;
        return res.json({
            total_amount: total,
            raw_text: ocrText,
            top_candidates: sortedAll.slice(0, 3),
        });
    }
    catch (err) {
        return res.status(500).json({
            total_amount: null,
            raw_text: ocrText,
            top_candidates: [],
            error: err instanceof Error
                ? err.message
                : String(err),
        });
    }
});
/* -----------------------------
   START SERVER
------------------------------*/
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
