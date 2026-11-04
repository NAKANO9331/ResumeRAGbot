import { readFile, mkdir, writeFile } from 'node:fs/promises';
const order = ['Config', 'StarterResume', 'PortfolioStore', 'QuickTopics', 'Knowledge', 'Images', 'Portfolio', 'Conversation', 'Gemini', 'Feedback', 'Line', 'OwnerLine', 'Contact', 'Booking', 'JobMatch', 'Chat', 'Review', 'ReviewUi', 'Webhook', 'Admin'];
const pieces = await Promise.all(order.map(async name => `// ===== ${name}.gs =====\n` + await readFile(new URL(`../gas/${name}.gs`, import.meta.url), 'utf8')));
const bundled = '// ResumeRAGbot — generated with npm run bundle\n\n' + pieces.join('\n\n');
const target = new URL('../dist/Code.gs', import.meta.url);
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== bundled) throw new Error('dist/Code.gs is stale. Run npm run bundle.');
  console.log('Single-file installer matches gas/ sources.');
} else {
  await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
  await writeFile(target, bundled);
  console.log('Created dist/Code.gs for single-file copy/paste installation.');
}
