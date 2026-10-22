const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const esbuild = require('esbuild');
const { chromium } = require('playwright');

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'onvif-browser-'));
  const oldCache = process.env.PLAYBACK_CACHE_DIR;
  process.env.PLAYBACK_CACHE_DIR = path.join(directory, 'cache');
  let browser;
  let server;
  try {
    const source = path.join(directory, 'source.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=20', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '24', '-c:v', 'libx264', '-threads', '1', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0', '-c:a', 'aac', '-movflags', '+faststart', source]);
    const sourceBytes = await fs.readFile(source);
    const modulePath = path.resolve('src/lib/recordingHls.ts');
    const loaded = new Module(modulePath, module);
    loaded.filename = modulePath;
    loaded.paths = module.paths;
    loaded._compile(ts.transpileModule(await fs.readFile(modulePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, modulePath);
    const hls = loaded.exports;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const makeClip = (id, cameraId, seconds) => ({ id, cameraId, cameraName: cameraId, filename: `${id}.mp4`, dateStr: date, timeStr: `12:00:${String(seconds).padStart(2, '0')}`, timestamp: `${date}T10:00:${String(seconds).padStart(2, '0')}.245Z`, durationSeconds: 24, sizeBytes: sourceBytes.length, storageTargetName: 'test', streamUrl: `/direct?clipId=${id}`, downloadUrl: `/direct?clipId=${id}` });
    const clips = [makeClip('next', 'camera', 24), makeClip('other', 'other-camera', 12), makeClip('first', 'camera', 0)];
    const cameras = [{ id: 'camera', name: 'camera', ip: '127.0.0.1', recordSegmentMinutes: 1 }, { id: 'other-camera', name: 'other-camera', ip: '127.0.0.2' }];
    const bundle = await esbuild.build({
      stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
        import React,{useEffect} from 'react';
        import {createRoot} from 'react-dom/client';
        import {ToastProvider} from './src/components/ToastProvider';
        import {LanguageProvider} from './src/components/LanguageProvider';
        import {ClipPlayer} from './src/components/playback/ClipPlayer';
        import {usePlaybackPage} from './src/components/playback/usePlaybackPage';
        function App(){const pb=usePlaybackPage();useEffect(()=>{window.pb=pb});return <ClipPlayer pb={pb}/>}
        createRoot(document.getElementById('app')).render(<LanguageProvider><ToastProvider><App/></ToastProvider></LanguageProvider>);
      ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    });
    let breakManifests = false;
    let directRequests = 0;
    server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/bundle.js') {
          response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles[0].contents); return;
        }
        if (url.pathname === '/api/nvr/recordings/hls') {
          if (breakManifests === true || (breakManifests === 'next' && url.searchParams.get('clipId') === 'next')) { response.statusCode = 500; response.end('simulated HLS failure'); return; }
          const segment = url.searchParams.get('segment');
          if (segment !== null) {
            const file = await hls.recordingSegment(source, Number(segment));
            response.setHeader('Content-Type', 'video/mp2t');
            response.setHeader('Cache-Control', 'public, max-age=3600');
            response.end(await fs.readFile(file));
          } else {
            const profile = await hls.recordingProfile(source);
            response.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            response.end(hls.recordingManifest(url.searchParams.get('clipId'), profile.duration, profile.boundaries));
          }
          return;
        }
        if (url.pathname === '/direct') {
          directRequests += 1;
          const match = /bytes=(\d+)-(\d*)/.exec(request.headers.range || '');
          const start = match ? Number(match[1]) : 0;
          const end = match?.[2] ? Math.min(sourceBytes.length - 1, Number(match[2])) : sourceBytes.length - 1;
          response.setHeader('Content-Type', 'video/mp4'); response.setHeader('Accept-Ranges', 'bytes');
          if (match) { response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${sourceBytes.length}`); }
          response.setHeader('Content-Length', end - start + 1); response.end(sourceBytes.subarray(start, end + 1)); return;
        }
        if (url.pathname.startsWith('/api/')) {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(url.pathname.endsWith('/cameras') ? { cameras }
            : url.pathname.endsWith('/recordings') ? { clips, days: [] }
            : url.pathname.endsWith('/events') ? { events: [] } : { ok: false })); return;
        }
        response.setHeader('Content-Type', 'text/html'); response.end('<div id="app"></div><script src="/bundle.js"></script>');
      } catch (error) { response.statusCode = 500; response.end(String(error)); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ timezoneId: 'Europe/Berlin', locale: 'de-DE' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(String(error)); console.error(error); });
    await page.addInitScript(() => {
      window.process = { env: { NODE_ENV: 'production' } };
      window.played = []; window.ended = [];
      document.addEventListener('playing', () => window.played.push({ clip: window.pb.activeClip.id, rate: window.pb.videoRef.current.playbackRate, at: performance.now() }), true);
      document.addEventListener('ended', () => window.ended.push({ clip: window.pb.activeClip.id, at: performance.now() }), true);
    });
    await page.goto(url);
    await page.waitForFunction(() => window.pb?.clips.length === 3);
    await page.evaluate(() => { window.pb.setIsMuted(true); window.pb.openClipWithOffset(window.pb.clips.find(clip => clip.id === 'first'), 2.375); });
    await page.waitForFunction(() => window.played.length > 0);
    await page.getByRole('button', { name: '2x', exact: true }).click();
    await page.waitForFunction(() => window.pb.videoRef.current.playbackRate === 2);
    assert.equal(await page.getByRole('button', { name: '4x', exact: true }).count(), 0);
    await page.evaluate(() => window.pb.togglePlay());
    const pausedAt = await page.evaluate(() => window.pb.videoRef.current.currentTime);
    await page.waitForTimeout(400);
    assert.ok(Math.abs(await page.evaluate(() => window.pb.videoRef.current.currentTime) - pausedAt) < 0.1);
    await page.evaluate(() => { window.pb.setAutoPlayNext(false); window.pb.seekToOffset(7.125); });
    await page.waitForFunction(() => !window.pb.videoRef.current.seeking && window.pb.videoRef.current.currentTime >= 7.125);
    assert.ok(await page.evaluate(() => Math.abs(window.pb.videoRef.current.currentTime - 7.125)) < 0.6);
    await page.evaluate(() => window.pb.setAutoPlayNext(true));
    await page.waitForFunction(() => window.ended.some(event => event.clip === 'next'), null, { timeout: 35_000 });
    const played = await page.evaluate(() => ({ played: window.played, ended: window.ended, error: window.pb.playerError }));
    assert.deepEqual(played.ended.map(event => event.clip), ['first', 'next']);
    assert.ok(played.played.some(event => event.clip === 'next' && event.rate === 2));
    assert.equal(played.error, '');
    await page.evaluate(() => window.pb.setActiveClip(null));
    await page.waitForFunction(() => window.pb.activeClip === null);
    assert.equal(await page.evaluate(() => window.pb.clips.length), 3);
    await context.close();
    breakManifests = true;
    const mobile = await browser.newContext({ timezoneId: 'Europe/Berlin', locale: 'de-DE', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const phone = await mobile.newPage();
    await phone.addInitScript(() => { window.process = { env: { NODE_ENV: 'production' } }; });
    phone.on('pageerror', error => errors.push(String(error)));
    await phone.goto(url);
    await phone.waitForFunction(() => window.pb?.clips.length === 3);
    await phone.evaluate(() => { window.pb.setIsMuted(true); window.pb.setSpeed(2); window.pb.openClipWithOffset(window.pb.clips.find(clip => clip.id === 'first'), 3.375); });
    await phone.waitForFunction(() => window.pb.videoRef.current?.currentSrc.includes('/direct') && !window.pb.videoRef.current.paused, null, { timeout: 25_000 });
    const recovered = await phone.evaluate(() => ({ rate: window.pb.videoRef.current.playbackRate, time: window.pb.videoRef.current.currentTime, error: window.pb.playerError }));
    assert.equal(recovered.rate, 2); assert.ok(recovered.time >= 3.375); assert.equal(recovered.error, ''); assert.ok(directRequests > 0);
    assert.deepEqual(errors, []);
    await mobile.close();
    breakManifests = 'next';
    const retryContext = await browser.newContext({ timezoneId: 'Europe/Berlin', locale: 'de-DE' });
    const retry = await retryContext.newPage();
    await retry.addInitScript(() => { window.process = { env: { NODE_ENV: 'production' } }; });
    retry.on('pageerror', error => errors.push(String(error)));
    await retry.goto(url);
    await retry.waitForFunction(() => window.pb?.clips.length === 3);
    await retry.evaluate(() => { window.pb.setIsMuted(true); window.pb.setSpeed(2); window.pb.openClipWithOffset(window.pb.clips.find(clip => clip.id === 'first'), 10); });
    await retry.waitForFunction(() => window.pb.activeClip?.id === 'next' && window.pb.videoRef.current?.currentSrc.includes('/direct') && !window.pb.videoRef.current.paused, null, { timeout: 25_000 });
    assert.equal(await retry.evaluate(() => window.pb.playerError), '');
    assert.equal(await retry.evaluate(() => window.pb.videoRef.current.playbackRate), 2);
    assert.deepEqual(errors, []);
    await retryContext.close();
    console.log('Desktop/mobile playback tests passed: exact seek, pause, 2x, next clip, preserved list, HTTP-500 and failed prefetch recovery.');
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (oldCache === undefined) delete process.env.PLAYBACK_CACHE_DIR;
    else process.env.PLAYBACK_CACHE_DIR = oldCache;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
