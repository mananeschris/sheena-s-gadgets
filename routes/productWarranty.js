const MAX_WARRANTY_MONTHS = 120;
const MAX_WARRANTY_TEXT = 2000;

function productWarranty(body, existing = {}) {
  const value = key => body[key] === undefined ? existing[key] : body[key];
  const flag = String(value("warranty_eligible") ?? "0").trim().toLowerCase();
  if (!["0", "1", "false", "true", "off", "on", "no", "yes"].includes(flag)) {
    throw new Error("Choose a valid warranty eligibility setting.");
  }
  const eligible = ["1", "true", "on", "yes"].includes(flag);
  if (!eligible) return { warranty_eligible: 0, warranty_duration_months: 0, warranty_coverage: "", warranty_exclusions: "" };

  const months = Number(value("warranty_duration_months"));
  if (!Number.isInteger(months) || months < 1 || months > MAX_WARRANTY_MONTHS) {
    throw new Error("Warranty duration must be a whole number from 1 to 120 months (up to 10 years).");
  }
  const coverage = String(value("warranty_coverage") ?? "").trim();
  const exclusions = String(value("warranty_exclusions") ?? "").trim();
  if (coverage.length > MAX_WARRANTY_TEXT || exclusions.length > MAX_WARRANTY_TEXT) {
    throw new Error("Warranty coverage and exclusions must each be 2,000 characters or less.");
  }
  return { warranty_eligible: 1, warranty_duration_months: months, warranty_coverage: coverage, warranty_exclusions: exclusions };
}

module.exports = { productWarranty };
