import * as fs from 'fs/promises';
import * as path from 'path';

const OUTPUT_DIR = path.resolve(process.cwd(), 'output');

export async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

export function getOutputPath(sessionName: string, ext: 'md' | 'pdf') {
  return path.join(OUTPUT_DIR, `${sessionName}.${ext}`);
}

export async function saveMarkdown(
  sessionName: string,
  markdown: string,
): Promise<string> {
  await ensureOutputDir();
  const filePath = getOutputPath(sessionName, 'md');
  await fs.writeFile(filePath, markdown, 'utf-8');
  return filePath;
}

export async function generatePdf(
  sessionName: string,
  markdown: string,
): Promise<string> {
  await ensureOutputDir();
  const filePath = getOutputPath(sessionName, 'pdf');

  // Dynamic import for md-to-pdf (ESM module)
  const { mdToPdf } = await import('md-to-pdf');
  const result = await mdToPdf(
    { content: markdown },
    {
      dest: filePath,
      launch_options: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
      pdf_options: {
        format: 'A4',
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      },
    },
  );

  if (result?.content) {
    await fs.writeFile(filePath, result.content);
  }

  return filePath;
}
