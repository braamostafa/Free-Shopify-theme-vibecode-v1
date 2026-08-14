class HeroSlider extends HTMLElement {
  #currentIndex = 0;
  #slideCount = 0;
  #autoplayTimer = null;
  #isPlaying = false;

  constructor() {
    super();
  }

  connectedCallback() {
    this.#init();
  }

  disconnectedCallback() {
    this.#stopAutoplay();
  }

  #init() {
    this.slides = this.querySelectorAll('[data-slide-index]');
    this.dots = this.querySelectorAll('[data-dot]');
    this.prevBtn = this.querySelector('[data-prev]');
    this.nextBtn = this.querySelector('[data-next]');
    this.progressBar = this.querySelector('[data-progress]');
    this.currentCounter = this.querySelector('[data-current]');
    this.totalCounter = this.querySelector('[data-total]');

    this.#slideCount = this.slides.length;

    if (this.#slideCount <= 1) return;

    this.prevBtn?.addEventListener('click', () => this.#prev());
    this.nextBtn?.addEventListener('click', () => this.#next());

    this.dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        const index = parseInt(dot.dataset.dot, 10);
        this.#goTo(index);
      });
    });

    // Touch & Pointer Drag Swipe Support (Mobile & Desktop)
    let startX = 0;
    let startY = 0;
    let isDragging = false;

    const handleStart = (e) => {
      const touch = e.touches ? e.touches[0] : e;
      startX = touch.clientX;
      startY = touch.clientY;
      isDragging = true;
    };

    const handleEnd = (e) => {
      if (!isDragging) return;
      isDragging = false;
      const touch = e.changedTouches ? e.changedTouches[0] : e;
      const diffX = startX - touch.clientX;
      const diffY = startY - touch.clientY;

      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 30) {
        if (diffX > 0) {
          this.#next();
        } else {
          this.#prev();
        }
      }
    };

    this.addEventListener('touchstart', handleStart, { passive: true });
    this.addEventListener('touchend', handleEnd, { passive: true });

    this.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') handleStart(e);
    });

    this.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse') handleEnd(e);
    });

    // Shopify Theme Editor support
    document.addEventListener('shopify:block:select', (event) => {
      if (!this.contains(event.target)) return;
      const slide = event.target.closest('[data-slide-index]');
      if (slide) {
        const index = parseInt(slide.dataset.slideIndex, 10);
        if (!isNaN(index)) {
          this.#goTo(index);
          this.#stopAutoplay();
        }
      }
    });

    document.addEventListener('shopify:block:deselect', (event) => {
      if (!this.contains(event.target)) return;
      if (this.dataset.autoplay === 'true') {
        this.#startAutoplay();
      }
    });

    if (this.dataset.autoplay === 'true') {
      this.#startAutoplay();
    }

    this.#updateProgress();
  }

  #goTo(index) {
    if (index === this.#currentIndex) return;

    const currentSlide = this.slides[this.#currentIndex];
    const nextSlide = this.slides[index];
    const currentDot = this.dots[this.#currentIndex];
    const nextDot = this.dots[index];

    currentSlide?.classList.remove('is-active');
    currentDot?.classList.remove('is-active');

    nextSlide?.classList.add('is-active');
    nextDot?.classList.add('is-active');

    this.#currentIndex = index;

    if (this.currentCounter) {
      this.currentCounter.textContent = index + 1;
    }

    this.#updateProgress();

    if (this.dataset.autoplay === 'true') {
      this.#restartAutoplay();
    }
  }

  #next() {
    const nextIndex = (this.#currentIndex + 1) % this.#slideCount;
    this.#goTo(nextIndex);
  }

  #prev() {
    const prevIndex = (this.#currentIndex - 1 + this.#slideCount) % this.#slideCount;
    this.#goTo(prevIndex);
  }

  #startAutoplay() {
    if (this.#isPlaying) return;
    this.#isPlaying = true;

    const speed = parseInt(this.dataset.autoplaySpeed, 10) || 5000;
    this.#autoplayTimer = setInterval(() => this.#next(), speed);
  }

  #stopAutoplay() {
    this.#isPlaying = false;
    if (this.#autoplayTimer) {
      clearInterval(this.#autoplayTimer);
      this.#autoplayTimer = null;
    }
  }

  #restartAutoplay() {
    this.#stopAutoplay();
    this.#startAutoplay();
  }

  #updateProgress() {
    if (!this.progressBar) return;
    const progress = ((this.#currentIndex + 1) / this.#slideCount) * 100;
    this.progressBar.style.width = `${progress}%`;
  }
}

if (!customElements.get('hero-slider')) {
  customElements.define('hero-slider', HeroSlider);
}
