import { OverflowList } from '@theme/overflow-list';
import VariantPicker from '@theme/variant-picker';
import { ProductComponent } from '@theme/view-event-elements';
import { debounce, isDesktopBreakpoint, mediaQueryLarge, yieldToMainThread } from '@theme/utilities';
import { SlideshowSelectEvent } from '@theme/events';
import { morph } from '@theme/morph';
import { StandardEvents, ProductSelectEvent } from '@shopify/events';

/**
 * @typedef {object} ProductCardLinkRefs
 * @property {HTMLElement} [cardGallery] - The card gallery element.
 * @property {HTMLImageElement[]} [imagesToTransition] - The images to transition.
 */

/**
 * A custom element for product links with images for transitions to PDP.
 * This is a base class that is extended by ProductCard.
 * Used directly by resource-card.liquid for non-product-card scenarios.
 * Extends ProductComponent to automatically emit product:view events when visible.
 *
 * @template {ProductCardLinkRefs} [T=ProductCardLinkRefs]
 * @extends {ProductComponent<T>}
 */
export class ProductCardLink extends ProductComponent {
  get productTransitionEnabled() {
    return this.getAttribute('data-product-transition') === 'true';
  }

  get featuredMediaUrl() {
    return this.getAttribute('data-featured-media-url');
  }

  /**
   * Handles the click event for view transitions.
   * @param {Event} event
   */
  handleViewTransition(event) {
    // If the event has been prevented, don't do anything, another component is handling the click
    if (event.defaultPrevented) return;

    // If the event was on an interactive element, don't do anything, this is not a navigation
    if (event.target instanceof Element) {
      const interactiveElement = event.target.closest('button, input, label, select, [tabindex="1"]');
      if (interactiveElement) return;
    }

    if (!this.productTransitionEnabled) return;

    const { cardGallery } = this.refs;
    if (!cardGallery || !cardGallery.hasAttribute('data-view-transition-to-main-product')) return;

    // Check on the current active image, whether it's a product card image or a resource card image
    const { imagesToTransition } = this.refs;
    const activeImage =
      imagesToTransition?.find(
        (/** @type {HTMLImageElement} */ image) =>
          image.closest('slideshow-slide')?.getAttribute('aria-hidden') === 'false'
      ) || imagesToTransition?.[imagesToTransition.length - 1];

    if (activeImage instanceof HTMLImageElement) this.#setImageSrcset(activeImage);

    cardGallery.setAttribute('data-view-transition-type', 'product-image-transition');
    cardGallery.setAttribute('data-view-transition-triggered', 'true');
  }

  /**
   * Sets the srcset for the image
   * @param {HTMLImageElement} image
   */
  #setImageSrcset(image) {
    if (!this.featuredMediaUrl) return;

    const currentImageUrl = new URL(image.currentSrc);

    // Deliberately not using origin, as it includes the protocol, which is usually skipped for featured media
    const currentImageRawUrl = currentImageUrl.host + currentImageUrl.pathname;

    if (!this.featuredMediaUrl.includes(currentImageRawUrl)) {
      const imageFade = image.animate([{ opacity: 0.8 }, { opacity: 1 }], {
        duration: 125,
        easing: 'ease-in-out',
      });

      imageFade.onfinish = () => {
        image.srcset = this.featuredMediaUrl ?? '';
      };
    }
  }
}

if (!customElements.get('product-card-link')) {
  customElements.define('product-card-link', ProductCardLink);
}

/**
 * A custom element that displays a product card.
 * Extends ProductCardLink to inherit view transition functionality.
 *
 * @typedef {object} ProductCardRefs
 * @property {HTMLAnchorElement} productCardLink - The product card link element.
 * @property {import('slideshow').Slideshow} [slideshow] - The slideshow component.
 * @property {import('quick-add').QuickAddComponent} [quickAdd] - The quick add component.
 * @property {HTMLElement} [cardGallery] - The card gallery component.
 * @property {HTMLImageElement[]} [imagesToTransition] - The images to transition.
 * @extends {ProductCardLink<ProductCardRefs>}
 */
export class ProductCard extends ProductCardLink {
  requiredRefs = ['productCardLink'];

