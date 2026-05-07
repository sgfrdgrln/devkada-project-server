Refactor this Express + Tesseract.js receipt OCR endpoint into a SMART receipt parser.

CURRENT ISSUE:
The system incorrectly selects random numbers (dates, IDs, timestamps) as the total amount because it uses Math.max() and weak keyword matching.

GOAL:
Build a robust receipt extraction algorithm that correctly identifies the TOTAL AMOUNT from noisy OCR text.

REQUIREMENTS:

1. REMOVE unsafe fallback:
   - Do NOT use Math.max(...allNumbers) as final decision

2. ADD NOISE FILTERING:
   - Remove or ignore:
     - dates (e.g. May 7, 2026, 07/05/2026)
     - years (4-digit numbers like 2026)
     - timestamps (HH:MM)
     - transaction IDs (long numeric strings)
     - reference/order numbers

3. IMPROVE KEYWORD DETECTION:
   Match more variations of TOTAL such as:
   - total
   - grand total
   - amount due
   - amount sent
   - total amount
   - total paid
   - balance due
   - ₱ / php / peso context

4. IMPLEMENT SCORING SYSTEM:
   Instead of max(), assign scores to each candidate number:
   - +100 if near "total" keyword
   - +80 if near currency symbol (₱, $, php)
   - +50 if in last 30% of receipt text
   - -100 if line contains date/time/id/ref/order
   - -50 if number is part of long digit string (>6 digits)

5. SELECT HIGHEST SCORE candidate as total_amount

6. FALLBACK RULE:
   Only if no keyword matches:
   - pick highest scored number (NOT highest value)

7. RETURN DEBUG INFO:
   - total_amount
   - raw_text
   - top 3 candidates with scores (for debugging)

8. KEEP:
   - Express route structure
   - multer upload
   - tesseract.js OCR flow

9. OUTPUT CLEAN CODE ONLY (no explanation)

GOAL RESULT:
The system should correctly extract values like "P100" from GCash receipts and ignore unrelated numbers like dates, IDs, or reference numbers.