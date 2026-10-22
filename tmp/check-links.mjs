import fs from 'fs';
const p = process.cwd();

// Build set of existing files
const existing = new Set();
function walk(dir, base) {
  try {
    fs.readdirSync(dir).forEach(f => {
      const full = dir + '/' + f;
      if (fs.statSync(full).isDirectory()) {
        walk(full, base + '/' + f);
      } else {
        existing.add(base + '/' + f.replace(p + '/', ''));
      }
    });
  } catch (e) {}
}
walk(p, '');

// Check links from docs
const docs = [
  'docs/ai-context.md', 'docs/architecture.md', 'docs/cli-reference.md',
  'docs/configure.md', 'docs/corpus-licenses.md', 'docs/current-state.md',
  'docs/decision-dictionary.md', 'docs/embeddings.md', 'docs/faq.md',
  'docs/getting-started.md', 'docs/implementation-plan.md', 'docs/install.md',
  'docs/manager-playbook.md', 'docs/problems.md', 'docs/skill-authoring.md',
  'docs/sync.md', 'docs/troubleshooting.md', 'docs/tuning.md',
  'docs/zcode-e2e-test.md', 'docs/zcode-skill-visibility.md', 'README.md'
];

let broken = 0;
docs.forEach(f => {
  try {
    const c = fs.readFileSync(p + '/' + f, 'utf8');
    const lines = c.split('\n');
    // Get the directory of the current doc for relative path resolution
    const docDir = f.substring(0, f.lastIndexOf('/'));
    lines.forEach((line, i) => {
      const matches = line.match(/\[([^\]]+)\]\(([^)\s]+)\)/g);
      if (!matches) return;
      matches.forEach(m => {
        const href = m.match(/\(([^)]+)\)/)[1];
        if (href.startsWith('http') || href.startsWith('#')) return;
        let target = href;
        if (target.startsWith('./')) {
          target = target.slice(2);
        } else if (target.startsWith('../')) {
          const depth = (target.match(/\.\.\//g) || []).length;
          const rel = target.split('/').slice(depth).join('/');
          target = rel;
        }
        // Normalize path separators
        target = target.replace(/\\/g, '/');
        // Resolve relative to the doc's directory
        let resolved;
        if (target.startsWith('/')) {
          resolved = p + target;
        } else {
          resolved = p + '/' + docDir + '/' + target;
        }
        if (!fs.existsSync(resolved)) {
          broken++;
          console.log(f + ':' + (i + 1) + ' BROKEN: ' + href + ' -> ' + target + ' (resolved: ' + resolved.replace(p + '/', '') + ')');
        }
      });
    });
  } catch (e) {}
});

if (broken === 0) {
  console.log('All internal links resolve.');
} else {
  console.log('Found ' + broken + ' broken links.');
}
