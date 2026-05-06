import "dotenv/config";
import type { Express, Request, Response } from "express";
import express from "express";
import multer from "multer";

type ExtractResponse = {
	total_amount: number | null;
	error?: string;
};

type GeminiResponse = {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string;
			}>;
		};
	}>;
};

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const GEMINI_URL =
	"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const prompt =
	"Extract the total amount from this receipt image.\n" +
	"Return ONLY valid JSON in this format:\n" +
	'{ "total_amount": number | null }\n' +
	"Use the final amount paid (NOT subtotal, NOT VAT).";

const parseGeminiJson = (text: string): { total_amount: number | null } => {
	const trimmed = text.trim();
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	const candidate =
		start !== -1 && end !== -1 && end > start
			? trimmed.slice(start, end + 1)
			: trimmed;

	try {
		const parsed = JSON.parse(candidate) as {
			total_amount?: number | null;
		};
		if (typeof parsed.total_amount === "number" || parsed.total_amount === null) {
			return { total_amount: parsed.total_amount };
		}
	} catch {
		// Fall through to null result.
	}

	return { total_amount: null };
};

app.post(
	"/api/extract-receipt",
	upload.single("image"),
	async (req: Request, res: Response<ExtractResponse>) => {
		try {
			const apiKey = process.env.GEMINI_API_KEY;
			if (!apiKey) {
				return res
					.status(500)
					.json({ total_amount: null, error: "GEMINI_API_KEY is not set" });
			}

			const file = req.file as Express.Multer.File | undefined;
			if (!file) {
				return res
					.status(400)
					.json({ total_amount: null, error: "Image file is required" });
			}

			const base64 = file.buffer.toString("base64");
			const mimeType = file.mimetype || "image/jpeg";

			const body = {
				contents: [
					{
						role: "user",
						parts: [
							{ text: prompt },
							{ inlineData: { data: base64, mimeType } },
						],
					},
				],
			};

			const geminiResponse = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (!geminiResponse.ok) {
				const errorText = await geminiResponse.text().catch(() => "");
				return res.status(500).json({
					total_amount: null,
					error: `Gemini API error: ${geminiResponse.status} ${geminiResponse.statusText}${
						errorText ? ` - ${errorText}` : ""
					}`,
				});
			}

			const data = (await geminiResponse.json()) as GeminiResponse;
			const text =
				data?.candidates?.[0]?.content?.parts
					?.map((part) => part.text ?? "")
					.join("")
					.trim() ?? "";

			return res.json(parseGeminiJson(text));
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			return res.status(500).json({ total_amount: null, error: message });
		}
	}
);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
	console.log(`Server listening on port ${port}`);
});
