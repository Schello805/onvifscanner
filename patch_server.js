const fs = require("fs");
const path = require("path");

const serverPath = path.join(__dirname, "server.js");
let content = fs.readFileSync(serverPath, "utf-8");

// Add process.env.DATABASE_URL injection at the top
const injection = `
// Force absolute path for Prisma to avoid Next.js bundling path issues
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:" + require("path").join(__dirname, "data", "onvifscanner.db");
}
`;

if (!content.includes("DATABASE_URL")) {
  content = content.replace("const next = require(\"next\");", "const next = require(\"next\");\n" + injection);
  fs.writeFileSync(serverPath, content);
  console.log("Patched server.js");
} else {
  console.log("Already patched");
}
