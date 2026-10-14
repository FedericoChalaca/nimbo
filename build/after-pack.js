// Después de empaquetar: en macOS se firma la app con una firma "ad hoc" (sin certificado ni cuenta de Apple).
// Sin esa firma, en los Mac con chip Apple (M1 y posteriores) el sistema dice que la app está "dañada" y no la deja
// abrir; con ella solo avisa de que es de un desarrollador no identificado (clic derecho → Abrir, la primera vez).
// No sustituye a la firma de Apple: es lo más simple que hace que funcione.
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  console.log(`  • firma ad hoc aplicada a ${path.basename(app)}`);
};
