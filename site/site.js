// Direct download links from the latest release (the buttons link to the release page otherwise).
fetch('https://api.github.com/repos/vit-games/horazon/releases/latest')
  .then((r) => (r.ok ? r.json() : null))
  .then((release) => {
    if (!release) return;
    const find = (re) => release.assets.find((a) => re.test(a.name));
    const assets = { win: find(/Setup.*\.exe$/), appimage: find(/\.AppImage$/) };
    for (const a of document.querySelectorAll('[data-asset]')) {
      const asset = assets[a.dataset.asset];
      if (asset) a.href = asset.browser_download_url;
    }
    const version = release.tag_name.replace(/^v/, '');
    for (const el of document.querySelectorAll('.ver')) el.textContent = version;
    for (const el of document.querySelectorAll('.version-line')) el.textContent = `Version ${version} · Windows 10/11 (64-bit) · Linux x86_64`;
  })
  .catch(() => {});

// On Linux the AppImage is the main download.
if (/Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent)) {
  for (const group of document.querySelectorAll('.downloads')) {
    const win = group.querySelector('[data-asset="win"]');
    const linux = group.querySelector('[data-asset="appimage"]');
    if (!win || !linux) continue;
    win.classList.remove('primary');
    win.textContent = 'Windows installer';
    linux.classList.add('primary');
    linux.textContent = 'Download for Linux';
    group.prepend(linux);
  }
}

// Copy buttons: <button class="copy" data-copy="text">.
for (const b of document.querySelectorAll('.copy')) {
  b.addEventListener('click', () =>
    navigator.clipboard.writeText(b.dataset.copy).then(() => {
      b.textContent = 'Copied';
      setTimeout(() => (b.textContent = 'Copy'), 1500);
    }, () => {}),
  );
}

// A link to a FAQ entry opens it.
const openTarget = () => {
  const el = location.hash && document.getElementById(location.hash.slice(1));
  if (el?.tagName === 'DETAILS') el.open = true;
};
addEventListener('hashchange', openTarget);
openTarget();

// Clips: <figure class="clip"> with a muted looping <video preload="none">. They load and play only while on
// screen, and the button pauses them for good. With reduced motion nothing plays on its own: the poster
// shows, with the browser's controls to start it.
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const watcher =
  !still &&
  new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const video = e.target;
        if (video.dataset.paused) continue;
        if (e.isIntersecting) video.play().catch(() => {});
        else video.pause();
      }
    },
    { threshold: 0.4 },
  );
for (const fig of document.querySelectorAll('.clip')) {
  const video = fig.querySelector('video');
  const toggle = fig.querySelector('.clip-toggle');
  if (still) {
    video.controls = true;
    continue;
  }
  watcher.observe(video);
  toggle.hidden = false;
  const show = () => {
    const paused = video.paused;
    toggle.classList.toggle('paused', paused);
    toggle.setAttribute('aria-label', paused ? 'Play' : 'Pause');
  };
  video.addEventListener('play', show);
  video.addEventListener('pause', show);
  toggle.addEventListener('click', () => {
    if (video.paused) {
      delete video.dataset.paused;
      video.play().catch(() => {});
    } else {
      video.dataset.paused = '1';
      video.pause();
    }
  });
}
