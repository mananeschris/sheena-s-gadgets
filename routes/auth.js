const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { issueSession, revokeSession, sameOrigin } = require("./chatSession");
const { loginProtection, failedLogin, successfulLogin, securityEvent } = require('./authSecurity');

const VERIFICATION_CODE_MINUTES = 10;
const STORE_NAME = "Sheena's Gadgets & Accessories Shop";

function dbQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function isGmailAddress(email) {
  return /^[a-z0-9._%+-]+@gmail\.com$/i.test(String(email || "").trim());
}

function verificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashCode(code) {
  return crypto
    .createHash("sha256")
    .update(`${String(code || "").trim()}:${process.env.EMAIL_VERIFICATION_SECRET || "sheena-email-verification"}`)
    .digest("hex");
}

function mailConfigured() {
  return emailProvider() === "brevo"
    ? Boolean(process.env.BREVO_API_KEY)
    : emailProvider() === "resend" && Boolean(process.env.RESEND_API_KEY);
}

function emailProvider() {
  const configuredProvider = String(process.env.EMAIL_PROVIDER || "").trim().toLowerCase();
  if (configuredProvider === "brevo" || configuredProvider === "resend") return configuredProvider;
  if (process.env.BREVO_API_KEY) return "brevo";
  if (process.env.RESEND_API_KEY) return "resend";
  return "console";
}

