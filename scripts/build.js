const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

function serviceActive(directory) {
  try {
    execFileSync('systemctl', ['is-active', '--quiet', 'onvifscanner.service'], { stdio: 'ignore' });
    const workingDirectory = execFileSync('systemctl', ['show', '-p', 'WorkingDirectory', '--value', 'onvifscanner.service'], { encoding: 'utf8' }).trim();
    return fs.realpathSync(workingDirectory) === fs.realpathSync(directory);
  } catch {
    return false;
  }
}

function runNext(directory) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], { cwd: directory, stdio: 'inherit' });
    const interrupt = signal => child.kill(signal);
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    const cleanup = () => {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
    };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', code => { cleanup(); resolve(code ?? 1); });
  });
}

async function build({ directory = process.cwd(), isServiceActive = serviceActive, run = runNext } = {}) {
  const dist = path.resolve(directory, process.env.NEXT_DIST_DIR || '.next');
  if (dist === path.resolve(directory) || !dist.startsWith(`${path.resolve(directory)}${path.sep}`)) {
    throw new Error('NEXT_DIST_DIR muss ein Unterverzeichnis des Projekts sein.');
  }
  if (isServiceActive(directory)) {
    throw new Error('Build abgebrochen: onvifscanner.service läuft noch. Zuerst systemctl stop onvifscanner ausführen; Aufnahme pausiert während des Builds.');
  }
  const lock = `${dist}.build-lock`;
  const backup = `${dist}-build-backup`;
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    let alive = Number.isInteger(pid) && pid > 0;
    if (alive) {
      try { process.kill(pid, 0); } catch (error) { alive = error.code !== 'ESRCH'; }
    }
    if (alive) throw new Error(`Ein Build läuft bereits (PID ${pid}).`);
    fs.rmSync(lock);
  }
  const descriptor = fs.openSync(lock, 'wx');
  fs.writeFileSync(descriptor, String(process.pid));
  fs.closeSync(descriptor);
  let backedUp = false;
  let buildStarted = false;
  try {
    const hasBuild = folder => fs.existsSync(path.join(folder, 'BUILD_ID'));
    if (!hasBuild(dist) && hasBuild(backup)) {
      fs.rmSync(dist, { recursive: true, force: true });
      fs.renameSync(backup, dist);
    }
    if (hasBuild(dist)) {
      fs.rmSync(backup, { recursive: true, force: true });
      fs.renameSync(dist, backup);
      backedUp = true;
    } else {
      fs.rmSync(dist, { recursive: true, force: true });
    }
    buildStarted = true;
    const code = await run(directory);
    if (code !== 0 || !hasBuild(dist)) throw new Error(`Next.js Build fehlgeschlagen (Status ${code}); kein neuer Produktionsbuild veröffentlicht.`);
    if (backedUp) fs.rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (buildStarted) fs.rmSync(dist, { recursive: true, force: true });
    if (backedUp) {
      fs.renameSync(backup, dist);
      console.error('Vorheriger Produktionsbuild wiederhergestellt. Dienst bleibt gestoppt; Code/Abhängigkeiten vor einem Neustart prüfen.');
    }
    throw error;
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

if (require.main === module) {
  build().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { build };