  get productPageUrl() {
    const link = this.refs.productCardLink;
    if (!link.getAttribute('href')) return '';

    const url = new URL(link.href);
    const variantOverride = this.#getProductPageVariantOverride();

    if (variantOverride?.action === 'set') {
      url.searchParams.set('variant', variantOverride.variantId);
    } else if (variantOverride?.action === 'remove') {
      url.searchParams.delete('variant');
    }

    return url.toString();
  }

  /**
   * Gets the user-selected variant ID that still needs to be synced from product-card state.
   * @returns {string | null} Variant ID or null.
   */
  getSelectedVariantId() {
    const variantOverride = this.#getProductPageVariantOverride();
    return variantOverride?.action === 'set' ? variantOverride.variantId : null;
  }

  /**
   * Gets the user-selected variant override for product-page URLs.
   * @returns {{ action: 'set', variantId: string } | { action: 'remove' } | null}
   */
  #getProductPageVariantOverride() {
    const link = this.refs.productCardLink;
    if (link.getAttribute('href')) {
      const url = new URL(link.href);
      if (url.searchParams.has('variant')) return null;
    }

    const variantId = this.#getCheckedVariantId();
    if (variantId === undefined) return null;

    return variantId ? { action: 'set', variantId } : { action: 'remove' };
  }

  /** @returns {string | undefined} */
  #getCheckedVariantId() {
    const checkedInput = /** @type {HTMLInputElement | null} */ (
      this.querySelector('input[type="radio"]:checked[data-variant-id]')
    );

    return checkedInput?.dataset.variantId;
  }

  /**
   * Gets the product card link element
   * @returns {HTMLAnchorElement | null} The product card link or null
   */
  getProductCardLink() {
    return this.refs.productCardLink || null;
  }

  #fetchProductPageHandler = () => {
    this.refs.quickAdd?.fetchProductPage(this.productPageUrl);
  };

  /**
   * Navigates to a URL link. Respects modifier keys for opening in new tab/window.
   * @param {Event} event - The event that triggered the navigation.
   * @param {URL} url - The URL to navigate to.
   */
  #navigateToURL = (event, url) => {
    // Check for modifier keys that should open in new tab/window (only for mouse events)
    const shouldOpenInNewTab =
      event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1);

    if (shouldOpenInNewTab) {
      event.preventDefault();
      window.open(url.href, '_blank');
      return;
    } else {
      window.location.href = url.href;
    }
  };

  connectedCallback() {
    super.connectedCallback();

    const link = this.refs.productCardLink;
    if (!(link instanceof HTMLAnchorElement)) throw new Error('Product card link not found');

    this.#handleQuickAdd();

    this.addEventListener(StandardEvents.productSelect, this.#handleProductSelect);
    this.addEventListener(SlideshowSelectEvent.eventName, this.#handleSlideshowSelect);
    mediaQueryLarge.addEventListener('change', this.#handleQuickAdd);

    this.addEventListener('click', this.navigateToProduct);

    // Synchronize which slide should rest on top (the first/featured image, or
    // the image of a selected variant), then preload the next slide's image so
    // the hover preview swaps without white flashes. Preload runs for every
    // card (not only nested slideshows), because the card gallery previews the
    // next image on hover on hover-capable devices.
    setTimeout(() => {
      this.#syncCardActiveSlide();
      this.#observeRestingImage();
      this.#preloadNextPreviewImage();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('click', this.navigateToProduct);
    this.#restingImageObserver?.disconnect();
    this.#restingImageObserver = null;
  }

  /**
   * Handles the quick add event.
   */
  #handleQuickAdd = () => {
    this.removeEventListener('pointerenter', this.#fetchProductPageHandler);
    this.removeEventListener('focusin', this.#fetchProductPageHandler);

    if (isDesktopBreakpoint()) {
      this.addEventListener('pointerenter', this.#fetchProductPageHandler);
      this.addEventListener('focusin', this.#fetchProductPageHandler);
    }
  };

  /**
   * Handles the product select event (variant selected and updated).
   * @param {ProductSelectEvent} event - The product select event.
   */
  #handleProductSelect = (event) => {
    // Update variant picker when variant:selected event fires
    const { optionValueId, variantId, connectedProductUrl } = event.detail ?? {};
    if (optionValueId && event.target !== this.variantPicker) {
      this.variantPicker?.updateSelectedOption(optionValueId);
    }

    // Empty string removes ?variant=.
    if (typeof variantId === 'string') {
      this.applyVariantToLinks(variantId, typeof connectedProductUrl === 'string' ? connectedProductUrl : undefined);
    }

    // Wait for variant:update data via promise
    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html } = detail;

        // Update price, availability, and URL based on new variant
        this.updatePrice(html);
        this.#isUnavailableVariantSelected(html);
        this.#updateProductUrl(html, typeof variantId === 'string' ? variantId : undefined);
        this.refs.quickAdd?.fetchProductPage(this.productPageUrl);

        if (event.target !== this.variantPicker) {
          this.variantPicker?.updateVariantPicker(html);
        }

        this.#updateVariantImages();
        this.#previousSlideIndex = null;

        // Remove attribute after re-rendering since a variant selection has been made
        this.removeAttribute('data-no-swatch-selected');

        // Force overflow list to reflow after variant update
        this.#updateOverflowList();
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[product-card] Event promise rejected:', error);
      });
  };

  /**
   * Forces the overflow list to recalculate by dispatching a reflow event.
   * This ensures the overflow counter displays correctly after variant updates.
   */
  #updateOverflowList() {
    // Find the overflow list in the variant picker
    const overflowList = this.querySelector('swatches-variant-picker-component overflow-list');
    const isActiveOverflowList = overflowList?.querySelector('[slot="overflow"]') ? true : false;
    if (!overflowList || !isActiveOverflowList) return;

    // Use requestAnimationFrame to ensure DOM has been updated
    requestAnimationFrame(() => {
      // Dispatch a reflow event to trigger recalculation
      overflowList.dispatchEvent(
        new CustomEvent('reflow', {
          bubbles: true,
          detail: {},
        })
      );
    });
  }

  /**
   * Updates the DOM with a new price.
   * @param {Document} html - The parsed HTML document with updated variant data.
   */
  updatePrice(html) {
    const priceContainer = this.querySelectorAll(`product-price [ref='priceContainer']`)[1];
    const newPriceElement = html.querySelector(`product-price [ref='priceContainer']`);

    if (newPriceElement && priceContainer) {
      morph(priceContainer, newPriceElement);
    }
  }

  /**
   * Updates the product URL based on the variant update.
   * @param {Document} html - The parsed HTML document with updated variant data.
   * @param {string} [intendedVariantId] - User-intended variant.
   */
  #updateProductUrl(html, intendedVariantId) {
    const responseProductCard = html.querySelector('product-card');
    const anchorElement = responseProductCard?.querySelector('a');
    const featuredMediaUrl = responseProductCard?.getAttribute('data-featured-media-url');

    // Update the featured media URL for view transitions (inherited from ProductCardLink)
    if (featuredMediaUrl) {
      this.setAttribute('data-featured-media-url', featuredMediaUrl);
    }

    if (anchorElement instanceof HTMLAnchorElement) {
      // If the href is empty, don't update the product URL eg: unavailable variant
      if (anchorElement.getAttribute('href')?.trim() === '') return;

      const responseUrl = new URL(anchorElement.href);
      this.#updateLinks({
        pathname: responseUrl.pathname,
        variantId: intendedVariantId ?? responseUrl.searchParams.get('variant'),
      });
    }
  }

  /**
   * Applies the given variant ID to the variant param of every link in the card.
   * Public so the components, namely swatches component can call it.
   * @param {string | null} variantId - The variant ID to set, or null to remove it.
   * @param {string} [productUrl] - Product URL path to adopt.
   */
  applyVariantToLinks(variantId, productUrl) {
    let pathname;
    if (productUrl) {
      try {
        pathname = new URL(productUrl, window.location.origin).pathname;
      } catch (error) {
        console.warn('[product-card] Invalid product URL:', productUrl, error);
        return;
      }
    }

    this.#updateLinks({ pathname, variantId });
  }

  /**
   * Updates every link in the card (overlay, gallery, and title) in place, preserving
   * each link's existing query params so tracking params stay in sync.
   * Always sets (or removes) the `variant` param; optionally adopts a new pathname (for combined-listing child navigation).
   * @param {object} options
   * @param {string} [options.pathname] - New pathname to adopt (combined-listing child navigation). Omit to keep each link's current path.
   * @param {string | null} [options.variantId] - Variant ID to set, or null/undefined to remove it.
   */
  #updateLinks({ pathname, variantId }) {
    const { productCardLink, productTitleLink, cardGalleryLink } = this.refs;
    for (const linkEl of [productCardLink, cardGalleryLink, productTitleLink]) {
      if (!(linkEl instanceof HTMLAnchorElement) || !linkEl.href) continue;
      const url = new URL(linkEl.href);
      if (pathname) url.pathname = pathname;
      if (variantId) url.searchParams.set('variant', variantId);
      else url.searchParams.delete('variant');
      linkEl.href = url.toString();
    }
  }

  /**
   * Checks if an unavailable variant is selected.
   * @param {Document} html - The parsed HTML document with updated variant data.
   */
  #isUnavailableVariantSelected(html) {
    const allVariants = /** @type {NodeListOf<HTMLInputElement>} */ (html.querySelectorAll('input:checked'));

    for (const variant of allVariants) {
      this.#toggleAddToCartButton(variant.dataset.optionAvailable === 'true');
    }
  }

  /**
   * Toggles the add to cart button state.
   * @param {boolean} enable - Whether to enable or disable the button.
   */
  #toggleAddToCartButton(enable) {
    const addToCartButton = this.querySelector('.add-to-cart__button button');

    if (addToCartButton instanceof HTMLButtonElement) {
      addToCartButton.disabled = !enable;
    }
  }

  /**
   * Hide the variant images that are not for the selected variant.
   */
  #updateVariantImages() {
    const { slideshow } = this.refs;
    if (!this.variantPicker?.selectedOption) {
      return;
    }

    this.#previewedSlides = [];

    const selectedImageId = this.variantPicker?.selectedOption.dataset.optionMediaId;

    if (slideshow && selectedImageId) {
      const { slides = [] } = slideshow.refs;

      for (const slide of slides) {
        if (slide.getAttribute('variant-image') == null) continue;

        slide.hidden = slide.getAttribute('slide-id') !== selectedImageId;
      }

      slideshow.select({ id: selectedImageId }, undefined, { animate: false });
    }

    this.#syncCardActiveSlide();
    this.#preloadRestingImage();
    this.#preloadNextPreviewImage();
  }

  /**
   * Marks the slide that should rest on top in the stacked hover layout.
   * By default this is the first image in the gallery; when a swatch is
   * selected it becomes that variant's image. This keeps the resting state
   * deterministic even though the slideshow's IntersectionObserver may mark
   * several stacked slides as "visible" simultaneously.
   */
  #syncCardActiveSlide() {
    const { slideshow } = this.refs;
    const slides =
      (slideshow?.refs.slides ?? []).length > 0
        ? slideshow.refs.slides
        : [...(slideshow?.querySelectorAll('slideshow-slide') ?? [])];
    if (!slides.length) return;

    let active = null;
    const selectedMediaId = this.variantPicker?.selectedOption?.dataset.optionMediaId;
    if (selectedMediaId) {
      active = slides.find((slide) => String(slide.getAttribute('slide-id')) === String(selectedMediaId));
    }
    active ??= slides.find((slide) => !slide.hasAttribute('hidden')) ?? slides[0];

    for (const slide of slides) {
      slide.toggleAttribute('data-card-active', slide === active);
    }
  }

  /**
   * Gets all variant inputs.
   * @returns {NodeListOf<HTMLInputElement>} All variant input elements.
   */
  get allVariants() {
    return this.querySelectorAll('input[data-variant-id]');
  }

  /**
   * Gets the variant picker component.
   * @returns {VariantPicker | null} The variant picker component.
   */
  get variantPicker() {
    return this.querySelector('swatches-variant-picker-component');
  }
  /** @type {number | null} */
  #previousSlideIndex = null;

  /** @type {{ element: HTMLElement, wasHidden: boolean }[]} */
  #previewedSlides = [];

  /**
   * Handles the slideshow select event.
   * @param {SlideshowSelectEvent} event - The slideshow select event.
   */
  #handleSlideshowSelect = (event) => {
    if (event.detail.userInitiated) {
      this.#previousSlideIndex = event.detail.index;
    }
  };

  /**
   * Previews a variant.
   * @param {string} id - The id of the variant to preview.
   */
  previewVariant(id) {
    const { slideshow } = this.refs;

    if (!slideshow) return;

    this.resetVariant.cancel();
    slideshow.select({ id }, undefined, { animate: false });
  }

  /**
   * Kicks the lazy loading of the slide's image so the hover crossfade never
   * reveals an unloaded/blank container. Works even while the slide is still
   * hidden (e.g. a variant-bound image with the `hidden` attribute).
   * @param {Element | null | undefined} slide - The slide containing the image.
   */
  #preloadSlideImage(slide) {
    const image = slide?.querySelector('img[loading="lazy"]');
    if (!(image instanceof HTMLImageElement)) return;

    // Remove the lazy hint: browsers skip `loading="lazy"` images inside
    // display:none/offscreen slides, which is exactly why the first hover
    // showed an empty (white) container instead of the second image.
    image.removeAttribute('loading');

    // Ask the browser to decode it so it is painted as soon as it is revealed.
    if (typeof image.decode === 'function') {
      image.decode().catch(() => {});
    }
  }

  /**
   * Kicks the lazy loading of the resting slide's image. The resting image
   * relies on the browser's lazy-load evaluation, which skips images inside
   * hidden/stacked slides and is only re-run on scroll events — leaving the
   * first image white until a refresh. Removing the lazy hint forces it to
   * fetch and decode on its own.
   */
  #preloadRestingImage() {
    const slides = this.#getPreviewSlides();
    const activeSlide = slides.find((slide) => slide.hasAttribute('data-card-active')) ?? slides[0];
    if (activeSlide instanceof HTMLElement) {
      this.#preloadSlideImage(activeSlide);
    }
  }

  /** @type {IntersectionObserver | null} */
  #restingImageObserver = null;

  /**
   * Ensures the resting image starts loading as soon as the card approaches
   * the viewport, instead of waiting for the browser's (sometimes skipped)
   * lazy-load re-evaluation. Cards already in or near the viewport are kicked
   * immediately; the rest wait for an IntersectionObserver with a margin so
   * the image is decoded by the time the user scrolls to it.
   */
  #observeRestingImage() {
    const cardGallery = this.refs.cardGallery;
    if (!(cardGallery instanceof HTMLElement)) return;

    const kick = () => {
      this.#restingImageObserver?.disconnect();
      this.#restingImageObserver = null;
      this.#preloadRestingImage();
    };

    const rect = cardGallery.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    if (rect.top < viewportHeight + 400 && rect.bottom > -400) {
      kick();
      return;
    }

    this.#restingImageObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            kick();
            break;
          }
        }
      },
      { rootMargin: '400px 0px' }
    );
    this.#restingImageObserver.observe(cardGallery);
  }

  /**
   * Ensures the image that follows the resting slide (including hidden
   * variant-bound images) is fetched and decoded ahead of the first hover.
   */
  #preloadNextPreviewImage() {
    const nextSlide = this.#getNextPreviewSlide();
    if (nextSlide instanceof HTMLElement) {
      this.#preloadSlideImage(nextSlide);
    }
  }

  /**
   * All slides of the card gallery in DOM order (hidden variant slides
   * included), so previews and preloads follow the gallery order regardless of
   * the slideshow's internal scroll/visibility state.
   * @returns {HTMLElement[]}
   */
  #getPreviewSlides() {
    const slideshow = this.refs.slideshow;
    if (slideshow && slideshow.refs.slides?.length) return slideshow.refs.slides;
    return [...(this.refs.cardGallery?.querySelectorAll('slideshow-slide') ?? [])];
  }

  /**
   * Finds the slide to preview on hover: the one that follows the resting
   * slide in gallery order, including hidden variant slides, so that images
   * attached to variants (e.g., colors) also show on hover. The resting slide
   * is resolved from the slide marked `data-card-active` (the featured/first
   * image, or the selected variant image) instead of `slideshow.current`,
   * which can drift out of sync with the rendered DOM after prior previews.
   * @returns {HTMLElement | null} The next slide element or null.
   */
  #getNextPreviewSlide() {
    const allSlides = this.#getPreviewSlides();
    if (allSlides.length < 2) return null;

    const currentSlide =
      allSlides.find((slide) => slide.hasAttribute('data-card-active')) ?? allSlides[0];

    const currentIndex = allSlides.indexOf(currentSlide);

    // No slide after the resting one (single image or resting on the last
    // media): there is nothing to preview.
    if (currentIndex < 0 || currentIndex >= allSlides.length - 1) return null;

    return allSlides[currentIndex + 1] ?? null;
  }

  /**
   * Previews the next image on hover without touching the slideshow's
   * scroll position, `aria-hidden` state or IntersectionObserver tracking.
   * The slide to show is marked with a `data-preview-hover` attribute and
   * styled purely by CSS, so it can never leak into the resting state.
   * @param {PointerEvent} event - The pointer event.
   */
  previewImage(event) {
    const nextSlide = this.#getNextPreviewSlide();
    if (!(nextSlide instanceof HTMLElement)) return;

    this.resetVariant.cancel();

    // Start the lazy image loading before the slide is revealed, then wait one
    // frame so the browser can resolve/decode it. This turns the first hover
    // into an animated crossfade instead of an empty (white) flash.
    this.#preloadSlideImage(nextSlide);

    this.#pendingPreview = nextSlide;
    requestAnimationFrame(() => {
      if (!this.isConnected || this.#pendingPreview !== nextSlide) return;
      this.#pendingPreview = null;
      this.#setPreviewSlide(nextSlide);
    });

    // Preload the slide after the previewed one (hidden variant slides can be
    // right behind it) so consecutive hovers stay instant.
    const allSlides = this.#getPreviewSlides();
    const previewIndex = allSlides.indexOf(nextSlide);
    if (previewIndex !== -1) {
      this.#preloadSlideImage(allSlides[previewIndex + 1]);
    }

    // On touch devices pointerleave may never fire, so the preview would stay
    // stuck forever. Clear it automatically after a brief delay so the card
    // always returns to its first image.
    if (!window.matchMedia('(hover: hover)').matches) {
      clearTimeout(this.#touchPreviewTimer);
      this.#touchPreviewTimer = setTimeout(() => this.#endPreview(), 1200);
    }
  }

  /**
   * The slide queued for hover preview but not yet revealed (waits one frame
   * for the preloaded image to be decoded). Cleared by #endPreview.
   * @type {HTMLElement | null}
   */
  #pendingPreview = null;

  /**
   * Timer that auto-clears the preview on touch devices where pointerleave
   * never fires. Cleared on pointer leave and on next preview.
   * @type {ReturnType<typeof setTimeout> | undefined}
   */
  #touchPreviewTimer = undefined;

  /**
   * Marks a slide for the hover preview: temporarily removes its `hidden`
   * attribute if it is a variant image so it can render, and flags it with
   * `data-preview-hover`. Also flags the card gallery with `data-previewing`
   * so the CSS crossfade hides the resting slide for the preview duration.
   * @param {HTMLElement} slide - The slide to preview.
   */
  #setPreviewSlide(slide) {
    const wasHidden = slide.hasAttribute('hidden');
    if (wasHidden) {
      slide.removeAttribute('hidden');
    }
    slide.setAttribute('data-preview-hover', '');
    this.#previewedSlides.push({ element: slide, wasHidden });
    this.refs.cardGallery?.setAttribute('data-previewing', '');
  }

  /**
   * Ends the hover preview: removes the preview markers and restores the
   * `hidden` attribute on slides that were temporarily revealed, so the card
   * always returns to its resting first image.
   */
  #endPreview() {
    clearTimeout(this.#touchPreviewTimer);
    this.#pendingPreview = null;
    this.refs.cardGallery?.removeAttribute('data-previewing');

    for (const { element, wasHidden } of this.#previewedSlides) {
      if (!element.isConnected) continue;
      element.removeAttribute('data-preview-hover');
      element.removeAttribute('reveal');
      if (wasHidden) {
        element.setAttribute('hidden', '');
      }
    }
    this.#previewedSlides = [];
  }

  /**
   * Resets the image, ending any hover preview so the card returns to its
   * resting image (the active slide).
   * @param {PointerEvent} event - The pointer event.
   */
  resetImage(event) {
    this.#endPreview();
  }

  /**
   * Resets the image to the variant image.
   */
  #resetVariant = () => {
    const { slideshow } = this.refs;

    if (!slideshow) return;

    this.#endPreview();

    // If we have a selected variant, always use its image
    if (this.variantPicker?.selectedOption) {
      const id = this.variantPicker.selectedOption.dataset.optionMediaId;
      if (id) {
        slideshow.select({ id }, undefined, { animate: false });
        return;
      }
    }

    // No variant selected - use initial slide if it's valid
    const initialSlide = slideshow.initialSlide;
    const slideId = initialSlide?.getAttribute('slide-id');
    if (initialSlide && slideshow.slides?.includes(initialSlide) && slideId) {
      slideshow.select({ id: slideId }, undefined, { animate: false });
      return;
    }

    // No valid initial slide or selected variant - go to previous
    slideshow.previous(undefined, { animate: false });
  };

  /**
   * Intercepts the click event on the product card anchor, we want
   * to use this to add an intermediate state to the history.
   * This intermediate state captures the page we were on so that we
   * navigate back to the same page when the user navigates back.
   * In addition to that, it captures the product card anchor so that we
   * have the specific product card in view.
   *
   * A product card can have other interactive elements like variant picker,
   * so we do not navigate if the click was on one of those elements.
   *
   * @param {Event} event
   */
  navigateToProduct = (event) => {
    if (!(event.target instanceof Element)) return;

    // Don't navigate if this product card is marked as no-navigation (e.g., in theme editor)
    if (this.hasAttribute('data-no-navigation')) return;

    const interactiveElement = event.target.closest('button, input, label, select, [tabindex="1"]');

    // If the click was on an interactive element, do nothing.
    if (interactiveElement) {
      return;
    }

    const link = this.refs.productCardLink;
    if (!link.href) return;
    const linkURL = new URL(link.href);

    const productCardAnchor = link.getAttribute('id');
    if (!productCardAnchor) return;

    const infiniteResultsList = this.closest('results-list[infinite-scroll="true"]');
    if (!window.Shopify.designMode && infiniteResultsList) {
      const url = new URL(window.location.href);
      const parent = this.closest('li');
      url.hash = productCardAnchor;
      if (parent && parent.dataset.page) {
        url.searchParams.set('page', parent.dataset.page);
      }

      yieldToMainThread().then(() => {
        history.replaceState({}, '', url.toString());
      });
    }

    const targetLink = event.target.closest('a');
    // Let the native navigation handle the click if it was on a link.
    if (!targetLink) {
      this.#navigateToURL(event, linkURL);
    }
  };

  /**
   * Resets the variant.
   */
  resetVariant = debounce(this.#resetVariant, 100);
}

