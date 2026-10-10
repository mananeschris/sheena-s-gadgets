    let currentUser = null;
    let customerAccount = null;
    let currentViewingOrderId = null;
    let orders = [];
    let ordersLoadError = false;
    const repairRequestsInFlight = new Set();
    let installmentApplications = [];
    let installmentSchedules = [];
    let layaways = [];
    let layawayLoadError = false;
    let customerStatement = null;
    let notifications = [];
    let wishlistProducts = [];
    let activeFilter = "all";
    let orderLinkHandled = false;
    let customerAddresses = [];
    let editingAddressId = null;
    let deliveryLocationMap = null;
    let deliveryLocationMarker = null;
    let deliveryMapEngine = "";

    function money(value) {
      return `₱${Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;
    }

    function orderDate(value) {
      return new Date(value).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    function getBucket(order) {
      const status = window.CustomerDeliveryStatus.status(order);
      const paymentStatus = String(order.payment_status || "").toLowerCase();
      const installmentStatus = String(order.installment_application_status || "").toLowerCase();

      if (status === "cancelled") return "cancelled";
      if (status === "pending" && isGCashMethod(order.payment_method) && paymentStatus === "for_verification") return "waiting-approval";
      if (status === "pending" && isGCashMethod(order.payment_method) && paymentStatus === "paid") return "placed";
      if (status === "pending" && !isGCashMethod(order.payment_method) && paymentStatus === "to_collect") return "placed";
      if (status === "delivered") return "completed";
      if (status === "out_for_delivery") return "out-for-delivery";
      if (status === "shipped") return "to-receive";
      if (status === "processing") return "to-ship";
      const needsPayment = [
        "pending_verification",
        "to_collect",
        "payment_setup_failed",
        "awaiting_payment_setup",
        "installment_application_pending",
        "installment_application_failed",
        "installment_downpayment_pending",
        "installment_downpayment_failed",
        "installment_downpayment_expired",
        "installment_approved_downpayment_pending"
      ].includes(paymentStatus);

      if (status === "pending" || needsPayment || installmentStatus === "pending") return "to-pay";
      return "to-pay";
    }

    const CUSTOMER_ORDER_STATUS_LABELS = {
      pending: "Order Placed",
      processing: "Processing",
      shipped: "Ready",
      out_for_delivery: "Out for Delivery",
      delivered: "Completed",
      cancelled: "Cancelled"
    };

    const ORDER_TRACKING_STEPS = [
      { key: "pending", label: "Order Placed", dateField: "created_at" },
      { key: "processing", label: "Processing", dateField: "processing_at" },
      { key: "shipped", label: "Ready", dateField: "shipped_at" },
      { key: "out_for_delivery", label: "Out for Delivery", dateField: "out_for_delivery_at" },
      { key: "delivered", label: "Completed", dateField: "delivered_at" }
    ];

    function customerOrderStatusLabel(order) {
      const status = window.CustomerDeliveryStatus.status(order);
      if (status === "pending" && isGCashMethod(order.payment_method)) {
        const paymentStatus = order.payment_status || "pending_payment";
        if (paymentStatus === "pending_payment") return "Payment Needed";
        if (paymentStatus === "for_verification") return "Waiting for Admin Approval";
        if (paymentStatus === "rejected") return "Proof Rejected · Re-upload";
        if (paymentStatus === "paid") return "Order Placed";
      }
      return CUSTOMER_ORDER_STATUS_LABELS[status] || status;
    }

    function orderStatusIndex(status) {
      const index = ORDER_TRACKING_STEPS.findIndex(step => step.key === (status || "pending"));
      return index >= 0 ? index : 0;
    }

    function trackingDate(order, step, isDone, compact = false) {
      const value = order[step.dateField] || (step.key === "pending" ? order.created_at : null);
      if (!value || !isDone) return "Waiting";
      return compact ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : orderDate(value);
    }

    function orderTrackingHtml(order, compact = false) {
      const status = window.CustomerDeliveryStatus.status(order);
      if (status === "cancelled") {
        return `<div class="tracking-cancelled">Order cancelled${order.cancellation_admin_note ? `: ${escapeHtml(order.cancellation_admin_note)}` : ""}</div>`;
      }

      const activeIndex = orderStatusIndex(status);
      return `
        <div class="tracking-timeline ${compact ? "compact" : ""}">
          ${ORDER_TRACKING_STEPS.map((step, index) => {
            const isDone = index <= activeIndex;
            const isCurrent = index === activeIndex;
            return `
              <div class="tracking-step ${isDone ? "done" : ""} ${isCurrent ? "current" : ""}">
                <span class="tracking-dot"></span>
                <strong>${escapeHtml(step.key === "pending" && status === "pending" ? customerOrderStatusLabel(order) : step.label)}</strong>
                <span>${escapeHtml(trackingDate(order, step, isDone, compact))}</span>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }
    function statusHistoryHtml(order) {
      const history = Array.isArray(order.status_history) ? order.status_history : [];
      if (!history.length) return "";

      return `
        <div class="tracking-history">
          <div class="tracking-history-title">Tracking History</div>
          ${history.map(item => `
            <div class="tracking-history-item">
              <div>
              <strong>${escapeHtml(item.status === "pending" ? "Order Submitted" : CUSTOMER_ORDER_STATUS_LABELS[item.status] || item.status)}</strong>
                <span>${escapeHtml(orderDate(item.created_at))}</span>
              </div>
              <div>
                <strong>${escapeHtml(item.note || "Status updated.")}</strong>
                <span>${escapeHtml(item.actor_name || "System")}</span>
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }
    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function deliveryLine(order) {
      if (!order.delivery_address) return "";
      return `<span>Deliver to: ${escapeHtml(order.delivery_address)}</span>`;
    }

    function deliveryNoteLine(order) {
      if (!order.delivery_note) return "";
      return `<span>Note: ${escapeHtml(order.delivery_note)}</span>`;
    }

    function shippingRegionLabel(order) {
      const labels = {
        local: "Local / Nearby Sogod-Bacacay",
        luzon: "Luzon",
        visayas: "Visayas"
      };
      const key = String(order.shipping_region || "").toLowerCase();
      return labels[key] || order.shipping_region || "";
    }

    function shippingLine(order) {
      const label = shippingRegionLabel(order);
      const fee = Number(order.shipping_fee || 0);
      if (!label && !fee) return "";
      return `<span>Shipping: ${escapeHtml(label || "Delivery")} - ${money(fee)}</span>`;
    }

    function paymentStatusLabel(order) {
      const labels = {
        to_collect: "To Collect",
        pending_payment: "Submit GCash Proof",
        for_verification: "Checking GCash",
        rejected: "GCash Proof Rejected",
        installment_application_pending: "Installment Application Pending",
        installment_downpayment_pending: "Installment Downpayment Pending",
        installment_downpayment_paid: "Installment Downpayment Paid",
        installment_downpayment_expired: "Installment Downpayment Expired",
        installment_approved_downpayment_pending: "Approved, Waiting Downpayment",
        installment_active: "Installment Active",
        installment_rejected: "Installment Rejected",
        installment_downpayment_failed: "Installment Downpayment Failed",
        installment_completed: "Installment Completed",
        pending_verification: "Checking GCash",
        awaiting_payment_setup: "Payment Setup Needed",
        payment_setup_failed: "Payment Failed",
        paid: "Paid",
        failed: "Failed",
        expired: "Expired",
        cancelled: "Cancelled"
      };
      const status = order.payment_status || (String(order.payment_method || "cod") === "cod" ? "to_collect" : "pending_payment");
      return labels[status] || status;
    }

    function isGCashMethod(method) {
      const value = String(method || "").toLowerCase();
      return value === "gcash" || Boolean(value && !["cod", "cash", "installment", "manual", "pos"].includes(value));
    }

    function isOldPaymentUrl(url) {
      return /gcash/i.test(String(url || ""));
    }

    function usableCheckoutUrl(record) {
      const url = record?.payment_checkout_url || "";
      return isOldPaymentUrl(url) ? "" : url;
    }

    function paymentMethodLabel(method) {
      const value = String(method || "cod").toLowerCase();
      if (isGCashMethod(value)) return "GCash";
      if (value === "cod") return "Cash on Delivery";
      if (value === "cash") return "Cash";
      if (value === "installment") return "Installment";
      return String(method || "").toUpperCase();
    }

    function installmentApplicationStatusLabel(status) {
      const labels = {
        pending: "Pending Admin Review",
        approved: "Approved",
        rejected: "Rejected"
      };
      return labels[status] || status || "Pending";
    }

    function canPayOrder(order) {
      if (!usableCheckoutUrl(order)) return false;
      if (order.payment_method === "installment") {
        return order.payment_status === "installment_downpayment_pending" &&
          order.installment_application_status === "approved";
      }
      return order.payment_status === "pending_verification";
    }

    function canSubmitManualGcashProof(order) {
      const status = order.payment_status || "";
      if ((order.status || "") === "cancelled") return false;
      if (!isGCashMethod(order.payment_method)) return false;
      return ["pending_payment", "rejected", "payment_setup_failed", "failed"].includes(status);
    }

    function canRefreshPayment(order) {
      if (String(order.payment_provider || "").includes("gcash")) {
        return order.payment_status === "for_verification";
      }
      return (Boolean(order.payment_checkout_id) && !isOldPaymentUrl(order.payment_checkout_url)) ||
        false;
    }

    function canRetryPayment(order) {
      const status = order.payment_status || "";
      if ((order.status || "") === "cancelled") return false;
      if (["paid", "installment_active", "installment_completed", "installment_rejected"].includes(status)) return false;
      if (order.payment_method === "installment") {
        return order.installment_application_status === "approved" &&
          (["installment_downpayment_pending", "installment_downpayment_failed", "installment_downpayment_expired", "payment_setup_failed"].includes(status) ||
            isOldPaymentUrl(order.payment_checkout_url));
      }
      return false;
    }
    function cancellationStatusLabel(status) {
      const labels = {
        pending: "Cancellation Pending",
        approved: "Cancellation Approved",
        rejected: "Cancellation Rejected"
      };
      return labels[status] || status || "";
    }

    function canRequestCancellation(order) {
      const status = order.status || "pending";
      return ["pending", "processing"].includes(status) && order.cancellation_request_status !== "pending";
    }

    function cancellationLine(order) {
      if (!order.cancellation_request_status) return "";
      return `
        <span>Cancel Status: ${escapeHtml(cancellationStatusLabel(order.cancellation_request_status))}</span>
        ${order.cancellation_reason ? `<span>Cancel Reason: ${escapeHtml(order.cancellation_reason)}</span>` : ""}
        ${order.cancellation_admin_note ? `<span>Admin Note: ${escapeHtml(order.cancellation_admin_note)}</span>` : ""}
      `;
    }

    function repairStatusLabel(status) {
      const labels = {
        pending: "Repair Pending",
        approved: "Repair Approved",
        rejected: "Repair Rejected"
      };
      return labels[status] || status || "";
    }

    function repairServiceStatusLabel(status) {
      const labels = {
        approved: "Approved",
        item_received: "Item Received",
        diagnosing: "Diagnosing",
        repairing: "Repairing",
        ready_for_pickup: "Ready for Pickup",
        completed: "Completed"
      };
      return labels[status] || status || "Not Started";
    }

    function isWarrantyActive(order) {
      if ((order.status || "") !== "delivered") return false;
      if (!order.warranty_expires_at) return true;
      return new Date(order.warranty_expires_at).getTime() >= Date.now();
    }

    function warrantyLine(order) {
      if ((order.status || "") !== "delivered") return "";
      const label = order.warranty_expires_at
        ? `Warranty until: ${formatDate(order.warranty_expires_at)}`
        : "Warranty: Active";
      const status = isWarrantyActive(order) ? "Active" : "Expired";
      return `<span>${escapeHtml(label)} (${status})</span>`;
    }

    function canRequestRepair(order) {
      return isWarrantyActive(order) && !["pending", "approved"].includes(order.repair_request_status || "");
    }

    function repairLine(order) {
      if (!order.repair_request_status) return "";
      return `
        <span>Repair Status: ${escapeHtml(repairStatusLabel(order.repair_request_status))}</span>
        ${order.repair_request_status === "approved" ? `<span>Repair Progress: ${escapeHtml(repairServiceStatusLabel(order.repair_service_status))}</span>` : ""}
        ${order.repair_issue ? `<span>Repair Issue: ${escapeHtml(order.repair_issue)}</span>` : ""}
        ${order.repair_admin_note ? `<span>Repair Instructions: ${escapeHtml(order.repair_admin_note)}</span>` : ""}
      `;
    }


    function repairStepHtml(order) {
      if (order.repair_request_status !== "approved") return "";
      const steps = ["approved", "item_received", "diagnosing", "repairing", "ready_for_pickup", "completed"];
      const current = order.repair_service_status || "approved";
      return `
        <div class="repair-steps">
          ${steps.map(step => `<span class="repair-step ${step === current ? "active" : ""}">${escapeHtml(repairServiceStatusLabel(step))}</span>`).join("")}
        </div>
      `;
    }
    function applicationStatusLabel(status) {
      const labels = {
        pending: "Pending Review",
        approved: "Approved",
        rejected: "Rejected"
      };
      return labels[status] || "Not Applied";
    }

    function formatDate(value) {
      if (!value) return "-";
      return new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    }

    function scheduleStatusLabel(status) {
      const labels = {
        unpaid: "Unpaid",
        partial: "Partial",
        overdue: "Overdue",
        due_today: "Due Today",
        due_soon: "Due Soon",
        current: "Current",
        paid: "Paid"
      };
      return labels[status] || status;
    }

    function schedulePaymentLabel(schedule) {
      if ((schedule.status || "") === "paid") return "Paid";
      const status = schedule.payment_status || "not_started";
      const labels = {
        not_started: "No GCash proof yet",
        pending_verification: "GCash proof uploaded",
        paid: "Paid",
        failed: "Payment failed",
        expired: "Payment expired",
        cancelled: "Payment cancelled"
      };
      return labels[status] || paymentStatusLabel({ payment_status: status, payment_method: "gcash" });
    }

    function canPaySchedule(schedule) {
      const status = schedule.status || "unpaid";
      const remaining = Math.max(Number(schedule.amount_due || 0) - Number(schedule.amount_paid || 0), 0);
      return status !== "paid" && remaining > 0;
    }


    function dateOnly(value) {
      if (!value) return null;
      const raw = String(value);
      const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const date = match
        ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
        : new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      date.setHours(0, 0, 0, 0);
      return date;
    }

    function daysUntilDate(value) {
      const due = dateOnly(value);
      if (!due) return null;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return Math.round((due.getTime() - today.getTime()) / 86400000);
    }

    function computedScheduleStatus(schedule) {
      const remaining = Math.max(Number(schedule.amount_due || 0) - Number(schedule.amount_paid || 0), 0);
      if ((schedule.status || "") === "paid" || remaining <= 0) return "paid";
      const days = daysUntilDate(schedule.due_date);
      if (days !== null && days < 0) return "overdue";
      if (days === 0) return "due_today";
      if (days !== null && days <= 7) return "due_soon";
      if ((schedule.status || "") === "partial") return "partial";
      return schedule.status || "current";
    }

    function scheduleAttentionRank(status) {
      const ranks = { overdue: 1, due_today: 2, due_soon: 3, partial: 4, current: 5, unpaid: 6, paid: 9 };
      return ranks[status] || 8;
    }

    function scheduleDueMessage(schedule, status) {
      const remaining = Math.max(Number(schedule.amount_due || 0) - Number(schedule.amount_paid || 0), 0);
      const days = daysUntilDate(schedule.due_date);
      if (status === "overdue") return `Overdue by ${Math.abs(days || 0)} day${Math.abs(days || 0) === 1 ? "" : "s"}. Balance: ${money(remaining)}.`;
      if (status === "due_today") return `Due today. Amount to pay: ${money(remaining)}.`;
      if (status === "due_soon") return `Due in ${days} day${days === 1 ? "" : "s"}. Amount to pay: ${money(remaining)}.`;
      return `Next due on ${formatDate(schedule.due_date)}. Balance: ${money(remaining)}.`;
    }

    function scheduleActionControls(schedule) {
      const pendingProof = schedule.payment_status === "pending_verification";
      if (!canPaySchedule(schedule)) return "";
      return `
        ${pendingProof
          ? `<button class="btn btn-sm btn-outline-dark icon-label" onclick="refreshInstallmentSchedulePayment(${Number(schedule.id)})"><i data-lucide="refresh-cw" aria-hidden="true"></i><span>Check Review</span></button>`
          : `<button class="btn btn-sm btn-dark icon-label" onclick="startInstallmentSchedulePayment(${Number(schedule.id)})"><i data-lucide="upload" aria-hidden="true"></i><span>Pay with GCash</span></button>`}
        ${!pendingProof && schedule.payment_checkout_id && !isOldPaymentUrl(schedule.payment_checkout_url) ? `<button class="payment-view" title="Refresh payment status" aria-label="Refresh payment status" onclick="refreshInstallmentSchedulePayment(${Number(schedule.id)})"><i data-lucide="refresh-cw" aria-hidden="true"></i></button>` : ""}
      `;
    }

    function renderInstallmentDueAlerts() {
      const section = document.getElementById("installmentDueSection");
      const container = document.getElementById("installmentDueAlerts");
      if (!section || !container) return;

      const actionable = installmentSchedules
        .map(schedule => ({ ...schedule, computed_status: computedScheduleStatus(schedule) }))
        .filter(schedule => ["overdue", "due_today", "due_soon"].includes(schedule.computed_status))
        .sort((a, b) => {
          const rank = scheduleAttentionRank(a.computed_status) - scheduleAttentionRank(b.computed_status);
          if (rank) return rank;
          return String(a.due_date || "").localeCompare(String(b.due_date || ""));
        });

      section.classList.toggle("d-none", actionable.length === 0);
      if (!actionable.length) {
        container.innerHTML = "";
        return;
      }

      container.innerHTML = actionable.slice(0, 4).map(schedule => {
        const status = schedule.computed_status;
        return `
          <article class="plan-reminder ${status === "overdue" ? "overdue" : ""}">
            <i data-lucide="${status === "overdue" ? "circle-alert" : "clock-3"}" aria-hidden="true"></i>
            <div><strong>${escapeHtml(schedule.product_name || "Installment plan")}</strong><span>Payment ${Number(schedule.installment_no) || "-"} &middot; ${escapeHtml(scheduleDueMessage(schedule, status))}</span></div>
            <span class="payment-state ${status === "overdue" ? "overdue" : "pending"}">${escapeHtml(scheduleStatusLabel(status))}</span>
          </article>
        `;
      }).join("");
    }
    function profileFieldValue(id) {
      return document.getElementById(id)?.value.trim() || "";
    }

    function dateInputValue(value) {
      if (!value) return "";
      const raw = String(value);
      const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) return `${match[1]}-${match[2]}-${match[3]}`;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
    }

    function setAccountStatus(id, message, type = "") {
      const element = document.getElementById(id);
      if (!element) return;
      element.className = `account-status ${type}`.trim();
      element.innerText = message || "";
    }

    function fillAccountForm(user) {
      if (!user) return;
      document.getElementById("profileName").value = user.name || "";
      document.getElementById("profileEmail").value = user.email || "";
      document.getElementById("profileEmail").readOnly = true;
      document.getElementById("profilePhone").value = user.phone || "";
      document.getElementById("profileBirthday").value = dateInputValue(user.birthday);
      document.getElementById("profileGender").value = user.gender || "";
      const twoFactorToggle = document.getElementById("emailTwoFactorEnabled");
      if (twoFactorToggle) twoFactorToggle.checked = Boolean(user.email_2fa_enabled);
      renderEmailSecurityState(Boolean(user.email_2fa_enabled));
      document.getElementById("customerName").innerText = user.name || "Customer";
      document.getElementById("customerEmail").innerText = user.email || "";
    }

    function syncCurrentUser(user) {
      currentUser = { ...currentUser, ...user, role: String(user.role || currentUser.role || "customer").toLowerCase() };
      localStorage.setItem("currentUser", JSON.stringify(currentUser));
      customerAccount = currentUser;
      fillAccountForm(currentUser);
    }

    function accountPayload() {
      return {
        name: profileFieldValue("profileName"),
        email: profileFieldValue("profileEmail"),
        phone: profileFieldValue("profilePhone"),
        birthday: profileFieldValue("profileBirthday"),
        gender: profileFieldValue("profileGender")
      };
    }

    async function loadCustomerAccount() {
      if (!currentUser?.id) return;
      try {
        const res = await fetch(`/auth/profile/${currentUser.id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Unable to load account details.");
        syncCurrentUser(data.user);
      } catch (error) {
        fillAccountForm(currentUser);
        setAccountStatus("accountProfileStatus", "Account details are unavailable right now.", "error");
      }
    }

    function renderEmailSecurityState(enabled) {
      const badge = document.getElementById("emailSecurityState");
      badge.textContent = enabled ? "Enabled" : "Disabled";
      badge.className = `payment-state ${enabled ? "paid" : "neutral"}`;
    }

    function setSettingsBusy(buttonId, busy) {
      const button = document.getElementById(buttonId);
      const label = button.querySelector("span");
      button.dataset.idleLabel ||= label.textContent;
      button.disabled = busy;
      button.setAttribute("aria-busy", String(busy));
      label.textContent = busy ? "Saving..." : button.dataset.idleLabel;
    }

    async function saveAccountProfile() {
      if (document.getElementById("saveProfileButton").disabled) return;
      const payload = accountPayload();
      if (!payload.name || !payload.email || !payload.phone || !payload.birthday) {
        setAccountStatus("accountProfileStatus", "Please complete name, email, birthday, and contact number.", "error");
        return;
      }

      setAccountStatus("accountProfileStatus", "Saving account details...");
      setSettingsBusy("saveProfileButton", true);
      try {
        const res = await fetch(`/auth/profile/${currentUser.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Unable to update profile.");
        syncCurrentUser(data.user);
        setAccountStatus("accountProfileStatus", data.message || "Profile updated.", "success");
      } catch (error) {
        setAccountStatus("accountProfileStatus", error.message || "Unable to update profile.", "error");
      } finally {
        setSettingsBusy("saveProfileButton", false);
      }
    }

    function toggleProfilePassword(id, button) {
      const input = document.getElementById(id);
      if (!input) return;
      const hidden = input.type === "password";
      input.type = hidden ? "text" : "password";
      if (button) {
        const fieldName = document.querySelector(`label[for="${id}"]`)?.textContent || "password";
        button.setAttribute("aria-pressed", String(hidden));
        button.setAttribute("aria-label", `${hidden ? "Hide" : "Show"} ${fieldName.toLowerCase()}`);
        button.title = `${hidden ? "Hide" : "Show"} password`;
        button.innerHTML = `<i data-lucide="${hidden ? "eye-off" : "eye"}" aria-hidden="true"></i>`;
        window.lucide?.createIcons();
      }
    }

    function clearPasswordFields() {
      ["currentProfilePassword", "newProfilePassword", "confirmProfilePassword"].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
          input.value = "";
          if (input.type === "text") toggleProfilePassword(id, input.parentElement.querySelector("button"));
        }
      });
    }

    async function updateAccountPassword() {
      if (document.getElementById("savePasswordButton").disabled) return;
      const payload = {
        current_password: profileFieldValue("currentProfilePassword"),
        new_password: profileFieldValue("newProfilePassword"),
        confirm_password: profileFieldValue("confirmProfilePassword")
      };

      if (!payload.current_password || !payload.new_password || !payload.confirm_password) {
        setAccountStatus("accountPasswordStatus", "Please complete all password fields.", "error");
        return;
      }

      if (payload.new_password !== payload.confirm_password) {
        setAccountStatus("accountPasswordStatus", "New password and confirmation do not match.", "error");
        return;
      }

      setAccountStatus("accountPasswordStatus", "Updating password...");
      setSettingsBusy("savePasswordButton", true);
      try {
        const res = await fetch(`/auth/profile/${currentUser.id}/password`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Unable to update password.");
        clearPasswordFields();
        setAccountStatus("accountPasswordStatus", data.message || "Password updated.", "success");
      } catch (error) {
        setAccountStatus("accountPasswordStatus", error.message || "Unable to update password.", "error");
      } finally {
        setSettingsBusy("savePasswordButton", false);
      }
    }

    async function saveEmailTwoFactor() {
      if (document.getElementById("saveSecurityButton").disabled) return;
      const passwordInput = document.getElementById("emailTwoFactorPassword");
      const password = passwordInput?.value || "";
      if (!password) {
        setAccountStatus("emailTwoFactorStatus", "Enter your current password to confirm this change.", "error");
        return;
      }
      setAccountStatus("emailTwoFactorStatus", "Saving security setting...");
      setSettingsBusy("saveSecurityButton", true);
      try {
        const res = await fetch(`/auth/profile/${currentUser.id}/email-two-factor`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: document.getElementById("emailTwoFactorEnabled").checked, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Unable to update sign-in security.");
        passwordInput.value = "";
        if (passwordInput.type === "text") toggleProfilePassword(passwordInput.id, passwordInput.parentElement.querySelector("button"));
        currentUser.email_2fa_enabled = data.enabled;
        renderEmailSecurityState(Boolean(data.enabled));
        localStorage.setItem("currentUser", JSON.stringify(currentUser));
        setAccountStatus("emailTwoFactorStatus", data.message, "success");
      } catch (error) {
        setAccountStatus("emailTwoFactorStatus", error.message || "Unable to update sign-in security.", "error");
      } finally {
        setSettingsBusy("saveSecurityButton", false);
      }
    }

    function addressValue(id) {
      return document.getElementById(id)?.value.trim() || "";
    }

    function fullAddressLine(address) {
      return [address.address, address.city, address.province, address.postal_code]
        .filter(Boolean)
        .join(", ");
    }

    function clearAddressForm() {
      editingAddressId = null;
      document.getElementById("addressFormTitle").innerText = "Add Delivery Address";
      ["addressLabel", "addressRecipient", "addressPhone", "addressLine", "addressLandmark", "addressCity", "addressProvince", "addressPostal", "addressLatitude", "addressLongitude"].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = "";
      });
      const defaultInput = document.getElementById("addressDefault");
      if (defaultInput) defaultInput.checked = customerAddresses.length === 0;
      setAccountStatus("addressSaveStatus", "");
      setDeliveryPinStatus("No delivery pin selected.");
      setTimeout(() => {
        initializeDeliveryLocationMap();
        centerDeliveryMap(13.294, 123.79, 14);
        if (deliveryLocationMarker) deliveryLocationMarker.remove();
        deliveryLocationMarker = null;
      }, 100);
    }

    function setDeliveryPinStatus(message, type = "") {
      const status = document.getElementById("deliveryPinStatus");
      if (status) {
        status.className = `account-status ${type}`.trim();
        status.innerText = message;
      }
    }

    function setAddressPin(latitude, longitude, zoom = 16) {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (latitude === "" || longitude === "" || latitude == null || longitude == null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 85 || Math.abs(lng) > 180) return;
      document.getElementById("addressLatitude").value = lat.toFixed(7);
      document.getElementById("addressLongitude").value = lng.toFixed(7);
      initializeDeliveryLocationMap();
      if (!deliveryLocationMap) {
        setDeliveryPinStatus("Map service is unavailable. Reload the page and try again.", "error");
        return;
      }
      const point = [lat, lng];
      if (!deliveryLocationMarker) {
        deliveryLocationMarker = deliveryMapEngine === "vector"
          ? new maplibregl.Marker({ draggable: true, color: "#0f6b50" }).setLngLat([lng, lat]).addTo(deliveryLocationMap)
          : L.marker(point, { draggable: true }).addTo(deliveryLocationMap);
        deliveryLocationMarker.on("dragend", event => {
          const moved = deliveryMapEngine === "vector" ? event.target.getLngLat() : event.target.getLatLng();
          setAddressPin(moved.lat, moved.lng, deliveryLocationMap.getZoom());
        });
      } else {
        if (deliveryMapEngine === "vector") deliveryLocationMarker.setLngLat([lng, lat]);
        else deliveryLocationMarker.setLatLng(point);
      }
      centerDeliveryMap(lat, lng, zoom);
      setDeliveryPinStatus(`Delivery pin selected: ${lat.toFixed(5)}, ${lng.toFixed(5)}`, "success");
    }

    function centerDeliveryMap(latitude, longitude, zoom) {
      if (!deliveryLocationMap) return;
      if (deliveryMapEngine === "vector") deliveryLocationMap.jumpTo({ center: [longitude, latitude], zoom });
      else deliveryLocationMap.setView([latitude, longitude], zoom);
    }

    function resizeDeliveryMap() {
      if (!deliveryLocationMap) return;
      if (deliveryMapEngine === "vector") deliveryLocationMap.resize();
      else deliveryLocationMap.invalidateSize();
    }

    function fallbackDeliveryMap() {
      if (deliveryMapEngine !== "vector") return;
      deliveryLocationMarker?.remove();
      deliveryLocationMarker = null;
      deliveryLocationMap.remove();
      deliveryLocationMap = null;
      initializeDeliveryLocationMap(true);
      const lat = document.getElementById("addressLatitude").value;
      const lng = document.getElementById("addressLongitude").value;
      if (lat !== "" && lng !== "") setAddressPin(lat, lng);
    }

    function initializeDeliveryLocationMap(forceRaster = false) {
      const element = document.getElementById("deliveryLocationMap");
      if (!element || !element.offsetWidth || !element.offsetHeight) return;
      if (!deliveryLocationMap) {
        if (window.maplibregl && !forceRaster) {
          try {
            deliveryLocationMap = new maplibregl.Map({ container: element, style: "https://tiles.openfreemap.org/styles/liberty", center: [123.79, 13.294], zoom: 14, minZoom: 2, maxZoom: 19, attributionControl: false, dragRotate: false, pitchWithRotate: false, preserveDrawingBuffer: true });
            deliveryMapEngine = "vector";
            deliveryLocationMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
            deliveryLocationMap.addControl(new maplibregl.AttributionControl({ compact: false }), "bottom-right");
            deliveryLocationMap.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
            deliveryLocationMap.scrollZoom.disable();
            deliveryLocationMap.on("click", event => setAddressPin(event.lngLat.lat, event.lngLat.lng, deliveryLocationMap.getZoom()));
            const vectorMap = deliveryLocationMap;
            const loadingTimeout = setTimeout(() => { if (deliveryLocationMap === vectorMap && !vectorMap.isStyleLoaded()) fallbackDeliveryMap(); }, 12000);
            vectorMap.once("load", () => clearTimeout(loadingTimeout));
            vectorMap.on("error", () => { if (deliveryLocationMap === vectorMap && !vectorMap.isStyleLoaded()) fallbackDeliveryMap(); });
          } catch (error) {
            deliveryLocationMap?.remove();
            deliveryLocationMap = null;
            element.replaceChildren();
          }
        }
        if (!deliveryLocationMap && window.L) {
          deliveryMapEngine = "raster";
          deliveryLocationMap = L.map(element, { scrollWheelZoom: false }).setView([13.294, 123.79], 14);
          L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(deliveryLocationMap);
          deliveryLocationMap.on("click", event => setAddressPin(event.latlng.lat, event.latlng.lng, deliveryLocationMap.getZoom()));
        }
        if (!deliveryLocationMap) setDeliveryPinStatus("Map service is unavailable. Reload the page and try again.", "error");
      }
      setTimeout(resizeDeliveryMap, 120);
    }

    function pinAddressMapCenter() {
      initializeDeliveryLocationMap();
      if (!deliveryLocationMap) return;
      const point = deliveryLocationMap.getCenter();
      setAddressPin(point.lat, point.lng, deliveryLocationMap.getZoom());
    }

    function toggleAddressMapExpanded() {
      const editor = document.querySelector(".delivery-pin-editor");
      const expanded = editor.classList.toggle("map-expanded");
      const button = document.getElementById("expandAddressMap");
      button.setAttribute("aria-pressed", String(expanded));
      button.setAttribute("aria-label", expanded ? "Close expanded map" : "Expand map");
      button.title = expanded ? "Close expanded map" : "Expand map";
      button.innerHTML = `<i data-lucide="${expanded ? "minimize" : "maximize"}" aria-hidden="true"></i>`;
      document.body.classList.toggle("address-map-open", expanded);
      if (expanded) {
        editor.setAttribute("role", "dialog");
        editor.setAttribute("aria-modal", "true");
        editor.setAttribute("aria-label", "Delivery location map");
        button.focus();
      } else {
        editor.removeAttribute("role");
        editor.removeAttribute("aria-modal");
        editor.removeAttribute("aria-label");
      }
      window.lucide?.createIcons();
      resizeDeliveryMap();
    }

    function startNewAddress() {
      clearAddressForm();
      document.getElementById("addressEditorForm").scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("addressLabel").focus({ preventScroll: true });
    }

    window.addEventListener("hashchange", () => {
      if (document.querySelector(".map-expanded")) toggleAddressMapExpanded();
      if (location.hash === "#addresses") initializeDeliveryLocationMap();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && document.querySelector(".map-expanded")) { toggleAddressMapExpanded(); document.getElementById("expandAddressMap").focus(); }
      const expanded = document.querySelector(".map-expanded");
      if (event.key === "Tab" && expanded) {
        const controls = [...expanded.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });

    function useCurrentAddressLocation() {
      if (!navigator.geolocation) {
        setDeliveryPinStatus("This browser does not support current location. Choose a point on the map.", "error");
        return;
      }
      setDeliveryPinStatus("Finding your location...");
      const button = document.getElementById("locateAddressButton");
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      navigator.geolocation.getCurrentPosition(position => {
        button.disabled = false;
        button.setAttribute("aria-busy", "false");
        setAddressPin(position.coords.latitude, position.coords.longitude, 17);
      }, error => {
        button.disabled = false;
        button.setAttribute("aria-busy", "false");
        setDeliveryPinStatus(error.code === 1 ? "Location permission was denied. Choose a point on the map instead." : "Could not get your location. Choose a point on the map instead.", "error");
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    }

    function renderAddressBook() {
      const container = document.getElementById("addressList");
      if (!container) return;
      document.getElementById("savedAddressCount").textContent = customerAddresses.length;
      if (location.hash === "#addresses") initializeDeliveryLocationMap();

      if (!customerAddresses.length) {
        container.innerHTML = `<div class="payments-empty plan-schedule-empty"><i data-lucide="map-pin-house" aria-hidden="true"></i><h3>No saved address yet</h3><button class="btn btn-outline-dark icon-label" onclick="startNewAddress()"><i data-lucide="plus" aria-hidden="true"></i><span>Add Address</span></button></div>`;
        document.getElementById("addressDefault").checked = true;
        window.lucide?.createIcons();
        return;
      }

      container.innerHTML = customerAddresses.map(address => {
        const id = Number(address.id);
        const pinned = address.latitude != null && address.latitude !== "" && address.longitude != null && address.longitude !== "" && Number.isFinite(Number(address.latitude)) && Number.isFinite(Number(address.longitude));
        return `<article class="address-card saved-address-item ${Number(address.is_default || 0) ? "default" : ""}">
          <div class="saved-address-head"><h3><i data-lucide="${address.label?.toLowerCase() === "office" ? "building-2" : "house"}" aria-hidden="true"></i>${escapeHtml(address.label || "Address")}</h3>${Number(address.is_default || 0) ? `<span class="payment-state paid">Default</span>` : ""}</div>
          <strong class="saved-address-recipient">${escapeHtml(address.recipient_name || "Customer")}</strong><span class="saved-address-phone">${escapeHtml(address.phone || "No contact")}</span>
          <p class="saved-address-line">${escapeHtml(fullAddressLine(address) || "No address line")}</p>
          ${address.landmark ? `<p class="saved-address-landmark">${escapeHtml(address.landmark)}</p>` : ""}
          <div class="saved-address-footer"><span class="saved-address-pin ${pinned ? "saved" : "missing"}"><i data-lucide="${pinned ? "map-pin-check" : "map-pin-off"}" aria-hidden="true"></i>${pinned ? "Pin saved" : "Pin required"}</span><div class="plan-actions">
            ${Number(address.is_default || 0) ? "" : `<button class="payment-view" type="button" title="Set as default address" aria-label="Set ${escapeHtml(address.label || "address")} as default" onclick="setDefaultAddress(${id})"><i data-lucide="star" aria-hidden="true"></i></button>`}
            <button class="payment-view" type="button" title="Edit address and pin" aria-label="Edit ${escapeHtml(address.label || "address")}" onclick="editCustomerAddress(${id})"><i data-lucide="pencil" aria-hidden="true"></i></button>
            <button class="payment-view saved-address-delete" type="button" title="Delete address" aria-label="Delete ${escapeHtml(address.label || "address")}" onclick="deleteCustomerAddress(${id})"><i data-lucide="trash-2" aria-hidden="true"></i></button>
          </div></div>
        </article>`;
      }).join("");
      window.lucide?.createIcons();
    }

    function editCustomerAddress(id) {
      const address = customerAddresses.find(item => Number(item.id) === Number(id));
      if (!address) return;
      editingAddressId = Number(address.id);
      document.getElementById("addressFormTitle").innerText = "Edit Delivery Address";
      document.getElementById("addressLabel").value = address.label || "";
      document.getElementById("addressRecipient").value = address.recipient_name || "";
      document.getElementById("addressPhone").value = address.phone || "";
      document.getElementById("addressLine").value = address.address || "";
      document.getElementById("addressLandmark").value = address.landmark || "";
      document.getElementById("addressCity").value = address.city || "";
      document.getElementById("addressProvince").value = address.province || "";
      document.getElementById("addressPostal").value = address.postal_code || "";
      document.getElementById("addressDefault").checked = Number(address.is_default || 0) === 1;
      document.getElementById("addressLatitude").value = address.latitude ?? "";
      document.getElementById("addressLongitude").value = address.longitude ?? "";
      document.getElementById("addressEditorForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => {
        initializeDeliveryLocationMap();
        if (address.latitude != null && address.latitude !== "" && address.longitude != null && address.longitude !== "") setAddressPin(address.latitude, address.longitude);
        else {
          if (deliveryLocationMarker) deliveryLocationMarker.remove();
          deliveryLocationMarker = null;
          setDeliveryPinStatus("Choose your delivery point on the map.");
        }
      }, 180);
    }

    async function loadCustomerAddresses() {
      const container = document.getElementById("addressList");
      if (container) container.innerHTML = `<div class="empty-state">Loading saved addresses...</div>`;

      try {
        const res = await fetch(`/customer/addresses/${currentUser.id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Unable to load addresses.");
        customerAddresses = Array.isArray(data) ? data : [];
      } catch (error) {
        customerAddresses = [];
        if (container) container.innerHTML = `<div class="empty-state">Saved addresses are unavailable right now.</div>`;
        return;
      }

      renderAddressBook();
    }

    async function saveCustomerAddress() {
      if (document.getElementById("saveAddressButton").disabled) return;
      const returnToCheckout = new URLSearchParams(window.location.search).get("returnTo") === "/checkout.html";
      const payload = {
        user_id: currentUser.id,
        label: addressValue("addressLabel") || "Home",
        recipient_name: addressValue("addressRecipient"),
        phone: addressValue("addressPhone"),
        address: addressValue("addressLine"),
        landmark: addressValue("addressLandmark"),
        latitude: document.getElementById("addressLatitude")?.value || "",
        longitude: document.getElementById("addressLongitude")?.value || "",
        city: addressValue("addressCity"),
        province: addressValue("addressProvince"),
        postal_code: addressValue("addressPostal"),
        is_default: (returnToCheckout || document.getElementById("addressDefault")?.checked) ? 1 : 0
      };

      if (!payload.recipient_name || !payload.phone || !payload.address) {
        alert("Please complete recipient name, contact number, and complete address.");
        return;
      }
      if (payload.latitude === "" || payload.longitude === "") {
        setDeliveryPinStatus("Choose and confirm a delivery pin before saving.", "error");
        document.getElementById("deliveryLocationMap")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      const url = editingAddressId ? `/customer/addresses/${editingAddressId}` : "/customer/addresses";
      const method = editingAddressId ? "PUT" : "POST";
      setSettingsBusy("saveAddressButton", true);
      setAccountStatus("addressSaveStatus", "Saving delivery address...");
      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Unable to save address.");
        if (returnToCheckout) {
          window.location.replace("/checkout.html");
          return;
        }
        customerAddresses = Array.isArray(data.addresses) ? data.addresses : customerAddresses;
        clearAddressForm();
        renderAddressBook();
        setAccountStatus("addressSaveStatus", data.message || "Address saved.", "success");
      } catch (error) {
        setAccountStatus("addressSaveStatus", error.message || "Unable to save address.", "error");
      } finally {
        setSettingsBusy("saveAddressButton", false);
      }
    }

    async function setDefaultAddress(id) {
      try {
        const res = await fetch(`/customer/addresses/${id}/default`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: currentUser.id })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Unable to update default address.");
        customerAddresses = Array.isArray(data.addresses) ? data.addresses : customerAddresses;
        renderAddressBook();
      } catch (error) {
        alert(error.message || "Unable to update default address.");
      }
    }

    async function deleteCustomerAddress(id) {
      const address = customerAddresses.find(item => Number(item.id) === Number(id));
      const confirmed = await AppDialog.confirm({
        title: "Delete saved address?",
        message: "This address will be removed from your address book and will no longer be available during checkout.",
        details: [
          { label: "Address", value: address?.label || "Saved address" },
          { label: "Recipient", value: address?.recipient_name || "Not specified" }
        ],
        confirmText: "Delete Address",
        tone: "danger"
      });
      if (!confirmed) return;

      try {
        const res = await fetch(`/customer/addresses/${id}?user_id=${currentUser.id}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Unable to delete address.");
        customerAddresses = Array.isArray(data.addresses) ? data.addresses : customerAddresses.filter(item => Number(item.id) !== Number(id));
        clearAddressForm();
        renderAddressBook();
      } catch (error) {
        alert(error.message || "Unable to delete address.");
      }
    }
    function setFilter(filter) {
      activeFilter = filter;
      document.querySelectorAll(".tab").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.filter === filter);
        tab.setAttribute('aria-pressed', String(tab.dataset.filter === filter));
      });
      sanitizeOrderSearch();
      renderOrders();
    }

    function sanitizeOrderSearch() {
      const input = document.getElementById("customerOrderSearch");
      if (!input) return;

      const value = input.value.trim().toLowerCase();
      const email = String(currentUser?.email || customerAccount?.email || "").trim().toLowerCase();
      if (email && value === email) {
        input.value = "";
      }
    }

    function renderSummary() {
      document.getElementById("totalOrders").innerText = orders.length;
      document.getElementById("toPayCount").innerText = orders.filter(order => getBucket(order) === "to-pay").length;
      const waitingApprovalCount = document.getElementById("waitingApprovalCount");
      if (waitingApprovalCount) waitingApprovalCount.innerText = orders.filter(order => getBucket(order) === "waiting-approval").length;
      const placedCount = document.getElementById("placedCount");
      if (placedCount) placedCount.innerText = orders.filter(order => getBucket(order) === "placed").length;
      document.getElementById("toShipCount").innerText = orders.filter(order => getBucket(order) === "to-ship").length;
      document.getElementById("toReceiveCount").innerText = orders.filter(order => getBucket(order) === "to-receive").length;
      document.getElementById("outForDeliveryCount").innerText = orders.filter(order => getBucket(order) === "out-for-delivery").length;
    }


    function statementDueLabel(statement) {
      if (Number(statement.overdue_count || 0) > 0) return "Overdue";
      if (Number(statement.balance || 0) <= 0) return "Paid";
      if (statement.next_due_date) return "Current";
      return "Pending";
    }

    function renderCustomerStatementOverview() {
      const container = document.getElementById("statementOverview");
      if (!container) return;
      if (!customerStatement) {
        container.innerHTML = `<div class="empty-state">Loading payment statement...</div>`;
        return;
      }

      const summary = customerStatement.summary || {};
      const statements = Array.isArray(customerStatement.soa) ? customerStatement.soa : [];
      if (customerStatement.error) {
        container.innerHTML = `<div class="payments-empty" role="alert"><i data-lucide="circle-alert" aria-hidden="true"></i><h3>Unable to load payments</h3><button class="btn btn-outline-dark icon-label" onclick="loadCustomerStatement()"><i data-lucide="refresh-cw" aria-hidden="true"></i><span>Try Again</span></button></div>`;
        window.lucide?.createIcons();
        return;
      }

      const rows = statements.map(statement => {
        const paymentLabel = { for_verification: "Under review", rejected: "Rejected", to_collect: "To collect", pending_payment: "Payment needed" }[statement.payment_status];
        const label = statement.order_status === "cancelled" ? "Cancelled" : paymentLabel || statementDueLabel(statement);
        const tone = { Paid: "paid", Overdue: "overdue", Rejected: "overdue", Cancelled: "neutral" }[label] || "pending";
        const name = statement.product_name || "Ordered products";
        const method = { gcash: "GCash", cod: "Cash on Delivery", installment: "Installment", layaway: "Layaway" }[String(statement.payment_method).toLowerCase()] || statement.payment_method || "Payment";
        return `<article class="payment-ledger-row">
          <div class="payment-product"><span class="payment-method-icon" aria-hidden="true"><i data-lucide="receipt-text"></i></span><div><h3>${escapeHtml(name)}</h3><span>${escapeHtml(method)}</span>${statement.next_due_date ? `<small>Next due ${escapeHtml(formatDate(statement.next_due_date))} &middot; ${money(statement.next_due_amount)}</small>` : ""}</div></div>
          <span class="payment-state ${tone}">${label}</span>
          <div class="payment-amount"><span>Paid</span><strong>${money(statement.total_paid)}</strong></div>
          <div class="payment-amount"><span>Balance</span><strong>${money(statement.balance)}</strong></div>
          <a class="payment-view" href="/customer/order.html?order_id=${Number(statement.order_id)}" title="View order and payment details" aria-label="View payment details for ${escapeHtml(name)}"><i data-lucide="arrow-up-right" aria-hidden="true"></i></a>
        </article>`;
      }).join("");

      container.innerHTML = `
        <div class="payment-metrics">
          <div class="payment-metric"><i data-lucide="badge-check" aria-hidden="true"></i><span>Total Paid</span><strong>${money(summary.total_paid)}</strong></div>
          <div class="payment-metric"><i data-lucide="wallet" aria-hidden="true"></i><span>Remaining Balance</span><strong>${money(summary.total_balance)}</strong></div>
          <div class="payment-metric overdue"><i data-lucide="circle-alert" aria-hidden="true"></i><span>Overdue</span><strong>${money(summary.overdue_amount)}</strong></div>
          <div class="payment-metric"><i data-lucide="calendar-clock" aria-hidden="true"></i><span>Next Due</span><strong>${summary.next_due_date ? money(summary.next_due_amount) : "No upcoming dues"}</strong>${summary.next_due_date ? `<small>${escapeHtml(formatDate(summary.next_due_date))}</small>` : ""}</div>
        </div>
        <div class="payment-ledger-head"><h3>Payment Overview</h3><span>${statements.length} ${statements.length === 1 ? "order" : "orders"}</span></div>
        <div class="payment-ledger">
          ${rows || `<div class="payments-empty"><i data-lucide="receipt-text" aria-hidden="true"></i><h3>No payments yet</h3><a class="btn btn-outline-dark icon-label" href="/customer/shop.html#products"><i data-lucide="store" aria-hidden="true"></i><span>Browse Shop</span></a></div>`}
        </div>
      `;
      window.lucide?.createIcons();
    }

    async function loadCustomerStatement() {
      const container = document.getElementById("statementOverview");
      if (container) container.innerHTML = `<div class="empty-state">Loading payment statement...</div>`;
      try {
        const res = await fetch(`/soa/${currentUser.id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Unable to load statement.");
        customerStatement = data;
      } catch (error) {
        customerStatement = { error: true, summary: {}, soa: [] };
      }
      renderCustomerStatementOverview();
    }

    async function refreshProfile() {
      await Promise.all([
        loadCustomerAccount(),
        loadOrders(),
        loadInstallmentApplications(),
        loadInstallmentSchedules(),
        loadLayaways(),
        loadCustomerStatement(),
        loadNotifications(),
        loadCustomerAddresses()
      ]);
    }
    function renderPaymentNotifications() {
      const container = document.getElementById("paymentNotifications");
      const rejectedPayments = orders.filter(order =>
        order.payment_status === "rejected" && order.status !== "cancelled"
      );
      const approvedInstallments = orders.filter(order =>
        order.payment_method === "installment" &&
        order.payment_status === "installment_downpayment_pending" &&
        order.installment_application_status === "approved" &&
        usableCheckoutUrl(order)
      );
      const pendingInstallments = orders.filter(order =>
        order.payment_method === "installment" &&
        order.payment_status === "installment_application_pending" &&
        order.installment_application_status === "pending"
      );

      if (!rejectedPayments.length && !approvedInstallments.length && !pendingInstallments.length) {
        container.innerHTML = `<div class="payment-all-clear"><i data-lucide="circle-check" aria-hidden="true"></i><span>No payment actions needed.</span></div>`;
        window.lucide?.createIcons();
        return;
      }

      container.innerHTML = [
        ...rejectedPayments.map(order => `
          <div class="payment-alert rejected">
            <div>
              <strong>Payment rejected &middot; ${escapeHtml(orderItemsTitle(order))}</strong>
              <span class="text-muted">${escapeHtml(order.payment_rejection_reason || "The submitted proof could not be verified.")} Upload a new valid GCash proof to continue this order.</span>
            </div>
            <a class="btn btn-dark" href="/customer/order.html?order_id=${order.id}">Re-upload Proof</a>
          </div>
        `),
        ...approvedInstallments.map(order => `
          <div class="payment-alert">
            <div>
              <strong>Installment approved &middot; ${escapeHtml(orderItemsTitle(order))}</strong>
              <span class="text-muted">You can now pay your downpayment to activate the installment schedule.</span>
            </div>
            <a class="btn btn-dark" href="${escapeHtml(usableCheckoutUrl(order))}">Pay Downpayment</a>
          </div>
        `),
        ...pendingInstallments.map(order => `
          <div class="payment-alert">
            <div>
              <strong>Application pending &middot; ${escapeHtml(orderItemsTitle(order))}</strong>
              <span class="text-muted">Admin is still reviewing your National ID verification. Downpayment will be available after approval.</span>
            </div>
            <span class="status-pill">Pending</span>
          </div>
        `)
      ].join("");
    }

    function orderItemsTitle(order) {
      const items = Array.isArray(order.items) ? order.items : [];
      if (items.length <= 1) return order.product_name || "Product";
      return `${items.length} items`;
    }

    function orderItemsMeta(order) {
      const items = Array.isArray(order.items) ? order.items : [];
      if (items.length <= 1) {
        return `
              <span>Qty: ${order.quantity}</span>
              ${order.variant_name ? `<span>Variant: ${escapeHtml(order.variant_name)}</span>` : ""}
        `;
      }

      return `<span>${items.map(item => `${escapeHtml(item.product_name || "Product")} x${item.quantity}`).join(" | ")}</span>`;
    }

    function parseImages(value) {
      try {
        const parsed = value ? JSON.parse(value) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }

    function orderItems(order) {
      const items = Array.isArray(order.items) && order.items.length
        ? order.items
        : [{
            product_id: order.product_id,
            product_name: order.product_name || "Product",
            variant_name: order.variant_name || "Default",
            quantity: order.quantity || 1,
            unit_price: order.variant_price || Number(order.total_price || 0) / Math.max(Number(order.quantity || 1), 1),
            subtotal: order.total_price || 0,
            product_image: order.product_image
          }];

      return items.map(item => ({
        ...item,
        product_image: item.product_image || order.product_image || parseImages(order.product_images)[0] || "https://via.placeholder.com/160x160?text=Product"
      }));
    }

    function orderImage(order) {
      return orderItems(order)[0]?.product_image || "https://via.placeholder.com/160x160?text=Product";
    }

    function bucketLabel(bucket) {
      const labels = {
        "waiting-approval": "Waiting for Admin Approval",
        placed: "Order Placed",
        "to-pay": "To Pay",
        "to-ship": "Processing",
        "to-receive": "Ready",
        "out-for-delivery": "Out for Delivery",
        completed: "Completed",
        cancelled: "Cancelled"
      };
      return labels[bucket] || bucket;
    }

    function customerOrderLink(orderId) {
      const url = new URL("/customer/order.html", window.location.origin);
      url.searchParams.set("order_id", orderId);
      return url.toString();
    }

    function openOrderTracking(orderId) {
      window.location.href = `/customer/order.html?order_id=${orderId}`;
    }

    function setCustomerOrderUrl(orderId) {
      const url = new URL(window.location.href);
      url.searchParams.set("order", orderId);
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    function clearCustomerOrderUrl() {
      const url = new URL(window.location.href);
      if (!url.searchParams.has("order")) return;
      url.searchParams.delete("order");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }

    async function copyTextToClipboard(text, successMessage) {
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const input = document.createElement("textarea");
          input.value = text;
          input.setAttribute("readonly", "readonly");
          input.style.position = "fixed";
          input.style.opacity = "0";
          document.body.appendChild(input);
          input.select();
          document.execCommand("copy");
          input.remove();
        }
        alert(successMessage);
      } catch (error) {
        prompt("Copy this:", text);
      }
    }

    function copyOrderId(orderId) {
      copyTextToClipboard(orderReference(orderId), `Copied ${orderLabel(orderId)}.`);
    }

    function copyOrderLink(orderId) {
      copyTextToClipboard(customerOrderLink(orderId), `Copied link for ${orderLabel(orderId)}.`);
    }

    async function refreshPaymentStatus(orderId) {
      try {
        const res = await fetch(`/payments/gcash/status/${orderId}`);
        const data = await res.json();

        if (!res.ok) {
          alert(data.message || "Unable to refresh payment status.");
          await loadOrders();
          return;
        }

        await loadOrders();
        if (currentViewingOrderId && Number(currentViewingOrderId) === Number(orderId)) {
          viewOrderDetails(orderId);
        }
        alert(`Payment status: ${paymentStatusLabel({ payment_status: data.payment_status, payment_method: "gcash" })}`);
      } catch (error) {
        alert(error.message || "Unable to refresh payment status.");
      }
    }

    function getProfileCart() {
      try {
        const cart = JSON.parse(localStorage.getItem("cart") || "[]");
        return Array.isArray(cart) ? cart : [];
      } catch (error) {
        return [];
      }
    }

    function saveProfileCart(cart) {
      localStorage.setItem("cart", JSON.stringify(cart));
    }

    function productVariantsFromProfile(product) {
      try {
        const variants = product?.variants ? JSON.parse(product.variants) : [];
        return Array.isArray(variants) ? variants : [];
      } catch (error) {
        return [];
      }
    }

    function findReorderVariantIndex(item, product) {
      const variants = productVariantsFromProfile(product);
      const rawIndex = item.variant_index;
      if (rawIndex !== undefined && rawIndex !== null && rawIndex !== "") {
        const index = Number(rawIndex);
        if (Number.isInteger(index) && variants[index]) return index;
      }

      const orderedVariant = String(item.variant_name || "").trim().toLowerCase();
      if (!orderedVariant || orderedVariant === "default") return "";
      const matchedIndex = variants.findIndex(variant => String(variant.name || "").trim().toLowerCase() === orderedVariant);
      return matchedIndex >= 0 ? matchedIndex : "";
    }

    function reorderCartKey(productId, variantIndex) {
      return `${productId}_${variantIndex === null || variantIndex === undefined ? "" : variantIndex}`;
    }

    function reorderItemSummary(items) {
      if (items.length === 1) return items[0].product_name || "1 item";
      return `${items.length} items`;
    }

    async function buyAgain(orderId) {
      const order = orders.find(item => Number(item.id) === Number(orderId));
      if (!order) return alert("Order not found.");

      const sourceItems = orderItems(order).filter(item => Number(item.product_id));
      if (!sourceItems.length) return alert("This order has no product details available for reorder.");

      try {
        const res = await fetch("/products");
        const products = await res.json();
        if (!res.ok || !Array.isArray(products)) throw new Error("Unable to check latest product stock.");

        const cart = getProfileCart();
        const skipped = [];
        let addedCount = 0;

        sourceItems.forEach(item => {
          const product = products.find(entry => Number(entry.id) === Number(item.product_id));
          if (!product) {
            skipped.push(`${item.product_name || "Product"} is no longer available`);
            return;
          }

          const variantIndex = findReorderVariantIndex(item, product);
          const variants = productVariantsFromProfile(product);
          if (variants.length && variantIndex === "") {
            skipped.push(`${product.name || item.product_name || "Product"} needs variant selection again`);
            return;
          }
          const variant = variantIndex !== "" ? variants[Number(variantIndex)] : null;
          const stock = Number(variant ? variant.stock : product.stock || 0);
          if (stock <= 0) {
            skipped.push(`${product.name || item.product_name || "Product"} is out of stock`);
            return;
          }

          const key = reorderCartKey(product.id, variantIndex);
          const existing = cart.find(entry => entry.key === key);
          const requestedQty = Math.max(Number(item.quantity || 1), 1);
          const existingQty = existing ? Number(existing.quantity || 0) : 0;
          const addQty = Math.min(requestedQty, Math.max(stock - existingQty, 0));

          if (addQty <= 0) {
            skipped.push(`${product.name || item.product_name || "Product"} already reached available stock in cart`);
            return;
          }

          if (existing) {
            existing.quantity = existingQty + addQty;
            existing.stock = stock;
            existing.price = Number(variant ? variant.price : product.price || item.unit_price || 0);
            existing.selected = true;
          } else {
            cart.push({
              key,
              product_id: Number(product.id),
              variant_index: variantIndex,
              name: product.name || item.product_name || "Product",
              variant_name: variant ? variant.name : (item.variant_name || "Default"),
              price: Number(variant ? variant.price : product.price || item.unit_price || 0),
              stock,
              quantity: addQty,
              selected: true
            });
          }

          addedCount += addQty;
        });

        if (!addedCount) {
          alert(skipped.join("\n") || "No items were added to cart.");
          return;
        }

        saveProfileCart(cart);
        localStorage.setItem("openCartOnShop", "1");
        const note = skipped.length ? `\n\nSome items were skipped:\n${skipped.join("\n")}` : "";
        alert(`Added ${addedCount} item(s) from ${orderLabel(order)} to cart.${note}`);
        window.location.href = "/customer/shop.html?cart=open";
      } catch (error) {
        alert(error.message || "Unable to add this order to cart.");
      }
    }
    async function retryPayment(orderId) {
      try {
        const res = await fetch(`/payments/gcash/retry/${orderId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: currentUser.id })
        });
        const data = await res.json();

        if (!res.ok) {
          alert(data.message || "Unable to prepare GCash upload.");
          await loadOrders();
          return;
        }

        if (data.payment_checkout_url) {
          window.location.href = data.payment_checkout_url;
          return;
        }

        await loadOrders();
        alert(data.message || "You can now upload GCash proof.");
      } catch (error) {
        alert(error.message || "Unable to prepare GCash upload.");
      }
    }
    function customerOrderSearchText(order) {
      const items = orderItems(order);
      return [
        orderItemsTitle(order),
        order.status,
        customerOrderStatusLabel(order),
        window.CustomerDeliveryStatus.status(order),
        paymentStatusLabel(order),
        order.payment_method,
        order.payment_status,
        order.repair_request_status,
        ...items.flatMap(item => [item.product_name, item.variant_name, item.quantity])
      ].join(" ").toLowerCase();
    }

    function clearOrderSearch() {
      const input = document.getElementById("customerOrderSearch");
      if (input) input.value = "";
      renderOrders();
    }
    function profileOrderIcon(name) {
      return `<i data-lucide="${name}" aria-hidden="true"></i>`;
    }

    document.addEventListener('click', event => {
      document.querySelectorAll('.profile-order-more[open]').forEach(menu => {
        if (!menu.contains(event.target) || event.target.closest('.profile-order-menu button')) menu.open = false;
      });
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      document.querySelectorAll('.profile-order-more[open]').forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); });
    });

    function profileOrderActions(order) {
      const id = Number(order.id);
      const button = (text, icon, action, className = '', attributes = '') => `<button type="button" class="${className}" onclick="${action}" ${attributes}>${profileOrderIcon(icon)}<span>${text}</span></button>`;
      let primary = button('View Order', 'arrow-up-right', `openOrderTracking(${id})`, 'btn btn-dark');
      let isViewPrimary = true;
      if (canSubmitManualGcashProof(order)) {
        primary = button('Submit GCash Proof', 'upload', `openOrderTracking(${id})`, 'btn btn-dark'); isViewPrimary = false;
      } else if (canPayOrder(order)) {
        primary = `<a class="btn btn-dark" href="${escapeHtml(usableCheckoutUrl(order))}">${profileOrderIcon('wallet')}Pay Now</a>`; isViewPrimary = false;
      } else if (canRetryPayment(order)) {
        primary = button(order.payment_method === 'installment' ? 'Prepare Downpayment Proof' : 'Prepare GCash Proof', 'upload', `retryPayment(${id})`, 'btn btn-dark'); isViewPrimary = false;
      } else if (canReviewOrder(order)) {
        primary = button('Write Review', 'star', `goToReview(${id})`, 'btn btn-dark'); isViewPrimary = false;
      }
      const other = [
        button('Copy Order ID', 'copy', `copyOrderId(${id})`),
        button('Buy Again', 'shopping-cart', `buyAgain(${id})`)
      ];
      if (canRefreshPayment(order)) other.push(button('Refresh Payment', 'refresh-cw', `refreshPaymentStatus(${id})`));
      if (canRequestCancellation(order)) other.push(button('Request Cancel', 'circle-x', `requestCancellation(${id})`));
      if (canRequestRepair(order)) other.push(button('Request Repair', 'wrench', `requestRepair(${id})`, '', `data-repair-request="${id}" ${repairRequestsInFlight.has(id) ? 'disabled' : ''}`));
      return `<div class="profile-order-actions">${!isViewPrimary ? button('View Order', 'arrow-up-right', `openOrderTracking(${id})`, 'btn btn-outline-dark') : ''}${primary}<details class="profile-order-more"><summary aria-label="More actions" title="More order actions">${profileOrderIcon('ellipsis')}</summary><div class="profile-order-menu">${other.join('')}</div></details></div>`;
    }

    function orderCard(order) {
      const items = orderItems(order);
      const bucket = getBucket(order);
      const itemHtml = item => `<div class="profile-order-product"><span class="profile-order-photo">${profileOrderIcon('image-off')}<img class="order-image" src="${escapeHtml(item.product_image)}" alt="${escapeHtml(item.product_name || 'Product')}" loading="lazy" onerror="this.hidden=true"></span><div><h3>${escapeHtml(item.product_name || 'Product')}</h3><p>${escapeHtml(item.variant_name || 'Standard')}</p><span>Qty ${Number(item.quantity || 1)}</span></div>${item.subtotal != null || item.unit_price != null ? `<strong class="profile-order-item-price">${money(item.subtotal ?? Number(item.unit_price) * Number(item.quantity || 1))}</strong>` : ''}</div>`;
      const paymentIssue = canSubmitManualGcashProof(order) && String(order.payment_status).toLowerCase() === 'rejected';
      const note = paymentIssue ? order.payment_rejection_reason || 'Upload a new payment proof to continue.'
        : order.cancellation_request_status === 'pending' ? 'Your cancellation request is under review.'
        : bucket === 'waiting-approval' ? 'Your payment proof is being reviewed by the shop.'
        : bucket === 'out-for-delivery' ? 'Your order is on the way. Keep your phone available.' : '';
      return `
        <article class="order-card profile-order-card" data-order-id="${Number(order.id)}">
          <header class="profile-order-head"><time datetime="${escapeHtml(order.created_at || '')}">${escapeHtml(orderDate(order.created_at))}</time><span class="profile-order-status" data-bucket="${bucket}">${profileOrderIcon({ 'waiting-approval': 'clock-3', 'placed': 'clipboard-check', 'to-pay': 'wallet', 'to-ship': 'package', 'to-receive': 'package-check', 'out-for-delivery': 'truck', completed: 'circle-check', cancelled: 'circle-x' }[bucket] || 'package')}${escapeHtml(customerOrderStatusLabel(order))}</span></header>
          <div class="profile-order-products">${items.slice(0, 2).map(itemHtml).join('')}${items.length > 2 ? `<details class="profile-order-extra"><summary>+${items.length - 2} more products</summary>${items.slice(2).map(itemHtml).join('')}</details>` : ''}</div>
          <div class="profile-order-payment"><span>${profileOrderIcon('wallet')}${escapeHtml(paymentMethodLabel(order.payment_method))}</span><span>${escapeHtml(paymentStatusLabel(order))}</span></div>
          ${orderTrackingHtml(order, true)}
          ${note ? `<div class="profile-order-note ${paymentIssue ? 'payment-issue' : ''}">${profileOrderIcon(paymentIssue ? 'circle-alert' : 'info')}<span>${escapeHtml(note)}</span></div>` : ''}
          <footer class="profile-order-footer"><div class="profile-order-total"><span>Order total</span><strong>${money(order.total_price)}</strong>${Number(order.shipping_fee) > 0 ? `<small>Includes ${money(order.shipping_fee)} shipping</small>` : ''}</div>${profileOrderActions(order)}</footer>
        </article>
      `;
    }

    function renderOrders() {
      const container = document.getElementById("ordersList");
      if (ordersLoadError) {
        container.innerHTML = `<div class="profile-orders-empty" role="alert">${profileOrderIcon('circle-alert')}<h3>Unable to load orders</h3><button type="button" class="btn btn-outline-dark" onclick="loadOrders()">${profileOrderIcon('refresh-cw')}Try Again</button></div>`;
        window.lucide?.createIcons();
        return;
      }
      const buckets = ["waiting-approval", "placed", "to-pay", "to-ship", "to-receive", "out-for-delivery", "completed", "cancelled"];
      const visibleBuckets = activeFilter === "all" ? buckets : [activeFilter];
      sanitizeOrderSearch();
      const search = document.getElementById("customerOrderSearch")?.value.trim().toLowerCase() || "";
      const matchingOrders = [...(search ? orders.filter(order => customerOrderSearchText(order).includes(search)) : orders)];
      const oldest = document.getElementById('customerOrderSort')?.value === 'oldest';
      matchingOrders.sort((a, b) => (oldest ? 1 : -1) * ((Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || Number(a.id) - Number(b.id)));
      document.querySelectorAll('#ordersSection [data-filter]').forEach(tab => {
        tab.querySelector('.tab-count').textContent = tab.dataset.filter === 'all' ? orders.length : orders.filter(order => getBucket(order) === tab.dataset.filter).length;
      });
      const completed = orders.filter(order => getBucket(order) === 'completed').length;
      const active = orders.filter(order => !['completed', 'cancelled'].includes(getBucket(order))).length;
      document.getElementById('customerOrderActivitySummary').textContent = `${active} active / ${completed} completed`;
      const searchCount = document.getElementById("customerOrderSearchCount");
      const visibleCount = matchingOrders.filter(order => activeFilter === 'all' || getBucket(order) === activeFilter).length;
      if (searchCount) searchCount.innerText = `Showing ${visibleCount} of ${orders.length}`;
      const sections = visibleBuckets.map(bucket => {
        const list = matchingOrders.filter(order => getBucket(order) === bucket);
        if (!list.length && activeFilter !== "all") {
          return `
            <div class="profile-orders-empty">
              ${profileOrderIcon('package-search')}
              <h4>${search ? "No matching orders" : "No orders here"}</h4>
              <p>${search ? "Try another product, status, or payment keyword." : "No orders with this status yet."}</p>
            </div>
          `;
        }
        if (!list.length) return "";

        return `
          <section class="orders-section">
            <div class="orders-section-head">
              <h2>${bucketLabel(bucket)}</h2>
              <span class="status-pill">${list.length}</span>
            </div>
            <div class="orders-list">
              ${list.map(orderCard).join("")}
            </div>
          </section>
        `;
      }).join("");

      container.innerHTML = sections || `
        <div class="profile-orders-empty">
          ${profileOrderIcon('shopping-bag')}
          <h4>${search ? "No matching orders" : "No orders yet"}</h4>
        <p>${search ? "Try another product, status, or payment keyword." : "Your purchases will appear here."}</p>
        ${!orders.length ? `<a class="btn btn-dark" href="/customer/shop.html#products">${profileOrderIcon('store')}Browse Shop</a>` : ''}
        </div>
      `;
      window.lucide?.createIcons();
    }


    function renderRepairWarrantyCenter() {
      const container = document.getElementById("repairWarrantyList");
      if (!container) return;
      const overview = document.getElementById("repairOverview");
      const toolbar = document.getElementById("repairToolbar");
      const trackedOrders = orders.filter(order => {
        return (order.status || "") === "delivered" || Boolean(order.repair_request_status);
      });
      overview.hidden = toolbar.hidden = ordersLoadError || !trackedOrders.length;
      if (ordersLoadError) {
        container.innerHTML = `<div class="payments-empty" role="status"><i data-lucide="cloud-off" aria-hidden="true"></i><h3>Unable to load warranty and repair activity</h3><button class="btn btn-outline-dark icon-label" onclick="loadOrders()"><i data-lucide="rotate-cw" aria-hidden="true"></i><span>Try Again</span></button></div>`;
        window.lucide?.createIcons();
        return;
      }
      if (!trackedOrders.length) {
        container.innerHTML = `<div class="payments-empty"><i data-lucide="shield-check" aria-hidden="true"></i><h3>No warranty activity yet</h3><p>Delivered purchases and repair requests will appear here.</p><a class="btn btn-outline-dark icon-label" href="#orders"><i data-lucide="package" aria-hidden="true"></i><span>View My Orders</span></a></div>`;
        window.lucide?.createIcons();
        return;
      }
      const openRequest = order => order.repair_request_status === "pending" || (order.repair_request_status === "approved" && order.repair_service_status !== "completed");
      const ready = order => order.repair_request_status === "approved" && order.repair_service_status === "ready_for_pickup";
      const completed = order => order.repair_request_status === "approved" && order.repair_service_status === "completed";
      overview.innerHTML = `<div class="payment-metrics">${[
        ["shield-check", "Covered orders", trackedOrders.filter(isWarrantyActive).length],
        ["wrench", "Open requests", trackedOrders.filter(openRequest).length],
        ["package-check", "Ready for pickup", trackedOrders.filter(ready).length],
        ["circle-check", "Completed repairs", trackedOrders.filter(completed).length]
      ].map(([icon, label, count]) => `<div class="payment-metric"><i data-lucide="${icon}" aria-hidden="true"></i><span>${label}</span><strong>${count}</strong></div>`).join("")}</div>`;
      const filter = document.getElementById("repairFilter").value;
      const visibleOrders = trackedOrders.filter(order => {
        if (filter === "covered") return isWarrantyActive(order);
        if (filter === "ongoing") return openRequest(order);
        if (filter === "ready") return ready(order);
        if (filter === "completed") return completed(order);
        if (filter === "expired") return order.status === "delivered" && !isWarrantyActive(order);
        return true;
      });
      document.getElementById("repairCount").textContent = `${visibleOrders.length} of ${trackedOrders.length}`;
      container.innerHTML = visibleOrders.map(order => {
        const warrantyActive = isWarrantyActive(order);
        const serviceStatus = order.repair_service_status || "approved";
        const requestStatus = order.repair_request_status;
        const statusText = requestStatus === "approved" ? repairServiceStatusLabel(serviceStatus)
          : requestStatus === "pending" ? "Awaiting review" : requestStatus === "rejected" ? "Request declined" : "No repair request";
        const statusTone = requestStatus === "pending" ? "pending" : requestStatus === "rejected" ? "overdue" : requestStatus === "approved" ? "paid" : "neutral";
        const items = orderItems(order);
        const title = items.map(item => item.product_name).join(" + ");
        const steps = ["approved", "item_received", "diagnosing", "repairing", "ready_for_pickup", "completed"];
        const currentStep = steps.indexOf(serviceStatus);
        return `
          <article class="service-item">
            <header class="service-head">
              <img src="${escapeHtml(orderImage(order))}" alt="${escapeHtml(title)}" loading="lazy">
              <div class="service-product"><h3>${escapeHtml(title)}</h3><p>${items.map(item => `${escapeHtml(item.variant_name || "Default")} &middot; Qty ${Number(item.quantity || 1)}`).join(" / ")}</p></div>
              <span class="payment-state ${statusTone}">${escapeHtml(statusText)}</span>
            </header>
            <dl class="service-facts">
              <div><dt>Warranty coverage</dt><dd class="${warrantyActive ? "covered" : ""}"><i data-lucide="${warrantyActive ? "shield-check" : "shield-off"}" aria-hidden="true"></i>${warrantyActive ? "Under warranty" : order.status === "delivered" ? "Expired" : "Not yet active"}</dd></div>
              <div><dt>${order.warranty_expires_at ? "Coverage ends" : "Delivered"}</dt><dd>${escapeHtml(formatDate(order.warranty_expires_at || order.delivered_at))}</dd></div>
              <div><dt>Request submitted</dt><dd>${escapeHtml(formatDate(order.repair_requested_at))}</dd></div>
            </dl>
            ${requestStatus === "approved" ? `
              <div class="service-progress"><p>Service progress <strong>${escapeHtml(repairServiceStatusLabel(serviceStatus))}</strong></p>
                <ol class="service-steps" aria-label="Repair progress">${steps.map((step, index) => `<li class="${index < currentStep || serviceStatus === "completed" ? "done" : index === currentStep ? "current" : ""}" ${index === currentStep ? 'aria-current="step"' : ""}><span class="service-step-marker" aria-hidden="true">${index < currentStep || serviceStatus === "completed" ? '<i data-lucide="check"></i>' : index + 1}</span><span>${escapeHtml(repairServiceStatusLabel(step))}</span></li>`).join("")}</ol>
              </div>
            ` : ""}
            ${order.repair_issue || order.repair_admin_note ? `<div class="service-notes">
              ${order.repair_issue ? `<div><h4>Reported issue</h4><p>${escapeHtml(order.repair_issue)}</p></div>` : ""}
              ${order.repair_admin_note ? `<div><h4><i data-lucide="message-square" aria-hidden="true"></i>Shop update</h4><p>${escapeHtml(order.repair_admin_note)}</p></div>` : ""}
            </div>` : ""}
            <footer class="service-footer">
              <span>${requestStatus === "pending" ? "Your request is waiting for the shop's review." : ready(order) ? "Check the shop update for pickup instructions." : completed(order) ? "Service completed." : !requestStatus && warrantyActive ? "Repair requests are subject to warranty review." : !warrantyActive && !requestStatus ? "Warranty coverage has ended." : ""}</span>
              <div class="service-actions">
                <a class="payment-view" href="/customer/order.html?order_id=${Number(order.id)}" title="View Order" aria-label="View order for ${escapeHtml(title)}"><i data-lucide="external-link" aria-hidden="true"></i></a>
                ${canRequestRepair(order) ? `<button class="btn btn-dark icon-label" data-repair-request="${Number(order.id)}" onclick="requestRepair(${Number(order.id)})" ${repairRequestsInFlight.has(Number(order.id)) ? "disabled" : ""}><i data-lucide="wrench" aria-hidden="true"></i><span>Request Repair</span></button>` : ""}
              </div>
            </footer>
          </article>
        `;
      }).join("") || `<div class="payments-empty"><i data-lucide="search" aria-hidden="true"></i><h3>No matching activity</h3><button class="btn btn-outline-dark" onclick="document.getElementById('repairFilter').value='all';renderRepairWarrantyCenter()">Show All Activity</button></div>`;
      window.lucide?.createIcons();
    }
    function viewOrderDetails(orderId) {
      currentViewingOrderId = orderId;
      const order = orders.find(item => Number(item.id) === Number(orderId));
      if (!order) return;
      const items = orderItems(order);
      setCustomerOrderUrl(orderId);
      document.getElementById("orderModalTitle").innerText = orderLabel(order);
      document.getElementById("orderModalSubtitle").innerText = `${bucketLabel(getBucket(order))} | ${orderDate(order.created_at)}`;
      document.getElementById("orderModalBody").innerHTML = `
        <div class="order-detail-items">
          ${items.map(item => `
            <div class="order-detail-item">
              <img src="${escapeHtml(item.product_image)}" alt="${escapeHtml(item.product_name || "Product")}">
              <div>
                <strong>${escapeHtml(item.product_name || "Product")}</strong>
                <div class="text-muted">Variant: ${escapeHtml(item.variant_name || "Default")}</div>
                <div class="text-muted">Qty: ${item.quantity}</div>
              </div>
              <strong>${money(item.subtotal || Number(item.unit_price || 0) * Number(item.quantity || 1))}</strong>
            </div>
          `).join("")}
        </div>
        ${orderTrackingHtml(order)}
        ${statusHistoryHtml(order)}
        <div class="order-meta mt-3">
          <span>Status: ${escapeHtml(order.status || "pending")}</span>
          <span>Payment: ${paymentMethodLabel(order.payment_method)}</span>
          <span>Payment Status: ${paymentStatusLabel(order)}</span>
              ${order.payment_last_checked_at ? `<span>Payment Checked: ${orderDate(order.payment_last_checked_at)}</span>` : ""}
          ${deliveryLine(order)}
          ${deliveryNoteLine(order)}
          ${shippingLine(order)}
          ${cancellationLine(order)}
          ${warrantyLine(order)}
          ${repairLine(order)}
        </div>
        <div class="order-modal-total mt-3">
          <span>Total</span>
          <strong>${money(order.total_price)}</strong>
        </div>
        <div class="order-actions">
          <button class="btn btn-dark" onclick="printCustomerOrderReceipt()">Print Receipt</button>
          <button class="btn btn-outline-dark" onclick="copyOrderId(${order.id})">Copy ID</button>
          <button class="btn btn-outline-dark" onclick="copyOrderLink(${order.id})">Copy Link</button>
          <button class="btn btn-outline-dark" onclick="closeOrderDetails(); buyAgain(${order.id})">Buy Again</button>
          ${canSubmitManualGcashProof(order) ? `<button class="btn btn-dark" onclick="closeOrderDetails(); openOrderTracking(${order.id})">Submit GCash Proof</button>` : ""}
          ${canPayOrder(order) ? `<a class="btn btn-dark" href="${escapeHtml(usableCheckoutUrl(order))}">Pay Now</a>` : ""}
          ${canRetryPayment(order) ? `<button class="btn btn-dark" onclick="retryPayment(${order.id})">${order.payment_method === "installment" ? "Prepare Downpayment Proof" : "Prepare GCash Proof"}</button>` : ""}
          ${canRefreshPayment(order) ? `<button class="btn btn-outline-dark" onclick="refreshPaymentStatus(${order.id})">Refresh Payment</button>` : ""}
          ${canRequestCancellation(order) ? `<button class="btn btn-outline-dark" onclick="closeOrderDetails(); requestCancellation(${order.id})">Request Cancel</button>` : ""}
          ${canRequestRepair(order) ? `<button class="btn btn-outline-dark" onclick="closeOrderDetails(); requestRepair(${order.id})">Request Repair</button>` : ""}
          ${canReviewOrder(order) ? `<button class="btn btn-outline-dark" onclick="closeOrderDetails(); goToReview(${order.id})">Write Review</button>` : ""}
        </div>
      `;
      document.getElementById("orderModalBackdrop").classList.add("show");
    }

    function printableCustomerOrderHtml(order) {
      const items = orderItems(order)
      const lt = String.fromCharCode(60)
      const gt = String.fromCharCode(62)
      function openTag(name) { return lt + name + gt }
      function closeTag(name) { return lt + "/" + name + gt }
      function tag(name, content) { return openTag(name) + content + closeTag(name) }
      const rows = items.map(function (item) {
        const product = escapeHtml(item.product_name ? item.product_name : "Product")
        const variant = escapeHtml(item.variant_name ? item.variant_name : "Default")
        const qty = item.quantity ? item.quantity : 1
        const subtotal = money(item.subtotal ? item.subtotal : Number(item.unit_price ? item.unit_price : 0) * Number(qty))
        return tag("tr", tag("td", product) + tag("td", variant) + tag("td", String(qty)) + tag("td", subtotal))
      }).join("")
      const orderTitle = orderLabel(order)
      return lt + "!doctype html" + gt +
        openTag("html") +
        openTag("head") + tag("title", orderTitle) + closeTag("head") +
        openTag("body") +
        tag("h1", "Sheena's Gadgets & Accessories Shop") +
        tag("h2", orderTitle) +
        tag("p", "Customer order receipt") +
        tag("p", "Date: " + escapeHtml(orderDate(order.created_at))) +
        tag("p", "Payment: " + escapeHtml(paymentMethodLabel(order.payment_method))) +
        openTag("table") +
        tag("thead", tag("tr", tag("th", "Product") + tag("th", "Variant") + tag("th", "Qty") + tag("th", "Subtotal"))) +
        tag("tbody", rows) +
        closeTag("table") +
        tag("h2", "Shipping: " + (shippingRegionLabel(order) || "Delivery") + " / " + money(order.shipping_fee || 0)) +
        tag("h2", "Total: " + money(order.total_price)) +
        closeTag("body") +
        closeTag("html")
    }
    function printCustomerOrderReceipt() {
      const order = orders.find(item => Number(item.id) === Number(currentViewingOrderId));
      if (!order) return;
      const printWindow = window.open("", "_blank", "width=900,height=720");
      if (!printWindow) return alert("Please allow pop-ups to print this receipt.");
      printWindow.document.open();
      printWindow.document.write(printableCustomerOrderHtml(order));
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 300);
    }
    function closeOrderDetails(event) {
      if (event && event.target.id !== "orderModalBackdrop") return;
      document.getElementById("orderModalBackdrop")?.classList.remove("show");
      currentViewingOrderId = null;
      clearCustomerOrderUrl();
    }

    function canReviewOrder(order) {
      return (order.status || "") === "delivered";
    }
    async function requestCancellation(orderId) {
      const values = await AppDialog.form({
        eyebrow: "Order request",
        title: "Request order cancellation",
        message: "Tell the shop why you need to cancel this order. The request is subject to admin review.",
        details: [{ label: "Order", value: orderReference(orderId) }],
        fields: [{ name: "reason", label: "Cancellation reason", type: "textarea", required: true, placeholder: "Example: I selected the wrong item or delivery address." }],
        submitText: "Submit Request"
      });
      if (!values) return;
      const reason = values.reason.trim();

      const res = await fetch(`/orders/${orderId}/cancellation-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: currentUser.id, reason })
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.message || "Unable to request cancellation.");
        return;
      }

      alert("Cancellation request submitted. Admin will review it.");
      await loadOrders();
    }

    async function requestRepair(orderId) {
      orderId = Number(orderId);
      const order = orders.find(item => Number(item.id) === orderId);
      if (!order || !canRequestRepair(order) || repairRequestsInFlight.has(orderId)) return;
      repairRequestsInFlight.add(orderId);
      try {
        const repairItem = orderItems(order)[0];
        const values = await AppDialog.form({
          variant: "repair",
          confirmIcon: "send",
          eyebrow: "Repairs & warranty",
          title: "Request a repair",
          message: "Describe the problem and when it happens. The shop will review your request and warranty coverage.",
          preview: { items: repairItem ? [{ name: repairItem.product_name, description: `${repairItem.variant_name || "Standard"} · Qty ${Number(repairItem.quantity || 1)}`, image: repairItem.product_image }] : [] },
          details: [
            { label: "Order", value: orderReference(orderId), icon: "package-check" },
            { label: "Warranty", value: order.warranty_expires_at ? `Active until ${formatDate(order.warranty_expires_at)}` : "Active", icon: "shield-check" }
          ],
          fields: [{ name: "issue", label: "What needs repair?", type: "textarea", rows: 5, required: true, maxLength: 1200, placeholder: "Tell us what is happening and when you first noticed it." }],
          submitText: "Send Repair Request"
        });
        if (!values) return;
        const issue = values.issue.trim();
        if (!issue) { alert("Please describe the product issue."); return; }
        document.querySelectorAll(`[data-repair-request="${orderId}"]`).forEach(button => { button.disabled = true; });

        const res = await fetch(`/orders/${orderId}/repair-request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: currentUser.id, issue })
        });
        const data = await res.json();

        if (!res.ok) {
          alert(data.message || "Unable to request repair.");
          return;
        }

        alert("Repair request submitted. Admin will review it.");
        await loadOrders();
      } catch (error) {
        alert("Unable to submit your repair request. Please try again.");
      } finally {
        repairRequestsInFlight.delete(orderId);
        document.querySelectorAll(`[data-repair-request="${orderId}"]`).forEach(button => { button.disabled = false; });
      }
    }


    function goToReview(orderId) {
      window.location.href = `/customer/review.html?order_id=${orderId}`;
    }

    async function submitReview(orderId) {
      const values = await AppDialog.form({
        eyebrow: "Product feedback",
        title: "Write a product review",
        message: "Share your experience to help other customers make a better choice.",
        details: [{ label: "Order", value: orderReference(orderId) }],
        fields: [
          {
            name: "rating",
            label: "Rating",
            type: "select",
            required: true,
            defaultValue: "5",
            options: [
              { value: "5", label: "5 - Excellent" },
              { value: "4", label: "4 - Very good" },
              { value: "3", label: "3 - Good" },
              { value: "2", label: "2 - Fair" },
              { value: "1", label: "1 - Poor" }
            ]
          },
          { name: "comment", label: "Review", type: "textarea", required: true, placeholder: "What did you like or dislike about the product?" }
        ],
        submitText: "Submit Review"
      });
      if (!values) return;
      const rating = Number(values.rating);
      const comment = values.comment.trim();

      const res = await fetch("/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId, user_id: currentUser.id, rating, comment })
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.message || "Unable to submit review.");
        return;
      }

      alert("Review submitted. Thank you!");
      await loadOrders();
    }
    function wishlistIds() {
      try { return JSON.parse(localStorage.getItem("wishlist") || "[]").map(Number); } catch (error) { return []; }
    }

    function removeWishlist(productId) {
      const next = wishlistIds().filter(id => id !== Number(productId));
      localStorage.setItem("wishlist", JSON.stringify(next));
      renderWishlist();
    }

    function productImage(product) {
      try {
        const images = product.images ? JSON.parse(product.images) : [];
        if (Array.isArray(images) && images.length) return images[0];
      } catch (error) {}
      return product.image || "https://via.placeholder.com/220x220?text=Product";
    }

    function renderWishlist() {
      const container = document.getElementById("wishlistList");
      if (!container) return;
      const ids = wishlistIds();
      const saved = wishlistProducts.filter(product => ids.includes(Number(product.id)));
      document.getElementById("wishlistCount").textContent = `${saved.length} saved ${saved.length === 1 ? "product" : "products"}`;
      if (!saved.length) {
        container.innerHTML = `<div class="wishlist-empty"><i data-lucide="heart" aria-hidden="true"></i><h3>Your wishlist is empty</h3><a class="btn btn-dark icon-label" href="/customer/shop.html#products"><i data-lucide="store" aria-hidden="true"></i><span>Browse Shop</span></a></div>`;
        window.lucide?.createIcons();
        return;
      }
      container.innerHTML = saved.map(product => {
        const id = Number(product.id);
        const inStock = Number(product.stock) > 0;
        return `
        <article class="wishlist-item">
          <a class="wishlist-image" href="/customer/product.html?id=${id}" aria-label="View ${escapeHtml(product.name)}"><img src="${escapeHtml(productImage(product))}" alt="${escapeHtml(product.name)}" loading="lazy" onerror="this.hidden=true"></a>
          <div class="wishlist-details">
            <span class="wishlist-category">${escapeHtml(product.category || "Gadgets & Accessories")}</span>
            <h3><a href="/customer/product.html?id=${id}">${escapeHtml(product.name)}</a></h3>
            <span class="wishlist-stock ${inStock ? "in-stock" : "out-of-stock"}">${inStock ? "In stock" : "Out of stock"}</span>
          </div>
          <strong class="wishlist-price">${money(product.price)}</strong>
          <div class="wishlist-actions">
            <a class="wishlist-icon wishlist-view" href="/customer/product.html?id=${id}" title="View product" aria-label="View ${escapeHtml(product.name)}"><i data-lucide="arrow-up-right" aria-hidden="true"></i></a>
            <button class="wishlist-icon wishlist-remove" type="button" title="Remove from wishlist" aria-label="Remove ${escapeHtml(product.name)} from wishlist" onclick="removeWishlist(${id})"><i data-lucide="trash-2" aria-hidden="true"></i></button>
          </div>
        </article>
      `;
      }).join("");
      window.lucide?.createIcons();
    }

    async function loadWishlist() {
      const container = document.getElementById("wishlistList");
      container.innerHTML = `<div class="wishlist-empty" role="status">Loading saved products...</div>`;
      try {
        const res = await fetch("/products");
        if (!res.ok) throw new Error("Unable to load saved products.");
        const data = await res.json();
        wishlistProducts = Array.isArray(data) ? data : [];
        renderWishlist();
      } catch (error) {
        container.innerHTML = `<div class="wishlist-empty" role="alert"><p>Unable to load your wishlist.</p><button class="btn btn-outline-dark icon-label" onclick="loadWishlist()"><i data-lucide="refresh-cw" aria-hidden="true"></i><span>Try Again</span></button></div>`;
        window.lucide?.createIcons();
      }
    }
    function openLinkedOrderIfNeeded() {
      if (orderLinkHandled) return;
      const orderId = Number(new URLSearchParams(window.location.search).get("order"));
      if (!orderId) return;

      orderLinkHandled = true;
      window.location.href = `/customer/order.html?order_id=${orderId}`;
    }
    async function loadOrders() {
      const container = document.getElementById("ordersList");
      container.innerHTML = `<div class="empty-state">Loading orders...</div>`;
      document.getElementById("repairOverview").hidden = true;
      document.getElementById("repairToolbar").hidden = true;
      document.getElementById("repairWarrantyList").innerHTML = `<div class="payments-empty" role="status">Loading warranty and repair activity...</div>`;
      ordersLoadError = false;
      try {
        const res = await fetch(`/orders/customer/${currentUser.id}`);
        const data = await res.json();
        if (!res.ok) throw new Error("Unable to load orders.");

        orders = Array.isArray(data) ? data : [];
        renderSummary();
        renderPaymentNotifications();
        renderRepairWarrantyCenter();
        renderOrders();
        openLinkedOrderIfNeeded();
      } catch (error) {
        ordersLoadError = true;
        renderOrders();
        renderRepairWarrantyCenter();
      }
    }

    async function loadInstallmentSchedules() {
      const container = document.getElementById("installmentScheduleList");
      container.innerHTML = `<div class="empty-state">Loading installment schedules...</div>`;

      const res = await fetch(`/installments/customer/${currentUser.id}/schedules`);
      const data = await res.json();

      if (!res.ok) {
        container.innerHTML = `<div class="empty-state">Unable to load installment schedules.</div>`;
        installmentSchedules = [];
        renderInstallmentDueAlerts();
        return;
      }

      installmentSchedules = Array.isArray(data) ? data : [];
      renderInstallmentDueAlerts();
      renderInstallmentSchedules();
      renderInstallmentApplications();
    }

    async function loadLayaways() {
      const container = document.getElementById("layawayList");
      if (container) container.innerHTML = `<div class="payments-empty" role="status">Loading layaway plans...</div>`;
      layawayLoadError = false;
      try {
        const res = await fetch(`/layaways/customer/${currentUser.id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Unable to load layaways.");
        layaways = Array.isArray(data) ? data : [];
      } catch (error) {
        layawayLoadError = true;
      }
      renderLayaways();
    }

    function layawayStatusLabel(status) {
      const labels = {
        pending_downpayment: "Pending Downpayment",
        payment_failed: "Payment Failed",
        active: "Active",
        overdue: "Overdue",
        ready_for_release: "Ready for Release",
        on_the_way: "On the Way",
        delivered: "Delivered",
        released: "Released",
        cancelled: "Cancelled"
      };
      return labels[status] || status || "Pending";
    }

    function renderLayaways() {
      const container = document.getElementById("layawayList");
      if (!container) return;
      const overview = document.getElementById("layawayOverview");
      const filterControl = document.getElementById("layawayFilter");
      overview.hidden = layawayLoadError || layaways.length === 0;
      filterControl.hidden = layawayLoadError || layaways.length === 0;
      document.getElementById("layawayCount").textContent = layawayLoadError ? "" : layaways.length;
      if (layawayLoadError) {
        container.innerHTML = `<div class="payments-empty plan-schedule-empty" role="alert"><i data-lucide="circle-alert" aria-hidden="true"></i><h3>Unable to load layaway plans</h3><button class="btn btn-outline-dark icon-label" onclick="loadLayaways()"><i data-lucide="refresh-cw" aria-hidden="true"></i><span>Try Again</span></button></div>`;
        window.lucide?.createIcons();
        return;
      }
      if (!layaways.length) {
        container.innerHTML = `<div class="payments-empty plan-schedule-empty"><i data-lucide="hand-coins" aria-hidden="true"></i><h3>No layaway plans yet</h3><a class="btn btn-outline-dark icon-label" href="/customer/shop.html#products"><i data-lucide="store" aria-hidden="true"></i><span>Browse Shop</span></a></div>`;
        window.lucide?.createIcons();
        return;
      }
      const ongoingStatuses = ["pending_downpayment", "payment_failed", "active", "overdue"];
      const ongoing = layaways.filter(item => ongoingStatuses.includes(item.status_label || item.status));
      const ready = layaways.filter(item => (item.status_label || item.status) === "ready_for_release");
      const totalPaid = layaways.reduce((sum, item) => sum + Number(item.amount_paid || 0), 0);
      const outstanding = ongoing.reduce((sum, item) => sum + Math.max(Number(item.balance ?? (Number(item.total_amount || 0) - Number(item.amount_paid || 0))), 0), 0);
      overview.innerHTML = `<div class="payment-metric"><i data-lucide="hand-coins" aria-hidden="true"></i><span>Ongoing Plans</span><strong>${ongoing.length}</strong></div><div class="payment-metric"><i data-lucide="badge-check" aria-hidden="true"></i><span>Total Paid</span><strong>${money(totalPaid)}</strong></div><div class="payment-metric"><i data-lucide="wallet" aria-hidden="true"></i><span>Outstanding Balance</span><strong>${money(outstanding)}</strong></div><div class="payment-metric"><i data-lucide="package-check" aria-hidden="true"></i><span>Ready for Release</span><strong>${ready.length}</strong></div>`;
      const filter = filterControl.value;
      const visible = layaways.filter(item => {
        const status = item.status_label || item.status || "pending_downpayment";
        if (filter === "ongoing") return ongoingStatuses.includes(status);
        if (filter === "ready") return status === "ready_for_release";
        if (filter === "completed") return ["released", "delivered"].includes(status);
        if (filter === "cancelled") return status === "cancelled";
        return true;
      });
      if (!visible.length) {
        container.innerHTML = `<div class="payments-empty plan-schedule-empty"><i data-lucide="list-filter" aria-hidden="true"></i><h3>No matching layaway plans</h3><button class="btn btn-outline-dark icon-label" onclick="document.getElementById('layawayFilter').value='all';renderLayaways()"><i data-lucide="rotate-ccw" aria-hidden="true"></i><span>Show All Plans</span></button></div>`;
        window.lucide?.createIcons();
        return;
      }
      container.innerHTML = visible.map(item => {
        const status = item.status_label || item.status || "pending_downpayment";
        const total = Number(item.total_amount || 0);
        const paid = Number(item.amount_paid || 0);
        const balance = Math.max(Number(item.balance ?? (total - paid)), 0);
        const progress = total > 0 ? Math.min(Math.max(Math.round((paid / total) * 100), 0), 100) : 0;
        const tone = ["ready_for_release", "released", "delivered"].includes(status) ? "paid" : ["overdue", "payment_failed"].includes(status) ? "overdue" : status === "cancelled" ? "neutral" : "pending";
        const days = daysUntilDate(item.due_date);
        const deadline = item.due_date ? `Payment deadline ${formatDate(item.due_date)}` : "No deadline set";
        const note = status === "cancelled" ? "Cancelled" : ["released", "delivered"].includes(status) ? "Completed" : status === "ready_for_release" ? "Fully paid" : status === "on_the_way" ? "Out for delivery" : days !== null ? (days < 0 ? `${Math.abs(days)} days past deadline` : days === 0 ? "Deadline today" : `${days} days remaining`) : "";
        return `
          <article class="plan-request layaway-plan">
            <div class="plan-item-head"><div><span class="plan-payment-number">${escapeHtml(deadline)}</span><h3>${escapeHtml(item.product_name || "Layaway product")}</h3>${item.variant_name || item.quantity ? `<span class="layaway-product-meta">${escapeHtml(item.variant_name || "")}${item.variant_name && item.quantity ? " &middot; " : ""}${item.quantity ? `Qty ${Number(item.quantity)}` : ""}</span>` : ""}</div><span class="payment-state ${tone}">${escapeHtml(layawayStatusLabel(status))}</span></div>
            <div class="plan-facts"><div><span>Total Amount</span><strong>${money(total)}</strong></div><div><span>Paid</span><strong>${money(paid)}</strong></div><div><span>Remaining</span><strong>${money(balance)}</strong></div></div>
            <div class="layaway-progress-label"><span>Payment progress</span><strong>${progress}% paid</strong></div>
            <progress class="plan-progress" max="${Math.max(total, 1)}" value="${Math.max(paid, 0)}" aria-label="Payment progress for ${escapeHtml(item.product_name || "Layaway product")}"></progress>
            <div class="plan-item-footer"><span class="layaway-deadline ${status === "overdue" ? "overdue" : ""}"><i data-lucide="${status === "cancelled" ? "circle-slash" : ["ready_for_release", "released", "delivered"].includes(status) ? "circle-check" : "clock-3"}" aria-hidden="true"></i>${escapeHtml(note)}</span><div class="plan-actions">
              ${usableCheckoutUrl(item) && status === "pending_downpayment" ? `<a class="btn btn-sm btn-dark icon-label" href="${escapeHtml(usableCheckoutUrl(item))}"><i data-lucide="wallet" aria-hidden="true"></i><span>Pay Downpayment</span></a>` : ""}
              ${["active", "overdue"].includes(status) && balance > 0 ? `<button class="btn btn-sm btn-dark icon-label" onclick="payLayawayInstallment(${Number(item.id)}, ${balance})"><i data-lucide="hand-coins" aria-hidden="true"></i><span>Make Payment</span></button>` : ""}
            </div></div>
          </article>
        `;
      }).join("");
      window.lucide?.createIcons();
    }

    async function payLayawayInstallment(id, balance) {
      const productName = layaways.find(item => Number(item.id) === Number(id))?.product_name || "Layaway plan";
      const values = await AppDialog.form({
        eyebrow: "Layaway payment",
        title: "Make a layaway payment",
        message: "Enter the amount you want to pay through GCash.",
        details: [
          { label: "Product", value: productName },
          { label: "Remaining balance", value: money(balance) }
        ],
        fields: [{ name: "amount", label: "Payment amount", type: "number", required: true, min: "0.01", max: Number(balance || 0), step: "0.01", defaultValue: Number(balance || 0).toFixed(2) }],
        submitText: "Continue to Payment"
      });
      if (!values) return;
      const amount = Number(values.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > Number(balance || 0)) return;
      try {
        const res = await fetch(`/layaways/${id}/payments/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: currentUser.id, amount, payment_method: "gcash" })
        });
        const data = await res.json();
        if (!res.ok) return alert(data.message || "Unable to create layaway payment.");
        if (data.payment_checkout_url) {
          window.location.href = data.payment_checkout_url;
          return;
        }
        alert(data.message || "Layaway payment created.");
      } catch (error) {
        alert(error.message || "Unable to create layaway payment.");
      }
    }

    async function loadInstallmentApplications() {
      const container = document.getElementById("installmentApplicationList");
      if (container) container.innerHTML = `<div class="empty-state">Loading installment requests...</div>`;

      try {
        const res = await fetch(`/installments/customer/${currentUser.id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Unable to load installment requests.");
        installmentApplications = Array.isArray(data) ? data : [];
      } catch (error) {
        installmentApplications = [];
      }

      renderInstallmentApplications();
    }

    async function loadNotifications() {
      const container = document.getElementById("profileNotifications");
      container.innerHTML = `<div class="empty-state">Loading notifications...</div>`;

      const res = await fetch(`/notifications/customer/${currentUser.id}`);
      const data = await res.json();

      if (!res.ok) {
        container.innerHTML = `<div class="empty-state">Unable to load notifications.</div>`;
        return;
      }

      notifications = Array.isArray(data) ? data : [];
      renderNotifications();
    }

    function customerNotificationText(value, item) {
      const text = String(value || "");
      if (!item.order_product_name) return text;
      return text.replace(/Order\s*(?:ID|#|number)?\s*[:#-]?\s*\d{1,10}/gi, item.order_product_name);
    }

    function customerNotificationTitle(item) {
      const title = customerNotificationText(item.title || "Notification", item);
      const productName = String(item.order_product_name || "");
      if (!productName || title.toLowerCase().indexOf(productName.toLowerCase()) !== 0) return title;
      return title.slice(productName.length).replace(/^[\s:|\-]+/, "") || "Order update";
    }

    function renderNotifications() {
      const container = document.getElementById("profileNotifications");

      if (!notifications.length) {
        container.innerHTML = `<div class="empty-state">No notifications yet.</div>`;
        return;
      }

      container.innerHTML = notifications.map(item => `
        <div class="notification-card ${Number(item.is_read) ? "" : "unread"} ${item.order_product_image ? "has-product-image" : ""}">
          ${item.order_product_image ? `<img class="notification-product-image" src="${escapeHtml(item.order_product_image)}" alt="${escapeHtml(item.order_product_name || "Ordered product")}" loading="lazy" onerror="this.hidden=true">` : ""}
          <div class="notification-content">
            ${item.order_product_name ? `<strong class="notification-product-name">${escapeHtml(item.order_product_name)}</strong>` : ""}
            <strong>${escapeHtml(customerNotificationTitle(item))}</strong>
            <span class="text-muted">${escapeHtml(item.message)}</span>
          </div>
          ${item.action_url ? `<a class="btn btn-dark" href="${escapeHtml(item.action_url)}" onclick="markNotificationRead(${item.id})">Open</a>` : ""}
        </div>
      `).join("");
    }

    async function markNotificationRead(id) {
      await fetch(`/notifications/${id}/read`, { method: "PUT" });
    }

    async function markAllNotificationsRead() {
      await fetch(`/notifications/customer/${currentUser.id}/read-all`, { method: "PUT" });
      await loadNotifications();
    }

    function setInstallmentView(view) {
      for (const name of ["schedule", "requests"]) {
        const selected = name === view;
        const tab = document.getElementById(`${name}Tab`);
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        document.getElementById(`${name}Panel`).hidden = !selected;
      }
    }

    function renderInstallmentOverview() {
      const outstanding = installmentSchedules.filter(schedule => computedScheduleStatus(schedule) !== "paid");
      const next = outstanding.filter(schedule => schedule.due_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
      const balance = outstanding.reduce((sum, schedule) => sum + Math.max(Number(schedule.amount_due || 0) - Number(schedule.amount_paid || 0), 0), 0);
      const active = new Set(outstanding.map(schedule => Number(schedule.order_id))).size;
      document.getElementById("installmentOverview").innerHTML = `
        <div class="payment-metric"><i data-lucide="calendar-check" aria-hidden="true"></i><span>Active Plans</span><strong>${active}</strong></div>
        <div class="payment-metric"><i data-lucide="clipboard-clock" aria-hidden="true"></i><span>Pending Requests</span><strong>${installmentApplications.filter(application => application.status === "pending").length}</strong></div>
        <div class="payment-metric"><i data-lucide="wallet" aria-hidden="true"></i><span>Scheduled Balance</span><strong>${money(balance)}</strong></div>
        <div class="payment-metric"><i data-lucide="calendar-clock" aria-hidden="true"></i><span>Next Unpaid Due</span><strong>${next ? money(Math.max(Number(next.amount_due || 0) - Number(next.amount_paid || 0), 0)) : "No upcoming dues"}</strong>${next ? `<small>${escapeHtml(formatDate(next.due_date))}</small>` : ""}</div>`;
      document.getElementById("scheduleCount").textContent = installmentSchedules.length;
      document.getElementById("requestsCount").textContent = installmentApplications.length;
      window.lucide?.createIcons();
    }

    function renderInstallmentApplications() {
      const container = document.getElementById("installmentApplicationList");
      if (!container) return;
      renderInstallmentOverview();

      if (!installmentApplications.length) {
        container.innerHTML = `<div class="payments-empty"><i data-lucide="clipboard-list" aria-hidden="true"></i><h3>No plan requests yet</h3></div>`;
        window.lucide?.createIcons();
        return;
      }

      container.innerHTML = installmentApplications.map(application => {
        const status = String(application.status || "pending").toLowerCase();
        const orderId = Number(application.order_id || 0);
        const productName = application.product_name || "Installment order";
        const paymentStatus = application.order_payment_status || application.payment_status || "installment_application_pending";
        const canPayDownpayment = status === "approved" && usableCheckoutUrl(application);
        const scheduleStarted = installmentSchedules.some(schedule => Number(schedule.order_id) === orderId);
        const requestNote = status === "pending"
          ? "Waiting for admin review. Downpayment button will appear after approval."
          : status === "approved"
            ? (scheduleStarted ? "Your monthly payment schedule is available." : "Approved. Pay the downpayment to start the monthly schedule.")
            : (application.admin_note || "Application was rejected.");

        return `
          <article class="plan-request">
            <div class="plan-item-head"><h3>${escapeHtml(productName)}</h3><span class="payment-state ${status === "approved" ? "paid" : status === "rejected" ? "overdue" : "pending"}">${escapeHtml(installmentApplicationStatusLabel(status))}</span></div>
            <div class="plan-facts"><div><span>Term</span><strong>${escapeHtml(application.preferred_terms || "-")} months</strong></div><div><span>Downpayment</span><strong>${money(application.downpayment_amount)}</strong></div><div><span>Monthly Payment</span><strong>${money(application.monthly_amount)}</strong></div></div>
            <p class="plan-note">${escapeHtml(requestNote)}</p>
            <div class="plan-item-footer"><span>${escapeHtml(paymentStatusLabel({ payment_status: paymentStatus, payment_method: "installment" }))}</span><div class="plan-actions">
              ${canPayDownpayment && !scheduleStarted ? `<a class="btn btn-sm btn-dark icon-label" href="${escapeHtml(usableCheckoutUrl(application))}"><i data-lucide="wallet" aria-hidden="true"></i><span>Pay Downpayment</span></a>` : ""}
              ${orderId ? `<a class="payment-view" href="/customer/order.html?order_id=${orderId}" title="View order" aria-label="View order for ${escapeHtml(productName)}"><i data-lucide="arrow-up-right" aria-hidden="true"></i></a>` : ""}
            </div></div>
          </article>
        `;
      }).join("");
      window.lucide?.createIcons();
    }

    function renderInstallmentSchedules() {
      const container = document.getElementById("installmentScheduleList");
      renderInstallmentOverview();
      const filterControl = document.getElementById("installmentScheduleFilter");
      filterControl.hidden = installmentSchedules.length === 0;
      const filter = filterControl.value;
      const visible = installmentSchedules.filter(schedule => filter === "all" || (filter === "paid" ? computedScheduleStatus(schedule) === "paid" : computedScheduleStatus(schedule) !== "paid"))
        .slice().sort((a, b) => scheduleAttentionRank(computedScheduleStatus(a)) - scheduleAttentionRank(computedScheduleStatus(b)) || String(a.due_date || "").localeCompare(String(b.due_date || "")));

      if (!installmentSchedules.length) {
        container.innerHTML = `<div class="payments-empty plan-schedule-empty"><i data-lucide="calendar-days" aria-hidden="true"></i><h3>No monthly schedule yet</h3><button class="btn btn-outline-dark icon-label" onclick="setInstallmentView('requests')"><i data-lucide="clipboard-list" aria-hidden="true"></i><span>View Plan Requests</span></button></div>`;
        window.lucide?.createIcons();
        return;
      }
      if (!visible.length) {
        container.innerHTML = `<div class="payments-empty"><h3>No ${filter === "paid" ? "paid" : "unpaid"} payments</h3></div>`;
        return;
      }
      container.innerHTML = visible.map(schedule => {
        const remaining = Math.max(Number(schedule.amount_due || 0) - Number(schedule.amount_paid || 0), 0);
        const status = computedScheduleStatus(schedule);
        return `
          <article class="plan-schedule-item">
            <div class="plan-item-head"><div><span class="plan-payment-number">Payment ${Number(schedule.installment_no) || "-"} &middot; ${escapeHtml(formatDate(schedule.due_date))}</span><h3>${escapeHtml(schedule.product_name || "Installment plan")}</h3></div><span class="payment-state ${status === "paid" ? "paid" : status === "overdue" ? "overdue" : "pending"}">${escapeHtml(scheduleStatusLabel(status))}</span></div>
            <div class="plan-facts"><div><span>Amount Due</span><strong>${money(schedule.amount_due)}</strong></div><div><span>Paid</span><strong>${money(schedule.amount_paid)}</strong></div><div><span>Remaining</span><strong>${money(remaining)}</strong></div></div>
            <progress class="plan-progress" max="${Math.max(Number(schedule.amount_due || 0), 1)}" value="${Math.max(Number(schedule.amount_paid || 0), 0)}" aria-label="Payment progress"></progress>
            <div class="plan-item-footer"><span>${escapeHtml(schedulePaymentLabel(schedule))}</span><div class="plan-actions">${scheduleActionControls(schedule)}<a class="payment-view" href="/customer/order.html?order_id=${Number(schedule.order_id)}" title="View order" aria-label="View order for ${escapeHtml(schedule.product_name || "Installment plan")}"><i data-lucide="arrow-up-right" aria-hidden="true"></i></a></div></div>
          </article>
        `;
      }).join("");
      window.lucide?.createIcons();
    }

    async function startInstallmentSchedulePayment(scheduleId) {
      const method = "gcash";
      try {
        const res = await fetch(`/installments/schedules/${scheduleId}/checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: currentUser.id, method })
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.message || "Unable to prepare installment GCash upload.");
          await loadInstallmentSchedules();
          await loadCustomerStatement();
          return;
        }
        if (data.payment_checkout_url) {
          window.location.href = data.payment_checkout_url;
          return;
        }
        alert(data.message || "You can now upload GCash proof for this installment.");
        await loadInstallmentSchedules();
        await loadCustomerStatement();
      } catch (error) {
        alert(error.message || "Unable to prepare installment GCash upload.");
      }
    }

    async function refreshInstallmentSchedulePayment(scheduleId) {
      try {
        const res = await fetch(`/installments/schedules/${scheduleId}/status?user_id=${currentUser.id}`);
        const data = await res.json();
        if (!res.ok) {
          alert(data.message || "Unable to refresh installment payment.");
          await loadInstallmentSchedules();
          await loadCustomerStatement();
          return;
        }
        await loadInstallmentSchedules();
        await loadCustomerStatement();
        await loadOrders();
        alert(`Installment payment status: ${schedulePaymentLabel(data)}`);
      } catch (error) {
        alert(error.message || "Unable to refresh installment payment.");
      }
    }

    function scrollToProfileNotifications() {
      window.showProfileView("notifications");
      if (typeof setNotificationFilter === "function") setNotificationFilter("unread");
      document.getElementById("notificationsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    function logout() {
      localStorage.removeItem("currentUser");
      window.location.href = "/";
    }

    function readCurrentUser() {
      try {
        const user = JSON.parse(localStorage.getItem("currentUser") || "null");
        if (!user) return null;
        user.role = String(user.role || "customer").toLowerCase();
        return user;
      } catch (error) {
        localStorage.removeItem("currentUser");
        return null;
      }
    }

    document.addEventListener("DOMContentLoaded", () => {
      currentUser = readCurrentUser();

      if (!currentUser || currentUser.role !== "customer") {
        window.location.href = `/auth.html?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }

      document.getElementById("customerName").innerText = currentUser.name || "Customer";
      document.getElementById("customerEmail").innerText = currentUser.email || "";
      document.querySelector('.plan-tabs').addEventListener('keydown', event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const view = event.key === "Home" ? "schedule" : event.key === "End" ? "requests" : document.getElementById("scheduleTab").getAttribute("aria-selected") === "true" ? "requests" : "schedule";
        setInstallmentView(view);
        document.getElementById(`${view}Tab`).focus();
      });
      loadWishlist();
      refreshProfile();
    });