async function ensureEmailVerificationColumns(db) {
  await require('./employeeAccounts').ensureStateSchema(db);
  const columns = [
    ["email_verified", "ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 1"],
    ["email_verification_code_hash", "ADD COLUMN email_verification_code_hash VARCHAR(255) NULL"],
    ["email_verification_expires_at", "ADD COLUMN email_verification_expires_at DATETIME NULL"],
    ["email_verified_at", "ADD COLUMN email_verified_at DATETIME NULL"]
  ];

  for (const [name, alter] of columns) {
    const rows = await dbQuery(db, `SHOW COLUMNS FROM users LIKE '${name}'`);
    if (rows.length) continue;
    try {
      await dbQuery(db, `ALTER TABLE users ${alter}`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }

  await dbQuery(db, `
    UPDATE users
    SET email_verified=1
    WHERE (email_verified IS NULL OR email_verified=0)
      AND (role <> 'customer' OR email_verification_code_hash IS NULL)
      AND (role NOT IN ('staff','rider') OR account_status='active')
  `);
}

async function ensurePendingRegistrationTable(db) {
  await dbQuery(db, `
    CREATE TABLE IF NOT EXISTS pending_customer_registrations (
      email VARCHAR(255) NOT NULL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      password VARCHAR(255) NOT NULL,
      birthday DATE NOT NULL,
      phone VARCHAR(50) NOT NULL,
      gender VARCHAR(40) NULL,
      address TEXT NOT NULL,
      city VARCHAR(255) NOT NULL,
      province VARCHAR(255) NOT NULL,
      postal_code VARCHAR(30) NOT NULL,
      verification_code_hash VARCHAR(255) NOT NULL,
      verification_expires_at DATETIME NOT NULL,
      verification_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureTwoFactorColumns(db) {
  const columns = [
    ["email_2fa_enabled", "ADD COLUMN email_2fa_enabled TINYINT(1) NOT NULL DEFAULT 0"],
    ["email_2fa_code_hash", "ADD COLUMN email_2fa_code_hash VARCHAR(255) NULL"],
    ["email_2fa_expires_at", "ADD COLUMN email_2fa_expires_at DATETIME NULL"],
    ["email_2fa_attempts", "ADD COLUMN email_2fa_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0"]
  ];

  for (const [name, alter] of columns) {
    const rows = await dbQuery(db, `SHOW COLUMNS FROM users LIKE '${name}'`);
    if (rows.length) continue;
    try {
      await dbQuery(db, `ALTER TABLE users ${alter}`);
    } catch (error) {
      if (error.code !== "ER_DUP_FIELDNAME") throw error;
    }
  }
}

function verificationPublicPayload(code) {
  if (process.env.NODE_ENV === "production") return {};
  if (mailConfigured()) return {};
  return { dev_code: code };
}

async function sendVerificationEmail(to, name, code) {
  if (!mailConfigured()) {
    console.log(`[email-verification] ${to}: ${code}`);
    return { sent: false, dev: true };
  }

  const safeName = String(name || "Customer").replace(/[<>&]/g, "");
  const subject = "Verify your Sheena's Gadgets account";
  const text = `Hi ${name || "Customer"},\n\nYour verification code is ${code}. It expires in ${VERIFICATION_CODE_MINUTES} minutes.\n\nIf you did not create this account, you can ignore this email.`;
  const html = `
      <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
        <h2>Verify your Sheena's Gadgets account</h2>
        <p>Hi ${safeName},</p>
        <p>Use this code to verify your account:</p>
        <div style="font-size:28px;font-weight:800;letter-spacing:6px;padding:14px 18px;border:1px solid #111;display:inline-block">${code}</div>
        <p>This code expires in ${VERIFICATION_CODE_MINUTES} minutes.</p>
      </div>
    `;

  if (emailProvider() === "brevo") {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": process.env.BREVO_API_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        sender: {
          name: process.env.EMAIL_FROM_NAME || STORE_NAME,
          email: process.env.EMAIL_FROM_ADDRESS || "no-reply@sheenas-gadgets.local"
        },
        to: [{ email: to, name: name || "Customer" }],
        subject,
        textContent: text,
        htmlContent: html
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Unable to send verification email through Brevo: ${errorText || response.status}`);
    }
    return { sent: true, provider: "brevo" };
  }

  if (emailProvider() === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || `${STORE_NAME} <onboarding@resend.dev>`,
        to,
        subject,
        text,
        html
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Unable to send verification email through Resend: ${errorText || response.status}`);
    }
    return { sent: true, provider: "resend" };
  }

  return { sent: true };
}

async function sendAccountSecurityEmail(to, name, code, resetUrl = "", notice = "") {
  const safeName = String(name || "Customer").replace(/[<>&]/g, "");
  const noticeText = typeof notice === 'string' ? notice : notice.text;
  const subject = notice ? (notice.subject || "Admin account sign-in alert") : resetUrl ? "Reset your Sheena's Gadgets password" : "Your sign-in security code";
  const text = notice ? noticeText : resetUrl
    ? `Hi ${name || "Customer"},\n\nReset your password using this link:\n${resetUrl}\n\nThe link expires in 15 minutes and can only be used once. If you did not request this, ignore this email. Your password will not change.`
    : `Hi ${name || "Customer"},\n\nYour sign-in code is ${code}. It expires in 10 minutes. If you did not try to sign in, change your password.`;
  const safeUrl = resetUrl.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const html = notice ? `<div style="font-family:Arial,sans-serif;color:#111"><h2>${subject}</h2><p>${noticeText.replace(/[<>&]/g, '')}</p></div>` : resetUrl
    ? `<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5"><h2>${subject}</h2><p>Hi ${safeName},</p><p><a href="${safeUrl}">Reset Password</a></p><p>The link expires in 15 minutes and can only be used once.</p><p>If you did not request this, ignore this email. Your password will not change.</p></div>`
    : `<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5"><h2>Your sign-in security code</h2><p>Hi ${safeName},</p><p>Use this code to complete your sign-in:</p><div style="font-size:28px;font-weight:800;letter-spacing:6px;padding:14px 18px;border:1px solid #111;display:inline-block">${code}</div><p>This code expires in 10 minutes. If you did not try to sign in, change your password.</p></div>`;
  if (!mailConfigured()) {
    if (process.env.NODE_ENV === "production") throw new Error("Account security email delivery is not configured.");
    console.log(resetUrl ? `[password-recovery] ${to}: ${resetUrl}` : `[email-2fa] ${to}: ${code}`);
    return { dev_code: code };
  }

  let response;
  if (emailProvider() === "brevo") {
    response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { accept: "application/json", "api-key": process.env.BREVO_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { name: process.env.EMAIL_FROM_NAME || STORE_NAME, email: process.env.EMAIL_FROM_ADDRESS || "no-reply@sheenas-gadgets.local" },
        to: [{ email: to, name: name || "Customer" }], subject, textContent: text, htmlContent: html
      })
    });
  } else {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM || `${STORE_NAME} <onboarding@resend.dev>`, to, subject, text, html })
    });
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Unable to send account security email: ${errorText || response.status}`);
  }
  return {};
}

const sendTwoFactorEmail = (to, name, code) => sendAccountSecurityEmail(to, name, code);
const adminAuth = require('./adminAuth')({
  sendCode: sendTwoFactorEmail, configured: mailConfigured, passwordMatches, safeUser, isValidPassword,
  notifyLogin: (user, ip) => sendAccountSecurityEmail(user.email, user.name, '', '', `Your admin account signed in at ${new Date().toISOString()} from IP ${ip}. If this was not you, reset your password immediately.`),
  notifySecurity: (user, ip, action) => sendAccountSecurityEmail(user.email, user.name, '', '', { subject: 'Admin account security alert', text: `${action} at ${new Date().toISOString()} from IP ${ip}. If this was not you, reset your password immediately.` })
});
router.use(adminAuth.router);
router.use(require("./passwordRecovery")({
  sendEmail: (user, url) => sendAccountSecurityEmail(user.email, user.name, "", url),
  ensureTwoFactorColumns,
  isValidPassword
}));

async function createAndSendVerification(db, user) {
  const code = verificationCode();
  await dbQuery(db, `
    UPDATE users
    SET email_verification_code_hash=?,
        email_verification_expires_at=DATE_ADD(NOW(), INTERVAL ? MINUTE),
        email_verified=IF(role='customer', email_verified, 1)
    WHERE id=?
  `, [hashCode(code), VERIFICATION_CODE_MINUTES, user.id]);
  const mail = await sendVerificationEmail(user.email, user.name, code);
  return { ...mail, ...verificationPublicPayload(code) };
}

function verificationResponse(message, email, delivery) {
  return {
    message,
    requires_verification: true,
    email,
    ...(delivery?.dev_code ? { dev_code: delivery.dev_code } : {})
  };
}

async function passwordMatches(inputPassword, storedPassword) {
  if (!storedPassword) return false;
  const rawPassword = String(inputPassword || "");
  const trimmedPassword = rawPassword.trim();
  if (await bcrypt.compare(rawPassword, storedPassword)) return true;
  if (trimmedPassword !== rawPassword) return bcrypt.compare(trimmedPassword, storedPassword);
  return false;
}

function cleanText(value, maxLength = 255) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeDateInput(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function customerAge(birthday) {
  const date = new Date(`${birthday}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const passed = today.getMonth() > date.getMonth() ||
    (today.getMonth() === date.getMonth() && today.getDate() >= date.getDate());
  if (!passed) age -= 1;
  return age;
}

