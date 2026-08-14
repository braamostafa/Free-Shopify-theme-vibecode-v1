import { fetchConfig } from '@theme/utilities';
import { CartLinesUpdateEvent, CartErrorEvent } from '@shopify/events';

/**
 * "Complete your cart" carousel shown inside the cart drawer.
 * Displays the most recently added cart items as a scroll-snap slider and lets
 * the shopper add one more of a line directly from the drawer.
 *
 * Each "Add" button carries `data-add`, `data-variant-id`, `data-quantity`,
 * plus `data-add-text` / `data-added-text` for the button label swap.
 */
class CartCompleteCart extends HTMLElement {
  /** @type {((event: MouseEvent) => void) | undefined} */
  #boundClick;

  /** @type {(() => void) | undefined} */
  #boundPrev;

  /** @type {(() => void) | undefined} */
  #boundNext;

  connectedCallback() {
    this.#boundClick = (event) => {
      const addButton = event.target.closest('[data-add]');
      if (addButton && this.contains(addButton)) this.#handleAdd(addButton);
    };
    this.#boundPrev = () => this.scrollByStep(-1);
    this.#boundNext = () => this.scrollByStep(1);

    this.addEventListener('click', this.#boundClick);
    this.prevButton?.addEventListener('click', this.#boundPrev);
    this.nextButton?.addEventListener('click', this.#boundNext);
    this.track?.addEventListener('scroll', this.#updateArrows, { passive: true });
    this.#updateArrows();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#boundClick);
    this.prevButton?.removeEventListener('click', this.#boundPrev);
    this.nextButton?.removeEventListener('click', this.#boundNext);
    this.track?.removeEventListener('scroll', this.#updateArrows);
  }

  /** @type {HTMLElement | null} */
  get track() {
    return this.querySelector('[data-track]');
  }

  /** @type {HTMLButtonElement | null} */
  get prevButton() {
    return this.querySelector('[data-prev]');
  }

  /** @type {HTMLButtonElement | null} */
  get nextButton() {
    return this.querySelector('[data-next]');
  }

  scrollByStep(direction) {
    const track = this.track;
    if (!track) return;
    const step = Math.max(track.clientWidth * 0.6, 160);
    track.scrollBy({ left: direction * step, behavior: 'smooth' });
  }

  #updateArrows = () => {
    const track = this.track;
    if (!track) return;
    const tolerance = 4;
    const atStart = track.scrollLeft <= tolerance;
    const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - tolerance;
    this.prevButton?.toggleAttribute('disabled', atStart);
    this.nextButton?.toggleAttribute('disabled', atEnd);
  };

  #handleAdd(button) {
    if (button.disabled) return;
    const variantId = button.dataset.variantId;
    if (!variantId) return;

    button.disabled = true;
    this.#setLoadingState(button, true);

    const formData = new FormData();
    formData.set('id', variantId);
    formData.set('quantity', button.dataset.quantity || '1');

    const sectionIds = [];
    document.querySelectorAll('cart-items-component').forEach((el) => {
      const sectionId = el instanceof HTMLElement ? el.dataset.sectionId : undefined;
      if (sectionId) sectionIds.push(sectionId);
    });
    formData.append('sections', sectionIds.join(','));

    const deferredEventPromise = CartLinesUpdateEvent.createPromise();

    this.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'add',
        context: 'cart',
        lines: [{ merchandiseId: variantId, quantity: Number(formData.get('quantity')) }],
        promise: deferredEventPromise.promise,
      })
    );

    const cartAddUrl = window.Theme?.routes?.cart_add_url || '/cart/add.js';
    const config = fetchConfig('javascript', { body: formData });

    fetch(cartAddUrl, {
      ...config,
      headers: {
        ...config.headers,
        Accept: 'text/html',
      },
    })
      .then((response) => response.json())
      .then(async (response) => {
        if (response.status) {
          throw new Error(response.message || 'Add to cart failed');
        }

        const cart = await this.#fetchCart();

        deferredEventPromise.resolve({
          cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
          detail: {
            sections: response.sections,
            items: cart.items || [],
            itemCount: cart.item_count || 0,
            source: 'cart-complete-cart',
            didError: false,
          },
        });

        this.#setLoadingState(button, false);
        this.#setAddedState(button, true);
        setTimeout(() => this.#setAddedState(button, false), 1400);
      })
      .catch((error) => {
        deferredEventPromise.reject(error);
        this.dispatchEvent(
          new CartErrorEvent({
            error: error?.message || 'Add to cart failed',
            code: 'INVALID',
          })
        );
        this.#setLoadingState(button, false);
        this.#setAddedState(button, false);
        button.disabled = false;
      });
  }

  #fetchCart() {
    const cartUrl = window.Theme?.routes?.cart_url || '/cart';
    return fetch(`${cartUrl}.json`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    }).then((response) => {
      if (!response.ok) throw new Error(`Failed to fetch cart: ${response.status}`);
      return response.json();
    });
  }

  #setLoadingState(button, loading) {
    button.classList.toggle('is-loading', loading);
    button.setAttribute('aria-busy', String(loading));
  }

  #setAddedState(button, added) {
    const textEl = button.querySelector('[data-text-label]');
    const label = added ? button.dataset.addedText : button.dataset.addText;
    if (textEl && label) textEl.textContent = label;
    button.classList.toggle('is-added', added);
    if (added) {
      setTimeout(() => {
        button.disabled = false;
      }, 1400);
    }
  }
}

if (!customElements.get('cart-complete-cart')) {
  customElements.define('cart-complete-cart', CartCompleteCart);
}
