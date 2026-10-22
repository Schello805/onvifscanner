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
    const stylesFile = path.join(directory, 'styles.css');
    execFileSync(process.execPath, [require.resolve('tailwindcss/lib/cli'), '-i', 'src/app/globals.css', '-o', stylesFile, '--minify'], { stdio: 'pipe' });
    const styles = await fs.readFile(stylesFile);
    const bundle = await esbuild.build({
      stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
        import React,{useEffect} from 'react';
        import {createRoot} from 'react-dom/client';
        import {ToastProvider} from './src/components/ToastProvider';
        import {LanguageProvider} from './src/components/LanguageProvider';
        import {ClipPlayer} from './src/components/playback/ClipPlayer';
        import {PlaybackTimeline} from './src/components/playback/PlaybackTimeline';
        import {usePlaybackPage} from './src/components/playback/usePlaybackPage';
        import Hls from 'hls.js';
        window.testHls=Hls;window.hlsInstances=[];window.mediaRecoveries=0;
        const loadSource=Hls.prototype.loadSource;
        Hls.prototype.loadSource=function(url){window.hlsInstances.push({hls:this,url});return loadSource.call(this,url)};
        const recover=Hls.prototype.recoverMediaError;
        Hls.prototype.recoverMediaError=function(){window.mediaRecoveries++;return recover.call(this)};
        function App(){const pb=usePlaybackPage();useEffect(()=>{window.pb=pb});return <main className="mx-auto max-w-6xl space-y-4"><ClipPlayer pb={pb}/><PlaybackTimeline pb={pb}/></main>}
        createRoot(document.getElementById('app')).render(<LanguageProvider><ToastProvider><App/></ToastProvider></LanguageProvider>);
      ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    });
    let breakManifests = false;
    let directRequests = 0;
    const manifestRequests = [];
    let slowClip = '';
    let interruptedSegments = 0;
    let compatibleSegments = 0;
    server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/bundle.js') {
          response.setHeader('Content-Type', 'application/javascript'); response.end(bundle.outputFiles[0].contents); return;
        }
        if (url.pathname === '/styles.css') {
          response.setHeader('Content-Type', 'text/css'); response.end(styles); return;
        }
        if (url.pathname === '/api/nvr/recordings/hls') {
          const compatibility = url.searchParams.get('compatibility') === '1';
          if (!compatibility && (breakManifests === true || (breakManifests === 'next' && url.searchParams.get('clipId') === 'next'))) { response.statusCode = 500; response.end('simulated HLS failure'); return; }
          const segment = url.searchParams.get('segment');
          if (segment !== null) {
            if (compatibility) compatibleSegments++;
            const controller = new AbortController();
            response.once('close', () => {
              if (!response.writableEnded) { interruptedSegments++; controller.abort(); }
            });
            if (url.searchParams.get('clipId') === slowClip) await new Promise(resolve => setTimeout(resolve, 1500));
            const file = await hls.recordingSegment(source, Number(segment), controller.signal, compatibility);
            response.setHeader('Content-Type', 'video/mp2t');
            response.setHeader('Cache-Control', 'public, max-age=3600');
            response.end(await fs.readFile(file));
          } else {
            manifestRequests.push(url.searchParams.get('clipId'));
            const profile = await hls.recordingProfile(source, compatibility);
            response.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            response.end(hls.recordingManifest(url.searchParams.get('clipId'), profile.duration, profile.boundaries, compatibility));
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
        response.setHeader('Content-Type', 'text/html'); response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><div id="app"></div><script src="/bundle.js"></script>');
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
      window.seekTimes = []; window.loadStarts = 0; window.frames = new WeakMap();
      const tracked = new WeakSet();
      document.addEventListener('loadedmetadata', (event) => {
        const video = event.target;
        if (!(video instanceof HTMLVideoElement) || tracked.has(video) || !video.requestVideoFrameCallback) return;
        tracked.add(video);
        const frame = (_, metadata) => { window.frames.set(video, metadata.mediaTime); video.requestVideoFrameCallback(frame); };
        video.requestVideoFrameCallback(frame);
      }, true);
      document.addEventListener('seeking', () => window.seekTimes.push(performance.now()), true);
      document.addEventListener('loadstart', () => window.loadStarts++, true);
      document.addEventListener('playing', () => window.played.push({ clip: window.pb.activeClip.id, rate: window.pb.videoRef.current.playbackRate, at: performance.now() }), true);
      document.addEventListener('ended', () => window.ended.push({ clip: window.pb.activeClip.id, at: performance.now() }), true);
    });
    await page.goto(url);
    await page.waitForFunction(() => window.pb?.clips.length === 3);
    await page.evaluate(() => { window.pb.setIsMuted(true); window.pb.setAutoPlayNext(false); window.pb.setSelectedCameraId('camera'); window.pb.setTimelineWindowMinutes(5); window.pb.setTimelineStartMin(720); window.pb.openClipWithOffset(window.pb.clips.find(clip => clip.id === 'first'), 2.375); });
    await page.waitForFunction(() => window.played.length > 0);
    await page.getByRole('button', { name: '2x', exact: true }).click();
    await page.waitForFunction(() => window.pb.videoRef.current.playbackRate === 2);
    assert.equal(await page.getByRole('button', { name: '4x', exact: true }).count(), 0);
    await page.evaluate(() => window.pb.togglePlay());
    const pausedAt = await page.evaluate(() => window.pb.videoRef.current.currentTime);
    await page.waitForTimeout(400);
    assert.ok(Math.abs(await page.evaluate(() => window.pb.videoRef.current.currentTime) - pausedAt) < 0.1);
    const clipScrubber = page.getByRole('slider', { name: 'Position im Clip' });
    await clipScrubber.scrollIntoViewIfNeeded();
    const track = await clipScrubber.boundingBox();
    const beforeScrub = await page.evaluate(() => ({ loads: window.loadStarts, seeks: window.seekTimes.length, attempt: window.pb.playbackAttempt, source: window.pb.videoRef.current.currentSrc }));
    await page.mouse.move(track.x + track.width * 0.2, track.y + track.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => window.pb.isScrubbing && window.pb.videoRef.current.paused);
    await page.mouse.move(track.x + track.width * 0.85, track.y + track.height / 2, { steps: 20 });
    await page.waitForTimeout(180);
    await page.waitForFunction(() => window.pb.isScrubbing && !window.pb.videoRef.current.seeking && window.pb.videoRef.current.readyState >= 2);
    const previewFrame = await page.evaluate(() => ({ frame: window.frames.get(window.pb.videoRef.current), position: window.pb.videoRef.current.currentTime }));
    assert.ok(Math.abs(previewFrame.frame - previewFrame.position) < 0.15, JSON.stringify(previewFrame));
    await page.mouse.move(track.x + track.width * 0.35, track.y + track.height / 2, { steps: 20 });
    await page.mouse.up();
    await page.waitForFunction(() => !window.pb.isScrubbing && !window.pb.videoRef.current.seeking);
    assert.ok(Math.abs(await page.evaluate(() => window.pb.videoRef.current.currentTime) - 8.4) < 0.05);
    await page.getByLabel('Aktuelle Aufnahmezeit').getByText('12:00:08 Uhr', { exact: true }).waitFor();
    assert.ok(Math.abs(Date.parse(await page.getByLabel('Aktuelle Aufnahmezeit').getAttribute('datetime')) - Date.parse(`${date}T10:00:08.645Z`)) < 2);
    const afterScrub = await page.evaluate(() => ({ loads: window.loadStarts, seeks: window.seekTimes.length, attempt: window.pb.playbackAttempt, source: window.pb.videoRef.current.currentSrc, paused: window.pb.videoRef.current.paused }));
    assert.equal(afterScrub.loads, beforeScrub.loads); assert.equal(afterScrub.source, beforeScrub.source); assert.equal(afterScrub.attempt, beforeScrub.attempt);
    assert.ok(afterScrub.seeks - beforeScrub.seeks < 15); assert.equal(afterScrub.paused, true);
    await clipScrubber.press('ArrowRight');
    await page.waitForFunction(() => !window.pb.videoRef.current.seeking);
    assert.ok(Math.abs(await page.evaluate(() => window.pb.videoRef.current.currentTime) - 9.4) < 0.05);
    const dayScrubber = page.getByRole('slider', { name: 'Aufnahmezeit', exact: true });
    await dayScrubber.scrollIntoViewIfNeeded();
    const dayTrack = await dayScrubber.boundingBox();
    const dayPosition = (seconds) => dayTrack.x + seconds / 300 * dayTrack.width;
    const initialManifests = manifestRequests.length;
    await page.mouse.click(dayPosition(17.375), dayTrack.y + dayTrack.height / 2);
    await page.waitForFunction(() => !window.pb.videoRef.current.seeking && Math.abs(window.pb.videoRef.current.currentTime - 17.13) < 0.1);
    assert.equal(manifestRequests.length, initialManifests);
    await page.mouse.move(dayPosition(18), dayTrack.y + dayTrack.height / 2);
    await page.mouse.down();
    await page.mouse.move(dayPosition(37.625), dayTrack.y + dayTrack.height / 2, { steps: 15 });
    await page.mouse.up();
    await page.waitForFunction(() => window.pb.activeClip.id === 'next' && !window.pb.videoRef.current.seeking && window.pb.videoRef.current.readyState >= 2 && Math.abs(window.pb.videoRef.current.currentTime - 13.38) < 0.1);
    assert.equal(await page.evaluate(() => window.pb.videoRef.current.paused), true);
    await dayScrubber.scrollIntoViewIfNeeded();
    await dayScrubber.click({ position: { x: 60 / 300 * dayTrack.width, y: dayTrack.height / 2 } });
    assert.equal(await page.evaluate(() => window.pb.activeClip.id), 'next');
    await page.getByText(/Keine Aufnahme für 12:01:00/).waitFor();
    slowClip = 'next';
    const networkSession = await context.newCDPSession(page);
    await networkSession.send('Network.clearBrowserCache');
    await page.evaluate(() => window.pb.openClipWithOffset(window.pb.clips.find(clip => clip.id === 'first'), 6));
    await page.waitForFunction(() => window.pb.videoRef.current.readyState >= 2 && !window.pb.videoRef.current.seeking);
    await dayScrubber.scrollIntoViewIfNeeded();
    const delayedRequest = page.waitForRequest(request => request.url().includes('clipId=next&segment='));
    await page.mouse.move(dayPosition(37.625), dayTrack.y + dayTrack.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => window.pb.activeClip?.id === 'next');
    await delayedRequest;
    await page.waitForTimeout(200);
    await page.mouse.move(dayPosition(9.625), dayTrack.y + dayTrack.height / 2);
    await page.mouse.up();
    await page.waitForFunction(() => window.pb.activeClip.id === 'first' && window.pb.videoRef.current.readyState >= 2 && !window.pb.videoRef.current.seeking && window.pb.videoRef.current.currentTime >= 9.38);
    assert.equal(await page.evaluate(() => window.pb.playerError), '');
    await page.waitForTimeout(1700);
    assert.equal(await page.evaluate(() => window.pb.activeClip.id), 'first');
    assert.ok(interruptedSegments > 0);
    slowClip = '';
    await page.evaluate(() => window.pb.openClipWithOffset(window.pb.clips.find(clip => clip.id === 'first'), 7.125));
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
    const touchContext = await browser.newContext({ timezoneId: 'Europe/Berlin', locale: 'de-DE', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const touchPage = await touchContext.newPage();
    await touchPage.addInitScript(() => { window.process = { env: { NODE_ENV: 'production' } }; });
    touchPage.on('pageerror', error => errors.push(String(error)));
    await touchPage.goto(url);
    await touchPage.waitForFunction(() => window.pb?.clips.length === 3);
    await touchPage.evaluate(() => { window.pb.setIsMuted(true); window.pb.setSpeed(2); window.pb.setAutoPlayNext(false); window.pb.setSelectedCameraId('camera'); window.pb.setTimelineWindowMinutes(5); window.pb.setTimelineStartMin(720); window.pb.openClipWithOffset(window.pb.clips.find(clip => clip.id === 'first'), 2); });
    await touchPage.waitForFunction(() => window.pb.videoRef.current?.readyState >= 2 && !window.pb.videoRef.current.paused);
    await touchPage.evaluate(() => window.pb.togglePlay());
    const touchScrubber = touchPage.getByRole('slider', { name: 'Position im Clip' });
    await touchScrubber.scrollIntoViewIfNeeded();
    await touchPage.waitForTimeout(500);
    const touchTrack = await touchScrubber.boundingBox();
    const scrollBeforeTouch = await touchPage.evaluate(() => window.scrollY);
    const touchSession = await touchContext.newCDPSession(touchPage);
    const touchPoint = (ratio) => ({ x: touchTrack.x + touchTrack.width * ratio, y: touchTrack.y + touchTrack.height / 2 });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(0.2)] });
    for (let index = 1; index <= 20; index++) {
      await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(0.2 + index * 0.03)] });
    }
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touchPage.waitForFunction(() => !window.pb.isScrubbing && !window.pb.videoRef.current.seeking && Math.abs(window.pb.videoRef.current.currentTime - 19.2) < 0.1);
    await touchPage.getByLabel('Aktuelle Aufnahmezeit').getByText('12:00:19 Uhr', { exact: true }).waitFor();
    assert.equal(await touchPage.evaluate(() => window.pb.videoRef.current.paused), true);
    assert.ok(Math.abs(await touchPage.evaluate(() => window.scrollY) - scrollBeforeTouch) < 2);
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(0.3)] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(0.4)] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await touchPage.waitForFunction(() => !window.pb.isScrubbing);
    await touchPage.waitForTimeout(300);
    assert.equal(await touchPage.evaluate(() => window.pb.videoRef.current.paused), true);
    const touchDayScrubber = touchPage.getByRole('slider', { name: 'Aufnahmezeit', exact: true });
    await touchDayScrubber.scrollIntoViewIfNeeded();
    const touchDayTrack = await touchDayScrubber.boundingBox();
    const dayTouchPoint = (seconds) => ({ x: touchDayTrack.x + seconds / 300 * touchDayTrack.width, y: touchDayTrack.y + touchDayTrack.height / 2 });
    const scrollBeforeDayTouch = await touchPage.evaluate(() => window.scrollY);
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [dayTouchPoint(10)] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [dayTouchPoint(32.245)] });
    await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touchPage.waitForFunction(() => window.pb.activeClip?.id === 'next' && !window.pb.videoRef.current.seeking && window.pb.videoRef.current.readyState >= 2 && Math.abs(window.pb.videoRef.current.currentTime - 8) < 0.1);
    await touchPage.waitForTimeout(400);
    assert.ok(Math.abs(await touchPage.evaluate(() => window.scrollY) - scrollBeforeDayTouch) < 2);
    assert.equal(await touchPage.evaluate(() => window.pb.videoRef.current.paused), true);
    assert.equal(await touchPage.evaluate(() => window.pb.videoRef.current.playbackRate), 2);
    if (process.env.PLAYBACK_SCREENSHOT_DIR) {
      await fs.mkdir(process.env.PLAYBACK_SCREENSHOT_DIR, { recursive: true });
      await touchPage.screenshot({ path: path.join(process.env.PLAYBACK_SCREENSHOT_DIR, 'playback-mobile.png'), fullPage: true });
    }
    await touchContext.close();
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
    await phone.evaluate(() => {
      window.pb.setAutoPlayNext(false);
      const video = window.pb.videoRef.current;
      Object.defineProperty(video, 'error', { configurable: true, value: { code: 4, message: 'simulated unsupported original recording' } });
      video.dispatchEvent(new Event('error'));
      delete video.error;
    });
    await phone.waitForFunction(position => window.hlsInstances.some(entry => entry.url.includes('compatibility=1')) && window.pb.videoRef.current.readyState >= 2 && !window.pb.videoRef.current.paused && window.pb.videoRef.current.currentTime >= position, recovered.time);
    assert.equal(await phone.evaluate(() => window.pb.playerError), '');
    assert.equal(await phone.evaluate(() => window.pb.videoRef.current.playbackRate), 2);
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
    breakManifests = false;
    const decodeContext = await browser.newContext({ timezoneId: 'Europe/Berlin', locale: 'de-DE' });
    const decodePage = await decodeContext.newPage();
    await decodePage.addInitScript(() => { window.process = { env: { NODE_ENV: 'production' } }; });
    decodePage.on('pageerror', error => errors.push(String(error)));
    await decodePage.goto(url);
    await decodePage.waitForFunction(() => window.pb?.clips.length === 3);
    await decodePage.evaluate(() => { window.pb.setIsMuted(true); window.pb.setAutoPlayNext(false); window.pb.setSpeed(2); window.pb.openClipWithOffset(window.pb.clips.find(clip => clip.id === 'first'), 8.375); });
    await decodePage.waitForFunction(() => window.pb.videoRef.current?.readyState >= 2 && !window.pb.videoRef.current.paused && window.pb.videoRef.current.currentTime >= 8.375);
    const beforeDecodeError = await decodePage.evaluate(() => window.pb.videoRef.current.currentTime);
    const beforeDirectRequests = directRequests;
    await decodePage.evaluate(() => {
      const video = window.pb.videoRef.current;
      Object.defineProperty(video, 'error', { configurable: true, value: { code: 3, message: 'simulated browser decode failure' } });
      video.dispatchEvent(new Event('error'));
      delete video.error;
    });
    await decodePage.waitForFunction(position => window.mediaRecoveries === 1 && window.pb.videoRef.current.readyState >= 2 && !window.pb.videoRef.current.paused && window.pb.videoRef.current.currentTime >= position, beforeDecodeError);
    assert.equal(await decodePage.evaluate(() => window.pb.playerError), '');
    assert.equal(directRequests, beforeDirectRequests);
    assert.equal(await decodePage.evaluate(() => window.pb.videoRef.current.playbackRate), 2);
    await decodePage.evaluate(() => { window.pb.seekToOffset(21.375); window.pb.togglePlay(); });
    await decodePage.waitForFunction(() => window.pb.videoRef.current.paused && !window.pb.videoRef.current.seeking && window.pb.videoRef.current.readyState >= 2);
    const fatalDecode = () => {
      const instance = window.hlsInstances.findLast(entry => entry.hls.media === window.pb.videoRef.current).hls;
      instance.trigger(window.testHls.Events.ERROR, { fatal: true, type: window.testHls.ErrorTypes.MEDIA_ERROR, details: window.testHls.ErrorDetails.BUFFER_APPEND_ERROR });
    };
    await decodePage.evaluate(fatalDecode);
    await decodePage.waitForFunction(() => window.hlsInstances.some(entry => entry.url.includes('compatibility=1')) && window.pb.videoRef.current.readyState >= 2 && !window.pb.videoRef.current.seeking && Math.abs(window.pb.videoRef.current.currentTime - 21.375) < 0.05);
    assert.ok(compatibleSegments > 0);
    assert.equal(await decodePage.evaluate(() => window.pb.playerError), '');
    assert.equal(await decodePage.evaluate(() => window.pb.videoRef.current.paused), true);
    assert.equal(await decodePage.evaluate(() => window.pb.videoRef.current.playbackRate), 2);
    assert.equal(directRequests, beforeDirectRequests);
    await decodePage.evaluate(fatalDecode);
    await decodePage.waitForFunction(() => window.pb.videoRef.current.currentSrc.includes('/direct') && window.pb.videoRef.current.readyState >= 2 && !window.pb.videoRef.current.seeking && Math.abs(window.pb.videoRef.current.currentTime - 21.375) < 0.05);
    assert.equal(await decodePage.evaluate(() => window.pb.videoRef.current.paused), true);
    await decodePage.evaluate(() => {
      const video = window.pb.videoRef.current;
      Object.defineProperty(video, 'error', { configurable: true, value: { code: 3, message: 'persistent decode failure' } });
      video.dispatchEvent(new Event('error'));
      delete video.error;
    });
    await decodePage.waitForFunction(() => window.pb.playerError.includes('Medienfehler 3'));
    const recoveryCount = await decodePage.evaluate(() => window.hlsInstances.length);
    await decodePage.waitForTimeout(500);
    assert.equal(await decodePage.evaluate(() => window.hlsInstances.length), recoveryCount);
    assert.equal(await decodePage.getByText(/vorzeitiger Stream-Abbruch/).count(), 0);
    assert.deepEqual(errors, []);
    await decodeContext.close();
    console.log('Desktop/mobile playback tests passed: exact seek, live scrub preview, throttled mouse/touch drag, keyboard, cross-clip timeline, stable page scroll, canceled requests/gestures, gaps, pause, 2x, next clip, preserved list, HTTP-500, failed prefetch, decoder recovery and bounded compatible-segment fallback at the same position.');
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (oldCache === undefined) delete process.env.PLAYBACK_CACHE_DIR;
    else process.env.PLAYBACK_CACHE_DIR = oldCache;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