function isValidPassword(password) {
  return /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/.test(String(password || ""));
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    birthday: normalizeDateInput(user.birthday),
    phone: user.phone || "",
    gender: user.gender || "",
    address: user.address || "",
    city: user.city || "",
    province: user.province || "",
    postal_code: user.postal_code || "",
    email_2fa_enabled: String(user.role).toLowerCase() === 'admin' || Number(user.email_2fa_enabled) === 1,
    admin_verification_required: String(user.role).toLowerCase() === 'admin'
  };
}

function getUserById(db, id) {
  return new Promise((resolve, reject) => {
    db.query(
      "SELECT id, name, email, role, birthday, phone, gender, address, city, province, postal_code, email_2fa_enabled FROM users WHERE id=? AND role='customer' LIMIT 1",
      [id],
      (err, rows) => err ? reject(err) : resolve(rows[0] || null)
    );
  });
}
// REGISTER
router.post("/register", async (req, res) => {
  const {
    name,
    email,
    password,
    birthday,
    phone,
    gender,
    address,
    city,
    province,
    postal_code
  } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required" });
  }

  if (!birthday || !phone || !address || !city || !province || !postal_code) {
    return res.status(400).json({ message: "Complete customer profile information is required" });
  }

  const birthDate = new Date(birthday);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());

  if (!hasBirthdayPassed) age -= 1;

  if (Number.isNaN(birthDate.getTime()) || age < 13) {
    return res.status(400).json({ message: "Customer must be at least 13 years old" });
  }

  const isValidPassword = (password) => {
    const regex = /^(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;
    return regex.test(password);
  };

  if (!isValidPassword(password)) {
    return res.status(400).json({ message: "Weak password" });
  }

  const normalizedEmail = normalizeEmail(email);
  if (!isGmailAddress(normalizedEmail)) {
    return res.status(400).json({ message: "Please use a valid Gmail address for customer registration." });
  }

  try {
    await ensurePendingRegistrationTable(req.db);
    const result = await dbQuery(req.db, "SELECT * FROM users WHERE LOWER(TRIM(email)) = ?", [normalizedEmail]);
    if (result.length > 0) {
      return res.status(400).json({ message: "Email exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const code = verificationCode();
    const values = [
      normalizedEmail, cleanText(name, 255), hashedPassword, birthday, cleanText(phone, 50),
      cleanText(gender, 40) || null, cleanText(address, 2000), cleanText(city, 255),
      cleanText(province, 255), cleanText(postal_code, 30), hashCode(code), VERIFICATION_CODE_MINUTES
    ];
    await dbQuery(req.db, `
      INSERT INTO pending_customer_registrations
        (email, name, password, birthday, phone, gender, address, city, province, postal_code,
         verification_code_hash, verification_expires_at, verification_attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), 0)
      ON DUPLICATE KEY UPDATE
        name=VALUES(name), password=VALUES(password), birthday=VALUES(birthday), phone=VALUES(phone),
        gender=VALUES(gender), address=VALUES(address), city=VALUES(city), province=VALUES(province),
        postal_code=VALUES(postal_code), verification_code_hash=VALUES(verification_code_hash),
        verification_expires_at=VALUES(verification_expires_at), verification_attempts=0, created_at=CURRENT_TIMESTAMP
    `, values);

    const delivery = await sendVerificationEmail(normalizedEmail, cleanText(name, 255), code);
    res.json(verificationResponse("Check your email and enter the code to finish creating your account. Your account will be created after verification.", normalizedEmail, { ...delivery, ...verificationPublicPayload(code) }));
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to create account" });
  }
});

// LOGIN
router.post("/login", sameOrigin, loginProtection, async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  try {
    await ensureEmailVerificationColumns(req.db);
    await ensureTwoFactorColumns(req.db);
    const result = await dbQuery(req.db, "SELECT * FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1", [normalizedEmail]);
    if (result.length === 0) {
      await bcrypt.compare(String(password), '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
      await failedLogin(req);
      return res.status(400).json({ message: "Incorrect email or password." });
    }

    const user = result[0];

    const isMatch = await passwordMatches(password, user.password);

    if (!isMatch) {
      await failedLogin(req);
      return res.status(400).json({ message: "Incorrect email or password." });
    }

    if (['staff','rider'].includes(String(user.role).toLowerCase()) && user.account_status !== 'active') {
      return res.status(403).json({ message: user.account_status === 'disabled' ? 'Your account is disabled. Contact the admin.' : 'Activate your account using the invitation email before signing in. Contact the admin for a new invitation.' });
    }
    if (String(user.role).toLowerCase() === 'admin') return await adminAuth.startLogin(req, res, user);

    if (String(user.role || "customer").toLowerCase() === "customer" && Number(user.email_verified) !== 1) {
      const delivery = await createAndSendVerification(req.db, user);
      return res.status(403).json(verificationResponse("Verify your Gmail before signing in. We sent a new code.", user.email, delivery));
    }

    if (String(user.role || "customer").toLowerCase() === "customer" && Number(user.email_2fa_enabled) === 1) {
      const code = verificationCode();
      const codeHash = await bcrypt.hash(code, 10);
      await dbQuery(req.db, `UPDATE users SET email_2fa_code_hash=?, email_2fa_expires_at=DATE_ADD(NOW(), INTERVAL 10 MINUTE), email_2fa_attempts=0 WHERE id=?`, [codeHash, user.id]);
      const delivery = await sendTwoFactorEmail(user.email, user.name, code);
      return res.json({ message: "Enter the sign-in code sent to your email.", requires_two_factor: true, email: user.email, ...(delivery.dev_code ? { dev_code: delivery.dev_code } : {}) });
    }

    await issueSession(req, res, user);
    await successfulLogin(req, user);
    res.json({
      message: "Login successful",
      user: safeUser(user)
    });
  } catch (error) {
    res.status(503).json({ message: "Unable to sign in. Please try again." });
  }
});

router.post("/verify-two-factor", sameOrigin, loginProtection, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const code = String(req.body.code || "").trim();
  if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ message: "Enter the 6-digit sign-in code." });

  try {
    await ensureTwoFactorColumns(req.db);
    const users = await dbQuery(req.db, `SELECT *, email_2fa_expires_at < NOW() AS code_expired FROM users WHERE LOWER(TRIM(email))=? AND role='customer' LIMIT 1`, [email]);
    const user = users[0];
    if (!user || Number(user.email_2fa_enabled) !== 1 || !user.email_2fa_code_hash) return res.status(400).json({ message: "No active sign-in code. Sign in again to request a new code." });
    if (Number(user.email_2fa_attempts) >= 5) {
      await dbQuery(req.db, "UPDATE users SET email_2fa_code_hash=NULL, email_2fa_expires_at=NULL, email_2fa_attempts=0 WHERE id=?", [user.id]);
      return res.status(429).json({ message: "Too many incorrect codes. Sign in again to request a new code." });
    }
    if (Number(user.code_expired) === 1) return res.status(400).json({ message: "Sign-in code expired. Sign in again to request a new code." });
    if (!await bcrypt.compare(code, user.email_2fa_code_hash)) {
      await dbQuery(req.db, "UPDATE users SET email_2fa_attempts=email_2fa_attempts+1 WHERE id=?", [user.id]);
      return res.status(400).json({ message: "Incorrect sign-in code." });
    }
    const consumed = await dbQuery(req.db, "UPDATE users SET email_2fa_code_hash=NULL, email_2fa_expires_at=NULL, email_2fa_attempts=0 WHERE id=? AND email_2fa_code_hash=?", [user.id, user.email_2fa_code_hash]);
    if (!consumed.affectedRows) return res.status(400).json({ message: 'This code has already been used. Sign in again.' });
    await issueSession(req, res, user);
    await successfulLogin(req, user);
    res.json({ message: "Login successful", user: safeUser(user) });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to verify sign-in code." });
  }
});

