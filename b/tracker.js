(function() {
  // The tracker expects a global _sf_config object
  const config = window._sf_config || {};
  
  const getDevice = () => {
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) return 'tablet';
    if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/i.test(ua)) return 'mobile';
    return 'desktop';
  };

  const getBrowser = () => {
    const ua = navigator.userAgent;
    if (ua.includes('Edg')) return 'Edge';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Firefox')) return 'Firefox';
    return 'Other';
  };

  const getOS = () => {
    const ua = navigator.userAgent;
    if (ua.includes('Windows')) return 'Windows';
    if (ua.includes('Mac OS')) return 'macOS';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    if (ua.includes('Linux')) return 'Linux';
    return 'Other';
  };

  const getRefType = (ref) => {
    if (!ref) return 'direct';
    if (ref.includes('google')) return 'search';
    if (ref.includes('facebook') || ref.includes('t.co') || ref.includes('instagram')) return 'social';
    return 'other';
  };

  // Persistent User ID
  if (!localStorage.getItem('sf_uid')) {
    localStorage.setItem('sf_uid', crypto.randomUUID());
  }

  // Session ID
  if (!sessionStorage.getItem('sf_sid')) {
    sessionStorage.setItem('sf_sid', crypto.randomUUID());
  }

  let startTime = Date.now();
  let maxScroll = 0;

  const track = (type, extra = {}, callback = null) => {
    if (!config.username || !config.businessId || !config.origin) {
      console.warn('[SF-Tracker] Missing configuration:', { 
        username: !!config.username, 
        businessId: !!config.businessId, 
        origin: !!config.origin 
      });
      if (callback) callback(false);
      return;
    }

    const payload = {
      type,
      timestamp: Date.now(),
      username: config.username,
      businessId: config.businessId,
      sid: sessionStorage.getItem('sf_sid'),
      uid: localStorage.getItem('sf_uid'),
      variant: config.variant || 'A',
      page: {
        path: window.location.pathname,
        referrer: document.referrer || 'direct',
        refType: getRefType(document.referrer)
      },
      device: {
        browser: getBrowser(),
        os: getOS(),
        device: getDevice()
      },
      ...extra
    };

    // Ensure origin doesn't have trailing slash for clean URL
    const cleanOrigin = config.origin.replace(/\/$/, '');
    const url = cleanOrigin + '/api/analytics/track';

    const handleResponse = (res) => {
      if (!res.ok) {
        console.error('[SF-Tracker] Tracking failed with status:', res.status);
        if (callback) callback(false);
      } else {
        if (callback) callback(true);
      }
    };

    const handleError = (err) => {
      console.error('[SF-Tracker] Tracking error:', err);
      if (callback) callback(false);
    };

    if (navigator.sendBeacon && (type === 'exit' || type === 'perf' || type === 'vital')) {
      try {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const success = navigator.sendBeacon(url, blob);
        if (callback) callback(success);
        if (!success) {
          // Fallback to fetch if sendBeacon returns false
          fetch(url, {
            method: 'POST',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' },
            keepalive: true,
            mode: 'cors'
          }).then(handleResponse).catch(handleError);
        }
      } catch (e) {
        fetch(url, {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
          mode: 'cors'
        }).then(handleResponse).catch(handleError);
      }
    } else {
      fetch(url, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        mode: 'cors'
      }).then(handleResponse).catch(handleError);
    }
  };

  // Initial tracking with retry
  const initialTrack = (retries = 3) => {
    track('view', { step: 'view' }, (success) => {
      if (!success && retries > 0) {
        console.log(`[SF-Tracker] Initial view failed, retrying... (${retries} left)`);
        setTimeout(() => initialTrack(retries - 1), 2000);
      } else if (success) {
        console.log('[SF-Tracker] Initialized for', config.businessId);
        // Session ping after 30s to confirm engagement
        setTimeout(() => track('ping', { active: true }), 30000);
      }
    });
  };

  initialTrack();

  // Scroll tracking
  window.addEventListener('scroll', () => {
    const scrollPercent = Math.round((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight * 100);
    if (scrollPercent > maxScroll) {
      maxScroll = scrollPercent;
      if (maxScroll >= 50 && !window._sf_scroll50) {
        window._sf_scroll50 = true;
        track('funnel_step', { step: 'scroll_50' });
      }
      if (maxScroll >= 100 && !window._sf_scroll100) {
        window._sf_scroll100 = true;
        track('funnel_step', { step: 'scroll_100' });
      }
    }
  }, { passive: true });

  // Interaction tracking
  document.addEventListener('click', (e) => {
    const target = e.target.closest('a, button');
    
    // Heatmap tracking
    track('heatmap', { x: e.clientX, y: e.clientY });

    if (target) {
      const text = target.innerText.toLowerCase();
      const isGoal = text.includes('contact') || 
                     text.includes('book') || 
                     text.includes('get started') ||
                     text.includes('buy') ||
                     text.includes('quote') ||
                     target.id.toLowerCase().includes('cta') ||
                     target.className.toLowerCase().includes('cta');
      
      track('interaction', {
        type: 'click',
        tag: target.tagName,
        id: target.id,
        classes: target.className,
        text: target.innerText.substring(0, 50).trim()
      });

      if (isGoal) {
        track('conversion', {
          value: config.conversionValue || 0,
          label: target.innerText.substring(0, 50).trim()
        });
      }

      track('activity', {
        action: isGoal ? 'clicked CTA' : 'clicked link',
        label: target.innerText.substring(0, 30).trim()
      });
    }
  });

  // Form tracking
  document.addEventListener('submit', (e) => {
    track('form_submit', { elementId: e.target.id || 'form' });
  });

  // Visibility tracking (more reliable than beforeunload)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const timeOnPage = Math.round((Date.now() - startTime) / 1000);
      track('exit', { time: timeOnPage, maxScroll: maxScroll });
    }
  });

  // Core Web Vitals
  import('https://unpkg.com/web-vitals?module').then(({ getLCP, getCLS, getFID }) => {
    getLCP(metric => track('vital', { name: 'LCP', value: metric.value }));
    getCLS(metric => track('vital', { name: 'CLS', value: metric.value }));
    getFID(metric => track('vital', { name: 'FID', value: metric.value }));
  }).catch(() => {
    // Fallback to basic timing if web-vitals fails
    window.addEventListener('load', () => {
      if (window.performance && window.performance.timing) {
        setTimeout(() => {
          const timing = window.performance.timing;
          const loadTime = timing.loadEventEnd - timing.navigationStart;
          if (loadTime > 0) track('perf', { loadTime });
        }, 0);
      }
    });
  });
})();
