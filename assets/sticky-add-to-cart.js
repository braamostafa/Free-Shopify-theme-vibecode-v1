import { Component } from '@theme/component';
import { ThemeEvents, QuantitySelectorUpdateEvent } from '@theme/events';
import { morph } from '@theme/morph';
import { onAnimationEnd } from '@theme/utilities';
import { StandardEvents, ProductSelectEvent, CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

/**
 * @typedef {Object} ProductVariant
 * @property {string|number} [id] - Variant ID
 * @property {string} [title] - Variant title
 * @property {string} [name] - Variant name
 * @property {boolean} [available] - Whether variant is available
 * @property {Object} [featured_media] - Featured media object
 * @property {Object} [featured_media.preview_image] - Preview image data
 * @property {string} [featured_media.preview_image.src] - Image source URL
 * @property {string} [featured_media.alt] - Alt text for the image
 */

/**
 * @typedef {HTMLElement & {
 *   source: Element,
 *   destination: Element,
 *   useSourceSize: string | boolean
 * }} FlyToCart
 */

/**
 * @typedef {Object} StickyAddToCartRefs
 * @property {HTMLElement} stickyBar - The floating bar container
 * @property {HTMLButtonElement} addToCartButton - Sticky bar's button
 * @property {HTMLElement} quantityDisplay - Quantity display container
 * @property {HTMLElement} quantityNumber - Quantity number element
 * @property {HTMLImageElement} productImage - Product image element
 */

/**
 * A custom element that manages a sticky add-to-cart bar.
 * Shows when the main buy buttons scroll out of view.
 *
 * @extends {Component<StickyAddToCartRefs>}
 */
class StickyAddToCartComponent extends Component {
  requiredRefs = ['stickyBar', 'addToCartButton', 'quantityDisplay', 'quantityNumber'];

  /** @type {IntersectionObserver | null} */
  #buyButtonsIntersectionObserver = null;

  /** @type {number | undefined} */
  #resetTimeout;

  /** @type {boolean} */
  #isStuck = false;

  /** @type {number | null} */
  #animationTimeout = null;

  /** @type {AbortController} */
  #abortController = new AbortController();

  /** @type {HTMLButtonElement | null} */
  #targetAddToCartButton = null;

  /** @type {number} */
  #currentQuantity = 1;

  /** @type {boolean} */
  #pendingAdd = false;

  connectedCallback() {
    super.connectedCallback();

    this.#setupIntersectionObserver();

    const { signal } = this.#abortController;
    const target = this.closest('.shopify-section');
    target?.addEventListener(StandardEvents.productSelect, this.#handleProductSelect, { signal });

    document.addEventListener(StandardEvents.cartLinesUpdate, this.#handleCartAddComplete, { signal });
    document.addEventListener(StandardEvents.cartError, this.#handleCartAddComplete, { signal });
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#handleQuantityUpdate, { signal });

    this.#getInitialQuantity();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#buyButtonsIntersectionObserver?.disconnect();
    this.#abortController.abort();
    if (this.#animationTimeout) {
      clearTimeout(this.#animationTimeout);
    }
  }

  /**
   * Sets up the IntersectionObserver to watch the buy buttons visibility
   */
  #setupIntersectionObserver() {
    const productForm = this.#getProductForm();
    if (!productForm) return;

    // Watch the actual add-to-cart button when available, otherwise the buy buttons block
    const target = productForm.querySelector('[ref="addToCartButton"]') ?? productForm.closest('.buy-buttons-block');
    if (!target) return;

    // Observer for buy buttons visibility.
    // The sticky bar appears whenever the main add-to-cart button leaves the viewport
    // and disappears as soon as it comes back into view. It stays visible
    // everywhere else, including at the bottom of the page.
    this.#buyButtonsIntersectionObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;

      if (!entry.isIntersecting && !this.#isStuck) {
        this.#showStickyBar();
      } else if (entry.isIntersecting && this.#isStuck) {
        this.#hideStickyBar();
      }
    });

    this.#buyButtonsIntersectionObserver.observe(target);
    this.#targetAddToCartButton = productForm.querySelector('[ref="addToCartButton"]');
  }

  // Public action handlers
  /**
   * Handles the add to cart button click in the sticky bar.
   * Delegates to the main add-to-cart button so the standard cart flow runs,
   * shows a loading spinner until the request settles, then reveals the
   * success state and the cart drawer auto-opens.
   */
  handleAddToCartClick = async () => {
    const { addToCartButton } = this.refs;
    if (!this.#targetAddToCartButton || addToCartButton.disabled || this.#pendingAdd) return;

    // Delegate to the main add-to-cart button. The flag is set before the
    // click so the synchronously dispatched cart event is captured.
    this.#targetAddToCartButton.dataset.puppet = 'true';
    this.#pendingAdd = true;
    addToCartButton.classList.add('is-loading');
    this.#targetAddToCartButton.click();
  };

  /**
   * Shows the success checkmark and plays the fly-to-cart animation once
   * the product has actually been added to the cart.
   */
  #triggerAddedState() {
    const { addToCartButton, productImage } = this.refs;
    if (this.#resetTimeout) clearTimeout(this.#resetTimeout);

    if (addToCartButton.dataset.added !== 'true') {
      addToCartButton.dataset.added = 'true';
    }

    const scheduleReset = () => {
      this.#resetTimeout = setTimeout(() => {
        addToCartButton.removeAttribute('data-added');
      }, 800);
    };

    const cartIcon = document.querySelector('.header-actions__cart-icon');
    if (!cartIcon || !(productImage instanceof Element) || productImage.offsetParent === null) {
      scheduleReset();
      return;
    }

    const flyToCartElement = /** @type {FlyToCart} */ (document.createElement('fly-to-cart'));
    flyToCartElement.classList.add('fly-to-cart--sticky');
    flyToCartElement.style.setProperty('background-image', `url(${productImage.src})`);
    flyToCartElement.useSourceSize = 'true';
    flyToCartElement.source = productImage;
    flyToCartElement.destination = cartIcon;

    document.body.appendChild(flyToCartElement);

    onAnimationEnd([addToCartButton, flyToCartElement]).then(scheduleReset);
  }

  /**
   * Handles the sticky bar quantity increase button click.
   * Proxies the click to the main product form quantity selector.
   * @param {Event} [event] - The click event
   */
  stickyIncreaseQuantity = (event) => {
    event?.preventDefault();
    this.#proxyQuantityClick('plus');
  };

  /**
   * Handles the sticky bar quantity decrease button click.
   * Proxies the click to the main product form quantity selector.
   * @param {Event} [event] - The click event
   */
  stickyDecreaseQuantity = (event) => {
    event?.preventDefault();
    this.#proxyQuantityClick('minus');
  };

  /**
   * Handles product select events (variant selected and updated)
   * @param {ProductSelectEvent} event - The product select event
   */
  #handleProductSelect = (event) => {
    if (!(event.target instanceof Element) || event.target.closest('product-card')) return;

    // Update variant ID from the event detail (variant:selected part)
    const { optionValueId } = event.detail ?? {};
    if (optionValueId) {
      this.dataset.currentVariantId = optionValueId;
    }

    // Wait for the promise to resolve with variant update data
    event.promise
      .then(({ detail }) => {
        if (!detail?.html) return;

        const { html, productId, resource: variant } = detail;

        if (productId && productId !== this.dataset.productId) return;

        // Get the new sticky add to cart HTML from the server response
        const newStickyAddToCart = /** @type {HTMLElement | null} */ (html.querySelector('sticky-add-to-cart'));
        if (!newStickyAddToCart) return;

        const newStickyBar = newStickyAddToCart.querySelector('[ref="stickyBar"]');
        if (!newStickyBar) return;

        // Store current visibility state before morphing
        const currentStuck = this.refs.stickyBar.getAttribute('data-stuck') || 'false';
        const variantAvailable = newStickyAddToCart.dataset.variantAvailable;

        // Morph the entire sticky bar content
        morph(this.refs.stickyBar, newStickyBar, { childrenOnly: true });

        // Restore visibility state after morphing
        this.refs.stickyBar.setAttribute('data-stuck', currentStuck);
        this.dataset.variantAvailable = variantAvailable;

        // Update the dataset attributes with new variant info
        if (variant && variant.id) {
          this.dataset.currentVariantId = variant.id;
        }

        // Re-cache the target add to cart button after morphing
        const productForm = this.#getProductForm();
        if (productForm) {
          this.#targetAddToCartButton = productForm.querySelector('[ref="addToCartButton"]');
        }

        if (variant == null) {
          this.#handleVariantUnavailable();
        }
        // Restore the current quantity display if needed
        this.#updateButtonText();
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') console.warn('[sticky-add-to-cart] Event promise rejected:', error);
      });
  };

  /**
   * Updates the variant title based on selected options when the variant is unavailable
   */
  #handleVariantUnavailable = () => {
    this.dataset.currentVariantId = '';
    const variantTitleElement = this.querySelector('.sticky-add-to-cart__variant');
    const productId = this.dataset.productId;
    const variantPicker = document.querySelector(`variant-picker[data-product-id="${productId}"]`);
    if (!variantTitleElement || !variantPicker) return;

    const selectedOptions = Array.from(variantPicker.querySelectorAll('input:checked'))
      .map((option) => /** @type {HTMLInputElement} */ (option).value)
      .filter((value) => value !== '')
      .join(' / ');
    if (!selectedOptions) return;
    variantTitleElement.textContent = selectedOptions;
  };

  /**
   * Handles cart add complete (success or error) - resets puppet flag and
   * resolves the sticky button's loading/success state.
   * @param {CartLinesUpdateEvent | CartErrorEvent} event - The cart event
   */
  #handleCartAddComplete = (event) => {
    // Reset the puppet flag only after the cart operation's promise settles,
    // not when the event is first dispatched (before the HTTP request completes).
    const resetPuppet = () => {
      if (this.#targetAddToCartButton) {
        this.#targetAddToCartButton.dataset.puppet = 'false';
      }
    };

    // CartLinesUpdateEvent has a promise; CartErrorEvent does not (error already happened).
    if ('promise' in event && event.promise instanceof Promise) {
      event.promise.finally(resetPuppet);
    } else {
      resetPuppet();
    }

    // Only respond to adds triggered from the sticky bar itself
    if (!this.#pendingAdd) return;

    const { addToCartButton } = this.refs;
    const finish = (didError) => {
      this.#pendingAdd = false;
      addToCartButton.classList.remove('is-loading');
      if (!didError) {
        this.#triggerAddedState();
      }
    };

    if ('promise' in event && event.promise instanceof Promise) {
      event.promise
        .then(({ detail }) => finish(Boolean(detail?.didError)))
        .catch(() => finish(true));
    } else {
      finish(true);
    }
  };

  /**
   * Handles quantity selector update events
   * @param {QuantitySelectorUpdateEvent} event - The quantity update event
   */
  #handleQuantityUpdate = (event) => {
    // Only respond to product page quantity selector updates, not cart drawer
    if (event.detail.cartLine) return;

    this.#currentQuantity = event.detail.quantity;
    this.#updateButtonText();
  };

  /**
   * Shows the sticky bar with animation
   */
  #showStickyBar() {
    const { stickyBar } = this.refs;
    this.#isStuck = true;
    stickyBar.dataset.stuck = 'true';
  }

  /**
   * Hides the sticky bar with animation
   */
  #hideStickyBar() {
    const { stickyBar } = this.refs;
    this.#isStuck = false;
    stickyBar.dataset.stuck = 'false';
  }

  // Helper methods
  /**
   * Gets the product form element
   * @returns {HTMLElement | null}
   */
  #getProductForm() {
    const productId = this.dataset.productId;
    if (!productId) return null;

    const sectionElement = this.closest('.shopify-section');
    if (!sectionElement) return null;

    const sectionId = sectionElement.id.replace('shopify-section-', '');
    return document.querySelector(
      `#shopify-section-${sectionId} product-form-component[data-product-id="${productId}"]`
    );
  }

  /**
   * Gets the initial quantity from the data attribute
   */
  #getInitialQuantity() {
    this.#currentQuantity = parseInt(this.dataset.initialQuantity || '1') || 1;
    this.#updateButtonText();
  }

  /**
   * Updates the button text to include quantity
   */
  #updateButtonText() {
    const { addToCartButton, quantityDisplay, quantityNumber } = this.refs;

    const available = !addToCartButton.disabled;

    // Update the quantity number
    quantityNumber.textContent = this.#currentQuantity.toString();

    // Show/hide the quantity stepper based on availability
    quantityDisplay.style.display = available ? 'flex' : 'none';
  }

  /**
   * Finds the main product form quantity selector component
   * @returns {HTMLElement | null}
   */
  #getMainQuantitySelector() {
    const productForm = this.#getProductForm();
    return productForm?.querySelector('quantity-selector-component') ?? null;
  }

  /**
   * Proxies a quantity button click to the main product form quantity selector
   * @param {'plus' | 'minus'} buttonName - The name of the button to click
   */
  #proxyQuantityClick(buttonName) {
    const quantitySelector = this.#getMainQuantitySelector();
    const button = quantitySelector?.querySelector(`button[name="${buttonName}"]`);
    button?.click();
  }
}

if (!customElements.get('sticky-add-to-cart')) {
  customElements.define('sticky-add-to-cart', StickyAddToCartComponent);
}
