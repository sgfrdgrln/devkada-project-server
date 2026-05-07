import "dotenv/config";
import type { Request, Response } from "express";
import express = require("express");
import multer = require("multer");
import { createWorker } from "tesseract.js";

type ExtractResponse = {
	total_amount: number | null;
	raw_text: string;
	top_candidates: Array<{ value: number; score: number; line: string }>;
	error?: string;
};

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

type Candidate = {
	value: number;
	score: number;
	line: string;
	lineIndex: number;
	keywordHit: boolean;
};

const numberRegex = /-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/g;
const yearRegex = /\b(19|20)\d{2}\b/;
const dateNumericRegex = /\b\d{1,2}[\/\-\.]\d{1,2}(?:[\/\-\.]\d{2,4})?\b/;
const monthRegex = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i;
const timeRegex = /\b\d{1,2}:\d{2}(?::\d{2})?\b/;
const dateKeywordRegex = /\b(date|time)\b/i;
const idRefRegex = /\b(id|ref|reference|order|transaction|trans|trx|tnx|rrn|stan|approval|auth|invoice|inv|terminal|serial|trace)\b/i;
const phoneRegex = /\+?\d[\d\s-]{9,}/;
const currencyRegex = /(\$|\u20B1|\bphp\b|\bpeso(?:s)?\b|\bP\s*\d)/i;
const keywordPatterns = [
	/\btotal amount sent\b/i,
	/\btotal\b/i,
	/\bgrand total\b/i,
	/\bamount due\b/i,
	/\bamount sent\b/i,
	/\btotal amount\b/i,
	/\btotal paid\b/i,
	/\bbalance due\b/i,
];

const hasKeyword = (text: string): boolean =>
	keywordPatterns.some((pattern) => pattern.test(text));

const hasCurrency = (text: string): boolean => currencyRegex.test(text);

const hasDateTime = (line: string): boolean =>
	dateNumericRegex.test(line) ||
	monthRegex.test(line) ||
	timeRegex.test(line) ||
	dateKeywordRegex.test(line);

const scoreCandidates = (raw: string): Candidate[] => {
	const lines = raw.split(/\r?\n/);
	const totalLines = Math.max(lines.length, 1);
	const candidates: Candidate[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		const region = [lines[i - 1] ?? "", lines[i], lines[i + 1] ?? ""].join(
			" "
		);
		const keywordNear = hasKeyword(region);
		const currencyNear = hasCurrency(region);
		const lineHasDateTime = hasDateTime(lines[i]);
		const lineHasIdRef = idRefRegex.test(lines[i]);
		const lineHasPhone = phoneRegex.test(lines[i]);
		const isLastThird = i >= Math.floor(totalLines * 0.7);

		const matches = lines[i].match(numberRegex) || [];

		for (const match of matches) {
			const digitsOnly = match.replace(/\D/g, "");
			if (!digitsOnly) continue;

			const value = Number(match.replace(/,/g, ""));
			if (Number.isNaN(value)) continue;

			const isYear = digitsOnly.length === 4 && yearRegex.test(digitsOnly);
			if (isYear) continue;

			if (lineHasDateTime && !keywordNear && !currencyNear) continue;
			if (lineHasPhone && !keywordNear && !currencyNear) continue;

			if (digitsOnly.length >= 8 && lineHasIdRef) continue;

			let score = 0;
			if (keywordNear) score += 100;
			if (currencyNear) score += 80;
			if (isLastThird) score += 50;
			if (lineHasDateTime || lineHasIdRef) score -= 100;
			if (digitsOnly.length > 6) score -= 50;
			if (/\.\d{2}$/.test(match)) score += 20;

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

app.post(
	"/api/extract-receipt",
	upload.single("image"),
	async (req: Request, res: Response<ExtractResponse>) => {
		let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
		let ocrText = "";

		try {
			const file = req.file as Express.Multer.File | undefined;

			if (!file) {
				return res.status(400).json({
					total_amount: null,
					raw_text: "",
					top_candidates: [],
					error: "Image file is required",
				});
			}

			worker = await createWorker({
				logger: () => {},
			});

			await worker.loadLanguage("eng");
			await worker.initialize("eng");

			const {
				data: { text },
			} = await worker.recognize(file.buffer);

			ocrText = text ?? "";

			const candidates = scoreCandidates(ocrText);
			const keywordCandidates = candidates.filter((c) => c.keywordHit);
			const selectionPool = keywordCandidates.length > 0 ? keywordCandidates : candidates;

			const sortedSelection = [...selectionPool].sort(
				(a, b) => b.score - a.score || b.value - a.value
			);

			const sortedAll = [...candidates].sort(
				(a, b) => b.score - a.score || b.value - a.value
			);

			const total = sortedSelection.length > 0 ? sortedSelection[0].value : null;
			const topCandidates = sortedAll.slice(0, 3).map((c) => ({
				value: c.value,
				score: c.score,
				line: c.line,
			}));

			return res.json({
				total_amount: total,
				raw_text: ocrText,
				top_candidates: topCandidates,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);

			return res.status(500).json({
				total_amount: null,
				raw_text: ocrText,
				top_candidates: [],
				error: message,
			});
		} finally {
			if (worker) {
				try {
					await worker.terminate();
				} catch {
					// ignore termination errors
				}
			}
		}
	}
);

const port = Number(process.env.PORT) || 3000;

app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});