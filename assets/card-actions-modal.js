(function() {
  function normalizeCart(cart) {
    if (!cart) return { id: '', totalQuantity: 0, cost: { totalAmount: { amount: '0', currencyCode: 'USD' } }, lines: [], discountCodes: [] };
    var currency = cart.currency || 'USD';
    return {
      id: cart.token || '',
      totalQuantity: cart.item_count || 0,
      cost: {
        totalAmount: {
          amount: String(cart.total_price != null ? cart.total_price : 0),
          currencyCode: currency
        }
      },
      lines: (cart.items || []).map(function(item) {
        var price = item.final_line_price != null ? item.final_line_price : item.line_price;
        return {
          id: item.key,
          quantity: item.quantity,
          cost: {
            totalAmount: {
              amount: String(price != null ? price : 0),
              currencyCode: currency
            }
          }
        };
      }),
      discountCodes: (cart.discount_codes || []).map(function(code) {
        return { code: code.code, applicable: code.applicable };
      })
    };
  }

  function getCartItemSectionIds() {
    var ids = [];
    document.querySelectorAll('cart-items-component').forEach(function(el) {
      var id = el.getAttribute('data-section-id');
      if (id) ids.push(id);
    });
    return ids.join(',');
  }

  function initProductActions() {
    document.querySelectorAll('.product-card-actions:not([data-initialized])').forEach(function(actions) {
      actions.setAttribute('data-initialized', 'true');

      var qtyValue = actions.querySelector('[data-qty-value]');
      var currentQty = 1;

      var minusBtn = actions.querySelector('[data-qty-minus]');
      var plusBtn = actions.querySelector('[data-qty-plus]');

      if (minusBtn) {
        minusBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          if (currentQty > 1) {
            currentQty--;
            if (qtyValue) qtyValue.textContent = currentQty;
          }
        });
      }

      if (plusBtn) {
        plusBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          currentQty++;
          if (qtyValue) qtyValue.textContent = currentQty;
        });
      }

      // Wishlist toggle
      var wishlistBtn = actions.querySelector('[data-wishlist-toggle]');
      if (wishlistBtn) {
        var productId = wishlistBtn.dataset.productId;
        var productData = {
          id: productId,
          handle: actions.dataset.productHandle || '',
          title: actions.dataset.productTitle || '',
          image: '',
          price: ''
        };

        // Collect product data from the card
        var cardGallery = actions.closest('.card-gallery');
        var cardImg = cardGallery ? cardGallery.querySelector('.product-media__image') || cardGallery.querySelector('img') : null;
        cardImg = cardImg || actions.querySelector('.product-media__image');
        if (cardImg) {
          productData.image = cardImg.dataset.src || cardImg.src || '';
        }
        var priceEl = cardGallery ? cardGallery.querySelector('.price') || cardGallery.querySelector('.price-item__group.price') : null;
        priceEl = priceEl || actions.querySelector('.price');
        if (priceEl) {
          productData.price = priceEl.textContent ? priceEl.textContent.trim() : '';
        }

        // Check localStorage for existing wishlist items to find image + price
        var stored = JSON.parse(localStorage.getItem('wishlist') || '[]');
        var existing = stored.find(function(item) { return item.id === productId; });
        if (existing) {
          productData.image = existing.image;
          productData.price = existing.price;
        }

        if (existing) {
          wishlistBtn.setAttribute('data-active', '');
        }
        wishlistBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          var list = JSON.parse(localStorage.getItem('wishlist') || '[]');
          var idx = list.findIndex(function(item) { return item.id === productId; });
          if (idx === -1) {
            list.push(productData);
            wishlistBtn.setAttribute('data-active', '');
          } else {
            list.splice(idx, 1);
            wishlistBtn.removeAttribute('data-active');
          }
          localStorage.setItem('wishlist', JSON.stringify(list));
          if (window.wishlistDrawer) window.wishlistDrawer.render();
        });
      }

      var addBtn = actions.querySelector('[data-add-to-cart]');
      if (addBtn) {
        addBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();

          var btn = this;
          if (btn.dataset.loading === 'true') return;

          var optionsCount = parseInt(actions.dataset.optionsCount) || 1;
          if (optionsCount > 1) {
            var cardContainer = actions.closest('.card-gallery') || actions.parentElement;
            var modal = cardContainer ? cardContainer.querySelector('.product-card-modal') : document.querySelector('.product-card-modal');
            if (modal) {
              btn.dataset.loading = 'true';
              btn.disabled = true;
              btn.classList.add('is-loading');
              setTimeout(function() {
                modal.showModal();
                document.body.style.overflow = 'hidden';
                btn.classList.remove('is-loading');
                btn.disabled = false;
                btn.dataset.loading = 'false';
              }, 1000);
            }
            return;
          }

          btn.dataset.loading = 'true';

          var addText = btn.querySelector('.product-card-actions__add-text');
          var variantId = actions.dataset.variantId;

          if (!variantId) {
            btn.dataset.loading = 'false';
            return;
          }

          btn.disabled = true;
          btn.classList.add('is-loading');
          if (addText) addText.textContent = 'Adding...';

          var deferred = {};
          deferred.promise = new Promise(function(resolve, reject) {
            deferred.resolve = resolve;
            deferred.reject = reject;
          });

          var event = new CustomEvent('shopify:cart:lines-update', {
            bubbles: true,
            cancelable: true
          });
          event.action = 'add';
          event.context = 'product-card';
          event.lines = [{ merchandiseId: String(variantId), quantity: currentQty }];
          event.promise = deferred.promise;
          addBtn.dispatchEvent(event);

          var formData = new FormData();
          formData.set('id', String(variantId));
          formData.set('quantity', String(currentQty));
          var sections = getCartItemSectionIds();
          if (sections) formData.append('sections', sections);

          fetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Accept': 'text/html' },
            body: formData
          })
          .then(function(response) { return response.json(); })
          .then(function(data) {
            if (data.status) throw new Error(data.message || 'Add to cart failed');
            return data;
          })
          .then(function(data) {
            requestAnimationFrame(function() {
              deferred.resolve({
                cart: normalizeCart(data),
                detail: {
                  sections: data.sections || {},
                  items: data.items || [],
                  itemCount: data.item_count || 0,
                  source: 'product-card-actions',
                  didError: false
                }
              });

              btn.classList.remove('is-loading');
              if (addText) addText.textContent = 'Added!';
              btn.disabled = false;
              btn.dataset.loading = 'false';
              currentQty = 1;
              if (qtyValue) qtyValue.textContent = '1';
            });

            setTimeout(function() {
              if (addText) addText.textContent = 'Add to Cart';
            }, 1500);
          })
          .catch(function(error) {
            deferred.reject(error);
            btn.classList.remove('is-loading');
            if (addText) addText.textContent = 'Add to Cart';
            btn.disabled = false;
            btn.dataset.loading = 'false';
          });
        });
      }
    });
  }

  function initProductModals() {
    document.querySelectorAll('.product-card-modal:not([data-modal-initialized])').forEach(function(modal) {
      modal.setAttribute('data-modal-initialized', 'true');

      var variantsScript = modal.querySelector('script[data-modal-variants]');
      var variants = [];
      if (variantsScript) {
        try { variants = JSON.parse(variantsScript.textContent); } catch(e) {}
      }

      function getSelectedValues() {
        var selectedValues = [];
        modal.querySelectorAll('.variant-option--buttons, .variant-option--swatches').forEach(function(fieldset) {
          var checked = fieldset.querySelector('input[type="radio"]:checked');
          if (checked) selectedValues.push(checked.value);
        });
        return selectedValues;
      }

      function findVariant(values) {
        return variants.find(function(v) {
          for (var i = 0; i < values.length; i++) {
            if (v['option' + (i + 1)] !== values[i]) return false;
          }
          return true;
        }) || variants[0] || null;
      }

      var initialVariant = findVariant(getSelectedValues());
      var selectedVariantId = initialVariant ? initialVariant.id : null;
      var currentQty = 1;
      var qtyValue = modal.querySelector('[data-modal-qty-value]');
      var priceEl = modal.querySelector('[data-modal-price]');

      var mainImage = modal.querySelector('[data-modal-main-image]');
      var images = [];
      var currentIndex = 0;
      modal.querySelectorAll('[data-modal-thumb]').forEach(function(thumb) {
        images.push({
          el: thumb,
          id: thumb.getAttribute('data-image-id'),
          src: thumb.getAttribute('data-src')
        });
      });

      function showImage(index) {
        if (!images.length || !mainImage) return;
        if (index < 0) index = images.length - 1;
        if (index >= images.length) index = 0;
        currentIndex = index;
        var image = images[index];
        if (mainImage.getAttribute('src') === image.src) return;
        mainImage.style.opacity = '0';
        var targetSrc = image.src;
        mainImage.onload = function() { mainImage.style.opacity = '1'; };
        mainImage.src = targetSrc;
        mainImage.setAttribute('data-image-id', image.id);
        modal.querySelectorAll('.product-card-modal__thumb').forEach(function(t) { t.classList.remove('is-active'); });
        if (image.el) image.el.classList.add('is-active');
        var counter = modal.querySelector('[data-modal-counter]');
        if (counter) counter.textContent = (index + 1) + ' / ' + images.length;
      }

      function syncImageForVariant(variant) {
        if (!variant || !variant.featured_image || !variant.featured_image.id) return;
        var imgId = String(variant.featured_image.id);
        for (var i = 0; i < images.length; i++) {
          if (images[i].id === imgId) {
            showImage(i);
            return;
          }
        }
      }

      modal.querySelectorAll('[data-modal-thumb]').forEach(function(thumb, i) {
        thumb.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          showImage(i);
        });
      });

      var prevBtn = modal.querySelector('[data-modal-prev]');
      var nextBtn = modal.querySelector('[data-modal-next]');
      if (prevBtn) {
        prevBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          showImage(currentIndex - 1);
        });
      }
      if (nextBtn) {
        nextBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          showImage(currentIndex + 1);
        });
      }

      var modalCounter = modal.querySelector('[data-modal-counter]');
      if (modalCounter && images.length) modalCounter.textContent = '1 / ' + images.length;
      syncImageForVariant(initialVariant);

      modal.querySelectorAll('.variant-option--buttons input[type="radio"], .variant-option--swatches input[type="radio"]').forEach(function(radio) {
        radio.addEventListener('change', function() {
          modal.querySelectorAll('.variant-option--buttons, .variant-option--swatches').forEach(function(fieldset) {
            var swatchValue = fieldset.querySelector('.variant-option__swatch-value');
            var checked = fieldset.querySelector('input[type="radio"]:checked');
            if (swatchValue && checked) swatchValue.textContent = checked.value;
          });

          var matched = findVariant(getSelectedValues());

          if (matched) {
            selectedVariantId = matched.id;
            if (priceEl && matched.price != null) {
              priceEl.textContent = new Intl.NumberFormat(document.documentElement.lang === 'ar' ? 'ar-EG' : 'en-US', { style: 'currency', currency: 'USD' }).format(matched.price / 100);
            }
            var formVariantId = modal.querySelector('[data-modal-form-variant-id]');
            if (formVariantId) formVariantId.value = matched.id;
            syncImageForVariant(matched);
          }
        });
      });

      var minusBtn = modal.querySelector('[data-modal-qty-minus]');
      var plusBtn = modal.querySelector('[data-modal-qty-plus]');
      var qtyInput = modal.querySelector('[data-modal-qty-input]');

      function syncFormQuantity() {
        var formQty = modal.querySelector('[data-modal-form-quantity]');
        if (formQty) formQty.value = currentQty;
        if (qtyValue) qtyValue.textContent = currentQty;
        if (qtyInput && parseInt(qtyInput.value) !== currentQty) qtyInput.value = currentQty;
      }

      if (qtyInput) {
        qtyInput.addEventListener('input', function() {
          var val = parseInt(this.value);
          if (!isNaN(val) && val >= 1) {
            currentQty = val;
            syncFormQuantity();
          }
        });
        qtyInput.addEventListener('change', function() {
          var val = parseInt(this.value);
          if (isNaN(val) || val < 1) val = 1;
          currentQty = val;
          this.value = currentQty;
          syncFormQuantity();
        });
      }

      if (minusBtn) {
        minusBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          if (currentQty > 1) {
            currentQty--;
            syncFormQuantity();
          }
        });
      }

      if (plusBtn) {
        plusBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          currentQty++;
          syncFormQuantity();
        });
      }

      var addBtn = modal.querySelector('[data-modal-add-to-cart]');
      if (addBtn) {
        addBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          if (!selectedVariantId) return;
          var btn = this;
          if (btn.disabled) return;
          btn.disabled = true;

          var cartIcon = btn.querySelector('.product-card-modal__cart-icon');
          var spinner = btn.querySelector('.product-card-modal__spinner');
          var addText = modal.querySelector('[data-modal-add-text]');
          if (cartIcon) cartIcon.style.display = 'none';
          if (spinner) spinner.style.display = 'inline-block';
          if (addText) addText.textContent = 'Adding...';

          var deferred = {};
          deferred.promise = new Promise(function(resolve, reject) {
            deferred.resolve = resolve;
            deferred.reject = reject;
          });

          var shopifyEvent = new CustomEvent('shopify:cart:lines-update', { bubbles: true, cancelable: true });
          shopifyEvent.action = 'add';
          shopifyEvent.lines = [{ merchandiseId: String(selectedVariantId), quantity: currentQty }];
          shopifyEvent.promise = deferred.promise;
          addBtn.dispatchEvent(shopifyEvent);

          var payload = { items: [{ id: parseInt(selectedVariantId), quantity: currentQty }] };
          var modalSections = getCartItemSectionIds();
          if (modalSections) payload.sections = modalSections.split(',');

          fetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.status) throw new Error(data.message || 'Add to cart failed');
              return data;
            })
            .then(function(data) {
              requestAnimationFrame(function() {
                deferred.resolve({
                  cart: data,
                  detail: { sections: data.sections || {}, items: data.items || [], itemCount: data.item_count || 0, source: 'product-card-modal', didError: false }
                });

                if (cartIcon) cartIcon.style.display = 'block';
                if (spinner) spinner.style.display = 'none';
                if (addText) addText.textContent = 'Added!';
                currentQty = 1;
                if (qtyValue) qtyValue.textContent = '1';
                syncFormQuantity();
              });

              setTimeout(function() {
                modal.close();
                document.body.style.overflow = '';
                btn.disabled = false;
                if (addText) addText.textContent = 'Add to Cart';
              }, 800);
            })
            .catch(function(error) {
              console.error('Add to cart error:', error);
              deferred.reject(error);
              if (cartIcon) cartIcon.style.display = 'block';
              if (spinner) spinner.style.display = 'none';
              if (addText) addText.textContent = 'Add to Cart';
              btn.disabled = false;
            });
        });
      }

      var buyBtn = modal.querySelector('[data-modal-buy-now]');
      if (buyBtn) {
        buyBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          var btn = this;
          if (btn.disabled) return;

          var variantId = selectedVariantId;
          if (!variantId) {
            var fallbackVariant = findVariant(getSelectedValues());
            if (fallbackVariant) variantId = fallbackVariant.id;
          }
          if (!variantId) return;

          btn.disabled = true;
          btn.textContent = 'Redirecting...';

          fetch('/cart/add.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: [{ id: parseInt(variantId), quantity: currentQty }] })
          })
            .then(function(r) { return r.json(); })
            .then(function(data) {
              if (data.status) throw new Error(data.message || 'Add to cart failed');
              window.location.href = '/checkout';
            })
            .catch(function(err) {
              btn.disabled = false;
              btn.textContent = 'Buy Now';
              document.dispatchEvent(new CustomEvent('shopify:cart:error', {
                bubbles: true,
                cancelable: true,
                detail: { message: err.message || 'Could not add to cart' }
              }));
            });
        });
      }

      var closeBtn = modal.querySelector('[data-modal-close]');
      if (closeBtn) {
        closeBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          modal.close();
        });
      }

      modal.addEventListener('click', function(e) {
        if (e.target === modal) {
          modal.close();
        }
      });

      modal.addEventListener('close', function() {
        // Defer the full-page re-layout (scroll unlock) past the first paint
        // after close — otherwise the overflow reset runs in the same frame
        // as the modal teardown and blocks it (INP presentation delay).
        setTimeout(function() {
          document.body.style.overflow = '';
        }, 0);
      });
    });
  }

  function initInjectedCards() {
    var queued = false;
    var observer = new MutationObserver(function(mutations) {
      var relevant = false;
      for (var i = 0; i < mutations.length; i++) {
        var nodes = mutations[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var node = nodes[j];
          if (!node || node.nodeType !== 1) continue;
          if (node.classList && (node.classList.contains('product-card-actions') || node.classList.contains('product-card-modal'))) {
            relevant = true;
            break;
          }
          if (node.querySelector && node.querySelector('.product-card-actions, .product-card-modal')) {
            relevant = true;
            break;
          }
        }
        if (relevant) break;
      }
      if (!relevant || queued) return;
      queued = true;
      requestAnimationFrame(function() {
        queued = false;
        initProductActions();
        initProductModals();
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      initProductActions();
      initProductModals();
      initInjectedCards();
    });
  } else {
    initProductActions();
    initProductModals();
    initInjectedCards();
  }

  document.addEventListener('shopify:section:load', function() {
    initProductActions();
    initProductModals();
  });
})();
