import fs from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

async function read(relativePath: string): Promise<string> {
  return fs.readFile(path.join(repoRoot, relativePath), 'utf8');
}

describe('website landing page contracts', () => {
  it('mounts the mobile navigation inside the main navbar', async () => {
    const navBarSource = await read('website/src/components/NavBar.jsx');

    expect(navBarSource).toContain("import MobileNav from './MobileNav.jsx';");
    expect(navBarSource).toContain('<MobileNav />');
  });

  it('keeps navigation anchors aligned with rendered section ids', async () => {
    const mobileNavSource = await read('website/src/components/MobileNav.jsx');
    const quickStartSource = await read('website/src/components/QuickStart.jsx');
    const toolGridSource = await read('website/src/components/ToolGrid.jsx');
    const comparisonSource = await read('website/src/components/ComparisonTable.jsx');
    const techStackSource = await read('website/src/components/TechStackGrid.jsx');
    const pageSource = await read('website/src/pages/index.astro');

    expect(mobileNavSource).toContain("{ href: '#quickstart', label: 'Quick Start'");
    expect(quickStartSource).toContain('<section id="quickstart"');
    expect(toolGridSource).toContain('id="tools"');
    expect(comparisonSource).toContain('id="comparison"');
    expect(techStackSource).toContain('id="tech-stack"');
    expect(pageSource).toContain('id="architecture"');
  });

  it('surfaces distinct hosted and self-hosted CTA paths on the landing page', async () => {
    const pageSource = await read('website/src/pages/index.astro');

    expect(pageSource).toContain('Get Sage Free');
    expect(pageSource).toContain('Self-Host Guide');
    expect(pageSource).toContain("href=\"#quickstart\"");
    expect(pageSource).toContain('docs/guides/GETTING_STARTED.md');
  });

  it('scopes mobile tool expansion state per subsystem instead of using one global toggle', async () => {
    const toolGridSource = await read('website/src/components/ToolGrid.jsx');

    expect(toolGridSource).toContain("const [expandedMobileCategories, setExpandedMobileCategories] = useState([]);");
    expect(toolGridSource).toContain('const isMobileExpanded = expandedMobileCategories.includes(cat.key);');
    expect(toolGridSource).not.toContain('const [showAllMobileTools, setShowAllMobileTools] = useState(false);');
  });
});