if (!customElements.get('product-card')) {
  customElements.define('product-card', ProductCard);
}

/**
 * A custom element that displays a variant picker with swatches.
 * @typedef {import('@theme/variant-picker').VariantPickerRefs & {overflowList: HTMLElement}} SwatchesRefs
 */

/**
 * @extends {VariantPicker<SwatchesRefs>}
 */
class SwatchesVariantPickerComponent extends VariantPicker {
  /**
   * Handles card swatch changes.
   * @param {Event} event - The variant change event.
   */
  variantChanged(event) {
    if (!(event.target instanceof HTMLElement)) return;

    // Check if this is a swatch input
    const isSwatchInput = event.target instanceof HTMLInputElement && event.target.name?.includes('-swatch');
    const clickedSwatch = event.target;
    const hasAvailableVariant = clickedSwatch.dataset.hasAvailableVariant === 'true';
    const firstAvailableVariantId = clickedSwatch.dataset.firstAvailableOrFirstVariantId;

    // Request the first available variant for this swatch.
    if (isSwatchInput && hasAvailableVariant && firstAvailableVariantId) {
      event.stopPropagation();
      this.updateSelectedOption(clickedSwatch);

      const optionValueId = clickedSwatch.dataset.optionValueId || '';
      const connectedProductUrl = clickedSwatch.dataset.connectedProductUrl || '';
      const requestUrl = this.buildRequestUrl(clickedSwatch, 'product-card', [optionValueId]);

      this.fetchUpdatedSection(requestUrl, {
        detail: { optionValueId, variantId: firstAvailableVariantId, connectedProductUrl },
      });
      return;
    }

    // For all other cases, use the default behavior
    super.variantChanged(event);
  }

  /**
   * Shows all swatches.
   * @param {Event} [event] - The event that triggered the show all swatches.
   */
  showAllSwatches(event) {
    event?.preventDefault();

    const { overflowList } = this.refs;

    if (overflowList instanceof OverflowList) {
      overflowList.showAll();
    }
  }
}

if (!customElements.get('swatches-variant-picker-component')) {
  customElements.define('swatches-variant-picker-component', SwatchesVariantPickerComponent);
}
