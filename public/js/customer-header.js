window.updateCustomerHeaderAccount = function (user) {
  window.DeliveryChat?.refresh();
  const label = document.getElementById("accountLabel");
  const avatar = document.getElementById("accountAvatar");
  const link = document.getElementById("profileLink");
  const name = user ? String(user.name || user.email || "Customer").trim() : "";
  if (label) label.textContent = name;
  if (avatar) {
    const parts = name.split(/\s+/).filter(Boolean);
    avatar.textContent = parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();
  }
  if (link) {
    link.setAttribute("aria-label", name ? `Profile: ${name}` : "Profile");
    link.setAttribute("data-tooltip", name ? `${name} - My account` : "My account");
  }
};
