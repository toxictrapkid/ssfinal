// Render ledger_report.html -> ledger_report.pdf using the pre-installed Chromium
// via puppeteer-core. Uses Chrome's native header/footer so page numbers sit in the
// page margin and never overlap report content.
const puppeteer = require('puppeteer-core');
const path = require('path');

const HTML = path.join(__dirname, 'ledger_report.html');
const OUT = path.join(__dirname, 'ledger_report.pdf');
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';

const footer = `
  <div style="width:100%; font-family:Arial, sans-serif; font-size:7.5pt;
       color:#5b6b7f; padding:0 0.65in; display:flex; justify-content:space-between;
       align-items:center;">
    <span>Mo / Z Partnership Ledger Report</span>
    <span>Positive = Z owes Mo &nbsp;|&nbsp; Negative = Mo owes Z</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.goto('file://' + HTML, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: OUT,
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,       // honor the @page size/margins in the CSS
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footer,
    });
    console.log('OK  wrote', OUT);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
