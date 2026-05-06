// I am building a Node.js + TypeScript Express API server.
// This endpoint will receive a receipt image from a React Native Expo app (multipart/form-data).
//
// REQUIREMENTS:
//
// 1. Create an Express POST route: /api/extract-receipt
//
// 2. It receives:
//    - field name: "image" (multer file upload)
//
// 3. Convert uploaded image to base64
//
// 4. Call Google Gemini API (generative language API):
//    - model: gemini-1.5-flash
//    - API key from process.env.GEMINI_API_KEY
//
// 5. Prompt Gemini:
//    "Extract the total amount from this receipt image.
//     Return ONLY valid JSON in this format:
//     { \"total_amount\": number | null }
//     Use the final amount paid (NOT subtotal, NOT VAT)."
//
// 6. Send image using inlineData (base64) in Gemini request
//
// 7. Parse Gemini response safely:
//    - Extract text output
//    - JSON.parse it
//    - fallback to { total_amount: null } if parsing fails
//
// 8. Return JSON response to client:
//
//    {
//      total_amount: number | null
//    }
//
// 9. Handle errors properly:
//    - return 500 with { total_amount: null, error: string }
//
// 10. Use TypeScript types for request, response, and multer file
//
// 11. Keep code clean and production-ready (no pseudo code)