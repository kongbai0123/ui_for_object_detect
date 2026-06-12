/**
 * Vision Training Studio - DOM Contract Smoke Test
 * 
 * 靜態檢查 index.html 中的 ID 定義，與 js/*.js 中呼叫的 DOM IDs 是否一致。
 * 可作為 Commit 前或 CI 流程的自動化測試腳本。
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(projectRoot, 'index.html');
const jsDir = path.join(projectRoot, 'js');

console.log("=== 🚀 Starting DOM Contract Smoke Test ===");
console.log(`HTML Path: ${htmlPath}`);
console.log(`JS Directory: ${jsDir}\n`);

// 1. 讀取並解析 index.html 中定義的所有 IDs
if (!fs.existsSync(htmlPath)) {
    console.error(`[ERROR] index.html not found at ${htmlPath}`);
    process.exit(1);
}

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const idDefRegex = /\bid=["']([^"']+)["']/g;
const definedIds = new Set();
let match;

while ((match = idDefRegex.exec(htmlContent)) !== null) {
    definedIds.add(match[1]);
}

console.log(`Defined DOM IDs in index.html: ${definedIds.size}`);

// 2. 核心必要 IDs 與 可選 IDs (來自 validateDomContract)
const contractRequired = new Set([
    "home-view",
    "database-view",
    "annotation-view",
    "distribution-view",
    "training-workflow-view",
    "active-project-badge",
    "label-canvas",
    "canvas-container-div"
]);

// 3. 讀取 js/ 下的所有 JS 檔案，掃描呼叫的 DOM IDs
if (!fs.existsSync(jsDir)) {
    console.error(`[ERROR] JS directory not found at ${jsDir}`);
    process.exit(1);
}

const jsFiles = fs.readdirSync(jsDir)
    .filter(file => file.endsWith('.js') && !file.endsWith('.bak'));

const queriedIds = new Map(); // id -> Set of fileNames

// 用於提取 JS 中呼叫 ID 的正則表達式
const patterns = [
    // 匹配 document.getElementById("xxx")
    /document\.getElementById\(\s*["']([^"']+)["']\s*\)/g,
    // 匹配 this.on("xxx", ...), this.text("xxx", ...), this.value("xxx", ...) 等安全 Helpers
    /this\.(?:on|text|html|value|show|hide|activateModal|closeModal)\(\s*["']([^"']+)["']\s*/g
];

jsFiles.forEach(file => {
    const filePath = path.join(jsDir, file);
    const content = fs.readFileSync(filePath, 'utf8');
    
    patterns.forEach(regex => {
        // 重設 regex index
        regex.lastIndex = 0;
        let jsMatch;
        while ((jsMatch = regex.exec(content)) !== null) {
            const id = jsMatch[1];
            // 排除動態產生的或者是 required 陣列本身的字串，只比對明確的常數 ID
            if (id.includes('${') || id.includes('+')) continue;
            
            if (!queriedIds.has(id)) {
                queriedIds.set(id, new Set());
            }
            queriedIds.get(id).add(file);
        }
    });
});

console.log(`Queried DOM IDs in JavaScript files: ${queriedIds.size}`);

// 4. 比對差異並分析缺失 IDs
const missingRequired = [];
const missingOptional = [];

for (const [id, files] of queriedIds.entries()) {
    if (!definedIds.has(id)) {
        const fileList = Array.from(files).join(', ');
        if (contractRequired.has(id)) {
            missingRequired.push({ id, files: fileList });
        } else {
            missingOptional.push({ id, files: fileList });
        }
    }
}

// 5. 輸出報告與程序狀態
let exitCode = 0;

if (missingRequired.length > 0) {
    console.error("\n❌ [CRITICAL ERROR] 缺少核心必要 DOM 元素：");
    missingRequired.forEach(item => {
        console.error(`   - #${item.id} (used in: ${item.files})`);
    });
    exitCode = 1;
}

if (missingOptional.length > 0) {
    console.warn("\n⚠️ [WARNING] 缺少部分可選/輔助 DOM 元素 (不影響初始化，但對應功能可能未掛載)：");
    missingOptional.forEach(item => {
        console.warn(`   - #${item.id} (used in: ${item.files})`);
    });
}

if (exitCode === 0) {
    console.log("\n✅ [SUCCESS] DOM Contract Smoke Test Passed! All required DOM elements are present.");
} else {
    console.error("\n❌ [FAIL] DOM Contract Test Failed. Please fix missing required elements.");
}

process.exit(exitCode);
