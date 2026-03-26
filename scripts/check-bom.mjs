import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname } from 'path';

const CHECK_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.json', '.css', '.md', '.sql', '.yml', '.yaml'];
let foundBOMs = false;

function checkAndRemoveBOM(dir, depth = 0) {
  if (depth > 10) return; // Prevent infinite recursion
  
  const items = readdirSync(dir);
  
  for (const item of items) {
    if (item === 'node_modules' || item === '.git' || item === '.next') continue;
    
    const path = join(dir, item);
    const stat = statSync(path);
    
    if (stat.isDirectory()) {
      checkAndRemoveBOM(path, depth + 1);
    } else if (CHECK_EXTENSIONS.includes(extname(path))) {
      const buffer = readFileSync(path);
      
      // Check for UTF-8 BOM (0xEF 0xBB 0xBF)
      if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        console.log(`❌ BOM found in: ${path}`);
        const content = buffer.slice(3).toString('utf8');
        writeFileSync(path, content, { encoding: 'utf8' });
        console.log(`   ✅ Removed BOM`);
        foundBOMs = true;
      }
    }
  }
}

console.log('🔍 Checking for BOM markers...\n');
checkAndRemoveBOM('.');

if (foundBOMs) {
  console.log('\n⚠️  BOMs were found and removed. Please re-stage the files.');
  process.exit(1);
} else {
  console.log('✅ No BOM markers found. Safe to commit.');
  process.exit(0);
}