router.post("/logout", sameOrigin, async (req, res) => {
  try {
    await adminAuth.clearChallenge(req, res);
    const user = await require('./adminSessions').storeSession(req);
    if (user) await securityEvent(req, 'logout', user, 'Signed out');
    await revokeSession(req, res);
    res.json({ message: "Signed out." });
  } catch (_) { res.status(503).json({ message: "Unable to sign out securely. Please try again." }); }
});

router.post("/verify-email", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const code = String(req.body.code || "").trim();

  if (!email || !code) {
    return res.status(400).json({ message: "Email and verification code are required" });
  }

  try {
    await ensurePendingRegistrationTable(req.db);
    const pendingRows = await dbQuery(req.db, `
      SELECT *, verification_expires_at < NOW() AS code_expired
      FROM pending_customer_registrations
      WHERE email=?
      LIMIT 1
    `, [email]);
    const pending = pendingRows[0];

    if (pending) {
      if (Number(pending.verification_attempts) >= 5) {
        await dbQuery(req.db, "DELETE FROM pending_customer_registrations WHERE email=?", [email]);
        return res.status(429).json({ message: "Too many incorrect codes. Please sign up again to request a new code." });
      }
      if (Number(pending.code_expired) === 1) {
        return res.status(400).json({ message: "Verification code expired. Request a new code to finish sign-up." });
      }
      if (hashCode(code) !== pending.verification_code_hash) {
        await dbQuery(req.db, "UPDATE pending_customer_registrations SET verification_attempts=verification_attempts+1 WHERE email=?", [email]);
        return res.status(400).json({ message: "Invalid verification code." });
      }

      await ensureEmailVerificationColumns(req.db);
      try {
        await dbQuery(req.db, `
          INSERT INTO users
            (name, email, password, role, birthday, phone, gender, address, city, province, postal_code,
             email_verified, email_verification_code_hash, email_verification_expires_at, email_verified_at)
          VALUES (?, ?, ?, 'customer', ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, NOW())
        `, [pending.name, pending.email, pending.password, pending.birthday, pending.phone, pending.gender, pending.address, pending.city, pending.province, pending.postal_code]);
      } catch (error) {
        if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "An account with this email already exists. Please sign in." });
        throw error;
      }
      await dbQuery(req.db, "DELETE FROM pending_customer_registrations WHERE email=?", [email]);
      return res.json({ message: "Email verified. Your customer account has been created. You can sign in now.", account_created: true });
    }

    await ensureEmailVerificationColumns(req.db);
    const rows = await dbQuery(req.db, `
      SELECT users.*, email_verification_expires_at < NOW() AS verification_expired
      FROM users
      WHERE LOWER(TRIM(email))=? AND role='customer'
      LIMIT 1
    `, [email]);
    const user = rows[0];
    if (!user) return res.status(404).json({ message: "Account not found" });
    if (Number(user.email_verified) === 1) return res.json({ message: "Email is already verified. You can sign in now." });
    if (!user.email_verification_code_hash || !user.email_verification_expires_at) {
      return res.status(400).json({ message: "No active verification code. Please resend a new code." });
    }

    if (Number(user.verification_expired) === 1) {
      return res.status(400).json({ message: "Verification code expired. Please resend a new code." });
    }

    if (hashCode(code) !== user.email_verification_code_hash) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    await dbQuery(req.db, `
      UPDATE users
      SET email_verified=1,
          email_verified_at=NOW(),
          email_verification_code_hash=NULL,
          email_verification_expires_at=NULL
      WHERE id=?
    `, [user.id]);

    res.json({ message: "Gmail verified. You can sign in now." });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to verify email" });
  }
});

