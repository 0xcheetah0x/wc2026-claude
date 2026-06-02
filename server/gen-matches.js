const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "wc2026_tahmin.html"), "utf8");
const start = html.indexOf("const MATCHES=[");
const sub = html.slice(start);
const end = sub.indexOf("];");
const arr = sub.slice("const MATCHES=[".length, end);
const rows = [];
const re = /\{id:(\d+),grp:'[^']*',h:'([^']*)',a:'([^']*)',utc:'([^']*)'/g;
let m;
while ((m = re.exec(arr))) {
  rows.push({ id: +m[1], h: m[2], a: m[3], utc: m[4] });
}
fs.writeFileSync(path.join(__dirname, "matches.json"), JSON.stringify(rows));
console.log("wrote", rows.length, "matches");
