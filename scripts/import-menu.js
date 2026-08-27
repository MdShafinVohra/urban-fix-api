// scripts/import-menu.js
import xlsx from 'xlsx';
import fs from 'fs';
import path from 'path';

// ---- Usage: node scripts/import-menu.js <restaurant_id> <path-to-excel-file> ----
const RESTAURANT_ID = process.argv[2];
const EXCEL_FILE = process.argv[3];

// ⚠️ ADJUST these per file if a restaurant's sheet uses different headers
const ITEM_COLUMN = 'FOOD ITEMS';
const PRICE_COLUMN = 'FULL';

// Rough heuristic only — always spot-check after import (see note below)
const NONVEG_KEYWORDS = [
    'chicken', 'mutton', 'fish', 'egg', 'prawn', 'meat',
    'keema', 'lamb', 'beef', 'pork', 'crab', 'squid'
];

if (!RESTAURANT_ID || !EXCEL_FILE) {
    console.error('Usage: node scripts/import-menu.js <restaurant_id> <path-to-excel-file>');
    process.exit(1);
}

function escapeSql(value) {
    if (value === null || value === undefined || value === '') return 'NULL';
    return `'${String(value).replace(/'/g, "''")}'`;
}

function parsePrice(raw) {
    if (raw === undefined || raw === null || raw === '') return null;
    const num = parseFloat(String(raw).replace(/[^\d.]/g, ''));
    return isNaN(num) ? null : num;
}

function guessIsVeg(itemName) {
    const lower = itemName.toLowerCase();
    return NONVEG_KEYWORDS.some((kw) => lower.includes(kw)) ? 0 : 1;
}

function main() {
    const workbook = xlsx.readFile(EXCEL_FILE);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    const statements = [];
    const skipped = [];

    rows.forEach((row, index) => {
        const itemName = String(row[ITEM_COLUMN] ?? '').trim();
        const price = parsePrice(row[PRICE_COLUMN]);

        if (!itemName || price === null) {
            skipped.push({ row: index + 2, itemName, rawPrice: row[PRICE_COLUMN] });
            return;
        }

        const isVeg = guessIsVeg(itemName);

        statements.push(
            `INSERT INTO restaurant_menus (restaurant_id, name, price, is_veg) VALUES (${RESTAURANT_ID}, ${escapeSql(itemName)}, ${price}, ${isVeg});`
        );
    });

    fs.mkdirSync('./seed-output', { recursive: true });
    const outputPath = path.join('./seed-output', `menu-import-${RESTAURANT_ID}.sql`);
    fs.writeFileSync(outputPath, statements.join('\n'));

    console.log(`✅ Generated ${statements.length} INSERT statements → ${outputPath}`);
    if (skipped.length) {
        console.log(`⚠️  Skipped ${skipped.length} row(s) missing item name or price:`);
        skipped.forEach((s) => console.log(`   Row ${s.row}: name="${s.itemName}" price="${s.rawPrice}"`));
    }
}

main();