router.post("/resend-verification", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!email) return res.status(400).json({ message: "Email is required" });
  if (!isGmailAddress(email)) {
    return res.status(400).json({ message: "Please use a valid Gmail address." });
  }

  try {
    await ensurePendingRegistrationTable(req.db);
    const pendingRows = await dbQuery(req.db, "SELECT name FROM pending_customer_registrations WHERE email=? LIMIT 1", [email]);
    if (pendingRows[0]) {
      const code = verificationCode();
      await dbQuery(req.db, `
        UPDATE pending_customer_registrations
        SET verification_code_hash=?, verification_expires_at=DATE_ADD(NOW(), INTERVAL ? MINUTE), verification_attempts=0
        WHERE email=?
      `, [hashCode(code), VERIFICATION_CODE_MINUTES, email]);
      const delivery = await sendVerificationEmail(email, pendingRows[0].name, code);
      return res.json(verificationResponse("A new sign-up verification code was sent to your email.", email, { ...delivery, ...verificationPublicPayload(code) }));
    }

    await ensureEmailVerificationColumns(req.db);
    const rows = await dbQuery(req.db, "SELECT * FROM users WHERE LOWER(TRIM(email))=? AND role='customer' LIMIT 1", [email]);
    const user = rows[0];
    if (!user) return res.status(404).json({ message: "Account not found" });
    if (Number(user.email_verified) === 1) return res.json({ message: "Email is already verified. You can sign in now." });

    const delivery = await createAndSendVerification(req.db, user);
    res.json(verificationResponse("A new verification code was sent to your Gmail.", user.email, delivery));
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to resend verification code" });
  }
});

