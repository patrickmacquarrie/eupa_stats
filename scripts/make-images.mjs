// Draws the app icons and the link-preview card from the EUPA artwork: `node scripts/make-images.mjs`.
// The PNGs are committed (public/); run this again only after changing the artwork or colours.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";

const ART = (bg, ground = "#11351b") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${bg}"/>
  <clipPath id="in"><rect x="46" y="46" width="420" height="420" rx="62"/></clipPath>
  <g clip-path="url(#in)"><path d="M40 330 L472 170 L472 476 L40 476 Z" fill="${ground}"/></g>
  <ellipse cx="256" cy="230" rx="170" ry="70" transform="rotate(-20 256 230)" fill="#fff"/>
  <ellipse cx="270" cy="222" rx="118" ry="38" transform="rotate(-20 270 222)" fill="#498b37"/>
  <rect x="36" y="36" width="440" height="440" rx="72" fill="none" stroke="#fff" stroke-width="20"/></svg>`;
const font = readFileSync("src/assets/fonts/oswald-latin.woff2").toString("base64");
const css = `@font-face { font-family: Oswald; font-weight: 500 700; src: url(data:font/woff2;base64,${font}) format("woff2"); }
  html, body { margin: 0; } body { font-family: Oswald, sans-serif; }`;

const b = await chromium.launch();
const shot = async (file, w, h, html) => {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.setContent(`<!doctype html><style>${css}</style>${html}`);
  await p.evaluate(() => document.fonts.ready);
  writeFileSync(file, await p.screenshot({ type: "png", omitBackground: false }));
  await p.close();
};
const icon = (bg, ground, size, inset = 0) =>
  `<div style="width:${size}px;height:${size}px;background:${bg};display:grid;place-items:center">
    <div style="width:${size - 2 * inset}px;height:${size - 2 * inset}px">${ART(bg, ground).replace("<svg ", '<svg width="100%" height="100%" ')}</div></div>`;

// Full-bleed squares: phones round the corners themselves. "Maskable" keeps the art inside the
// safe circle Android crops to. Stats entry gets the darkest green so the two installs differ.
for (const [name, bg, ground] of [["icon", "#346d25", "#11351b"], ["icon-entry", "#11351b", "#346d25"]]) {
  await shot(`public/${name}-180.png`, 180, 180, icon(bg, ground, 180));
  await shot(`public/${name}-192.png`, 192, 192, icon(bg, ground, 192));
  await shot(`public/${name}-512.png`, 512, 512, icon(bg, ground, 512));
  await shot(`public/${name}-maskable-512.png`, 512, 512, icon(bg, ground, 512, 56));
}

// The card a link shows in chats and on social media (1200×630).
await shot("public/og-card.png", 1200, 630, `
  <div style="width:1200px;height:630px;background:#346d25;color:#fff;display:flex;flex-direction:column;justify-content:center;
    padding:0 90px;box-sizing:border-box;border-top:14px solid #498b37;border-bottom:22px solid #27521b;position:relative;overflow:hidden">
    <div style="position:absolute;right:80px;top:115px;width:380px;height:380px">${ART("#346d25").replace("<svg ", '<svg width="100%" height="100%" ')}</div>
    <div style="display:inline-flex;align-self:flex-start;background:#11351b;border:4px solid #fff;border-radius:12px;padding:6px 16px 4px;
      font-weight:700;font-size:54px;letter-spacing:.04em">EUPA</div>
    <div style="font-weight:600;font-size:112px;line-height:1.02;margin-top:26px">Player stats</div>
    <div style="font-family:system-ui,sans-serif;font-size:34px;line-height:1.35;margin-top:22px;max-width:660px;color:#e3eedd">
      Standings, leaderboards and every player's season in the Edmonton Ultimate Players Association.</div>
  </div>`);
await b.close();
console.log("Wrote the icons and og-card.png to public/.");
