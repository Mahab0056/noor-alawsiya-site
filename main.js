// حركات الموقع: ظهور مع التمرير، عناوين كلمة كلمة، ذرات ذهبية، وتشغيل الريل عند ظهوره.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  if (reduce || !('IntersectionObserver' in window)) {
    root.classList.remove('js');
    return;
  }

  // تقسيم النص لكلمات (بلا تقسيم الحروف حتى تبقى متصلة)
  const splitWords = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let i = 0;
    for (const node of nodes) {
      const parts = node.textContent.split(/(\s+)/);
      if (parts.every((p) => !p.trim())) continue;
      const frag = document.createDocumentFragment();
      for (const part of parts) {
        if (!part.trim()) {
          frag.appendChild(document.createTextNode(part));
          continue;
        }
        const span = document.createElement('span');
        span.className = 'w';
        span.style.setProperty('--i', i++);
        span.textContent = part;
        frag.appendChild(span);
      }
      node.parentNode.replaceChild(frag, node);
    }
    el.classList.add('words');
  };
  document.querySelectorAll('h1, h2, .ayah p').forEach(splitWords);

  // عناصر تظهر مع التمرير، وكل مجموعة إخوة تدخل بالتتابع
  const targets = document.querySelectorAll(
    '.hero .chip, .lead, .cta, .wrap > .chip, .two > div > .chip, .two p, .points li, .arch, .card, .note, .ayah cite, .grid figure, .reel, .contact a, .where, footer'
  );
  targets.forEach((el) => {
    el.classList.add('rv');
    const sibs = [...el.parentElement.children].filter((c) => c.classList.contains('rv') || c === el);
    el.style.setProperty('--d', Math.min(sibs.indexOf(el), 6));
  });

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    },
    {threshold: 0.18, rootMargin: '0px 0px -6% 0px'}
  );
  document.querySelectorAll('.rv, .words').forEach((el) => io.observe(el));
  // الواجهة فوق الطيّة: تظهر مباشرة بلا انتظار المراقب
  setTimeout(() => document.querySelectorAll('.hero .rv, .hero .words').forEach((el) => el.classList.add('in')), 60);

  // الريل: يشتغل صامتاً لما يظهر ويوقف لما يختفي
  const video = document.querySelector('.reel video');
  if (video) {
    let userPaused = false;
    video.addEventListener('pause', () => { if (!video.dataset.auto) userPaused = true; });
    video.addEventListener('play', () => { userPaused = false; });
    new IntersectionObserver(
      ([e]) => {
        video.dataset.auto = '1';
        if (e.isIntersecting && !userPaused) video.play().catch(() => {});
        else if (!e.isIntersecting) video.pause();
        setTimeout(() => delete video.dataset.auto, 50);
      },
      {threshold: 0.5}
    ).observe(video);
  }

  // ذرات ذهبية تطفو بالخلفية
  const canvas = document.getElementById('dust');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dots = [], raf = 0;
    const size = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = innerWidth; h = innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(46, (w * h) / 26000));
      dots = Array.from({length: n}, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: 0.6 + Math.random() * 1.6,
        vy: 0.06 + Math.random() * 0.22, vx: (Math.random() - 0.5) * 0.12,
        p: Math.random() * Math.PI * 2,
      }));
    };
    const tick = (t) => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.y -= d.vy; d.x += d.vx + Math.sin(t / 2400 + d.p) * 0.08;
        if (d.y < -4) { d.y = h + 4; d.x = Math.random() * w; }
        const a = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(t / 900 + d.p));
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(241, 215, 138, ${a.toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    size();
    addEventListener('resize', size);
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(tick);
    });
    raf = requestAnimationFrame(tick);
  }
})();