// CUSTOMER PROFILE
router.get("/profile/:id", require('./customerAccess').customerSession, require('./customerAccess').customerIdentity('id'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Valid customer id is required" });
  }

  try {
    await ensureTwoFactorColumns(req.db);
    const user = await getUserById(req.db, id);
    if (!user) return res.status(404).json({ message: "Customer profile not found" });
    res.json({ user: safeUser(user) });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load customer profile" });
  }
});

router.put("/profile/:id", require('./customerAccess').customerSession, require('./customerAccess').customerIdentity('id'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Valid customer id is required" });
  }

  const name = cleanText(req.body.name, 255);
  const email = normalizeEmail(req.body.email);
  const birthday = normalizeDateInput(req.body.birthday);
  const phone = cleanText(req.body.phone, 50);
  const gender = cleanText(req.body.gender, 40) || null;

  if (!name || !email || !birthday || !phone) {
    return res.status(400).json({ message: "Name, email, birthday, and phone are required" });
  }

  const age = customerAge(birthday);
  if (age === null || age < 13) {
    return res.status(400).json({ message: "Customer must be at least 13 years old" });
  }

  try {
    await ensureTwoFactorColumns(req.db);
    const existing = await getUserById(req.db, id);
    if (!existing) return res.status(404).json({ message: 'Customer profile not found.' });
    if (normalizeEmail(existing.email) !== email) return res.status(400).json({ message: 'Email changes require verification. Contact the shop to update your email securely.' });
    const duplicate = await new Promise((resolve, reject) => {
      req.db.query(
        "SELECT id FROM users WHERE LOWER(TRIM(email))=? AND id<>? LIMIT 1",
        [email, id],
        (err, rows) => err ? reject(err) : resolve(rows)
      );
    });
    if (duplicate.length) return res.status(400).json({ message: "Email is already used by another account" });

    await new Promise((resolve, reject) => {
      req.db.query(
        "UPDATE users SET name=?, email=?, birthday=?, phone=?, gender=? WHERE id=? AND role='customer'",
        [name, email, birthday, phone, gender, id],
        (err, result) => err ? reject(err) : resolve(result)
      );
    });

    const user = await getUserById(req.db, id);
    if (!user) return res.status(404).json({ message: "Customer profile not found" });
    res.json({ message: "Profile updated successfully", user: safeUser(user) });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to update profile" });
  }
});

