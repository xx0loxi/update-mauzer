# Electron Performance Optimization Guide (2026)

## Table of Contents
1. [GPU vs CPU Rendering Optimization](#gpu-vs-cpu-rendering)
2. [CSS Animation Performance](#css-animation-performance)
3. [JavaScript Event Optimization](#javascript-event-optimization)
4. [Memory Optimization](#memory-optimization)
5. [Chromium Flags for Weak Hardware](#chromium-flags)

---

## 1. GPU vs CPU Rendering Optimization

### Force GPU Acceleration

```javascript
// main.js - Electron main process
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('ignore-gpu-blocklist'); // Use cautiously

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      hardwareAcceleration: true,
      enableBlinkFeatures: 'OffscreenCanvas',
    }
  });
}
```

### CSS Properties That Trigger GPU Acceleration

```css
/* GOOD: GPU-accelerated properties */
.gpu-optimized {
  /* Use transform instead of top/left */
  transform: translateX(100px) translateY(50px);
  
  /* Use opacity for fade effects */
  opacity: 0.8;
  
  /* Force GPU layer creation */
  will-change: transform, opacity;
  
  /* Alternative force method */
  transform: translateZ(0);
  /* or */
  transform: translate3d(0, 0, 0);
}

/* BAD: CPU-bound properties */
.cpu-heavy {
  /* Avoid animating these */
  width: 200px;
  height: 200px;
  margin-left: 50px;
  top: 100px;
  left: 100px;
}
```

### Detecting GPU Rendering Issues

```javascript
// Check if GPU is being used
chrome.gpuBenchmarking.printToConsole('GPU Info');

// Or use Electron's built-in
const { app } = require('electron');
app.getGPUInfo('complete').then(info => {
  console.log('GPU Info:', info);
});
```

---

## 2. CSS Animation Performance

### Will-Change Property Best Practices

```css
/* ❌ BAD: Too broad, wastes memory */
.bad-example {
  will-change: transform, opacity, left, top, width, height;
}

/* ❌ BAD: Applied to too many elements */
* {
  will-change: transform;
}

/* ✅ GOOD: Specific, scoped, removed after use */
.good-example {
  transition: transform 0.3s ease-out;
}

.good-example:hover {
  will-change: transform;
}

.good-example.is-animating {
  will-change: transform;
  transform: translateX(100px);
}
```

```javascript
// Remove will-change after animation completes
const element = document.querySelector('.animated');

element.addEventListener('mouseenter', () => {
  element.style.willChange = 'transform';
});

element.addEventListener('animationend', () => {
  element.style.willChange = 'auto';
});

element.addEventListener('transitionend', () => {
  element.style.willChange = 'auto';
});
```

### High-Performance Animation Patterns

```css
/* Optimal animation properties (GPU-accelerated) */
@keyframes slideIn {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.slide-in {
  animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  /* Only animate transform and opacity */
}

/* Use transform: scale() instead of width/height */
@keyframes grow {
  from {
    transform: scale(0.8);
  }
  to {
    transform: scale(1);
  }
}

/* Contain paint and layout for isolated animations */
.animated-container {
  contain: layout style paint;
  /* Prevents reflow outside this container */
}
```

### RequestAnimationFrame for JavaScript Animations

```javascript
// ❌ BAD: Using setInterval/setTimeout
setInterval(() => {
  element.style.left = position + 'px';
  position += 1;
}, 16);

// ✅ GOOD: Using requestAnimationFrame
function animate(timestamp) {
  if (!start) start = timestamp;
  const progress = timestamp - start;
  
  element.style.transform = `translateX(${Math.min(progress / 10, 200)}px)`;
  
  if (progress < 2000) {
    requestAnimationFrame(animate);
  }
}

let start = null;
requestAnimationFrame(animate);
```

### Content-Visibility for Off-Screen Performance

```css
/* Skip rendering off-screen content */
.list-item {
  content-visibility: auto;
  contain-intrinsic-size: 0 200px; /* Estimated height */
}

/* For sections that start hidden */
.hidden-section {
  content-visibility: hidden;
}
```

---

## 3. JavaScript Event Optimization

### Throttling Implementation

```javascript
/**
 * Throttle: Executes function at most once per interval
 * Use for: scroll, resize, mousemove
 */
function throttle(func, delay = 100) {
  let lastCall = 0;
  let timeoutId = null;
  
  return function throttled(...args) {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;
    
    if (timeSinceLastCall >= delay) {
      lastCall = now;
      func.apply(this, args);
    } else {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        func.apply(this, args);
      }, delay - timeSinceLastCall);
    }
  };
}

// Usage
window.addEventListener('scroll', throttle(() => {
  console.log('Scroll position:', window.scrollY);
}, 100));
```

### Debouncing Implementation

```javascript
/**
 * Debounce: Executes function after delay of inactivity
 * Use for: search input, form validation, window resize completion
 */
function debounce(func, delay = 300) {
  let timeoutId = null;
  
  return function debounced(...args) {
    clearTimeout(timeoutId);
    
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

// Usage
const searchInput = document.querySelector('#search');
searchInput.addEventListener('input', debounce((e) => {
  performSearch(e.target.value);
}, 300));
```

### Passive Event Listeners

```javascript
// ✅ GOOD: Passive listeners for better scroll performance
document.addEventListener('touchstart', handleTouch, { passive: true });
document.addEventListener('wheel', handleWheel, { passive: true });
document.addEventListener('scroll', handleScroll, { passive: true });

// Use passive: false only if you need preventDefault()
document.addEventListener('touchmove', (e) => {
  if (shouldPrevent) {
    e.preventDefault();
  }
}, { passive: false });
```

### Event Delegation

```javascript
// ❌ BAD: Attaching listeners to many elements
document.querySelectorAll('.item').forEach(item => {
  item.addEventListener('click', handleClick);
});

// ✅ GOOD: Single listener on parent
document.querySelector('.list').addEventListener('click', (e) => {
  if (e.target.matches('.item')) {
    handleClick(e);
  }
});
```

### Intersection Observer for Lazy Loading

```javascript
// Better than scroll event listeners
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      img.src = img.dataset.src;
      observer.unobserve(img);
    }
  });
}, {
  rootMargin: '50px' // Start loading 50px before visible
});

document.querySelectorAll('img[data-src]').forEach(img => {
  observer.observe(img);
});
```

---

## 4. Memory Optimization for Electron Apps

### Memory Leak Prevention

```javascript
// ❌ BAD: Creating memory leaks
class BadComponent {
  constructor() {
    setInterval(() => {
      this.doSomething();
    }, 1000);
    
    window.addEventListener('resize', this.handleResize);
  }
}

// ✅ GOOD: Proper cleanup
class GoodComponent {
  constructor() {
    this.intervalId = null;
    this.handleResize = this.handleResize.bind(this);
  }
  
  mount() {
    this.intervalId = setInterval(() => {
      this.doSomething();
    }, 1000);
    
    window.addEventListener('resize', this.handleResize);
  }
  
  unmount() {
    clearInterval(this.intervalId);
    window.removeEventListener('resize', this.handleResize);
    this.intervalId = null;
  }
  
  handleResize() {
    // Handler
  }
}
```

### Limit BrowserWindow Instances

```javascript
// main.js
const windowManager = {
  windows: new Map(),
  
  create(id, options) {
    // Reuse existing window if possible
    if (this.windows.has(id)) {
      const win = this.windows.get(id);
      win.show();
      return win;
    }
    
    const win = new BrowserWindow(options);
    this.windows.set(id, win);
    
    win.on('closed', () => {
      this.windows.delete(id);
    });
    
    return win;
  }
};
```

### Use contextIsolation and nodeIntegration Properly

```javascript
// main.js - Secure and performant
const win = new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true, // Better memory isolation
    preload: path.join(__dirname, 'preload.js')
  }
});

// preload.js - Expose only what's needed
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  send: (channel, data) => {
    const validChannels = ['getData', 'saveData'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  }
});
```

### Enable Process Reuse

```javascript
// main.js
app.commandLine.appendSwitch('disable-features', 'site-per-process');
app.commandLine.appendSwitch('process-per-site');

// Limit renderer processes
app.commandLine.appendSwitch('renderer-process-limit', '3');
```

### Memory Monitoring

```javascript
// Renderer process
function checkMemory() {
  if (performance.memory) {
    const used = performance.memory.usedJSHeapSize / 1048576;
    const total = performance.memory.totalJSHeapSize / 1048576;
    
    console.log(`Memory: ${used.toFixed(2)} MB / ${total.toFixed(2)} MB`);
    
    if (used / total > 0.9) {
      console.warn('High memory usage detected!');
      // Trigger cleanup
    }
  }
}

setInterval(checkMemory, 30000);

// Main process
app.on('render-process-gone', (event, webContents, details) => {
  console.error('Renderer crashed:', details);
});
```

### Object Pooling for Frequent Allocations

```javascript
class ObjectPool {
  constructor(factory, reset, initialSize = 10) {
    this.factory = factory;
    this.reset = reset;
    this.pool = [];
    
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(factory());
    }
  }
  
  acquire() {
    return this.pool.length > 0 
      ? this.pool.pop() 
      : this.factory();
  }
  
  release(obj) {
    this.reset(obj);
    this.pool.push(obj);
  }
}

// Usage for DOM elements or objects
const divPool = new ObjectPool(
  () => document.createElement('div'),
  (div) => {
    div.className = '';
    div.innerHTML = '';
  }
);
```

---

## 5. Chromium Flags for Weak Hardware

### Essential Performance Flags

```javascript
// main.js - Electron main process
const { app } = require('electron');

// GPU & Rendering
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-oop-rasterization'); // Out-of-process rasterization
app.commandLine.appendSwitch('enable-hardware-overlays');

// Disable resource-intensive features
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-vsync'); // May help on some systems
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Memory optimization
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512'); // Limit heap size
app.commandLine.appendSwitch('renderer-process-limit', '2');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// Disable unnecessary features
app.commandLine.appendSwitch('disable-smooth-scrolling'); // Can reduce lag
app.commandLine.appendSwitch('disable-animations'); // System-level animations
app.commandLine.appendSwitch('disable-backing-store-limit');

// Network optimizations
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disk-cache-size', '1'); // Minimal cache
```

### Conditional Flags Based on Hardware

```javascript
const os = require('os');

function applyPerformanceFlags() {
  const totalMemory = os.totalmem() / (1024 ** 3); // GB
  const cpuCount = os.cpus().length;
  
  console.log(`System: ${totalMemory.toFixed(1)}GB RAM, ${cpuCount} CPUs`);
  
  // Low-end system detection (< 4GB RAM or < 2 CPUs)
  if (totalMemory < 4 || cpuCount < 2) {
    console.log('Low-end system detected, applying optimization flags');
    
    // Aggressive memory limits
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
    app.commandLine.appendSwitch('renderer-process-limit', '1');
    
    // Disable visual effects
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.commandLine.appendSwitch('disable-smooth-scrolling');
    
    // Reduce quality
    app.commandLine.appendSwitch('force-color-profile', 'srgb');
    app.commandLine.appendSwitch('disable-features', 
      'PaintHolding,UseSurfaceLayerForVideo');
  } else if (totalMemory < 8) {
    console.log('Medium system detected');
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
    app.commandLine.appendSwitch('renderer-process-limit', '2');
  } else {
    console.log('High-end system detected');
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=2048');
  }
}

app.whenReady().then(() => {
  applyPerformanceFlags();
  createWindow();
});
```

### V8 JavaScript Engine Flags

```javascript
// Optimize JavaScript execution
const v8Flags = [
  '--max-old-space-size=512',       // Heap size limit
  '--optimize-for-size',             // Optimize for smaller code size
  '--gc-interval=100',               // More frequent garbage collection
  '--max-semi-space-size=2',         // Young generation size
];

app.commandLine.appendSwitch('js-flags', v8Flags.join(' '));
```

### Complete Performance Configuration

```javascript
// main.js - Production-ready configuration
const { app, BrowserWindow } = require('electron');
const os = require('os');
const path = require('path');

class PerformanceManager {
  constructor() {
    this.systemInfo = {
      memory: os.totalmem() / (1024 ** 3),
      cpus: os.cpus().length,
      platform: os.platform()
    };
  }
  
  applyFlags() {
    // Always enable
    const essentialFlags = [
      'enable-gpu-rasterization',
      'enable-zero-copy',
      'enable-oop-rasterization',
      'disable-software-rasterizer',
    ];
    
    essentialFlags.forEach(flag => {
      app.commandLine.appendSwitch(flag);
    });
    
    // Memory-based optimization
    const memoryLimit = this.systemInfo.memory < 4 ? 256 :
                       this.systemInfo.memory < 8 ? 512 : 1024;
    
    app.commandLine.appendSwitch('js-flags', 
      `--max-old-space-size=${memoryLimit}`);
    
    // Process limits
    const processLimit = this.systemInfo.cpus < 2 ? 1 :
                        this.systemInfo.cpus < 4 ? 2 : 3;
    
    app.commandLine.appendSwitch('renderer-process-limit', 
      processLimit.toString());
    
    // Low-end specific
    if (this.systemInfo.memory < 4) {
      app.commandLine.appendSwitch('disable-smooth-scrolling');
      app.commandLine.appendSwitch('disable-features', 
        'UseSurfaceLayerForVideo,PaintHolding');
    }
  }
  
  createOptimizedWindow(options = {}) {
    const defaultOptions = {
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        hardwareAcceleration: true,
        enableBlinkFeatures: 'OffscreenCanvas',
        preload: path.join(__dirname, 'preload.js')
      },
      show: false // Show after ready to prevent flash
    };
    
    const win = new BrowserWindow({
      ...defaultOptions,
      ...options
    });
    
    // Show when ready
    win.once('ready-to-show', () => {
      win.show();
    });
    
    // Memory monitoring
    setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const heapUsed = memoryUsage.heapUsed / (1024 ** 2);
      
      if (heapUsed > memoryLimit * 0.8) {
        console.warn(`High memory usage: ${heapUsed.toFixed(2)}MB`);
        if (global.gc) {
          global.gc();
        }
      }
    }, 60000);
    
    return win;
  }
}

// Usage
const perfManager = new PerformanceManager();

app.whenReady().then(() => {
  perfManager.applyFlags();
  const mainWindow = perfManager.createOptimizedWindow();
  mainWindow.loadFile('index.html');
});

// Enable manual garbage collection in development
if (process.env.NODE_ENV === 'development') {
  app.commandLine.appendSwitch('js-flags', '--expose-gc');
}
```

---

## Summary Checklist

### For Low-End PCs:

**CSS:**
- ✅ Use only `transform` and `opacity` for animations
- ✅ Apply `will-change` sparingly and remove after use
- ✅ Use `content-visibility: auto` for long lists
- ✅ Add `contain: layout style paint` to animated containers
- ✅ Prefer `requestAnimationFrame` over CSS animations for complex sequences

**JavaScript:**
- ✅ Implement throttling for scroll/resize (100-150ms)
- ✅ Implement debouncing for input (250-300ms)
- ✅ Use passive event listeners for touch/wheel/scroll
- ✅ Use event delegation instead of multiple listeners
- ✅ Use IntersectionObserver for lazy loading

**Electron:**
- ✅ Enable GPU rasterization flags
- ✅ Limit renderer processes (1-2 for low-end)
- ✅ Set heap size limits (256-512MB for low-end)
- ✅ Enable context isolation and sandbox
- ✅ Monitor memory usage and trigger GC when needed
- ✅ Disable smooth scrolling and unnecessary animations
- ✅ Use process reuse strategies

**Testing:**
- ✅ Use Chrome DevTools Performance tab
- ✅ Check `chrome://gpu` for GPU status
- ✅ Monitor FPS (target 60fps, acceptable 30fps for low-end)
- ✅ Profile memory usage regularly
- ✅ Test on actual low-end hardware

---

## Additional Resources

- Electron Performance Docs: https://www.electronjs.org/docs/latest/tutorial/performance
- Chrome DevTools Performance: https://developer.chrome.com/docs/devtools/performance/
- CSS Triggers: https://csstriggers.com/
- V8 Flags: https://nodejs.org/api/cli.html#cli_v8_options

