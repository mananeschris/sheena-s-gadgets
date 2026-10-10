(() => {
  const modalElement = document.getElementById("installmentPlanModal");
  const body = document.getElementById("installmentPlanBody");
  let controller;
  let requestVersion = 0;
  let current = null;
  let activeTab = "overview";
  let actionBusy = false;
  let actionError = "";
  const tabs = { overview: "Overview", schedule: "Monthly Schedule", history: "Payment History" };
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const date = value => value ? escapeHtml(formatDate(value)) : "Not available";
  const badge = status => `<span class="full-plan-status ${escapeHtml(status || "pending")}">${escapeHtml(statementStatusLabel(status))}</span>`;
  const proof = path => path ? `<a class="full-plan-proof" href="${escapeHtml(path)}" target="_blank" rel="noopener">${adminIcon("image")}<span>View Proof</span></a>` : "";

  function planStatus(statement, plan) {
    if (plan.application?.status === "rejected") return "Application rejected";
    if (statement.order_status === "cancelled") return "Order cancelled";
    if (statement.payment_status === "installment_completed") return "Fully paid";
    if (plan.application?.status === "pending") return "Awaiting application approval";
    if (plan.downpayment.status !== "paid") return "Awaiting verified downpayment";
    return "Active plan";
  }

  function overviewHtml(statement, plan) {
    const application = plan.application || {};
    const items = plan.items?.length ? plan.items : [{ product_name: statement.product_name, variant_name: plan.variant_name, quantity: plan.quantity, product_image: plan.product_image }];
    return `
      <div class="full-plan-overview">
        <section><h6>Customer</h6><dl class="full-plan-details"><dt>Name</dt><dd>${escapeHtml(statement.customer_name)}</dd><dt>Email</dt><dd>${escapeHtml(statement.customer_email || "Not available")}</dd><dt>Contact</dt><dd>${escapeHtml(plan.customer_phone || "Not available")}</dd><dt>Address</dt><dd>${escapeHtml(plan.delivery_address || "Not available")}</dd></dl></section>
        <section><h6>Plan Details</h6><dl class="full-plan-details"><dt>Term</dt><dd>${escapeHtml(application.preferred_terms ?? statement.installment_terms ?? "-")} months</dd><dt>Monthly amount</dt><dd>${money(application.monthly_amount ?? statement.installment_monthly)}</dd><dt>Downpayment</dt><dd>${money(application.downpayment_amount ?? statement.installment_downpayment)} · ${escapeHtml(plan.downpayment.status)}</dd><dt>Financed amount</dt><dd>${money(application.financed_amount ?? statement.schedule_total_due)}</dd><dt>Submitted</dt><dd>${date(application.created_at || statement.created_at)}</dd><dt>Reviewed</dt><dd>${date(application.reviewed_at)}</dd></dl></section>
      </div>
      <section class="full-plan-products"><h6>Products</h6>${items.map(item => `<div class="full-plan-product"><img src="${escapeHtml(item.product_image || plan.product_image || "/assets/sheena-mark.svg")}" alt="${escapeHtml(item.product_name || "Product")}"><div><strong>${escapeHtml(item.product_name || "Product")}</strong><span>${escapeHtml(item.variant_name || "Default")} · Qty ${escapeHtml(item.quantity || 1)}</span></div></div>`).join("")}</section>
      ${application.admin_note ? `<div class="full-plan-note"><strong>Admin note</strong><p>${escapeHtml(application.admin_note)}</p></div>` : ""}
    `;
  }

  function scheduleHtml(statement, plan) {
    if (!statement.schedules.length) return `<div class="full-plan-empty">${adminIcon("calendar-clock")}<strong>No monthly schedule yet</strong><span>${escapeHtml(planStatus(statement, plan))}</span></div>`;
    const canCollect = (!plan.application || plan.application.status === "approved") && plan.downpayment.status === "paid" && statement.order_status !== "cancelled";
    return `<div class="full-plan-table-wrap"><table class="table align-middle"><thead><tr><th>Month</th><th>Due Date</th><th>Amount Due</th><th>Paid</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>${statement.schedules.map(schedule => `<tr>
      <td>${escapeHtml(schedule.installment_no)}</td><td>${date(schedule.due_date)}</td><td>${money(schedule.amount_due)}</td><td>${money(schedule.amount_paid)}</td><td>${money(schedule.balance)}</td><td>${badge(schedule.status)}</td>
      <td><div class="full-plan-actions">${canCollect && number(schedule.balance) > 0 ? `<button type="button" class="btn btn-sm btn-dark" onclick="recordFullPlanPayment(${Number(schedule.id)})" ${actionBusy ? "disabled" : ""}>${adminIcon("receipt")}<span>Record Payment</span></button>` : ""}${schedule.payment_status === "pending_verification" ? `<button type="button" class="btn btn-sm btn-outline-dark" onclick="checkFullPlanPayment(${Number(schedule.id)})" ${actionBusy ? "disabled" : ""}>${adminIcon("refresh-cw")}<span>Check Payment</span></button>` : ""}${proof(schedule.payment_proof_image)}</div></td>
    </tr>`).join("")}</tbody></table></div>`;
  }

  function historyHtml(statement, plan) {
    const downpayment = plan.downpayment;
    return `<section class="full-plan-downpayment"><h6>Downpayment</h6><dl class="full-plan-details"><dt>Status</dt><dd>${escapeHtml(downpayment.status)}</dd><dt>Reference</dt><dd>${escapeHtml(downpayment.reference || "Not submitted")}</dd><dt>Submitted</dt><dd>${date(downpayment.submitted_at)}</dd><dt>Verified</dt><dd>${date(downpayment.verified_at)}</dd></dl>${proof(downpayment.proof_image)}${downpayment.rejection_reason ? `<p class="text-danger mt-2">${escapeHtml(downpayment.rejection_reason)}</p>` : ""}</section>
      <section class="full-plan-ledger"><h6>Payment Ledger</h6>${adminStatementLedgerHtml(statement)}</section>
      ${statement.schedules.length ? `<section class="full-plan-references"><h6>Monthly Payment References</h6><div class="full-plan-table-wrap"><table class="table"><thead><tr><th>Month</th><th>Reference</th><th>Payment Status</th><th>Paid At</th><th>Proof</th></tr></thead><tbody>${statement.schedules.map(schedule => `<tr><td>${escapeHtml(schedule.installment_no)}</td><td>${escapeHtml(schedule.payment_reference || "Not recorded")}</td><td>${escapeHtml(schedulePaymentLabel(schedule))}</td><td>${date(schedule.paid_at)}</td><td>${proof(schedule.payment_proof_image) || "Not available"}</td></tr>`).join("")}</tbody></table></div></section>` : ""}`;
  }

  function render() {
    const { statement, plan } = current;
    const percent = number(statement.total_price) > 0 ? Math.min(100, Math.max(0, number(statement.total_paid) / number(statement.total_price) * 100)) : 0;
    body.innerHTML = `
      <div class="full-plan-heading"><span>${escapeHtml(orderReference(statement.order_id))}</span><strong>${escapeHtml(planStatus(statement, plan))}</strong><button type="button" class="btn btn-outline-dark full-plan-icon" onclick="viewInstallmentFullPlan(${Number(statement.order_id)}, '${activeTab}')" title="Refresh plan" aria-label="Refresh plan">${adminIcon("refresh-cw")}</button></div>
      <div class="full-plan-metrics"><div><span>Total Plan</span><strong>${money(statement.total_price)}</strong></div><div><span>Total Paid</span><strong>${money(statement.total_paid)}</strong></div><div><span>Remaining Balance</span><strong>${money(statement.balance)}</strong></div><div class="${number(statement.overdue_amount) > 0 ? "has-overdue" : ""}"><span>Overdue Amount</span><strong>${money(statement.overdue_amount)}</strong></div></div>
      <div class="full-plan-progress"><progress value="${percent}" max="100" aria-label="Plan payment progress"></progress><span>${Math.round(percent)}% paid</span></div>
      <div class="full-plan-next"><span>Next Due</span><strong>${statement.next_due_date ? `${date(statement.next_due_date)} · ${money(statement.next_due_amount)}` : "No scheduled payment due"}</strong></div>
      <div class="full-plan-tabs" role="tablist" aria-label="Installment plan views">${Object.entries(tabs).map(([key, label]) => `<button type="button" id="fullPlanTab-${key}" role="tab" aria-controls="fullPlanPanel-${key}" aria-selected="${key === activeTab}" tabindex="${key === activeTab ? 0 : -1}" onclick="showFullPlanTab('${key}')">${label}</button>`).join("")}</div>
      <section id="fullPlanPanel-overview" role="tabpanel" aria-labelledby="fullPlanTab-overview" ${activeTab !== "overview" ? "hidden" : ""}>${overviewHtml(statement, plan)}</section>
      <section id="fullPlanPanel-schedule" role="tabpanel" aria-labelledby="fullPlanTab-schedule" ${activeTab !== "schedule" ? "hidden" : ""}>${scheduleHtml(statement, plan)}</section>
      <section id="fullPlanPanel-history" role="tabpanel" aria-labelledby="fullPlanTab-history" ${activeTab !== "history" ? "hidden" : ""}>${historyHtml(statement, plan)}</section>
      ${actionError ? `<p class="text-danger mt-3" role="alert">${escapeHtml(actionError)}</p>` : ""}<div class="full-plan-footer"><button type="button" class="btn btn-sm btn-outline-dark" onclick="openFullPlanOrder()">${adminIcon("external-link")}<span>View Order</span></button>${["for_verification", "pending_verification"].includes(statement.payment_status) ? `<button type="button" class="btn btn-sm btn-dark" onclick="openFullPlanOrder('payment')">${adminIcon("wallet")}<span>Review Downpayment</span></button>` : ""}</div>`;
    refreshAdminIcons();
  }

  window.showFullPlanTab = key => {
    if (!tabs[key] || !current) return;
    activeTab = key;
    Object.keys(tabs).forEach(tab => {
      const button = document.getElementById(`fullPlanTab-${tab}`);
      button.setAttribute("aria-selected", String(tab === key));
      button.tabIndex = tab === key ? 0 : -1;
      document.getElementById(`fullPlanPanel-${tab}`).hidden = tab !== key;
    });
  };

  window.viewInstallmentFullPlan = async (orderId, tab = "overview") => {
    if (!requireAdminAction("Only admin can view installment plans.")) return;
    if (!Number.isInteger(Number(orderId)) || Number(orderId) <= 0) return;
    controller ||= createModalController("installmentPlanModal");
    const version = ++requestVersion;
    current = null;
    actionError = "";
    activeTab = tabs[tab] ? tab : "overview";
    document.getElementById("installmentPlanTitle").textContent = "Full Plan";
    body.setAttribute("aria-busy", "true");
    body.innerHTML = `<div class="full-plan-empty">${adminIcon("loader-circle")}<strong>Loading installment plan...</strong></div>`;
    controller.show();
    refreshAdminIcons();
    try {
      const response = await fetch(`/soa/admin/plan/${Number(orderId)}?${actorQueryString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Unable to load installment plan.");
      if (!data.statement || Number(data.statement.order_id) !== Number(orderId) || !data.plan || !Array.isArray(data.statement.schedules) || !Array.isArray(data.statement.payments)) throw new Error("Invalid installment plan response.");
      if (version !== requestVersion) return;
      current = data;
      document.getElementById("installmentPlanTitle").textContent = data.statement.product_name || "Full Plan";
      render();
    } catch (error) {
      if (version !== requestVersion) return;
      body.innerHTML = `<div class="full-plan-empty"><strong>Unable to load plan</strong><span>${escapeHtml(error.message)}</span><button type="button" class="btn btn-outline-dark" onclick="viewInstallmentFullPlan(${Number(orderId)}, '${activeTab}')">${adminIcon("refresh-cw")}<span>Retry</span></button></div>`;
      refreshAdminIcons();
    } finally {
      if (version === requestVersion) body.setAttribute("aria-busy", "false");
    }
  };

  async function scheduleAction(scheduleId, action) {
    const schedule = current?.statement.schedules.find(item => Number(item.id) === Number(scheduleId));
    if (!schedule || actionBusy) return;
    const orderId = current.statement.order_id;
    const version = requestVersion;
    actionBusy = true;
    actionError = "";
    render();
    try {
      await action(schedule);
      if (version === requestVersion) await viewInstallmentFullPlan(orderId, activeTab);
    } catch (error) {
      if (version === requestVersion) actionError = error.message || "Unable to update the payment.";
    } finally {
      actionBusy = false;
      if (current) render();
    }
  }

  window.recordFullPlanPayment = scheduleId => scheduleAction(scheduleId, schedule => recordInstallmentPayment(schedule.id, schedule.balance));
  window.checkFullPlanPayment = scheduleId => scheduleAction(scheduleId, schedule => refreshInstallmentSchedulePayment(schedule.id));
  window.openFullPlanOrder = (section = "") => {
    if (!current) return;
    const orderId = current.statement.order_id;
    modalElement.addEventListener("hidden.bs.modal", async () => {
      if (!allOrders.some(order => Number(order.id) === Number(orderId))) await loadOrders();
      viewOrder(Number(orderId), section);
    }, { once: true });
    controller.hide();
  };
  modalElement.addEventListener("hidden.bs.modal", () => {
    requestVersion += 1;
    current = null;
    body.setAttribute("aria-busy", "false");
  });
  body.addEventListener("keydown", event => {
    if (!event.target.matches('[role="tab"]') || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const keys = Object.keys(tabs);
    const index = event.key === "Home" ? 0 : event.key === "End" ? keys.length - 1 : (keys.indexOf(activeTab) + (event.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length;
    showFullPlanTab(keys[index]);
    document.getElementById(`fullPlanTab-${keys[index]}`).focus();
  });
})();