router.put("/profile/:id/password", require('./customerAccess').customerSession, require('./customerAccess').customerIdentity('id'), async (req, res) => {
  const id = Number(req.params.id);
  const currentPassword = String(req.body.current_password || "");
  const newPassword = String(req.body.new_password || "");
  const confirmPassword = String(req.body.confirm_password || "");

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "Valid customer id is required" });
  }

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).json({ message: "Current password, new password, and confirmation are required" });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "New password and confirmation do not match" });
  }

  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ message: "Password must be at least 8 characters with uppercase letter, number, and special character" });
  }

  try {
    await ensureTwoFactorColumns(req.db);
    const users = await new Promise((resolve, reject) => {
      req.db.query("SELECT id, password FROM users WHERE id=? AND role='customer' LIMIT 1", [id], (err, rows) => err ? reject(err) : resolve(rows));
    });
    const user = users[0];
    if (!user) return res.status(404).json({ message: "Customer profile not found" });

    const matches = await passwordMatches(currentPassword, user.password);
    if (!matches) return res.status(400).json({ message: "Current password is incorrect" });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    // Change the password and expire other devices atomically, retaining this session.
    await dbQuery(req.db, `UPDATE users u LEFT JOIN delivery_chat_sessions s ON s.user_id=u.id
      SET u.password=?, u.email_2fa_code_hash=NULL, u.email_2fa_expires_at=NULL, u.email_2fa_attempts=0,
        s.expires_at=IF(s.token_hash=?, s.expires_at, NOW())
      WHERE u.id=? AND u.role='customer'`, [hashedPassword, req.storeSession.token_hash, id]);

    res.json({ message: "Password updated successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to update password" });
  }
});

router.put("/profile/:id/email-two-factor", require('./customerAccess').customerSession, require('./customerAccess').customerIdentity('id'), async (req, res) => {
  const id = Number(req.params.id);
  const enabled = req.body.enabled === true;
  const password = String(req.body.password || "");
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Valid customer id is required." });
  if (!password) return res.status(400).json({ message: "Enter your current password to change this setting." });

  try {
    await ensureTwoFactorColumns(req.db);
    const users = await dbQuery(req.db, "SELECT id, email, password, email_verified FROM users WHERE id=? AND role='customer' LIMIT 1", [id]);
    const user = users[0];
    if (!user) return res.status(404).json({ message: "Customer account not found." });
    if (!await passwordMatches(password, user.password)) return res.status(400).json({ message: "Current password is incorrect." });
    if (enabled && Number(user.email_verified) !== 1) return res.status(400).json({ message: "Verify your email before enabling sign-in codes." });
    if (enabled && process.env.NODE_ENV === "production" && !mailConfigured()) return res.status(400).json({ message: "Email delivery is not configured. Contact support before enabling sign-in codes." });
    await dbQuery(req.db, "UPDATE users SET email_2fa_enabled=?, email_2fa_code_hash=NULL, email_2fa_expires_at=NULL, email_2fa_attempts=0 WHERE id=? AND role='customer'", [enabled ? 1 : 0, id]);
    res.json({ message: enabled ? "Email sign-in verification enabled." : "Email sign-in verification disabled.", enabled });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to update sign-in security." });
  }
});

module.exports = router;
