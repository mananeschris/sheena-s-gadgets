const params = new URLSearchParams(location.search);
const orderId = Number(params.get('order_id'));
let currentUser, selectedOrder, selectedRating = 5, reviewImages = [], reviewVideo = null, reviewUrls = [], reviewBusy = false;
const ratingDescriptions = ['Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[value])); }
function reviewMessage(message) { const target = document.getElementById('reviewMessage'); target.textContent = message; target.hidden = !message; }
function renderRating() {
  document.getElementById('ratingButtons').innerHTML = Array.from({ length: 5 }, (_, i) => `<button type="button" role="radio" aria-label="${i + 1} star${i ? 's' : ''}" aria-checked="${selectedRating === i + 1}" tabindex="${selectedRating === i + 1 ? 0 : -1}" class="star-btn ${i < selectedRating ? 'active' : ''}" onclick="setRating(${i + 1})" onkeydown="ratingKey(event, ${i + 1})"><i data-lucide="star" aria-hidden="true"></i></button>`).join('');
  document.getElementById('ratingDescription').textContent = ratingDescriptions[selectedRating - 1];
  window.lucide?.createIcons();
}
function setRating(value) { selectedRating = value; renderRating(); document.querySelector(`[aria-label="${value} star${value > 1 ? 's' : ''}"]`)?.focus(); }
function ratingKey(event, value) { const keys = { ArrowRight: Math.min(5, value + 1), ArrowUp: Math.min(5, value + 1), ArrowLeft: Math.max(1, value - 1), ArrowDown: Math.max(1, value - 1), Home: 1, End: 5 }; if (keys[event.key]) { event.preventDefault(); setRating(keys[event.key]); } }
function renderOrder() {
  const item = selectedOrder.items?.[0];
  const name = selectedOrder.items?.length > 1 ? `${selectedOrder.items.length} items` : item?.product_name || selectedOrder.product_name || 'Product';
  let images = []; try { images = JSON.parse(selectedOrder.product_images || '[]'); } catch { /* Use the stored primary image. */ }
  const image = item?.product_image || selectedOrder.product_image || images[0] || '/assets/sheena-mark.svg';
  const variant = item?.variant_name || selectedOrder.variant_name;
  document.getElementById('orderBox').innerHTML = `<div class="order-row"><div class="review-product-image"><img src="${escapeHtml(image)}" alt="${escapeHtml(name)}"></div><div class="order-copy"><span class="review-delivered"><i data-lucide="package-check" aria-hidden="true"></i>Delivered</span><strong>${escapeHtml(name)}</strong>${variant ? `<div class="muted">${escapeHtml(variant)}</div>` : ''}<dl class="review-purchase-details"><div><dt>Quantity</dt><dd>${selectedOrder.quantity || item?.quantity || 1}</dd></div><div><dt>Order total</dt><dd>&#8369;${Number(selectedOrder.total_price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd></div></dl></div></div>`;
  window.lucide?.createIcons();
}
function validMedia(files, type) { return files.every(file => file.type.startsWith(type + '/') && file.size <= 50 * 1024 * 1024); }
function addImages(input) {
  const files = [...input.files]; input.value = '';
  if (reviewBusy || !files.length) return;
  if (reviewImages.length + files.length > 5) return reviewMessage('You can add up to 5 photos.');
  if (!validMedia(files, 'image')) return reviewMessage('Choose image files of 50 MB or smaller.');
  reviewImages.push(...files); reviewMessage(''); previewMedia();
}
function addVideo(input) {
  const video = input.files[0]; input.value = '';
  if (reviewBusy || !video) return;
  if (!validMedia([video], 'video')) return reviewMessage('Choose a video of 50 MB or smaller.');
  reviewVideo = video; reviewMessage(''); previewMedia();
}
function removeReviewMedia(index, video = false) { if (reviewBusy) return; if (video) reviewVideo = null; else reviewImages.splice(index, 1); previewMedia(); }
function previewMedia() {
  document.getElementById('reviewPhotoCount').textContent = `${reviewImages.length} of 5 added`;
  document.getElementById('reviewVideoCount').textContent = `${reviewVideo ? 1 : 0} of 1 added`;
  reviewUrls.forEach(url => URL.revokeObjectURL(url)); reviewUrls = [];
  const url = file => { const value = URL.createObjectURL(file); reviewUrls.push(value); return value; };
  document.getElementById('imagePreview').innerHTML = reviewImages.map((file, i) => `<div class="review-photo"><img src="${url(file)}" alt="Review photo ${i + 1}"><button type="button" class="review-remove" title="Remove photo ${i + 1}" aria-label="Remove photo ${i + 1}" onclick="removeReviewMedia(${i})"><i data-lucide="x" aria-hidden="true"></i></button></div>`).join('');
  document.getElementById('videoPreview').innerHTML = reviewVideo ? `<div class="review-video"><video controls muted playsinline src="${url(reviewVideo)}"></video><button type="button" class="review-remove" title="Remove video" aria-label="Remove video" onclick="removeReviewMedia(0, true)"><i data-lucide="x" aria-hidden="true"></i></button></div>` : '';
  window.lucide?.createIcons();
}
async function loadOrder() {
  try {
    currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
    if (!currentUser || String(currentUser.role).toLowerCase() !== 'customer') { location.href = '/auth.html?returnTo=' + encodeURIComponent(location.pathname + location.search); return; }
    if (!orderId) throw new Error('Select a delivered order from your Profile to write a review.');
    const response = await fetch(`/orders/customer/${currentUser.id}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load order.');
    selectedOrder = (Array.isArray(data) ? data : []).find(order => Number(order.id) === orderId);
    if (!selectedOrder) throw new Error('Order not found in your account.');
    if (selectedOrder.status !== 'delivered') throw new Error('Only delivered orders can be reviewed.');
    renderOrder(); document.getElementById('submitBtn').disabled = false;
  } catch (error) { document.getElementById('orderBox').innerHTML = `<p>${escapeHtml(error.message || 'Unable to load order.')}</p><button type="button" class="btn btn-outline-dark" onclick="loadOrder()"><i data-lucide="refresh-cw" aria-hidden="true"></i>Try Again</button>`; window.lucide?.createIcons(); }
}
async function submitReview(event) {
  event?.preventDefault();
  if (reviewBusy || !selectedOrder || selectedOrder.status !== 'delivered') return;
  reviewBusy = true; reviewMessage('');
  document.querySelectorAll('#reviewForm button, #reviewForm input, #reviewForm textarea').forEach(control => control.disabled = true);
  const label = document.querySelector('#submitBtn span'); label.textContent = 'Submitting...';
  try {
    const form = new FormData(); form.append('order_id', orderId); form.append('user_id', currentUser.id); form.append('rating', selectedRating); form.append('comment', document.getElementById('comment').value.trim());
    reviewImages.forEach(file => form.append('images', file)); if (reviewVideo) form.append('video', reviewVideo);
    const response = await fetch('/reviews', { method: 'POST', body: form }); const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to submit review.');
    location.href = '/customer/profile.html';
  } catch (error) { reviewMessage(error.message || 'Unable to submit review. Please retry.'); }
  finally { reviewBusy = false; document.querySelectorAll('#reviewForm button, #reviewForm input, #reviewForm textarea').forEach(control => control.disabled = false); label.textContent = 'Submit Review'; }
}
document.addEventListener('DOMContentLoaded', () => {
  renderRating(); loadOrder();
  document.getElementById('reviewForm').addEventListener('submit', submitReview);
  document.getElementById('comment').addEventListener('input', event => { document.getElementById('commentCount').textContent = `${event.target.value.length} / 1,000`; });
});
window.addEventListener('pagehide', () => reviewUrls.forEach(url => URL.revokeObjectURL(url)));
